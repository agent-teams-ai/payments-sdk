import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import { command, packPackages, pnpm, repository } from './package-artifacts.ts';

type CandidateArchive = Readonly<{
  name: string; version: string; filename: string; bytes: number; sha256: string;
  dependencies: Readonly<Record<string, string>>;
  peerDependencies: Readonly<Record<string, string>>;
}>;
type CandidateManifest = Readonly<{
  schemaVersion: number; status: string; upstreamCommit: string; source: string;
  archives: readonly CandidateArchive[];
}>;
type ArchiveManifest = Readonly<{
  name: string; version: string; license: string; exports?: unknown;
  dependencies?: Readonly<Record<string, string>>;
  peerDependencies?: Readonly<Record<string, string>>;
}>;

const source = join(repository, 'qualification/observation');
const reportBase = join(repository, `.artifacts/observation-candidate-node-${process.versions.node}`);
await rm(`${reportBase}.json`, { force: true });
await rm(`${reportBase}.log`, { force: true });
const manifestBytes = await readFile(join(source, 'upstream-artifacts.json'));
const manifest = JSON.parse(manifestBytes.toString('utf8')) as CandidateManifest;
assert.equal(manifest.schemaVersion, 1);
assert.equal(manifest.status, 'unpublished-upstream-candidate');
assert.equal(manifest.source, 'https://github.com/agent-teams-ai/get-modular');
assert.match(manifest.upstreamCommit, /^[a-f0-9]{40}$/u);
assert.deepEqual(manifest.archives.map(item => item.name).sort(), [
  '@get-modular/assembly', '@get-modular/conformance', '@get-modular/core',
  '@get-modular/observation', '@get-modular/resources',
]);
assert.ok(process.env['DATABASE_URL'], 'DATABASE_URL is required: candidate qualification includes real PostgreSQL');
command(process.execPath, ['tools/toolchain.ts']);

const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const cache = join(repository, '.artifacts/observation-upstream', digest(manifestBytes));
await mkdir(cache, { recursive: true });
const upstream = new Map<string, string>();
for (const archive of manifest.archives) {
  assert.match(archive.filename, /^get-modular-[a-z]+-\d+\.\d+\.\d+\.tgz$/u);
  assert.match(archive.sha256, /^[a-f0-9]{64}$/u);
  assert.ok(Number.isSafeInteger(archive.bytes) && archive.bytes > 0 && archive.bytes < 1_000_000);
  const target = join(cache, archive.filename);
  let bytes: Buffer;
  try {
    bytes = await readFile(target);
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
    const url = `https://raw.githubusercontent.com/agent-teams-ai/get-modular/${manifest.upstreamCommit}/research/releases/observation-0.1.0/${archive.filename}`;
    // Download only pinned public archives; no lifecycle script runs before digest admission.
    command('curl', ['--fail', '--silent', '--show-error', '--location', '--max-time', '30', '--max-filesize', '1000000', '--output', target, url]);
    bytes = await readFile(target);
  }
  assert.equal(bytes.length, archive.bytes, `${archive.name}: archive size differs from the retained candidate`);
  assert.equal(digest(bytes), archive.sha256, `${archive.name}: archive digest differs from the retained candidate`);
  const entries = command('tar', ['-tzf', target]).trim().split('\n');
  assert.ok(entries.every(entry => entry.startsWith('package/') && !entry.split('/').includes('..')));
  const packed = JSON.parse(command('tar', ['-xOf', target, 'package/package.json'])) as ArchiveManifest;
  assert.equal(packed.name, archive.name);
  assert.equal(packed.version, archive.version);
  assert.equal(packed.license, 'Apache-2.0');
  assert.ok(packed.exports, `${archive.name}: missing public exports`);
  assert.deepEqual(packed.dependencies ?? {}, archive.dependencies);
  assert.deepEqual(packed.peerDependencies ?? {}, archive.peerDependencies);
  upstream.set(archive.name, target);
}

