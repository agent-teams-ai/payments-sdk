import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse, stringify } from 'yaml';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const cli = join(repository, 'node_modules/@agent-teams/engineering-foundation/dist/cli.js');
const packages = ['core', 'paddle', 'postgres', 'get-modular'];

type Finding = Readonly<{ ruleId: string; message?: string }>;
type Report = Readonly<{ capabilities: readonly Readonly<{ diagnostics: readonly Finding[] }>[] }>;
type DependencyPolicy = {
  boundaries: { id: string; allow: { packages: string[] } }[];
};

async function consumer(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'payments-boundaries-'));
  for (const path of ['foundation.config.yaml', 'pnpm-workspace.yaml', 'package.json', 'architecture']) {
    await cp(join(repository, path), join(root, path), { recursive: true });
  }
  for (const name of packages) {
    const target = join(root, 'packages', `payments-${name}`);
    await mkdir(target, { recursive: true });
    await cp(join(repository, 'packages', `payments-${name}`, 'package.json'), join(target, 'package.json'));
    await cp(join(repository, 'packages', `payments-${name}`, 'src'), join(target, 'src'), { recursive: true });
    await cp(join(repository, 'packages', `payments-${name}`, 'test'), join(target, 'test'), { recursive: true });
  }
  await symlink(join(repository, 'node_modules'), join(root, 'node_modules'), 'dir');
  return root;
}

function check(root: string): { status: number | null; report: Report; output: string } {
  const result = spawnSync(process.execPath, [cli, 'check', 'architecture.source-dependencies', '--consumer', root, '--format', 'json'], {
    cwd: repository,
    encoding: 'utf8',
    timeout: 45_000,
    env: { ...process.env, AGENT_TEAMS_FOUNDATION_NODE_EXECUTABLE: process.execPath },
  });
  assert.equal(result.error, undefined, String(result.error));
  const output = `${result.stdout}\n${result.stderr}`;
  let report: Report;
  try {
    report = JSON.parse(result.stdout) as Report;
  } catch (error) {
    throw new Error(output, { cause: error });
  }
  return { status: result.status, report, output };
}

async function mutation(name: string, change: (root: string) => Promise<void>, expectedRule: RegExp): Promise<void> {
  const root = await consumer();
  try {
    const baseline = check(root);
    assert.equal(baseline.status, 0, `unmodified ${name} fixture must pass: ${baseline.output}`);
    await change(root);
    const result = check(root);
    assert.equal(result.status, 1, `${name} must be rejected: ${result.output}`);
    assert.ok(result.report.capabilities.flatMap((capability) => capability.diagnostics).some((finding) => expectedRule.test(finding.ruleId)), result.output);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

void test('installed Foundation permits the actual source graph and same-owner imports', async () => {
  const root = await consumer();
  try {
    await writeFile(join(root, 'packages/payments-core/src/boundary-witness.ts'), 'export const witness = 1;\n');
    await writeFile(join(root, 'packages/payments-core/src/permitted-witness.ts'), "import { witness } from './boundary-witness.js'; export const permitted = witness;\n");
    const result = check(root);
    assert.equal(result.status, 0, result.output);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

for (const target of ['@agent-teams/payments-paddle', '@agent-teams/payments-postgres', '@agent-teams/payments-get-modular', '@agent-teams/engineering-foundation']) {
  void test(`installed Foundation rejects core importing ${target}`, () => mutation(target, async (root) => {
    await writeFile(join(root, 'packages/payments-core/src/forbidden.ts'), `import '${target}';\n`);
  }, /source-dependencies\.forbidden-package-dependency$/));
}

void test('installed Foundation rejects source without an owner inside the selected package universe', () => mutation('unowned source', async (root) => {
  await writeFile(join(root, 'packages/payments-core/unknown.ts'), 'export const unowned = true;\n');
}, /source-dependencies\.unclassified-source-file$/));

void test('installed Foundation rejects a new ungoverned package inside the selected universe', () => mutation('unowned package', async (root) => {
  const path = join(root, 'packages/payments-unowned/src');
  await mkdir(path, { recursive: true });
  await writeFile(join(path, '../package.json'), JSON.stringify({ name: '@agent-teams/payments-unowned', type: 'module' }));
  await writeFile(join(path, 'index.ts'), 'export const unowned = true;\n');
}, /source-dependencies\.uncovered-workspace-package-root$/));

for (const specifier of ['@agent-teams/payments-core/internal', '../../payments-core/src/index.js']) {
  void test(`installed Foundation rejects cross-package bypass ${specifier}`, () => mutation(specifier, async (root) => {
    await writeFile(join(root, 'packages/payments-paddle/src/forbidden.ts'), `import '${specifier}';\n`);
  }, /source-dependencies\./));
}

void test('installed Foundation rejects a runtime import of an allowlisted development-only dependency', () => mutation('runtime development dependency', async (root) => {
  const policyPath = join(root, 'architecture/foundation/source-dependencies.yaml');
  const policy = parse(await readFile(policyPath, 'utf8')) as DependencyPolicy;
  const core = policy.boundaries.find((boundary) => boundary.id === 'payments.core');
  assert.ok(core);
  core.allow.packages.push('typescript');
  await writeFile(policyPath, stringify(policy));
  const manifestPath = join(root, 'packages/payments-core/package.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>;
  manifest['devDependencies'] = { typescript: 'catalog:' };
  await writeFile(manifestPath, JSON.stringify(manifest));
  await writeFile(join(root, 'packages/payments-core/src/forbidden.ts'), "import 'typescript';\n");
}, /source-dependencies\..*(?:development|dev)/));
