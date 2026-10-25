import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { checkModuleLayout } from "@get-modular/conformance";
import { observeSourceGraph } from "@agent-teams/engineering-foundation/source-graph";
import { API } from "typescript/unstable/sync";
import * as ts from "typescript/unstable/ast";
import { parse } from "yaml";

const repository = resolve(import.meta.dirname, "../..");
const profilePath = "architecture/get-modular-consumer-profile.json";
const sourcePolicyPath = "architecture/foundation/source-dependencies.yaml";
const standard = {
  repository: "agent-teams-ai/get-modular",
  commit: "b70ba39304ac71964175c42a77309406a7c30ca2",
  path: "docs/architecture/common-assembly.md",
  sha256: "11a389b223506dc303fa986a7a37350b847013d85beb2de9d74cb8c97363e824",
  guide: "docs/guides/module-authoring.md",
  guideSha256: "9bdbc6a6eac511691cf429c7e7e12b4cf4fd86ec16a348fb3af7a46c989af144",
};
type Authored = Record<string, Record<string, string[]>>;
type Profile = {
  status: string;
  decision: string;
  standard: typeof standard;
  organization: { repository: string; commit: string; path: string; sha256: string };
  publishedArtifacts: { path: string; sha256: string };
  entrypoints: string[];
  roots: string[];
  authored: Authored;
  exceptions: {
    id: string;
    rule: string;
    paths: string[];
    owner: string;
    rationale: string;
    decision: string;
    reviewTrigger: string;
  }[];
  outsideScope: { boundary: string; owner: string; mechanism: string; reviewTrigger: string }[];
  verification: {
    adoption: string;
    sourceGraph: string;
    runtime: string;
    packed: string;
    tests: string[];
  };
  fullApplicationFms: string;
};
const read = (root: string, path: string) => readFile(join(root, path), "utf8");
const json = async <T>(root: string, path: string): Promise<T> =>
  JSON.parse(await read(root, path)) as T;
const normalized = (authored: Authored) =>
  Object.entries(authored)
    .flatMap(([path, apis]) =>
      Object.entries(apis).flatMap(([api, names]) => names.map((name) => `${path}:${api}:${name}`)),
    )
    .toSorted();

/** Only authored GM declarations/entries are inventoried; ordinary owner-local helpers may grow. */
function authoredCalls(file: ts.SourceFile, path: string, found: Authored): void {
  const names = new Map<string, string>(),
    namespaces = new Set<string>();
  const admitted = new Set(["declareModule", "defineContract", "implement", "input", "group"]);
  for (const statement of file.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== "@get-modular/assembly"
    ) {
      continue;
    }
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) {
      namespaces.add(bindings.name.text);
    }
    if (bindings && ts.isNamedImports(bindings)) {
      for (const binding of bindings.elements) {
        names.set(binding.name.text, binding.propertyName?.text ?? binding.name.text);
      }
    }
  }
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const api = ts.isIdentifier(callee)
        ? names.get(callee.text)
        : ts.isPropertyAccessExpression(callee) &&
            ts.isIdentifier(callee.expression) &&
            namespaces.has(callee.expression.text)
          ? callee.name.text
          : undefined;
      if (api !== undefined && admitted.has(api)) {
        let owner: ts.Node = node.parent;
        while (owner.kind !== ts.SyntaxKind.SourceFile && !ts.isVariableDeclaration(owner)) {
          owner = owner.parent;
        }
        assert.ok(
          ts.isVariableDeclaration(owner) && ts.isIdentifier(owner.name),
          `${path}: authored ${api} needs an explicit named declaration`,
        );
        const apis = (found[path] ??= {});
        (apis[api] ??= []).push(owner.name.text);
      }
    }
    node.forEachChild(visit);
  }
  visit(file);
}

