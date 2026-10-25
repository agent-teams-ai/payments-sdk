import assert from "node:assert/strict";
import { lstat, readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  STANDARD,
  type LayerRole,
  type SurfaceMap,
  type UseEdge,
} from "@agent-teams/feature-module-standard";
import {
  checkFeatureModuleOnDisk,
  formatNodeReport,
} from "@agent-teams/feature-module-standard/node";
import { observeSourceGraph } from "@agent-teams/engineering-foundation/source-graph";
import { API } from "typescript/unstable/sync";
import * as ts from "typescript/unstable/ast";
import { repository } from "./package-artifacts.ts";
import { checkInnerEffects } from "./feature-effects.ts";

export type FeatureProfile = Readonly<{
  schemaVersion: number;
  status: string;
  standard: Readonly<{ id: string; version: string; digest: string }>;
  productionRoots: readonly string[];
  excludedRoots: readonly string[];
  deviations: readonly unknown[];
  modules: readonly Readonly<{
    id: string;
    root: string;
    sourceRoot: string;
    testRoots: readonly string[];
    publicEntrypoints: readonly string[];
    moduleAssembly: readonly string[];
    features: readonly Readonly<{
      id: string;
      root: string;
      layers: readonly Readonly<{ root: string; role: LayerRole }>[];
    }>[];
    surfaces: SurfaceMap;
    useEdges: readonly UseEdge[];
    exceptions: readonly unknown[];
    generatedRoots: readonly string[];
  }>[];
}>;

const within = (path: string, parent: string): boolean =>
  path === parent || path.startsWith(`${parent}/`);

async function entries(
  root: string,
  path: string,
): Promise<Readonly<{ files: string[]; directories: string[] }>> {
  const files: string[] = [],
    directories: string[] = [];
  async function visit(current: string): Promise<void> {
    for (const entry of await readdir(join(root, current), { withFileTypes: true })) {
      const child = `${current}/${entry.name}`;
      assert.ok(!entry.isSymbolicLink(), `Linked governed source is not supported: ${child}`);
      if (entry.isDirectory()) {
        directories.push(child);
        await visit(child);
      } else {
        assert.ok(entry.isFile(), `Governed source must be regular: ${child}`);
        files.push(child);
      }
    }
  }
  await visit(path);
  return { files: files.toSorted(), directories: directories.toSorted() };
}

function assertPortable(path: string): void {
  assert.ok(
    path !== "" &&
      !path.startsWith("/") &&
      !path.includes("\\") &&
      path.split("/").every((part) => part !== "." && part !== ".." && part !== ""),
    `Invalid profile path: ${path}`,
  );
}

async function checkFacade(
  root: string,
  sourceRoot: string,
  paths: readonly string[],
  allowed: readonly string[],
): Promise<void> {
  const graph = await observeSourceGraph({ consumerRoot: root, roots: [sourceRoot] });
  assert.deepEqual(graph.parseFailures, [], "Facade source graph is incomplete");
  assert.deepEqual(
    graph.unresolved.filter((edge) => paths.includes(edge.from)),
    [],
    "Facade target cannot be resolved",
  );
  assert.deepEqual(
    graph.unresolvedRuntimeReferences.filter((edge) => paths.includes(edge.from)),
    [],
    "Computed facade loading is not supported",
  );
  assert.deepEqual(
    graph.external.filter((edge) => paths.includes(edge.from)),
    [],
    "Module facades may forward only owned feature surfaces",
  );
  const api = new API({ cwd: root });
  try {
    using snapshot = api.updateSnapshot({ openFiles: paths.map((path) => join(root, path)) });
    for (const path of paths) {
      const full = join(root, path);
      const file = snapshot.getDefaultProjectForFile(full)?.program.getSourceFile(full);
      assert.ok(file, `Facade is outside compiler coverage: ${path}`);
      assert.ok(file.statements.length > 0, `Empty module facade: ${path}`);
      for (const statement of file.statements) {
        assert.ok(
          ts.isExportDeclaration(statement) &&
            statement.exportClause !== undefined &&
            ts.isNamedExports(statement.exportClause),
          `Module facade must contain only curated named re-exports: ${path}`,
        );
        assert.ok(
          statement.moduleSpecifier !== undefined && ts.isStringLiteral(statement.moduleSpecifier),
          `Facade must forward an owned surface: ${path}`,
        );
      }
    }
  } finally {
    api.close();
  }
  for (const edge of graph.edges.filter((item) => paths.includes(item.from))) {
    assert.ok(
      allowed.includes(edge.to),
      `Facade bypasses an owned curated feature surface: ${edge.from} -> ${edge.to}`,
    );
  }
}

