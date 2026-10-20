import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { EnvHttpProxyAgent, fetch } from 'undici';
import { command, repository } from './package-artifacts.ts';

type Artifact = Readonly<{
  name: string; version: string; integrity: string; tarball: string; sourceCommit: string;
  packageJsonSha256: string;
  patch: Readonly<{ path: string; sha256: string; files: readonly Readonly<{
    path: string; fields: readonly string[]; originalSha256: string; patchedSha256: string;
  }>[] }>;
  runtime: Readonly<{ files: number; sha256Manifest: string }>;
  declaration: Readonly<{ files: number; sha256Manifest: string }>;
}>;

const reportPath = join(repository, `.artifacts/drizzle-admission-node-${process.versions.node}.json`);
await rm(reportPath, { force: true });
const artifact = JSON.parse(await readFile(join(repository, 'qualification/drizzle/artifact.json'), 'utf8')) as Artifact;
const hash = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
assert.equal(artifact.name, 'drizzle-orm');
assert.equal(artifact.patch.files.length, 8, 'Only the four reviewed interfaces and their CJS declarations may change');
assert.equal(artifact.patch.files.reduce((count, file) => count + file.fields.length, 0), 30);
assert.equal(hash(await readFile(join(repository, artifact.patch.path))), artifact.patch.sha256, 'Maintainer patch drift');
const require = createRequire(join(repository, 'packages/payments-postgres/package.json'));
const installed = dirname(require.resolve('drizzle-orm'));
const manifest = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8')) as { version: string };
assert.equal(manifest.version, artifact.version);