const catalog = (parse(await readFile(join(repository, 'pnpm-workspace.yaml'), 'utf8')) as { catalog: Record<string, string> }).catalog;
function pin(name: string): string {
  const value = catalog[name];
  assert.ok(value && /^\d+\.\d+\.\d+$/u.test(value), `Expected qualified exact catalog pin for ${name}`);
  return value;
}
const tarballs = await packPackages();
const paymentsArtifacts = [];
for (const [name, path] of tarballs) {
  if (name !== '@agent-teams/payments-get-modular') paymentsArtifacts.push({ name, sha256: digest(await readFile(path)) });
}
const root = await mkdtemp(join(tmpdir(), 'payments-observation-'));
try {
  const dependencies: Record<string, string> = {};
  for (const name of ['core', 'paddle', 'postgres']) {
    const packageName = `@agent-teams/payments-${name}`;
    const tarball = tarballs.get(packageName);
    assert.ok(tarball);
    dependencies[packageName] = `file:${tarball}`;
  }
  for (const [name, path] of upstream) dependencies[name] = `file:${path}`;
  for (const name of ['pg', '@types/pg', '@types/node', 'undici']) dependencies[name] = pin(name);
  const rootManifest = JSON.parse(await readFile(join(repository, 'package.json'), 'utf8')) as { packageManager: string };
  await writeFile(join(root, 'package.json'), JSON.stringify({ private: true, type: 'module', packageManager: rootManifest.packageManager, dependencies }, null, 2));
  // Exact archives also override transitive references. No workspace symlink or old GM peer enters this graph.
  const overrides = Object.entries(dependencies).filter(([name]) => name.startsWith('@get-modular/') || name.startsWith('@agent-teams/payments-') || name === '@types/node');
  await writeFile(join(root, 'pnpm-workspace.yaml'), `engineStrict: true\nstrictPeerDependencies: true\noverrides:\n${overrides.map(([name, value]) => `  ${JSON.stringify(name)}: ${JSON.stringify(value)}`).join('\n')}\n`);
  pnpm(['install', '--prefer-offline', '--ignore-scripts', '--lockfile=false', '--strict-peer-dependencies'], root);
  for (const path of ['qualification/observation', 'tests/fixtures/consumers', 'packages/payments-paddle/test/fixtures.ts']) {
    await cp(join(repository, path), join(root, path), { recursive: true });
  }
  const candidate = join(root, 'qualification/observation');
  const compiler = join(repository, 'node_modules/typescript/bin/tsc');
  const profiles = ['NodeNext', 'Bundler'] as const;
  for (const profile of profiles) {
    const config = `tsconfig.${profile.toLowerCase()}.json`;
    await writeFile(join(candidate, config), JSON.stringify({ extends: './tsconfig.json', compilerOptions: {
      module: profile === 'Bundler' ? 'ESNext' : 'NodeNext', moduleResolution: profile,
    } }));
    command(process.execPath, [compiler, '-p', join(candidate, config)], root);
  }
  const tests = (await readdir(candidate)).filter(name => name.endsWith('.test.ts')).sort();
  assert.ok(tests.length > 0, 'Candidate cannot qualify without scenarios');
  const output = command(process.execPath, ['--test', '--test-reporter=spec', ...tests.map(name => join(candidate, name))], root);
  console.log(output);
  const report = {
    status: 'passed', qualification: 'unpublished-upstream-candidate', npmPublicationProven: false,
    productionAdmission: false, node: process.version, typescript: pin('typescript'),
    upstreamCommit: manifest.upstreamCommit, manifestSha256: digest(manifestBytes),
    paymentsArtifacts,
    archives: manifest.archives.map(({ name, version, sha256 }) => ({ name, version, sha256 })),
    resolvers: profiles.map(resolution => ({ resolution, strict: true, skipLibCheck: false, passed: true })),
    tests, scenarioOutputSha256: digest(Buffer.from(output)),
  };
  await writeFile(`${reportBase}.json`, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(`${reportBase}.log`, output);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await rm(root, { recursive: true, force: true });
}