async function checkModule(root: string, module: FeatureProfile["modules"][number]): Promise<void> {
  for (const path of [
    module.root,
    module.sourceRoot,
    ...module.testRoots,
    ...module.moduleAssembly,
    ...module.publicEntrypoints,
  ]) {
    assertPortable(path);
  }
  assert.ok(within(module.sourceRoot, module.root), `Source root escapes module ${module.id}`);
  assert.deepEqual(module.exceptions, [], `${module.id}: full FMS has no module exceptions`);
  assert.deepEqual(
    module.generatedRoots,
    [],
    `${module.id}: production source cannot be silently classified generated`,
  );
  const tree = await entries(root, module.sourceRoot);
  assert.ok(tree.files.length > 0, `Empty production module: ${module.id}`);
  const roleRoots = module.features.flatMap((feature) => feature.layers);
  for (const feature of module.features) {
    assertPortable(feature.root);
    assert.ok(
      within(feature.root, `${module.sourceRoot}/features`),
      `Feature escapes owned source: ${feature.id}`,
    );
    assert.ok(feature.layers.length > 0, `Feature has no owned layers: ${feature.id}`);
    for (const layer of feature.layers) {
      assertPortable(layer.root);
      assert.ok(within(layer.root, feature.root), `Layer escapes feature: ${layer.root}`);
      assert.ok(
        tree.files.some((file) => within(file, layer.root)),
        `Empty ceremonial layer: ${layer.root}`,
      );
    }
  }
  for (const directory of tree.directories) {
    const known =
      directory === `${module.sourceRoot}/features` ||
      module.features.some((feature) => directory === feature.root) ||
      roleRoots.some((layer) => within(directory, layer.root)) ||
      module.moduleAssembly.some((path) => within(path, directory));
    assert.ok(known, `Unmapped source directory: ${directory}`);
  }
  for (const file of tree.files) {
    assert.ok(
      file.endsWith(".ts") && !file.endsWith(".d.ts"),
      `Maintained source must be ordinary TypeScript: ${file}`,
    );
    assert.ok(
      module.moduleAssembly.includes(file) ||
        module.features.some((feature) => within(file, feature.root)),
      `Source outside declared feature ownership: ${file}`,
    );
  }
  const manifest = JSON.parse(await readFile(join(root, module.root, "package.json"), "utf8")) as {
    exports: Record<string, { types: string; import: string }>;
  };
  const exported = Object.values(manifest.exports)
    .map((target) => {
      assert.deepEqual(
        Object.keys(target).toSorted(),
        ["import", "types"],
        `${module.id}: exports must use the supported ESM and declaration conditions`,
      );
      assert.match(
        target.import,
        /^\.\/dist\/.+\.js$/u,
        `${module.id}: invalid runtime export target`,
      );
      assert.match(
        target.types,
        /^\.\/dist\/.+\.d\.ts$/u,
        `${module.id}: invalid declaration export target`,
      );
      const runtime = target.import.replace(/^\.\/dist\//u, "").replace(/\.js$/u, ".ts");
      const declaration = target.types.replace(/^\.\/dist\//u, "").replace(/\.d\.ts$/u, ".ts");
      assertPortable(runtime);
      assertPortable(declaration);
      assert.equal(
        declaration,
        runtime,
        `${module.id}: runtime and declaration exports must reach the same curated facade`,
      );
      return `${module.sourceRoot}/${runtime}`;
    })
    .toSorted();
  assert.deepEqual(
    exported,
    [...module.publicEntrypoints].toSorted(),
    `${module.id}: public manifest targets differ from the declared entrypoints`,
  );
  for (const path of module.publicEntrypoints) {
    assert.ok(
      module.moduleAssembly.includes(path),
      `${module.id}: public export must use a declared module facade: ${path}`,
    );
  }
  const curated = Object.values(module.surfaces).flat();
  await checkFacade(root, module.sourceRoot, module.moduleAssembly, curated);
  await checkInnerEffects(root, module);
  const testRoots: string[] = [];
  for (const testRoot of module.testRoots) {
    const testTree = await entries(root, testRoot);
    for (const file of testTree.files) {
      assert.ok(
        within(file, `${testRoot}/features`) || within(file, `${testRoot}/module`),
        `Test lacks feature or module ownership: ${file}`,
      );
    }
    const features = `${testRoot}/features`;
    if (testTree.files.some((file) => within(file, features))) {
      testRoots.push(features);
    }
  }
  assert.ok(
    testRoots.length <= 1,
    "This repository maps one mirrored feature test tree per module",
  );
  const report = await checkFeatureModuleOnDisk({
    consumerRoot: root,
    sourceRoots: [module.sourceRoot],
    testRoots,
    structure: {
      featureRoots: module.features.map((feature) => feature.root),
      roleRoots,
      featuresRoots: [`${module.sourceRoot}/features`],
    },
    moduleComposition: module.moduleAssembly,
    surfaces: module.surfaces,
    useEdges: module.useEdges,
    ...(testRoots[0] === undefined ? {} : { testFeaturesRoot: testRoots[0] }),
  });
  assert.equal(report.ok, true, `${module.id}:\n${formatNodeReport(report)}`);
  assert.deepEqual(
    report.diagnostics.filter(
      (item) => item.code === "test-unowned" || item.code === "test-misplaced",
    ),
    [],
    `${module.id}: selected feature tests must have explicit owners`,
  );
}

export async function checkFeatureModules(root = repository): Promise<void> {
  const profile = JSON.parse(
    await readFile(join(root, "architecture/feature-module-standard.json"), "utf8"),
  ) as FeatureProfile;
  assert.equal(profile.schemaVersion, 1);
  assert.equal(profile.status, "adopted");
  assert.deepEqual(
    { id: profile.standard.id, version: profile.standard.version, digest: profile.standard.digest },
    STANDARD,
    "FMS implementation and adopted immutable standard differ",
  );
  assert.deepEqual(profile.productionRoots, ["packages"]);
  assert.deepEqual(profile.excludedRoots, []);
  assert.deepEqual(profile.deviations, []);
  const actual = await readdir(join(root, "packages"), { withFileTypes: true });
  for (const entry of actual) {
    assert.ok(
      entry.isDirectory() && !entry.isSymbolicLink(),
      `Unexpected package entry: ${entry.name}`,
    );
  }
  assert.deepEqual(
    actual.map((entry) => `packages/${entry.name}`).toSorted(),
    profile.modules.map((module) => module.root).toSorted(),
    "Every production package needs explicit full FMS ownership",
  );
  assert.equal(
    new Set(profile.modules.map((module) => module.id)).size,
    profile.modules.length,
    "Duplicate module id",
  );
  for (const module of profile.modules) {
    const source = await lstat(join(root, module.sourceRoot));
    assert.ok(
      source.isDirectory() && !source.isSymbolicLink(),
      `Invalid source root: ${module.sourceRoot}`,
    );
    await checkModule(root, module);
  }
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await checkFeatureModules();
  console.log("Full FMS module ownership, public surfaces and layers passed.");
}