await mkdir(join(repository, '.artifacts'), { recursive: true });
const temporary = await mkdtemp(join(repository, '.artifacts/drizzle-admission-'));
try {
  const archive = join(temporary, 'official.tgz');
  const supplied = process.env['DRIZZLE_ARCHIVE'];
  const bytes = (supplied !== undefined && supplied !== '') ? await readFile(supplied) : new Uint8Array(await (async () => {
    const dispatcher = new EnvHttpProxyAgent();
    try {
      const response = await fetch(artifact.tarball, { dispatcher, signal: AbortSignal.timeout(20_000) });
      assert.equal(response.ok, true, `Cannot retrieve official Drizzle artifact: ${response.status}`);
      return await response.arrayBuffer();
    } finally { await dispatcher.close(); }
  })());
  assert.ok(bytes.byteLength < 20_000_000, 'Unexpected Drizzle archive size');
  assert.equal(`sha512-${createHash('sha512').update(bytes).digest('base64')}`, artifact.integrity, 'Official archive SRI mismatch');
  await writeFile(archive, bytes);
  const entries = (await command('tar', ['-tzf', archive])).trim().split('\n');
  assert.ok(entries.every(entry => entry.startsWith('package/') && !entry.split('/').includes('..')), 'Unsafe archive path');
  await command('tar', ['-xzf', archive, '-C', temporary]);
  const original = join(temporary, 'package');
  const originalFiles = entries.filter(entry => !entry.endsWith('/')).map(entry => entry.slice('package/'.length)).toSorted();
  const installedFiles: string[] = [];
  const visit = async (path = ''): Promise<void> => {
    for (const entry of await readdir(join(installed, path), { withFileTypes: true })) {
      const relative = path ? `${path}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {await visit(relative);}
      else { assert.equal(entry.isFile(), true, `Unexpected installed link ${relative}`); installedFiles.push(relative); }
    }
  };
  await visit();
  assert.deepEqual(installedFiles.toSorted(), originalFiles, 'Installed Drizzle package file set drift');
  assert.equal(hash(await readFile(join(original, 'package.json'))), artifact.packageJsonSha256);
  let runtimeCount = 0;
  let runtimeManifest = '';
  let declarationCount = 0;
  let declarationManifest = '';
  const changed: string[] = [];
  for (const file of originalFiles) {
    const official = await readFile(join(original, file));
    const actual = await readFile(join(installed, file));
    const correction = artifact.patch.files.find(item => item.path === file);
    if (correction) {
      assert.equal(hash(official), correction.originalSha256, `Official declaration drift: ${file}`);
      const text = official.toString('utf8');
      const interfaceName = `${file.startsWith('pg-') ? 'Pg' : 'Cockroach'}${file.includes('policies') ? 'Policy' : 'Role'}Config`;
      const match = new RegExp(`interface ${interfaceName} \\{\\n([^}]+)\\n\\}`).exec(text);
      assert.ok((match?.[1] !== undefined && match[1] !== ''), `Missing reviewed configuration interface: ${file}`);
      let declaration = match[1];
      for (const field of correction.fields) {
        const line = new RegExp(`(^  ${field}\\?: [^;\\n]+);$`, 'm');
        assert.equal(line.test(declaration), true, `Missing reviewed optional field: ${file}/${field}`);
        declaration = declaration.replace(line, '$1 | undefined;');
      }
      const expected = text.replace(match[0], match[0].replace(match[1], declaration));
      assert.equal(actual.toString('utf8'), expected, `Change outside the reviewed optional-field correction: ${file}`);
      assert.equal(hash(actual), correction.patchedSha256, `Installed declaration patch drift: ${file}`);
      changed.push(file);
    } else {assert.equal(actual.equals(official), true, `Unapproved Drizzle file change: ${file}`);}
    if (/\.(?:js|cjs)$/u.test(file)) {
      runtimeCount += 1;
      runtimeManifest += `${file}\t${hash(official)}\n`;
    }
    if (/\.d\.(?:ts|cts)$/u.test(file)) {
      declarationCount += 1;
      declarationManifest += `${file}\t${hash(official)}\n`;
    }
  }
  assert.equal(runtimeCount, artifact.runtime.files);
  assert.equal(hash(runtimeManifest), artifact.runtime.sha256Manifest);
  assert.equal(declarationCount, artifact.declaration.files);
  assert.equal(hash(declarationManifest), artifact.declaration.sha256Manifest);
  assert.deepEqual(changed.toSorted(), artifact.patch.files.map(file => file.path).toSorted());

  // These are consumer probes, separate from the SDK's ordinary strict build. Their
  // invalid inputs must remain rejected after the optional-undefined correction.
  await symlink(join(repository, 'packages/payments-postgres/node_modules'), join(temporary, 'node_modules'), 'dir');
  const prelude = `import { sql } from 'drizzle-orm';
import { pgPolicy, pgRole } from 'drizzle-orm/pg-core';
import type { PgPolicyConfig, PgRoleConfig } from 'drizzle-orm/pg-core';
import { cockroachPolicy, cockroachRole } from 'drizzle-orm/cockroach-core';
import type { CockroachPolicyConfig, CockroachRoleConfig } from 'drizzle-orm/cockroach-core';
`;
  const valid = `${prelude}
const pgPolicyConfig: PgPolicyConfig = { as: undefined, for: undefined, to: undefined, using: undefined, withCheck: undefined };
const pgRoleConfig: PgRoleConfig = { createDb: undefined, createRole: undefined, inherit: undefined };
const crPolicyConfig: CockroachPolicyConfig = { as: undefined, for: undefined, to: undefined, using: undefined, withCheck: undefined };
const crRoleConfig: CockroachRoleConfig = { createDb: undefined, createRole: undefined };
const pgAssignedPolicy: PgPolicyConfig = pgPolicy('valid', pgPolicyConfig);
const pgAssignedRole: PgRoleConfig = pgRole('valid', pgRoleConfig);
const crAssignedPolicy: CockroachPolicyConfig = cockroachPolicy('valid', crPolicyConfig);
const crAssignedRole: CockroachRoleConfig = cockroachRole('valid', crRoleConfig);
pgPolicy('valid', { as: 'permissive', for: 'select', to: 'public', using: sql\`true\`, withCheck: sql\`true\` });
void [pgAssignedPolicy, pgAssignedRole, crAssignedPolicy, crAssignedRole];
`;
  const invalid = `${prelude}
pgPolicy('invalid', { as: 'unsupported' });
pgPolicy('invalid', { for: 'merge' });
pgPolicy('invalid', { using: 'true' });
pgRole('invalid', { createDb: 1 });
cockroachRole('invalid', { createRole: 'yes' });
`;
  const probes: { resolution: string; valid: boolean; rejectedInvalidInputs: number }[] = [];
  for (const resolution of ['NodeNext', 'Bundler']) {
    await writeFile(join(temporary, 'tsconfig.json'), JSON.stringify({
      extends: join(repository, 'tsconfig.base.json'),
      compilerOptions: { module: resolution === 'Bundler' ? 'ESNext' : 'NodeNext', moduleResolution: resolution, noEmit: true, declaration: false, declarationMap: false },
      include: ['probe.ts'],
    }));
    await writeFile(join(temporary, 'probe.ts'), valid);
    await command(process.execPath, [join(repository, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.json'], temporary);
    await writeFile(join(temporary, 'probe.ts'), invalid);
    const result = spawnSync(process.execPath, [join(repository, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.json', '--pretty', 'false'],
      { cwd: temporary, encoding: 'utf8', timeout: 30_000 });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1, 'Invalid Drizzle field inputs must fail compilation');
    const diagnostics = result.stdout.trim().split('\n');
    assert.equal(diagnostics.length, 5, `Unexpected declaration failures:\n${result.stdout}\n${result.stderr}`);
    assert.ok(diagnostics.every(line => /^probe\.ts\(\d+,\d+\): error TS2322:/u.test(line)), result.stdout);
    probes.push({ resolution, valid: true, rejectedInvalidInputs: diagnostics.length });
  }
  const report = {
    node: process.versions.node,
    subject: { commit: (await command('git', ['rev-parse', 'HEAD'])).trim(), trackedChanges: (await command('git', ['status', '--porcelain', '--untracked-files=no'])).trim() !== '' },
    artifact: { version: artifact.version, integrity: artifact.integrity, sourceCommit: artifact.sourceCommit },
    patchSha256: artifact.patch.sha256, changedDeclarations: changed, runtime: { files: runtimeCount, sha256Manifest: hash(runtimeManifest), unchanged: true }, probes,
    officialDeclarations: { files: declarationCount, sha256Manifest: hash(declarationManifest) },
  };
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} finally { await rm(temporary, { recursive: true, force: true }); }
