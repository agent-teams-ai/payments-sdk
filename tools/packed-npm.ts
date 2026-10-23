import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, glob, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { parse } from 'yaml';
import { command, repository } from './package-artifacts.ts';

type DrizzleArtifact = Readonly<{
  name: string; version: string; integrity: string; tarball: string; packageJsonSha256: string;
  patch: Readonly<{ files: readonly Readonly<{ path: string; originalSha256: string }>[] }>;
  runtime: Readonly<{ files: number; sha256Manifest: string; manifestEncoding: string }>;
  declaration: Readonly<{ files: number; sha256Manifest: string; manifestEncoding: string }>;
}>;
export type ConsumerPackage = Readonly<{ name: string; version: string; tarball: string; sha256: string; entrypoints: readonly string[] }>;

const digest = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
const forbiddenTypePath = /(?:^|[/\\])(?:drizzle-orm|mysql2|mysql)(?:[/\\]|$)/u;

/** A fresh npm installation proves the maintainer-only declaration repair is not a consumer input. */
export async function qualifyNpmConsumer(target: string, packages: readonly ConsumerPackage[], compiler: string): Promise<void> {
  const reportBase = join(repository, `.artifacts/packed-npm-node-${process.versions.node}`);
  for (const suffix of ['json', 'log', 'package-lock.json', 'nodenext.files.txt', 'bundler.files.txt']) {await rm(`${reportBase}.${suffix}`, { force: true });}
  assert.ok((process.env['DATABASE_URL'] !== undefined && process.env['DATABASE_URL'] !== ''), 'DATABASE_URL is required: the npm consumer runs the existing real PostgreSQL financial oracle');
  await mkdir(target);
  const artifact = JSON.parse(await readFile(join(repository, 'qualification/drizzle/artifact.json'), 'utf8')) as DrizzleArtifact;
  const catalog = (parse(await readFile(join(repository, 'pnpm-workspace.yaml'), 'utf8')) as { catalog: Record<string, string> }).catalog;
  const dependencies: Record<string, string> = Object.fromEntries(packages.map(item => [item.name, `file:${item.tarball}`]));
  for (const name of ['@get-modular/core', '@get-modular/assembly', '@get-modular/resources', '@get-modular/observation', '@get-modular/conformance', 'pg', 'pg-boss', '@types/pg', '@types/node', 'undici']) {
    const version = catalog[name];
    assert.ok((version !== undefined && version !== '') && /^\d+\.\d+\.\d+$/u.test(version), `Missing exact consumer fixture/peer pin ${name}`);
    dependencies[name] = version;
  }
  // npm's $ references preserve the root's exact four file: specs for transitive SDK edges.
  // Only SDK tarballs are overridden. Drizzle is an ordinary unpatched registry dependency.
  const overrides = Object.fromEntries(packages.map(({ name }) => [name, `$${name}`]));
  const input = { private: true, type: 'module', dependencies, overrides };
  await writeFile(join(target, 'package.json'), `${JSON.stringify(input, null, 2)}\n`);
  const npmVersion = (await command('npm', ['--version'], target)).trim();
  await command('npm', ['install', '--omit=dev', '--ignore-scripts', '--strict-peer-deps', '--no-audit', '--no-fund'], target);
  const lockBytes = await readFile(join(target, 'package-lock.json'));
  const lock = JSON.parse(lockBytes.toString('utf8')) as { packages: Record<string, { version?: string; resolved?: string; integrity?: string; dev?: boolean; link?: boolean }> };
  for (const [path, entry] of Object.entries(lock.packages)) {
    assert.equal(/(?:^|\/)node_modules\/mysql2(?:\/|$)/u.test(path), false, `mysql2 entered the production npm graph: ${path}`);
    assert.notEqual(entry.dev, true, `A development-only dependency entered the production consumer: ${path}`);
    assert.notEqual(entry.link, true, `A source/workspace link entered the packed consumer: ${path}`);
  }
  for (const item of packages) {
    const entry = lock.packages[`node_modules/${item.name}`];
    assert.equal(entry?.version, item.version);
    const resolved = entry.resolved;
    assert.ok(typeof resolved === 'string' && resolved.startsWith('file:'), `${item.name}: npm must resolve a local packed archive`);
    assert.equal(await realpath(resolve(target, resolved.slice('file:'.length))), await realpath(item.tarball), `${item.name}: npm must use the exact root tarball`);
    assert.equal(entry.integrity, `sha512-${createHash('sha512').update(await readFile(item.tarball)).digest('base64')}`);
  }
  const host = createRequire(join(target, 'package.json'));
  const postgres = createRequire(join(target, 'node_modules/@agent-teams/payments-postgres/package.json'));
  const drizzleRoot = dirname(postgres.resolve(artifact.name));
  assert.equal(await realpath(drizzleRoot), await realpath(dirname(host.resolve(artifact.name))), 'The adapter must execute the same official Drizzle installation inspected here');
  for (const require of [host, postgres, createRequire(join(drizzleRoot, 'package.json'))]) {
    assert.throws(() => require.resolve('mysql2'), { code: 'MODULE_NOT_FOUND' }, 'mysql2 must be absent from every relevant production resolution context');
    assert.throws(() => require.resolve('@agent-teams/engineering-foundation'), { code: 'MODULE_NOT_FOUND' });
    assert.throws(() => require.resolve('node-or-bun'), { code: 'MODULE_NOT_FOUND' });
  }
  const installedManifest = await readFile(join(drizzleRoot, 'package.json'));
  assert.equal(digest(installedManifest), artifact.packageJsonSha256, 'The npm consumer must have the untouched official Drizzle manifest');
  assert.equal((JSON.parse(installedManifest.toString('utf8')) as { version: string }).version, artifact.version);
  const installed = lock.packages['node_modules/drizzle-orm'];
  assert.equal(installed?.version, artifact.version);
  assert.equal(installed.resolved, artifact.tarball);
  assert.equal(installed.integrity, artifact.integrity);
  for (const file of artifact.patch.files) {
    assert.equal(digest(await readFile(join(drizzleRoot, file.path))), file.originalSha256, `${file.path}: a maintainer declaration patch leaked into npm`);
  }
  assert.equal(artifact.runtime.manifestEncoding, 'sorted relative .js/.cjs path, TAB, lowercase SHA256, LF');
  async function installedFileManifest(pattern: string): Promise<Readonly<{ files: number; sha256: string }>> {
    const paths: string[] = [];
    for await (const path of glob(pattern, { cwd: drizzleRoot })) {paths.push(path);}
    paths.sort();
    let manifest = '';
    for (const path of paths) {manifest += `${path}\t${digest(await readFile(join(drizzleRoot, path)))}\n`;}
    return { files: paths.length, sha256: digest(manifest) };
  }
  const runtime = await installedFileManifest('**/*.{js,cjs}');
  assert.equal(runtime.files, artifact.runtime.files);
  assert.equal(runtime.sha256, artifact.runtime.sha256Manifest, 'Installed Drizzle runtime must be byte-identical to the official artifact');
  assert.equal(artifact.declaration.manifestEncoding, 'sorted relative .d.ts/.d.cts path, TAB, lowercase SHA256, LF');
  const declaration = await installedFileManifest('**/*.{d.ts,d.cts}');
  assert.equal(declaration.files, artifact.declaration.files);
  assert.equal(declaration.sha256, artifact.declaration.sha256Manifest, 'All installed Drizzle declaration bytes must match the unpatched official artifact');

  // Reuse the existing independently asserted 225-credit/renewed-access/lost-ACK scenario.
  // Only fixture owners and test inputs are copied; every SDK operation uses its installed export.
  for (const path of ['qualification/observation/financial.test.ts', 'qualification/observation/test-support.ts', 'tests/fixtures/consumers', 'qualification/queue/pg-boss.test.ts']) {
    await cp(join(repository, path), join(target, path), { recursive: true });
  }
  const source = packages.flatMap(item => item.entrypoints).map((specifier, index) => `import * as api${index} from '${specifier}';\nvoid api${index};`).join('\n');
  await writeFile(join(target, 'index.ts'), source);
  await mkdir(join(repository, '.artifacts'), { recursive: true });
  const resolvers = [];
  for (const resolution of ['NodeNext', 'Bundler'] as const) {
    await writeFile(join(target, 'tsconfig.json'), JSON.stringify({ compilerOptions: {
      target: 'ES2024', lib: ['ES2024', 'DOM', 'DOM.Iterable'],
      module: resolution === 'Bundler' ? 'ESNext' : 'NodeNext', moduleResolution: resolution,
      strict: true, exactOptionalPropertyTypes: true, noUncheckedIndexedAccess: true, skipLibCheck: false,
      noEmit: true, allowImportingTsExtensions: true, types: ['node'],
    }, include: ['index.ts', 'qualification/observation/*.ts', 'qualification/queue/*.ts', 'tests/fixtures/consumers/*.ts'] }));
    const files = await command(process.execPath, [compiler, '-p', 'tsconfig.json', '--listFiles'], target);
    const paths = files.trim().split('\n');
    assert.ok(paths.includes(join(target, 'index.ts')), 'The actual all-export consumer must appear in the compiler file graph');
    for (const path of paths) {assert.equal(forbiddenTypePath.test(path), false, `ORM or MySQL declarations leaked through a public SDK export: ${path}`);}
    await writeFile(`${reportBase}.${resolution.toLowerCase()}.files.txt`, files);
    resolvers.push({ resolution, strict: true, exactOptionalPropertyTypes: true, noUncheckedIndexedAccess: true, skipLibCheck: false, ormDeclarationsReachable: false, listFilesSha256: digest(files), passed: true });
  }
  await command(process.execPath, ['--input-type=module', '-e', source], target);
  const output = await command(process.execPath, ['--test', '--test-reporter=spec', 'qualification/observation/financial.test.ts', 'qualification/queue/pg-boss.test.ts'], target);
  console.log(output);
  const report = {
    status: 'passed', consumer: 'production-only-npm', node: process.version, npm: npmVersion, typescript: (await command(process.execPath, [compiler, '--version'], target)).trim(),
    install: { omitDev: true, ignoreScripts: true, strictPeerDependencies: true, maintainerPatchConfiguration: false, mysql2Present: false },
    packages, publicEntrypoints: packages.flatMap(item => item.entrypoints),
    drizzle: { version: artifact.version, integrity: installed.integrity, manifestSha256: digest(installedManifest), correctedDeclarationTargetsUnpatched: artifact.patch.files.length, declarationFilesUnpatched: declaration.files, declarationManifestSha256: declaration.sha256, runtimeFiles: runtime.files, runtimeManifestSha256: runtime.sha256 },
    resolvers, lockSha256: digest(lockBytes), inputManifestSha256: digest(JSON.stringify(input)),
    financialScenario: 'qualification/observation/financial.test.ts', pgBossScenario: 'qualification/queue/pg-boss.test.ts', pgBossExplicitlyInstalled: true, scenarioOutputSha256: digest(output),
  };
  await writeFile(`${reportBase}.package-lock.json`, lockBytes);
  await writeFile(`${reportBase}.log`, output);
  await writeFile(`${reportBase}.json`, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}

/** An ordinary production-only install must use the existing custom transport without pg-boss. */
export async function qualifyNpmQueueConsumer(target: string, packages: readonly ConsumerPackage[], compiler: string, withNodePostgres: boolean): Promise<void> {
  assert.ok(process.env['DATABASE_URL'] !== undefined && process.env['DATABASE_URL'] !== '', 'DATABASE_URL is required: the queue consumer runs the real PostgreSQL transport scenario');
  const reportBase = join(repository, `.artifacts/packed-${withNodePostgres ? 'queue' : 'postgres-root'}-node-${process.versions.node}`);
  for (const suffix of ['json', 'log', 'package-lock.json', 'nodenext.files.txt', 'bundler.files.txt']) {await rm(`${reportBase}.${suffix}`, { force: true });}
  await mkdir(target);
  const selected = packages.filter(item => ['@agent-teams/payments-core', '@agent-teams/payments-postgres'].includes(item.name));
  assert.equal(selected.length, 2);
  const catalog = (parse(await readFile(join(repository, 'pnpm-workspace.yaml'), 'utf8')) as { catalog: Record<string, string> }).catalog;
  const dependencies: Record<string, string> = Object.fromEntries(selected.map(item => [item.name, `file:${item.tarball}`]));
  for (const name of withNodePostgres ? ['pg', '@types/pg', '@types/node'] : []) {
    const version = catalog[name];
    assert.ok(version !== undefined && /^\d+\.\d+\.\d+$/u.test(version), `Missing exact consumer fixture pin ${name}`);
    dependencies[name] = version;
  }
  const overrides = Object.fromEntries(selected.map(({ name }) => [name, `$${name}`]));
  await writeFile(join(target, 'package.json'), JSON.stringify({ private: true, type: 'module', dependencies, overrides }));
  // Do not omit optional packages: the manifest itself must prevent automatic peer installation.
  await command('npm', ['install', '--omit=dev', '--ignore-scripts', '--strict-peer-deps', '--no-audit', '--no-fund'], target);
  const lockBytes = await readFile(join(target, 'package-lock.json'));
  const lock = JSON.parse(lockBytes.toString('utf8')) as { packages: Record<string, { dev?: boolean; link?: boolean }> };
  for (const [path, entry] of Object.entries(lock.packages)) {
    assert.equal(/(?:^|\/)node_modules\/(?:pg-boss|mysql2)(?:\/|$)/u.test(path) || (!withNodePostgres && /(?:^|\/)node_modules\/(?:pg|@types\/pg)(?:\/|$)/u.test(path)), false, `Unselected dependency entered the production queue consumer: ${path}`);
    assert.notEqual(entry.dev, true, `Development-only dependency entered the production queue consumer: ${path}`);
    assert.notEqual(entry.link, true, `Workspace link entered the packed queue consumer: ${path}`);
  }
  const postgresManifest = JSON.parse(await readFile(join(target, 'node_modules/@agent-teams/payments-postgres/package.json'), 'utf8')) as {
    dependencies?: Record<string, string>; peerDependencies: Record<string, string>; peerDependenciesMeta: Record<string, { optional: boolean }>;
  };
  assert.equal(postgresManifest.dependencies?.['pg-boss'], undefined);
  assert.equal(postgresManifest.peerDependencies['pg-boss'], catalog['pg-boss']);
  assert.equal(postgresManifest.peerDependenciesMeta['pg-boss']?.optional, true);
  for (const require of [createRequire(join(target, 'package.json')), createRequire(join(target, 'node_modules/@agent-teams/payments-postgres/package.json'))]) {
    for (const absent of ['pg-boss', '@agent-teams/engineering-foundation', 'node-or-bun', ...(withNodePostgres ? [] : ['pg', '@types/pg'])]) {assert.throws(() => require.resolve(absent), { code: 'MODULE_NOT_FOUND' });}
  }
  for (const path of withNodePostgres ? ['tests/e2e/queue-transport.test.ts', 'tests/e2e/queue-transport-fixture.ts', 'tests/fixtures/consumers'] : []) {
    await cp(join(repository, path), join(target, path), { recursive: true });
  }
  await writeFile(join(target, 'index.ts'), "import * as api from '@agent-teams/payments-postgres';\nvoid api;\n");
  const resolvers = [];
  for (const resolution of ['NodeNext', 'Bundler'] as const) {
    await writeFile(join(target, 'tsconfig.json'), JSON.stringify({ compilerOptions: {
      target: 'ES2024', lib: ['ES2024', 'DOM'], module: resolution === 'Bundler' ? 'ESNext' : 'NodeNext', moduleResolution: resolution,
      strict: true, exactOptionalPropertyTypes: true, noUncheckedIndexedAccess: true, skipLibCheck: false,
      noEmit: true, allowImportingTsExtensions: true, types: withNodePostgres ? ['node'] : [],
    }, include: withNodePostgres ? ['index.ts', 'tests/e2e/queue-transport*.ts', 'tests/fixtures/consumers/*.ts'] : ['index.ts'] }));
    const files = await command(process.execPath, [compiler, '-p', 'tsconfig.json', '--listFiles'], target);
    for (const path of files.trim().split('\n')) {
      if (!withNodePostgres) {assert.equal(/(?:^|[/\\])(?:pg|@types[/\\]pg)(?:[/\\]|$)/u.test(path), false, `Driver declarations leaked through the root export: ${path}`);}
      assert.equal(forbiddenTypePath.test(path) || /(?:^|[/\\])pg-boss(?:[/\\]|$)/u.test(path), false, `Unselected vendor declarations leaked through the root export: ${path}`);
    }
    await mkdir(join(repository, '.artifacts'), { recursive: true });
    await writeFile(`${reportBase}.${resolution.toLowerCase()}.files.txt`, files);
    resolvers.push({ resolution, strict: true, exactOptionalPropertyTypes: true, noUncheckedIndexedAccess: true, skipLibCheck: false, pgBossDeclarationsReachable: false, listFilesSha256: digest(files), passed: true });
  }
  await command(process.execPath, ['index.ts'], target);
  const output = withNodePostgres ? await command(process.execPath, ['--test', '--test-reporter=spec', 'tests/e2e/queue-transport.test.ts'], target) : '';
  console.log(output);
  await mkdir(join(repository, '.artifacts'), { recursive: true });
  const report = {
    status: 'passed', consumer: withNodePostgres ? 'production-only-npm-custom-queue' : 'production-only-npm-postgres-root', node: process.version,
    install: { omitDev: true, ignoreScripts: true, strictPeerDependencies: true, optionalPackagesOmitted: false, pgBossPresent: false, nodePostgresExplicitlyInstalled: withNodePostgres },
    packages: selected, publicEntrypoint: '@agent-teams/payments-postgres', resolvers,
    scenario: withNodePostgres ? 'tests/e2e/queue-transport.test.ts' : null, scenarioOutputSha256: digest(output), lockSha256: digest(lockBytes),
  };
  await writeFile(`${reportBase}.package-lock.json`, lockBytes);
  await writeFile(`${reportBase}.log`, output);
  await writeFile(`${reportBase}.json`, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}
