import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { cleanBuildOutputs } from '../build.ts';
import { packageNames } from '../package-artifacts.ts';

void test('clean builds remove stale owned outputs and all incremental state while retaining adjacent files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'payments-build-'));
  try {
    for (const name of packageNames) {
      const directory = join(root, 'packages', `payments-${name}`);
      await mkdir(join(directory, 'dist/observation'), { recursive: true });
      await writeFile(join(directory, 'dist/observation/projection.js'), 'stale');
      await writeFile(join(directory, 'tsconfig.tsbuildinfo'), 'stale');
      await writeFile(join(directory, 'keep.txt'), 'retained');
    }
    await writeFile(join(root, 'tsconfig.tsbuildinfo'), 'stale');
    await writeFile(join(root, 'tsconfig.checks.tsbuildinfo'), 'stale');
    await cleanBuildOutputs(root);
    await cleanBuildOutputs(root);
    for (const name of packageNames) {
      const directory = join(root, 'packages', `payments-${name}`);
      await assert.rejects(access(join(directory, 'dist')), { code: 'ENOENT' });
      await assert.rejects(access(join(directory, 'tsconfig.tsbuildinfo')), { code: 'ENOENT' });
      assert.equal(await readFile(join(directory, 'keep.txt'), 'utf8'), 'retained');
    }
    await assert.rejects(access(join(root, 'tsconfig.tsbuildinfo')), { code: 'ENOENT' });
    await assert.rejects(access(join(root, 'tsconfig.checks.tsbuildinfo')), { code: 'ENOENT' });
  } finally { await rm(root, { recursive: true, force: true }); }
});

void test('a linked package or output fails before an earlier output is removed', async () => {
  for (const path of ['packages/payments-postgres', 'packages/payments-postgres/dist']) {
    const root = await mkdtemp(join(tmpdir(), 'payments-build-link-'));
    const external = await mkdtemp(join(tmpdir(), 'payments-build-external-'));
    try {
      await mkdir(join(root, 'packages/payments-core/dist'), { recursive: true });
      await writeFile(join(root, 'packages/payments-core/dist/retained.js'), 'not removed on failure');
      await writeFile(join(external, 'retained.js'), 'external sentinel');
      if (path.endsWith('/dist')) { await mkdir(join(root, 'packages/payments-postgres')); }
      await symlink(external, join(root, path), 'dir');
      await assert.rejects(cleanBuildOutputs(root), /Refusing linked build output/);
      assert.equal(await readFile(join(root, 'packages/payments-core/dist/retained.js'), 'utf8'), 'not removed on failure');
      assert.equal(await readFile(join(external, 'retained.js'), 'utf8'), 'external sentinel');
    } finally { await rm(root, { recursive: true, force: true }); await rm(external, { recursive: true, force: true }); }
  }
});
