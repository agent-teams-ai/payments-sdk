import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import { command, packPackages, pnpm, repository } from './package-artifacts.ts';

type PublishedArchive = Readonly<{
  name: string; version: string; bytes: number; sha256: string; registry: string; tarball: string; integrity: string;
  dependencies: Readonly<Record<string, string>>;
  peerDependencies: Readonly<Record<string, string>>;
}>;
type PublishedManifest = Readonly<{
  schemaVersion: number; status: string; archives: readonly PublishedArchive[];
}>;
type RegistryVersion = Readonly<{
  name: string; version: string;
  dependencies?: Readonly<Record<string, string>>;
  peerDependencies?: Readonly<Record<string, string>>;
  dist: Readonly<{ tarball: string; integrity: string }>;
}>;

const source = join(repository, 'qualification/observation');
const reportBase = join(repository, `.artifacts/observation-published-node-${process.versions.node}`);
await rm(`${reportBase}.json`, { force: true });
await rm(`${reportBase}.log`, { force: true });
const manifestBytes = await readFile(join(source, 'published-artifacts.json'));
const manifest = JSON.parse(manifestBytes.toString('utf8')) as PublishedManifest;
assert.equal(manifest.schemaVersion, 1);
assert.equal(manifest.status, 'published-registry-release');
assert.deepEqual(manifest.archives.map(item => item.name).toSorted(), [
  '@get-modular/assembly', '@get-modular/conformance', '@get-modular/core',
  '@get-modular/observation', '@get-modular/resources',
]);
assert.ok((process.env['DATABASE_URL'] !== undefined && process.env['DATABASE_URL'] !== ''), 'DATABASE_URL is required: published observation qualification includes real PostgreSQL');
await command(process.execPath, ['tools/toolchain.ts']);

const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const catalog = (parse(await readFile(join(repository, 'pnpm-workspace.yaml'), 'utf8')) as { catalog: Record<string, string> }).catalog;
function pin(name: string): string {
  const value = catalog[name];
  assert.ok((value !== undefined && value !== '') && /^\d+\.\d+\.\d+$/u.test(value), `Expected qualified exact catalog pin for ${name}`);
  return value;
}
// Registry packages replace the prepublication download/cache path. Verify public immutable
// metadata and bytes, then let the ordinary package manager install those exact public versions.
for (const archive of manifest.archives) {
  assert.equal(archive.version, pin(archive.name));
  assert.equal(archive.registry, `https://registry.npmjs.org/${archive.name.replaceAll('/', '%2f')}/${archive.version}`);
  assert.equal(archive.tarball, `https://registry.npmjs.org/${archive.name}/-/${archive.name.slice('@get-modular/'.length)}-${archive.version}.tgz`);
  const response = await fetch(archive.registry, { signal: AbortSignal.timeout(30_000) });
  assert.equal(response.status, 200, `${archive.name}: official published version is unavailable`);
  const metadata = await response.json() as RegistryVersion;
  assert.equal(metadata.name, archive.name);
  assert.equal(metadata.version, archive.version);
  assert.deepEqual(metadata.dependencies ?? {}, archive.dependencies);
  assert.deepEqual(metadata.peerDependencies ?? {}, archive.peerDependencies);
  assert.equal(metadata.dist.tarball, archive.tarball);
  assert.equal(metadata.dist.integrity, archive.integrity);
  const download = await fetch(archive.tarball, { signal: AbortSignal.timeout(30_000) });
  assert.equal(download.status, 200);
  const bytes = new Uint8Array(await download.arrayBuffer());
  assert.equal(bytes.length, archive.bytes);
  assert.equal(digest(bytes), archive.sha256, `${archive.name}: published archive identity changed`);
  assert.equal(`sha512-${createHash('sha512').update(bytes).digest('base64')}`, archive.integrity);
}

