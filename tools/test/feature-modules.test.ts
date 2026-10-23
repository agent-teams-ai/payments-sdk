import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { STANDARD } from '@agent-teams/feature-module-standard';
import { checkFeatureModules } from '../check-feature-modules.ts';
import { repository } from '../package-artifacts.ts';

const packageRoot = 'packages/payments-core';
const source = `${packageRoot}/src`;
const feature = `${source}/features/payment-evidence`;
const values = `${feature}/domain/values.ts`;
const facade = `${source}/index.ts`;

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'payments-fms-gate-'));
  for (const path of ['architecture', `${feature}/domain`, `${feature}/composition`]) { await mkdir(join(root, path), { recursive: true }); }
  await symlink(join(repository, 'node_modules'), join(root, 'node_modules'), 'dir');
  await writeFile(join(root, 'package.json'), JSON.stringify({ type: 'module' }));
  await writeFile(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2024', module: 'NodeNext', strict: true }, include: ['packages/**/*.ts'] }));
  await writeFile(join(root, packageRoot, 'package.json'), JSON.stringify({ name: '@agent-teams/payments-core', type: 'module', exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' } } }));
  await writeFile(join(root, 'architecture/feature-module-standard.json'), JSON.stringify({
    schemaVersion: 1, status: 'adopted', standard: STANDARD, productionRoots: ['packages'], excludedRoots: [], deviations: [],
    modules: [{ id: 'payments-core', root: packageRoot, sourceRoot: source, testRoots: [], publicEntrypoints: [facade], moduleAssembly: [facade],
      features: [{ id: 'payment-evidence', root: feature, layers: [{ root: `${feature}/domain`, role: 'domain' }, { root: `${feature}/composition`, role: 'composition' }] }],
      surfaces: { public: [`${feature}/composition/public.ts`] }, useEdges: [], exceptions: [], generatedRoots: [] }],
  }));
  await writeFile(join(root, facade), "export { meaning } from './features/payment-evidence/composition/public.js';\n");
  await writeFile(join(root, `${feature}/composition/public.ts`), "export { meaning } from '../domain/values.js';\n");
  await writeFile(join(root, values), 'export const meaning = 42;\n');
  return root;
}

async function scenario(run: (root: string) => Promise<void>): Promise<void> {
  const root = await fixture();
  try { await checkFeatureModules(root); await run(root); }
  finally { await rm(root, { recursive: true, force: true }); }
}

void test('FMS accepts directory-backed curated facades and deterministic domain computation', () => scenario(async root => {
  await writeFile(join(root, values), `import { createHash as hash } from 'node:crypto';
const window = { from: '2026-10-22T00:00:00Z' };
export const meaning = hash('sha256').update(new Date(Date.parse(window.from)).toISOString()).digest('hex');
`);
  await checkFeatureModules(root);
}));

void test('FMS rejects external re-exports and side effects in module facades', () => scenario(async root => {
  await writeFile(join(root, facade), "export { randomUUID } from 'node:crypto';\n");
  await assert.rejects(checkFeatureModules(root), /only owned feature surfaces/);
  await writeFile(join(root, facade), "export { meaning } from './features/payment-evidence/composition/public.js';\nconsole.log('effect');\n");
  await assert.rejects(checkFeatureModules(root), /only curated named re-exports/);
}));

void test('FMS checks declaration targets and all supported export conditions', () => scenario(async root => {
  for (const extra of [
    { types: './dist/features/payment-evidence/domain/values.d.ts', import: './dist/index.js' },
    { types: './dist/index.d.ts', import: './dist/index.js', require: './dist/features/payment-evidence/domain/values.js' },
  ]) {
    await writeFile(join(root, packageRoot, 'package.json'), JSON.stringify({ name: '@agent-teams/payments-core', type: 'module', exports: { '.': extra } }));
    await assert.rejects(checkFeatureModules(root), /same curated facade|supported ESM and declaration conditions/);
  }
}));

void test('FMS rejects public exports that bypass the declared module facades', () => scenario(async root => {
  await writeFile(join(root, packageRoot, 'package.json'), JSON.stringify({ name: '@agent-teams/payments-core', type: 'module', exports: {
    '.': { types: './dist/features/payment-evidence/domain/values.d.ts', import: './dist/features/payment-evidence/domain/values.js' },
  } }));
  const profilePath = join(root, 'architecture/feature-module-standard.json');
  const profile = JSON.parse(await readFile(profilePath, 'utf8')) as { modules: { publicEntrypoints: string[] }[] };
  const module = profile.modules[0]; assert.ok(module);
  module.publicEntrypoints = [values];
  await writeFile(profilePath, JSON.stringify(profile));
  await assert.rejects(checkFeatureModules(root), /declared module facade/);
}));

void test('FMS rejects imported randomness, namespaces and nonstatic capability acquisition', () => scenario(async root => {
  for (const code of [
    "import { randomUUID as next } from 'node:crypto'; export const meaning = next();",
    "import * as crypto from 'node:crypto'; export const meaning = crypto.randomUUID();",
    "const crypto = await import('node:crypto'); export const meaning = crypto.randomUUID();",
    "import { Paddle } from '@paddle/paddle-node-sdk'; export const meaning = Paddle;",
  ]) {
    await writeFile(join(root, values), code);
    await assert.rejects(checkFeatureModules(root), /deterministic createHash|pure named hash|static imports|External capability/);
  }
}));

void test('FMS rejects ambient effect aliases while preserving local domain names', () => scenario(async root => {
  for (const code of [
    'export const meaning = Date.now();',
    "const { now } = Date; export const meaning = now();",
    'const Clock = Date; export const meaning = new Clock();',
    'export const meaning = new Date();',
    'export const meaning = new Date(...([] as []));',
    'const empty: [] = []; export const meaning = new Date(...empty);',
    "export const meaning = Math['random']();",
    "const { fetch: acquire } = globalThis; export const meaning = acquire('https://example.invalid');",
    'export const meaning = process.env;',
    "declare const process: { env: Record<string, string | undefined> }; export const meaning = process.env['REVIEW_SENTINEL'];",
    'declare const Date: { now(): number }; export const meaning = Date.now();',
    "console.log('domain effect'); export const meaning = 42;",
  ]) {
    await writeFile(join(root, values), code);
    await assert.rejects(checkFeatureModules(root), /Ambient/);
  }
}));

void test('FMS rejects undeclared production modules, loose source and empty ceremonial layers', () => scenario(async root => {
  await mkdir(join(root, 'packages/unowned'));
  await assert.rejects(checkFeatureModules(root), /Every production package/);
  await rm(join(root, 'packages/unowned'), { recursive: true });
  await writeFile(join(root, source, 'loose.ts'), 'export const loose = true;');
  await assert.rejects(checkFeatureModules(root), /Source outside declared feature/);
  await rm(join(root, source, 'loose.ts'));
  const profilePath = join(root, 'architecture/feature-module-standard.json');
  const profile = JSON.parse(await readFile(profilePath, 'utf8')) as { modules: { features: { layers: { root: string; role: string }[] }[] }[] };
  const owned = profile.modules[0]?.features[0]; assert.ok(owned);
  owned.layers.push({ root: `${feature}/adapters`, role: 'adapters' });
  await mkdir(join(root, feature, 'adapters'));
  await writeFile(profilePath, JSON.stringify(profile));
  await assert.rejects(checkFeatureModules(root), /Empty ceremonial layer/);
}));
