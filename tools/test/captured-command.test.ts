import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { isProcessRuntimeError } from "node-or-bun";
import { command, repository } from "../package-artifacts.ts";

void test("captured development commands preserve literal argv, cwd, environment and stdout", async () => {
  const directory = await mkdtemp(join(tmpdir(), "payments captured command "));
  const key = "PAYMENTS_CAPTURE_FIXTURE";
  const previous = process.env[key];
  process.env[key] = "inherited fixture value";
  const args = ["spaces stay literal", "; exit 99", "$(exit 98)", "*.ts"];
  try {
    const source = `process.stdout.write(JSON.stringify({ args: process.argv.slice(1), cwd: process.cwd(), environment: process.env.${key} })); process.stderr.write('separate stderr');`;
    assert.deepEqual(
      JSON.parse(await command(process.execPath, ["-e", source, ...args], directory)),
      {
        args,
        cwd: directory,
        environment: "inherited fixture value",
      },
    );
    assert.equal(
      await command(process.execPath, ["-e", "process.stdout.write(process.cwd())"]),
      repository,
    );
  } finally {
    if (previous === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = previous;
    }
    await rm(directory, { recursive: true, force: true });
  }
});

void test("nonzero exits reject after retaining both captured diagnostic streams", async () => {
  await assert.rejects(
    () =>
      command(process.execPath, [
        "-e",
        "process.stdout.write('stdout fixture'); process.stderr.write('stderr fixture'); process.exitCode = 23;",
      ]),
    (error) => {
      assert.ok(error instanceof assert.AssertionError);
      assert.equal(error.actual, 23);
      assert.equal(error.expected, 0);
      assert.match(error.message, /\nstdout fixture\nstderr fixture/u);
      return true;
    },
  );
});

void test("signal termination cannot be mistaken for a successful command", async () => {
  await assert.rejects(
    () => command(process.execPath, ["-e", "process.kill(process.pid, 'SIGTERM')"]),
    (error) => {
      assert.ok(error instanceof assert.AssertionError);
      assert.equal(error.actual, null);
      assert.match(error.message, /signal: SIGTERM/u);
      return true;
    },
  );
});

void test("launch failures preserve the native ProcessRuntimeError and original cause", async () => {
  await assert.rejects(
    () => command(join(repository, "missing-command-fixture"), []),
    (error) => {
      assert.ok(isProcessRuntimeError(error));
      assert.equal(error.code, "launch");
      assert.ok(error.cause instanceof Error);
      assert.equal((error.cause as NodeJS.ErrnoException).code, "ENOENT");
      assert.equal(error.output, null);
      return true;
    },
  );
});

void test("independent stream budgets accept 3 MiB stdout plus 3 MiB stderr", async () => {
  const output = await command(process.execPath, [
    "-e",
    "process.stdout.end(Buffer.alloc(3 * 1024 * 1024, 97)); process.stderr.end(Buffer.alloc(3 * 1024 * 1024, 98));",
  ]);
  assert.equal(output, "a".repeat(3 * 1024 * 1024));
});

for (const stream of ["stdout", "stderr"] as const) {
  void test(`${stream} overflow remains a bounded runtime failure instead of a partial success`, async () => {
    await assert.rejects(
      () =>
        command(process.execPath, [
          "-e",
          `process.${stream}.end(Buffer.alloc(4 * 1024 * 1024 + 1, 97));`,
        ]),
      (error) => {
        assert.ok(isProcessRuntimeError(error));
        assert.equal(error.code, "output-limit");
        assert.equal(error.facts.initiatingCause, "capture");
        assert.equal(error.facts.outputBounded, true);
        assert.equal(error.facts.incompleteCustody, false);
        assert.ok(error.output !== null);
        assert.ok(Buffer.byteLength(error.output[stream]) <= 4 * 1024 * 1024);
        return true;
      },
    );
  });
}