const tarballs = await packPackages();
const paymentsArtifacts = [];
for (const [name, path] of tarballs) {paymentsArtifacts.push({ name, sha256: digest(await readFile(path)) });}
const root = await mkdtemp(join(tmpdir(), 'payments-observation-published-'));
try {
  const dependencies: Record<string, string> = {};
  for (const [name, path] of tarballs) {dependencies[name] = `file:${path}`;}
  for (const archive of manifest.archives) {dependencies[archive.name] = archive.version;}
  for (const name of ['pg', '@types/pg', '@types/node', 'undici']) {dependencies[name] = pin(name);}
  const rootManifest = JSON.parse(await readFile(join(repository, 'package.json'), 'utf8')) as { packageManager: string };
  await writeFile(join(root, 'package.json'), JSON.stringify({ private: true, type: 'module', packageManager: rootManifest.packageManager, dependencies }, null, 2));
  const overrides = Object.entries(dependencies).filter(([name]) => name.startsWith('@get-modular/') || name.startsWith('@agent-teams/payments-') || name === '@types/node');
  await writeFile(join(root, 'pnpm-workspace.yaml'), `engineStrict: true\nstrictPeerDependencies: true\noverrides:\n${overrides.map(([name, value]) => `  ${JSON.stringify(name)}: ${JSON.stringify(value)}`).join('\n')}\n`);
  await pnpm(['install', '--prefer-offline', '--ignore-scripts', '--lockfile=false', '--strict-peer-dependencies'], root);
  for (const archive of manifest.archives) {
    const installed = JSON.parse(await readFile(join(root, 'node_modules', archive.name, 'package.json'), 'utf8')) as RegistryVersion;
    assert.equal(installed.version, archive.version);
    assert.deepEqual(installed.dependencies ?? {}, archive.dependencies);
    assert.deepEqual(installed.peerDependencies ?? {}, archive.peerDependencies);
  }
  for (const path of ['qualification/observation', 'tests/fixtures/consumers']) {
    await cp(join(repository, path), join(root, path), { recursive: true });
  }
  const consumer = join(root, 'qualification/observation');
  const compiler = join(repository, 'node_modules/typescript/bin/tsc');
  const profiles = ['NodeNext', 'Bundler'] as const;
  for (const profile of profiles) {
    const config = `tsconfig.${profile.toLowerCase()}.json`;
    await writeFile(join(consumer, config), JSON.stringify({ extends: './tsconfig.json', compilerOptions: {
      module: profile === 'Bundler' ? 'ESNext' : 'NodeNext', moduleResolution: profile,
      exactOptionalPropertyTypes: true, noUncheckedIndexedAccess: true,
    } }));
    await command(process.execPath, [compiler, '-p', join(consumer, config)], root);
  }
  const tests = (await readdir(consumer)).filter(name => name.endsWith('.test.ts')).toSorted();
  assert.ok(tests.length > 0, 'Published observation cannot qualify without scenarios');
  const output = await command(process.execPath, ['--test', '--test-reporter=spec', ...tests.map(name => join(consumer, name))], root);
  console.log(output);
  const report = {
    status: 'passed', qualification: 'published-registry-release', npmPublicationProven: true,
    node: process.version, platform: process.platform, arch: process.arch, typescript: pin('typescript'), publicSurface: '@agent-teams/payments-get-modular/observation',
    manifestSha256: digest(manifestBytes), paymentsArtifacts,
    archives: manifest.archives.map(({ name, version, sha256, integrity, tarball }) => ({ name, version, sha256, integrity, tarball })),
    resolvers: profiles.map(resolution => ({ resolution, strict: true, exactOptionalPropertyTypes: true, noUncheckedIndexedAccess: true, skipLibCheck: false, passed: true })),
    tests, scenarioOutputSha256: digest(Buffer.from(output)),
  };
  await mkdir(join(repository, '.artifacts'), { recursive: true });
  await writeFile(`${reportBase}.json`, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(`${reportBase}.log`, output);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await rm(root, { recursive: true, force: true });
}
