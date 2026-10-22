import assert from 'node:assert/strict';
import { lstat, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { packageNames, pnpm, repository } from './package-artifacts.ts';

const outputs = [
  ...packageNames.flatMap(name => [`packages/payments-${name}/dist`, `packages/payments-${name}/tsconfig.tsbuildinfo`]),
  'tsconfig.tsbuildinfo', 'tsconfig.checks.tsbuildinfo',
] as const;

async function inspectOwnedPath(root: string, path: string): Promise<void> {
  const parts = path.split('/');
  for (let end = 1; end <= parts.length; end += 1) {
    const current = join(root, ...parts.slice(0, end));
    const entry = await lstat(current).catch((error: unknown) => {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') { return undefined; }
      throw error;
    });
    if (entry === undefined) { return; }
    assert.equal(entry.isSymbolicLink(), false, `Refusing linked build output or ancestor: ${current}`);
    if (end < parts.length) { assert.ok(entry.isDirectory(), `Build output ancestor is not a directory: ${current}`); }
    else if (path.endsWith('.tsbuildinfo')) { assert.ok(entry.isFile(), `Build metadata is not a regular file: ${current}`); }
    else { assert.ok(entry.isDirectory(), `Build output is not a directory: ${current}`); }
  }
}

/** Validate every owned path before removing any output; preserve all neighbouring files. */
export async function cleanBuildOutputs(root = repository): Promise<void> {
  const entry = await lstat(root);
  assert.ok(entry.isDirectory() && !entry.isSymbolicLink(), 'Build root must be an ordinary directory');
  for (const path of outputs) { await inspectOwnedPath(root, path); }
  for (const path of outputs) { await rm(join(root, path), { recursive: true, force: true }); }
}

export async function build(): Promise<void> {
  await cleanBuildOutputs();
  await pnpm(['exec', 'tsc', '--build', '--pretty', 'false']);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await build();
}
