import assert from "node:assert/strict";
import { readFile, realpath, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { command, repository } from "./package-artifacts.ts";

export function record(value: unknown): Record<string, unknown> {
  assert.ok(
    value !== null && typeof value === "object" && !Array.isArray(value),
    "Expected object",
  );
  return value as Record<string, unknown>;
}

const read = async (path: string) => record(JSON.parse(await readFile(path, "utf8")));
const tools = ["typescript", "tsrs", "bun", "oxlint", "oxlint-tsgolint", "oxfmt"] as const;

function within(root: string, target: string): void {
  const suffix = relative(root, target);
  assert.ok(
    suffix !== ".." && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix),
    "Tool escapes installed owner",
  );
}

/** Public metadata, one root pin and contained installed identity; no ancestor/global fallback. */
export async function resolveStack(root = repository) {
  root = await realpath(root);
  const manifest = await read(join(root, "package.json"));
  const sections = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
  const declarations = sections.flatMap((section) => {
    const value = record(manifest[section] ?? {})["stack-toolchain"];
    return value === undefined ? [] : [{ section, value }];
  });
  const declared = declarations[0];
  assert.ok(
    declarations.length === 1 && declared?.section === "devDependencies",
    "One root Stack development pin required",
  );
  assert.ok(
    typeof declared.value === "string" &&
      /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u.test(declared.value),
    "Stable exact Stack pin required",
  );
  const require = createRequire(join(root, "package.json"));
  const installed = await realpath(require.resolve("stack-toolchain/package.json"));
  within(join(root, "node_modules"), installed);
  const metadata = await read(installed);
  assert.equal(metadata["name"], "stack-toolchain", "Installed Stack name mismatch");
  assert.equal(metadata["version"], declared.value, "Installed Stack version mismatch");
  const packageRoot = dirname(installed);
  const entry = record(metadata["bin"])["stack-toolchain"];
  assert.ok(typeof entry === "string" && !isAbsolute(entry), "Public Stack bin missing");
  const bin = await realpath(resolve(packageRoot, entry));
  within(packageRoot, bin);
  assert.ok((await stat(bin)).isFile(), "Stack bin must be regular");
  const pinsPath = await realpath(require.resolve("stack-toolchain/toolchain-manifest.json"));
  within(packageRoot, pinsPath);
  const pins = await read(pinsPath);
  assert.equal(pins["schemaVersion"], 1, "Unsupported Stack manifest");
  const graph = {
    ...record(metadata["dependencies"]),
    ...record(metadata["optionalDependencies"]),
  };
  for (const tool of tools) {
    assert.ok(
      typeof pins[tool] === "string" && pins[tool] === graph[tool],
      `Stack manifest disagreement: ${tool}`,
    );
  }
  return { bin, version: declared.value, pins };
}

type StackIdentity = Awaited<ReturnType<typeof resolveStack>>;

/** Binding only. Optional engine absence is informational; required native artifacts must qualify. */
export function assertDoctor(value: unknown, identity: StackIdentity): void {
  const report = record(value),
    details = record(report["details"]);
  assert.equal(report["schemaVersion"], 1);
  assert.equal(report["command"], "doctor");
  assert.equal(report["status"], "passed");
  assert.equal(report["exitCode"], 0);
  assert.equal(details["schemaVersion"], 1);
  assert.equal(details["packageVersion"], identity.version);
  assert.deepEqual(report["versions"], identity.pins);
  assert.ok(Array.isArray(details["findings"]));
  assert.ok(
    details["findings"].every((finding: unknown) => record(finding)["severity"] === "info"),
    "Doctor findings failed",
  );
  for (const tool of tools) {
    const observed = record(details[tool]),
      required = tool !== "bun" && tool !== "tsrs";
    assert.equal(observed["required"], required, `${tool}: requirement drift`);
    assert.equal(observed["expectedVersion"], identity.pins[tool], `${tool}: pin drift`);
    if (observed["available"] === false && !required) {
      assert.equal(
        observed["installedVersion"],
        null,
        `${tool}: installed engine cannot disappear`,
      );
      assert.equal(observed["resolvedVersion"], null);
    } else {
      assert.equal(observed["available"], true, `${tool}: required tool unavailable`);
      assert.equal(observed["installedVersion"], identity.pins[tool]);
      assert.equal(observed["resolvedVersion"], identity.pins[tool]);
      assert.equal(
        observed["versionSource"],
        tool === "oxlint-tsgolint" ? "installed-package" : "binary-output",
      );
    }
  }
}

/** Commands run the published bin, through the existing captured Node process owner. */
export async function stackCommand(args: readonly string[], root = repository): Promise<void> {
  const identity = await resolveStack(root);
  const output = await command(process.execPath, [identity.bin, ...args, "--json"], root);
  const report: unknown = JSON.parse(output);
  if (args[0] === "doctor") {
    assertDoctor(report, identity);
  }
  process.stdout.write(output);
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await stackCommand(process.argv.slice(2));
}
