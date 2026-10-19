import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export const packageNames = ['core', 'paddle', 'postgres', 'get-modular'] as const;
export const repository = resolve(import.meta.dirname, '..');

export function command(executable: string, args: readonly string[], cwd = repository): string {
  const result = spawnSync(executable, [...args], { cwd, env: process.env, encoding: 'utf8', timeout: 120_000, maxBuffer: 4 * 1024 * 1024 });
  assert.equal(result.error, undefined, String(result.error));
  assert.equal(result.status, 0, `${executable} ${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

export function pnpm(args: readonly string[], cwd = repository): string {
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
    pnpm(['pack', '--pack-destination', target], directory);
    const tarball = join(target, `${manifest.name.replace('@', '').replace('/', '-')}-${manifest.version}.tgz`);
    results.set(manifest.name, tarball);
  }
  return results;
}