async function check(root: string): Promise<void> {
  const profile = await json<Profile>(root, profilePath);
  assert.equal(profile.status, "scoped-active");
  assert.deepEqual(profile.standard, standard, "reviewed CMS/guide pin drift");
  assert.deepEqual(
    profile.organization,
    {
      repository: "agent-teams-ai/.github",
      commit: "a34ecc6bc9bb165771f3962dccd25970dd5c0d98",
      path: "docs/engineering-quality-standard.md",
      sha256: "a65fb5150837b010a71abe36cefd26c32709eb9b9e89f3938498a647e72f5587",
    },
    "organization source pin drift",
  );
  assert.deepEqual(
    profile.publishedArtifacts,
    {
      path: "qualification/observation/published-artifacts.json",
      sha256: "6f6190afcfcee4d0fec1d9bbba210b12fc678ded4777e0664aba406517fee5ea",
    },
    "published artifact record drift",
  );
  const artifactsText = await read(root, profile.publishedArtifacts.path);
  assert.equal(
    createHash("sha256").update(artifactsText).digest("hex"),
    profile.publishedArtifacts.sha256,
    "published archive identities changed",
  );
  const artifacts = JSON.parse(artifactsText) as {
    archives: { name: string; version: string; integrity: string }[];
  };
  const workspace = parse(await read(root, "pnpm-workspace.yaml")) as {
    catalog: Record<string, string>;
  };
  assert.equal(
    workspace.catalog["typescript"],
    "7.0.2",
    "public unstable AST API requires compiler requalification on upgrade",
  );
  const lock = parse(await read(root, "pnpm-lock.yaml")) as {
    packages: Record<string, { resolution: { integrity: string } }>;
  };
  for (const archive of artifacts.archives) {
    assert.equal(
      workspace.catalog[archive.name],
      archive.version,
      `${archive.name}: reviewed catalog version drift`,
    );
    assert.equal(
      lock.packages[`${archive.name}@${archive.version}`]?.resolution.integrity,
      archive.integrity,
      `${archive.name}: reviewed lock integrity drift`,
    );
  }
  assert.equal(profile.decision, "docs/get-modular-adoption.md#decision");
  assert.deepEqual(profile.entrypoints, [
    "packages/payments-get-modular/src/index.ts",
    "packages/payments-get-modular/src/observation/index.ts",
  ]);
  assert.deepEqual(profile.roots, [
    "paymentsModule",
    "purchaseProjectionModule",
    "purchaseProjectionDisplayModule",
  ]);
  assert.deepEqual(profile.exceptions, [], "unknown or stale CMS exception");
  assert.deepEqual(
    profile.outsideScope.map((boundary) => boundary.boundary),
    ["payments.core", "payments.paddle", "payments.postgres"],
  );
  for (const boundary of profile.outsideScope) {
    for (const value of [boundary.owner, boundary.mechanism, boundary.reviewTrigger]) {
      assert.ok(
        value.trim(),
        "outside scope classification needs an owner, mechanism and review trigger",
      );
    }
  }
  assert.equal(profile.fullApplicationFms, "adopted; architecture/feature-module-standard.json");
  const paths = [
    ...profile.entrypoints,
    ...Object.keys(profile.authored),
    ...profile.verification.tests,
    profile.decision.split("#")[0] ?? "",
  ];
  for (const path of paths) {
    assert.ok((await stat(join(root, path))).isFile(), `profile path missing: ${path}`);
  }
  const policy = parse(await read(root, sourcePolicyPath)) as { governedRoots: string[] };
  const graph = await observeSourceGraph({
    consumerRoot: root,
    roots: policy.governedRoots.filter((path) => path.endsWith("/src")),
  });
  assert.deepEqual(graph.parseFailures, [], "source inventory must be complete");
  const found: Authored = {};
  const api = new API({ cwd: root });
  try {
    using snapshot = api.updateSnapshot({ openFiles: graph.files.map((path) => join(root, path)) });
    for (const path of graph.files) {
      const fullPath = join(root, path);
      const project = snapshot.getDefaultProjectForFile(fullPath);
      const file = project?.program.getSourceFile(fullPath);
      assert.ok(file, `${path}: the pinned compiler must expose its authored AST`);
      authoredCalls(file, path, found);
    }
  } finally {
    api.close();
  }
  assert.deepEqual(
    normalized(found),
    normalized(profile.authored),
    "unknown or stale authored Get Modular boundary",
  );
  const moduleRoot = "packages/payments-get-modular/src/";
  const files = graph.files.filter((path) => path.startsWith(moduleRoot));
  const imports = graph.edges
    .filter((edge) => edge.from.startsWith(moduleRoot))
    .map((edge) => ({
      from: edge.from,
      to: edge.to,
      mode: edge.mode === "type-only" ? ("type" as const) : ("value" as const),
    }));
  const useCaseExports = Object.fromEntries(
    graph.runtimeExports
      .filter(
        (file) => file.path.startsWith(moduleRoot) && file.path.includes("/application/use-cases/"),
      )
      .map((file) => {
        assert.equal(
          file.status,
          "complete",
          `${file.path}: unclassified runtime exports require collector qualification`,
        );
        assert.deepEqual(file.unsupported, [], `${file.path}: unclassified runtime exports`);
        return [
          file.path,
          file.exports.map((item) => ({
            name: item.name,
            kind: item.kind === "function" ? ("function" as const) : ("value" as const),
          })),
        ];
      }),
  );
  assert.equal(
    Object.keys(useCaseExports).length,
    files.filter((path) => path.includes("/application/use-cases/")).length,
    "every use-case file needs an observed export record",
  );
  const layout = checkModuleLayout({ files, imports, useCaseExports });
  assert.equal(
    layout.featureCount,
    2,
    "expected payment-runtime and purchase-observation features",
  );
  assert.equal(layout.moduleCount, 3, "expected runtime, projection and display entries");

  const { scripts } = await json<{ scripts: Record<string, string> }>(root, "package.json");
  assert.deepEqual(
    { ...profile.verification, tests: [] },
    {
      adoption: "architecture:features:check",
      sourceGraph: "foundation:check",
      runtime: "test:modular",
      packed: "test:observation",
      tests: [],
    },
  );
  assert.equal(
    scripts["test:modular:adoption"],
    "node --test tools/test/get-modular-adoption.test.ts",
    "adoption command removed or retargeted",
  );
  assert.equal(
    scripts["architecture:features:check"],
    "node tools/check-feature-modules.ts && pnpm test:modular:adoption",
    "architecture command must execute the published CMS gate",
  );
  assert.equal(
    scripts["test:boundaries"],
    "node --test tools/test/*.test.ts",
    "boundary command must execute the scoped gate",
  );
  assert.equal(
    scripts["foundation:check"],
    "agent-teams-foundation check",
    "Foundation graph command removed or retargeted",
  );
  assert.equal(
    scripts["test:modular"],
    "node tools/run-tests.ts modular",
    "Modular runtime command removed or retargeted",
  );
  assert.equal(
    scripts["test:observation"],
    "node tools/qualify-observation.ts",
    "packed Observation command removed or retargeted",
  );
  for (const name of ["check:fast", "check"]) {
    assert.match(
      scripts[name] ?? "",
      /^pnpm [\w:-]+(?: && pnpm [\w:-]+)*$/u,
      `${name}: blocking command chain must use only pnpm scripts joined by &&`,
    );
  }
  for (const command of ["pnpm architecture:features:check", "pnpm foundation:check"]) {
    assert.equal(
      scripts["check:fast"]
        ?.split("&&")
        .map((part) => part.trim())
        .includes(command),
      true,
      `fast chain lost ${command}`,
    );
  }
  for (const command of [
    "pnpm check:fast",
    "pnpm test:boundaries",
    "pnpm test:modular",
    "pnpm test:observation",
  ]) {
    assert.equal(
      scripts["check"]
        ?.split("&&")
        .map((part) => part.trim())
        .includes(command),
      true,
      `full chain lost ${command}`,
    );
  }
}

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "payments-modular-adoption-"));
  for (const path of [
    "architecture",
    "docs/get-modular-adoption.md",
    "package.json",
    "pnpm-workspace.yaml",
    "pnpm-lock.yaml",
    "qualification/observation",
    "tools/test",
  ]) {
    await mkdir(join(root, path, ".."), { recursive: true });
    await cp(join(repository, path), join(root, path), { recursive: true });
  }
  for (const name of ["core", "paddle", "postgres", "get-modular"]) {
    for (const path of ["src", "test", "package.json"]) {
      const relative = `packages/payments-${name}/${path}`;
      await mkdir(join(root, relative, ".."), { recursive: true });
      await cp(join(repository, relative), join(root, relative), { recursive: true });
    }
  }
  return root;
}

