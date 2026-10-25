import assert from "node:assert/strict";
import { glob, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import ts from "typescript";
import { parse } from "yaml";
import { command } from "./package-artifacts.ts";

const root = resolve(import.meta.dirname, "..");
const [major, minor, patch] = process.versions.node.split(".").map(Number);
assert.ok(
  (major === 24 && ((minor ?? 0) > 22 || (minor === 22 && (patch ?? 0) >= 1))) ||
    (major === 26 && ((minor ?? 0) > 12 || (minor === 12 && (patch ?? 0) >= 1))),
  `Unsupported qualification runtime ${process.versions.node}`,
);
assert.equal(process.platform, "linux", "The initial qualification profile is Linux");

function admittedCompiler(version: string): boolean {
  const parts = /^(\d+)\.(\d+)\.(\d+)(?:\+.*)?$/u.exec(version);
  if (!parts) {
    return false;
  }
  const value = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  return (value[0] ?? 0) > 7 || (value[0] === 7 && ((value[1] ?? 0) > 0 || (value[2] ?? 0) >= 2));
}

assert.ok(
  admittedCompiler(ts.version),
  `Compiler ${ts.version} is below 7.0.2 or not a stable release`,
);
const lock = parse(await readFile(resolve(root, "pnpm-lock.yaml"), "utf8")) as {
  packages?: Record<string, unknown>;
};
for (const name of Object.keys(lock.packages ?? {})) {
  if (name.startsWith("typescript@")) {
    assert.ok(
      admittedCompiler(name.slice("typescript@".length)),
      `Hidden unsupported TypeScript compiler: ${name}`,
    );
  }
}

const owners = new Map<string, string[]>();
const projects = ["tsconfig.checks.json", "qualification/observation/tsconfig.json"];
for await (const project of glob("packages/*/tsconfig.json", { cwd: root })) {
  projects.push(project);
}
for (const project of projects) {
  const configPath = resolve(root, project);
  const parsed = JSON.parse(
    await command(process.execPath, [
      resolve(root, "node_modules/typescript/bin/tsc"),
      "-p",
      configPath,
      "--showConfig",
    ]),
  ) as {
    compilerOptions: { strict: boolean; skipLibCheck: boolean };
    files: readonly string[];
  };
  assert.equal(parsed.compilerOptions.strict, true, `${project}: strict must be enabled`);
  assert.equal(
    parsed.compilerOptions.skipLibCheck,
    false,
    `${project}: declaration checks must stay enabled`,
  );
  for (const file of parsed.files) {
    const key = resolve(configPath, "..", file);
    const current = owners.get(key) ?? [];
    current.push(project);
    owners.set(key, current);
  }
}

let count = 0;
for await (const source of glob(
  [
    "packages/**/*.{ts,js,mjs,mts,cjs,cts,tsx,jsx}",
    "tools/**/*.{ts,js,mjs,mts,cjs,cts,tsx,jsx}",
    "tests/**/*.{ts,js,mjs,mts,cjs,cts,tsx,jsx}",
    "examples/**/*.{ts,js,mjs,mts,cjs,cts,tsx,jsx}",
    "qualification/**/*.{ts,js,mjs,mts,cjs,cts,tsx,jsx}",
  ],
  { cwd: root, exclude: ["**/dist/**", "**/node_modules/**"] },
)) {
  assert.ok(
    source.endsWith(".ts") && !source.endsWith(".d.ts"),
    `${source}: maintained sources must be .ts`,
  );
  assert.equal(
    owners.get(resolve(root, source))?.length,
    1,
    `${source}: needs exactly one strict owning project; found ${owners.get(resolve(root, source))?.join(", ") ?? "none"}`,
  );
  count += 1;
}
assert.ok(count > 0, "No maintained source files found");
console.log(
  `Qualified Linux Node ${process.versions.node}, TypeScript ${ts.version}, and ${count} strictly owned .ts sources`,
);
