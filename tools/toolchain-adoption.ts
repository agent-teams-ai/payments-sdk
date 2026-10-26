import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import { record } from "./stack-command.ts";
import { repository } from "./package-artifacts.ts";

const names = ["core", "paddle", "postgres", "get-modular"];
const projects = names.map((name) => `packages/payments-${name}/tsconfig.json`);
const fastTasks = ["toolchain:doctor", "typecheck:ordinary", "format:check"];

/** Consumer-owned scope, native islands and real required routes; technical execution stays shared. */
export async function checkToolchainAdoption(root = repository): Promise<void> {
  const json = async (path: string) => record(JSON.parse(await readFile(join(root, path), "utf8")));
  const yaml = async (path: string) => record(parse(await readFile(join(root, path), "utf8")));
  const manifest = await json("package.json"),
    scripts = record(manifest["scripts"]);
  const workspace = await yaml("pnpm-workspace.yaml");
  assert.equal(workspace["strictDepBuilds"], true, "Dependency build preflight required");
  assert.deepEqual(workspace["allowBuilds"], { bun: false }, "Only Bun script refusal is admitted");
  for (const section of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
  ]) {
    const dependencies = record(manifest[section] ?? {});
    for (const name of ["oxlint", "oxlint-tsgolint"]) {
      assert.equal(dependencies[name], undefined, "Ordinary tools belong to Stack");
    }
  }
  const config = await json("toolchain.config.json");
  assert.deepEqual(
    record(config["lint"])["paths"],
    [
      ...names.map((name) => `packages/payments-${name}/test`),
      "tools",
      "tests",
      "examples",
      "qualification",
    ],
    "All development roots require literal directory selection",
  );
  const formatPaths = record(config["format"])["paths"];
  assert.ok(Array.isArray(formatPaths));
  for (const path of [
    "packages/*/src/**/*.ts",
    "packages/*/test/**/*.ts",
    "packages/*/tests/**/*.ts",
    "tools/**/*.ts",
    "tests/**/*.ts",
    "examples/**/*.ts",
    "qualification/**/*.ts",
    "toolchain.config.json",
    "pnpm-workspace.yaml",
    ".github/workflows/checks.yaml",
    "architecture/foundation/*.yaml",
  ]) {
    assert.ok(formatPaths.includes(path), `Maintained format scope lost ${path}`);
  }
  assert.deepEqual(
    record(config["typecheck"])["projects"],
    [projects[0]],
    "Only the existing standalone project is ordinary",
  );
  const quality = await yaml("architecture/foundation/quality-source-coverage.yaml");
  assert.equal(quality["schemaVersion"], 1);
  assert.deepEqual(
    quality["compilerProjects"],
    projects,
    "All production compiler contexts required",
  );
  const nativeReferences: Record<string, string[]> = {
    "tsconfig.json": [
      ...names.map((name) => `packages/payments-${name}`),
      "./tsconfig.checks.json",
      "./qualification/observation/tsconfig.json",
    ],
    "tsconfig.checks.json": names.map((name) => `packages/payments-${name}`),
    "qualification/observation/tsconfig.json": names.map(
      (name) => `../../packages/payments-${name}`,
    ),
    ...Object.fromEntries(
      projects.map((project, index) => [project, index === 0 ? [] : ["../payments-core"]]),
    ),
  };
  for (const [project, references] of Object.entries(nativeReferences)) {
    assert.deepEqual(
      (await json(project))["references"] ?? [],
      references.map((path) => ({ path })),
      `Native reference graph drift: ${project}`,
    );
  }
  const expectedScripts = {
    "toolchain:doctor": "node tools/stack-command.ts doctor",
    "typecheck:ordinary": "node tools/stack-command.ts typecheck",
    "format:check": "node tools/stack-command.ts format:check",
    "gate:fast": "agent-teams-foundation gate run fast",
    "typecheck:checks": "node tools/stack-command.ts compile --project tsconfig.checks.json",
    "lint:development": "node tools/stack-command.ts lint",
  };
  for (const [name, body] of Object.entries(expectedScripts)) {
    assert.equal(scripts[name], body, `${name}: real gate removed`);
  }
  assert.ok(
    typeof scripts["check:fast"] === "string" &&
      scripts["check:fast"].split(" && ").includes("pnpm gate:fast"),
    "Fast entry must execute runner",
  );
  const foundation = record((await yaml("foundation.config.yaml"))["capabilities"]);
  assert.deepEqual(foundation["quality.gate-runner"], {
    configPath: "architecture/foundation/quality-gates.yaml",
  });
  const gates = await yaml("architecture/foundation/quality-gates.yaml");
  assert.equal(gates["schemaVersion"], 2);
  assert.deepEqual(
    gates["profiles"],
    [
      {
        id: "fast",
        packageManager: "pnpm",
        concurrency: 1,
        tasks: fastTasks.map((id, index) => ({
          id,
          ...(index === 0 ? {} : { needs: [fastTasks[index - 1]] }),
        })),
      },
    ],
    "Blocking fast tasks/order drift",
  );
  const workflow = await yaml(".github/workflows/checks.yaml");
  const build = record(record(workflow["jobs"])["build"]);
  assert.ok(
    Array.isArray(build["steps"]) &&
      build["steps"].some((step: unknown) => record(step)["run"] === "pnpm check:fast"),
    "Actual CI build must run fast adoption gates",
  );
}
