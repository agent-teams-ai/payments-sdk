import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { loadConfiguration } from "stack-toolchain";
import { repository } from "../package-artifacts.ts";
import { assertDoctor, resolveStack } from "../stack-command.ts";
import { checkToolchainAdoption } from "../toolchain-adoption.ts";

const pins = {
  schemaVersion: 1,
  typescript: "7.0.2",
  tsrs: "0.18.0-ts7.1.0-dev.20260929",
  bun: "1.4.3",
  oxlint: "1.83.0",
  "oxlint-tsgolint": "7.0.2001",
  oxfmt: "0.74.0",
};
const json = async (root: string, path: string, value: unknown) =>
  writeFile(join(root, path), JSON.stringify(value));

async function installed(version = "0.1.1"): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "payments-stack-binding-"));
  const target = "node_modules/stack-toolchain";
  await mkdir(join(root, target), { recursive: true });
  await json(root, "package.json", { devDependencies: { "stack-toolchain": version } });
  const dependencies = Object.fromEntries(
    Object.entries(pins).filter(([name]) => name !== "schemaVersion"),
  );
  await json(root, `${target}/package.json`, {
    name: "stack-toolchain",
    version,
    bin: { "stack-toolchain": "./cli.js" },
    dependencies,
    optionalDependencies: {},
    exports: {
      "./package.json": "./package.json",
      "./toolchain-manifest.json": "./toolchain-manifest.json",
    },
  });
  await json(root, `${target}/toolchain-manifest.json`, pins);
  await writeFile(
    join(root, target, "cli.js"),
    "throw new Error('metadata-only fixture must never execute');\n",
  );
  return root;
}

