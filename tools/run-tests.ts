import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { glob } from "node:fs/promises";

const groups: Readonly<Record<string, readonly string[]>> = {
  core: ["packages/payments-core/test/**/*.test.ts"],
  paddle: ["packages/payments-paddle/test/**/*.test.ts"],
  modular: ["packages/payments-get-modular/test/**/*.test.ts"],
  postgres: ["packages/payments-postgres/test/**/*.test.ts", "tests/integration/**/*.test.ts"],
  e2e: ["tests/e2e/**/*.test.ts"],
};
const name = process.argv[2];
assert.ok(name !== undefined && name !== "" && groups[name], `Unknown test group: ${name}`);
const files: string[] = [];
for await (const file of glob(groups[name])) {
  files.push(file);
}
assert.ok(files.length > 0, `Required test group ${name} has no tests`);
files.sort();
const child = spawn(
  process.execPath,
  ["--import", "./tools/source-test-resolver.ts", "--test", ...files],
  { stdio: "inherit", env: process.env },
);
child.on("error", (error) => {
  throw error;
});
child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exitCode = code ?? 1;
  }
});
