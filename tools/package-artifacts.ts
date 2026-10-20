import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createProcessExecutor } from 'node-or-bun';
import { createNodeProcessAdapter } from 'node-or-bun/node';

export const packageNames = ['core', 'paddle', 'postgres', 'get-modular'] as const;
export const repository = resolve(import.meta.dirname, '..');
const capturedCommands = createProcessExecutor(createNodeProcessAdapter());

export type PackedManifest = Readonly<{
  name: string; version: string; license: string; private?: boolean; exports?: unknown;
  dependencies?: Readonly<Record<string, string>>; peerDependencies?: Readonly<Record<string, string>>;
}>;

/** Inspect without extracting/executing an archive. Shared by CI packing and release admission. */
export async function auditPackageArchive(tarball: string, expectedName: string, expectedVersion?: string): Promise<Readonly<{ manifest: PackedManifest; entries: number }>> {
  const entries = (await command('tar', ['-tzf', tarball])).trim().split('\n');
  assert.ok(entries.every(entry => entry.startsWith('package/') && !entry.split('/').includes('..')), `${expectedName}: unsafe archive path`);
  assert.ok(entries.includes('package/dist/index.js'), `${expectedName}: missing ESM entrypoint`);
  assert.ok(entries.includes('package/dist/index.d.ts'), `${expectedName}: missing declarations`);
  assert.ok(entries.some(entry => /\/LICENSE(?:\.md|\.txt)?$/iu.test(entry)), `${expectedName}: missing license`);
  assert.ok(entries.every(entry => !/\/(?:src|test|tests|node_modules)\//u.test(entry)), `${expectedName}: development files leaked into archive`);
  const manifest = JSON.parse(await command('tar', ['-xOf', tarball, 'package/package.json'])) as PackedManifest;
  assert.equal(manifest.name, expectedName, 'Archive package name mismatch');
  assert.equal(manifest.license, 'Apache-2.0');
  assert.notEqual(manifest.private, true, 'Private package cannot be released');
  assert.ok(manifest.exports, `${expectedName}: missing exports map`);
  if (expectedVersion !== undefined) {assert.equal(manifest.version, expectedVersion, 'Archive version differs from release tag');}
  for (const [dependency, version] of Object.entries({ ...manifest.dependencies, ...manifest.peerDependencies })) {
    assert.ok(typeof version === 'string' && !version.startsWith('workspace:') && !version.startsWith('catalog:'), `${expectedName}: unresolved publish protocol ${dependency}`);
    assert.ok(!['@agent-teams/engineering-foundation', 'node-or-bun'].includes(dependency), `${expectedName}: development tooling leaked into runtime`);
  }
  return { manifest, entries: entries.length };
}

/** Captured development commands only: shell-free, bounded, and never retried. */
export async function command(executable: string, args: readonly string[], cwd = repository): Promise<string> {
  const result = await capturedCommands.run({ command: executable, args, cwd, timeoutMs: 120_000 });
  assert.equal(result.exitCode, 0, `${executable} ${args.join(' ')} (signal: ${result.signal ?? 'none'})\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

export function pnpm(args: readonly string[], cwd = repository): Promise<string> {
  const entry = process.env['npm_execpath'];
  assert.ok(entry && entry.includes('pnpm'), 'Run this gate through pnpm so the pinned package manager is used');
  return command(process.execPath, [entry, ...args], cwd);
}

export async function packPackages(): Promise<ReadonlyMap<string, string>> {
  const target = join(repository, '.artifacts/packages');
  await mkdir(target, { recursive: true });
  const results = new Map<string, string>();
  for (const short of packageNames) {
    const directory = join(repository, 'packages', `payments-${short}`);
    const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')) as { name: string; version: string; license: string };
    assert.equal(manifest.license, 'Apache-2.0');
    await pnpm(['pack', '--pack-destination', target], directory);
    const tarball = join(target, `${manifest.name.replace('@', '').replace('/', '-')}-${manifest.version}.tgz`);
    results.set(manifest.name, tarball);
  }
  return results;
}