void test("the Modular record and published CMS checker match full feature boundaries, reviewed artifacts and blocking commands", () =>
  check(repository));
void test("scoped adoption permits owner-local helpers and rejects meaningful drift", async (context) => {
  const changes: Readonly<Record<string, (root: string) => Promise<void>>> = {
    "reviewed pin drift": async (root) => {
      const profile = await json<Profile>(root, profilePath);
      profile.standard.commit = "0".repeat(40);
      await writeFile(join(root, profilePath), JSON.stringify(profile));
    },
    "unknown authored module": (root) =>
      writeFile(
        join(root, "packages/payments-get-modular/src/unknown.ts"),
        "import { declareModule as declare } from '@get-modular/assembly'; export const unknown = declare({});\n",
      ),
    "hidden input in existing file": async (root) => {
      const path =
        "packages/payments-get-modular/src/features/payment-runtime/composition/payment-runtime.inputs.ts";
      await writeFile(
        join(root, path),
        `${await read(root, path)}\nconst hidden = input<PaymentsCapabilities>()(paymentsConfigurationDeclaration);\n`,
      );
    },
    "type-only declaration edge": async (root) => {
      const path =
        "packages/payments-get-modular/src/features/payment-runtime/composition/payments.module.ts";
      await writeFile(
        join(root, path),
        (await read(root, path)).replace(
          "import { paymentsDeclaration }",
          "import type { paymentsDeclaration }",
        ),
      );
    },
    "type-only group edge": async (root) => {
      const path =
        "packages/payments-get-modular/src/features/payment-runtime/composition/payment-runtime.group.ts";
      await writeFile(
        join(root, path),
        (await read(root, path)).replace(
          "import { paymentsModule }",
          "import type { paymentsModule }",
        ),
      );
    },
    "use-case extra export": (root) =>
      writeFile(
        join(
          root,
          "packages/payments-get-modular/src/features/purchase-observation/application/use-cases/copy-query.ts",
        ),
        "export function copyQuery() {}\nexport function accidentalSecondUseCase() {}\n",
      ),
    "missing owned path": (root) =>
      rm(
        join(
          root,
          "packages/payments-get-modular/src/features/payment-runtime/composition/payment-runtime.inputs.ts",
        ),
      ),
    "unknown exception": async (root) => {
      const profile = await json<Profile>(root, profilePath);
      profile.exceptions.push({
        id: "blanket-exemption",
        rule: "layout",
        paths: [],
        owner: "test",
        rationale: "invalid",
        decision: "test",
        reviewTrigger: "test",
      });
      await writeFile(join(root, profilePath), JSON.stringify(profile));
    },
    "no-op command": async (root) => {
      const manifest = await json<{ scripts: Record<string, string> }>(root, "package.json");
      manifest.scripts["test:modular:adoption"] = 'node -e "process.exit(0)"';
      await writeFile(join(root, "package.json"), JSON.stringify(manifest));
    },
    "no-op runtime command": async (root) => {
      const manifest = await json<{ scripts: Record<string, string> }>(root, "package.json");
      manifest.scripts["test:modular"] = 'node -e "process.exit(0)"';
      await writeFile(join(root, "package.json"), JSON.stringify(manifest));
    },
    "no-op packed command": async (root) => {
      const manifest = await json<{ scripts: Record<string, string> }>(root, "package.json");
      manifest.scripts["test:observation"] = 'node -e "process.exit(0)"';
      await writeFile(join(root, "package.json"), JSON.stringify(manifest));
    },
    "removed fast chain": async (root) => {
      const manifest = await json<{ scripts: Record<string, string> }>(root, "package.json");
      manifest.scripts["check:fast"] = "pnpm typecheck";
      await writeFile(join(root, "package.json"), JSON.stringify(manifest));
    },
    "masked fast failure": async (root) => {
      const manifest = await json<{ scripts: Record<string, string> }>(root, "package.json");
      manifest.scripts["check:fast"] += " && true || true";
      await writeFile(join(root, "package.json"), JSON.stringify(manifest));
    },
    "masked full failure": async (root) => {
      const manifest = await json<{ scripts: Record<string, string> }>(root, "package.json");
      manifest.scripts["check"] += " && true || true";
      await writeFile(join(root, "package.json"), JSON.stringify(manifest));
    },
  };
  const expected: Readonly<Record<string, RegExp>> = {
    "reviewed pin drift": /reviewed CMS\/guide pin drift/u,
    "unknown authored module": /unknown or stale authored Get Modular boundary/u,
    "hidden input in existing file": /unknown or stale authored Get Modular boundary/u,
    "type-only declaration edge": /module-declaration/u,
    "type-only group edge": /orphan-module/u,
    "use-case extra export": /use-case-export/u,
    "missing owned path": /ENOENT/u,
    "unknown exception": /unknown or stale CMS exception/u,
    "no-op command": /adoption command removed or retargeted/u,
    "no-op runtime command": /Modular runtime command removed or retargeted/u,
    "no-op packed command": /packed Observation command removed or retargeted/u,
    "removed fast chain": /fast chain lost pnpm architecture:features:check/u,
    "masked fast failure": /check:fast: blocking command chain/u,
    "masked full failure": /check: blocking command chain/u,
  };
  for (const [name, change] of Object.entries(changes)) {
    await context.test(name, async () => {
      const root = await fixture();
      try {
        await writeFile(
          join(root, "packages/payments-get-modular/src/private-helper.ts"),
          "export const privateHelper = 1;\n",
        );
        await check(root);
        await change(root);
        const message = expected[name];
        assert.ok(message);
        await assert.rejects(check(root), message);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
});

void test("unused conflicting descriptor fragments reject at the final interface", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "payments-descriptor-fragments-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, "package.json"), '{"type":"module"}\n');
  await writeFile(
    join(directory, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2024",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        skipLibCheck: false,
        noEmit: true,
        types: [],
      },
      files: ["fixture.ts"],
    }),
  );
  const imports = [
    `import type { CapabilitiesOf, Contract } from ${JSON.stringify(join(repository, "node_modules/@get-modular/assembly/dist/index.js"))};`,
    `import type { Checkout, Read, PaymentsCapabilities } from ${JSON.stringify(join(repository, "packages/payments-get-modular/dist/index.js"))};`,
    "type PaymentContracts = typeof Checkout | typeof Read;",
  ].join("\n");
  const cases = [
    {
      name: "value",
      conflict:
        "Contract<typeof Checkout.id, { readonly incompatible: true }, typeof Checkout.revision>",
    },
    {
      name: "revision metadata",
      conflict:
        "Contract<typeof Checkout.id, PaymentsCapabilities[typeof Checkout.id]['value'], 99>",
    },
  ];
  for (const scenario of cases) {
    await writeFile(
      join(directory, "fixture.ts"),
      `${imports}\n` +
        `type Conflict = ${scenario.conflict};\n` +
        "interface Invalid extends CapabilitiesOf<PaymentContracts>, CapabilitiesOf<Conflict> {}\n",
    );
    const result = spawnSync(
      process.execPath,
      [
        join(repository, "node_modules/typescript/bin/tsc"),
        "-p",
        join(directory, "tsconfig.json"),
        "--pretty",
        "false",
      ],
      {
        cwd: repository,
        encoding: "utf8",
        timeout: 30000,
        maxBuffer: 1024 * 1024,
      },
    );
    assert.equal(result.error, undefined, scenario.name);
    assert.equal(result.signal, null, scenario.name);
    assert.equal(result.status, 1, `${scenario.name}: ${result.stdout}${result.stderr}`);
    assert.match(
      result.stdout,
      /error TS2320: Interface 'Invalid' cannot simultaneously extend types/u,
      scenario.name,
    );
    assert.match(result.stdout, /agent-teams\/payments\/checkout/u, scenario.name);
    assert.equal((result.stdout.match(/error TS\d+:/gu) ?? []).length, 1, result.stdout);
  }
});
