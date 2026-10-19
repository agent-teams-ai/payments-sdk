import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { command, packPackages, repository } from './package-artifacts.ts';

const tarballs = await packPackages();
const report = [];
for (const [name, tarball] of tarballs) {
  const entries = command('tar', ['-tzf', tarball]).trim().split('\n');
  assert.ok(entries.includes('package/dist/index.js'), `${name}: missing ESM entrypoint`);
  assert.ok(entries.includes('package/dist/index.d.ts'), `${name}: missing declarations`);
  assert.ok(entries.some((entry) => /\/LICENSE(?:\.md|\.txt)?$/iu.test(entry)), `${name}: missing license`);
  assert.ok(entries.every((entry) => !/\/(?:src|test|tests|node_modules)\//u.test(entry)), `${name}: development files leaked into archive`);
  const manifest = JSON.parse(command('tar', ['-xOf', tarball, 'package/package.json'])) as {
    dependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    exports?: unknown;
  };
  assert.ok(manifest.exports, `${name}: missing exports map`);
  for (const [dependency, version] of Object.entries({ ...manifest.dependencies, ...manifest.peerDependencies })) {
    assert.ok(!version.startsWith('workspace:') && !version.startsWith('catalog:'), `${name}: unresolved publish protocol ${dependency}`);
    assert.notEqual(dependency, '@agent-teams/engineering-foundation', `${name}: development tooling leaked into runtime`);
  }
  report.push({ name, tarball, entries: entries.length });
}
await mkdir(join(repository, '.artifacts'), { recursive: true });
await writeFile(join(repository, '.artifacts/release-dry-run.json'), `${JSON.stringify({ published: false, packages: report }, null, 2)}\n`);
console.log(JSON.stringify({ published: false, packages: report }, null, 2));