void test("Stack binding accepts matching current/future metadata without claiming engine qualification", async () => {
  for (const version of ["0.1.1", "1.2.3"]) {
    const root = await installed(version);
    try {
      assert.equal((await resolveStack(root)).version, version);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

void test("Stack binding rejects duplicate, noncanonical and unstable root declarations", async () => {
  const root = await installed();
  try {
    for (const value of ["^0.1.1", "latest", "npm:stack-toolchain@0.1.1", "0.2.0-rc.1", "00.1.1"]) {
      await json(root, "package.json", { devDependencies: { "stack-toolchain": value } });
      await assert.rejects(resolveStack(root), /Stable exact Stack pin/u);
    }
    for (const section of ["dependencies", "optionalDependencies", "peerDependencies"]) {
      await json(root, "package.json", {
        devDependencies: { "stack-toolchain": "0.1.1" },
        [section]: { "stack-toolchain": "0.1.1" },
      });
      await assert.rejects(resolveStack(root), /One root Stack development pin/u);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("Stack binding rejects missing, mismatched and ancestor/escaped installed identities", async () => {
  const root = await installed();
  try {
    const path = "node_modules/stack-toolchain/package.json";
    const original = JSON.parse(await readFile(join(root, path), "utf8")) as Record<
      string,
      unknown
    >;
    for (const change of [{ name: "wrong-package" }, { version: "0.2.0" }, { bin: {} }]) {
      await json(root, path, { ...original, ...change });
      await assert.rejects(resolveStack(root), /mismatch|bin missing/u);
    }
    await writeFile(join(root, "outside.js"), "export {};\n");
    await json(root, path, { ...original, bin: { "stack-toolchain": "../../outside.js" } });
    await assert.rejects(resolveStack(root), /escapes installed owner/u);
    await json(root, path, original);
    await mkdir(join(root, "child"));
    await json(root, "child/package.json", { devDependencies: { "stack-toolchain": "0.1.1" } });
    await assert.rejects(resolveStack(join(root, "child")), /escapes installed owner/u);
    const absent = await mkdtemp(join(tmpdir(), "payments-stack-absent-"));
    try {
      await json(absent, "package.json", { devDependencies: { "stack-toolchain": "0.1.1" } });
      await assert.rejects(resolveStack(absent), /Cannot find module|escapes installed owner/u);
      await mkdir(join(absent, "node_modules"));
      await symlink(
        join(root, "node_modules/stack-toolchain"),
        join(absent, "node_modules/stack-toolchain"),
        "dir",
      );
      await assert.rejects(resolveStack(absent), /escapes installed owner/u);
    } finally {
      await rm(absent, { recursive: true, force: true });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("doctor binding rejects package/engine mismatch and missing native typed evidence", async () => {
  const root = await installed("1.2.3");
  try {
    const identity = await resolveStack(root);
    const details = {
      schemaVersion: 1,
      packageVersion: identity.version,
      findings: [],
      ...Object.fromEntries(
        Object.entries(pins)
          .filter(([name]) => name !== "schemaVersion")
          .map(([name, version]) => [
            name,
            {
              required: !["bun", "tsrs"].includes(name),
              expectedVersion: version,
              installedVersion: version,
              resolvedVersion: version,
              available: true,
              versionSource: name === "oxlint-tsgolint" ? "installed-package" : "binary-output",
            },
          ]),
      ),
    };
    const report = {
      schemaVersion: 1,
      command: "doctor",
      status: "passed",
      exitCode: 0,
      versions: pins,
      details,
    };
    assertDoctor(report, identity);
    for (const change of [
      { packageVersion: "0.1.1" },
      { schemaVersion: 2 },
      { findings: [{ severity: "error" }] },
      {
        "oxlint-tsgolint": {
          required: true,
          expectedVersion: pins["oxlint-tsgolint"],
          available: false,
        },
      },
    ]) {
      assert.throws(() => {
        assertDoctor({ ...report, details: { ...details, ...change } }, identity);
      });
    }
    assert.throws(() => {
      assertDoctor({ ...report, versions: { ...pins, typescript: "7.0.3" } }, identity);
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function policyFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "payments-tool-policy-"));
  for (const path of [
    "package.json",
    "pnpm-workspace.yaml",
    "foundation.config.yaml",
    "toolchain.config.json",
    "architecture",
    ".github/workflows/checks.yaml",
    "tsconfig.json",
    "tsconfig.checks.json",
    "qualification/observation/tsconfig.json",
    ...["core", "paddle", "postgres", "get-modular"].map(
      (name) => `packages/payments-${name}/tsconfig.json`,
    ),
  ]) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await cp(join(repository, path), join(root, path), { recursive: true });
  }
  return root;
}

void test("actual adoption rejects lost compiler contexts/references, disabled scripts and CI/runner bypass", async (context) => {
  await checkToolchainAdoption();
  for (const [path, before, after] of [
    [
      "architecture/foundation/quality-source-coverage.yaml",
      "  - packages/payments-paddle/tsconfig.json\n",
      "",
    ],
    ["packages/payments-paddle/tsconfig.json", '"references"', '"lostReferences"'],
    ["pnpm-workspace.yaml", "bun: false", "bun: true"],
    ["pnpm-workspace.yaml", "strictDepBuilds: true", "strictDepBuilds: false"],
    ["architecture/foundation/quality-gates.yaml", "typecheck:ordinary", "toolchain:doctor"],
    [".github/workflows/checks.yaml", "pnpm check:fast", "pnpm typecheck"],
    ["package.json", "agent-teams-foundation gate run fast", "true"],
    ["package.json", "node tools/stack-command.ts format:check", "true"],
    ["toolchain.config.json", "packages/*/src/**/*.ts", "missing-source/**/*.ts"],
    ["toolchain.config.json", "packages/payments-core/test", "missing-tests"],
  ] as const) {
    await context.test(path + before, async () => {
      const root = await policyFixture();
      try {
        await checkToolchainAdoption(root);
        const source = await readFile(join(root, path), "utf8");
        assert.ok(source.includes(before));
        await writeFile(join(root, path), source.replace(before, after));
        await assert.rejects(checkToolchainAdoption(root));
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
});

void test("published Stack loader refuses reference projects and noCheck instead of hiding diagnostics", async () => {
  const root = await mkdtemp(join(tmpdir(), "payments-stack-project-"));
  try {
    await writeFile(join(root, "fixture.ts"), "export const fixture: number = 1;\n");
    await json(root, ".oxlintrc.json", {});
    await json(root, "toolchain.config.json", {
      schemaVersion: 1,
      profile: "typescript-node",
      typecheck: { projects: ["tsconfig.json"] },
      lint: { config: ".oxlintrc.json", paths: ["fixture.ts"] },
      format: { paths: ["fixture.ts"] },
    });
    const base = { compilerOptions: { strict: true, noEmit: true }, files: ["fixture.ts"] };
    await json(root, "tsconfig.json", base);
    await loadConfiguration({ cwd: root, signal: new AbortController().signal });
    await json(root, "tsconfig.json", { ...base, references: [{ path: "child.json" }] });
    await json(root, "child.json", base);
    await assert.rejects(
      loadConfiguration({ cwd: root, signal: new AbortController().signal }),
      /TOOLCHAIN_PROJECT_REFERENCES_UNSUPPORTED/u,
    );
    await json(root, "tsconfig.json", {
      ...base,
      compilerOptions: { ...base.compilerOptions, noCheck: true },
    });
    await assert.rejects(
      loadConfiguration({ cwd: root, signal: new AbortController().signal }),
      /TOOLCHAIN_NOCHECK_UNSUPPORTED/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
