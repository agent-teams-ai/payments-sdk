import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { sourceTestTarget } from "../source-test-resolver.ts";

void test("native source tests load maintained TypeScript while compiled package imports keep their artifact identity", () => {
  const sourceURL = new URL("../../packages/payments-core/src/index.ts", import.meta.url).href;
  const resolverURL = new URL("../source-test-resolver.ts", import.meta.url).href;
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      resolverURL,
      "--input-type=module",
      "-e",
      `
    import assert from 'node:assert/strict';
    const source = await import(process.argv[1]);
    const artifact = await import('@agent-teams/payments-core');
    assert.notEqual(source.createPayments, artifact.createPayments);
    assert.deepEqual(source.money('USD', '125'), { currency: 'USD', minorUnits: '125' });
  `,
      sourceURL,
    ],
    { cwd: new URL("../../", import.meta.url), encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.error, undefined);
});

void test("source test resolution leaves bare packages, dist, foreign paths, traversal and missing sources untouched", () => {
  const parent = new URL("../../packages/payments-core/src/index.ts", import.meta.url).href;
  assert.equal(
    sourceTestTarget("./features/payment-evidence/domain/values.js", parent)?.pathname.endsWith(
      "/domain/values.ts",
    ),
    true,
  );
  assert.equal(sourceTestTarget("@agent-teams/payments-core", parent), undefined);
  assert.equal(sourceTestTarget("../dist/index.js", parent), undefined);
  assert.equal(sourceTestTarget("./missing.js", parent), undefined);
  assert.equal(
    sourceTestTarget("./../src/../../payments-core-other/src/index.js", parent),
    undefined,
  );
  assert.equal(
    sourceTestTarget("./index.js", new URL("../../examples/host.ts", import.meta.url).href),
    undefined,
  );
  assert.equal(sourceTestTarget("./index.js"), undefined);
});
