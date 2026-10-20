import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { parse } from 'yaml';
import { auditPackageArchive, command, repository } from '../package-artifacts.ts';
import { assertReleaseCommit, qualifiedChecksRun, releaseRepository, releaseVersion } from '../release-policy.ts';
import type { ChecksJob, ChecksRun } from '../release-policy.ts';

const commit = 'a'.repeat(40);
const run: ChecksRun = { id: 100, head_sha: commit, head_branch: 'main', event: 'push', status: 'completed', conclusion: 'success', head_repository: { full_name: releaseRepository } };
const jobs: readonly ChecksJob[] = [{ name: 'Required checks', status: 'completed', conclusion: 'success' }];

void test('release workflow validates as YAML and confines writing to the dependent publication job', async () => {
  type Job = { needs?: string; permissions?: Record<string, string>; steps: readonly { uses?: string; run?: string }[] };
  const workflow = parse(await readFile(join(repository, '.github/workflows/release.yaml'), 'utf8')) as { on: Record<string, unknown>; permissions: Record<string, string>; jobs: Record<string, Job> };
  assert.deepEqual(Object.keys(workflow.on).toSorted(), ['push', 'workflow_dispatch']);
  assert.equal(workflow.permissions['contents'], 'read');
  assert.equal(workflow.permissions['actions'], 'read');
  assert.equal(workflow.jobs['candidate']?.permissions, undefined);
  assert.equal(workflow.jobs['release']?.needs, 'candidate');
  assert.equal(workflow.jobs['release'].permissions?.['contents'], 'write');
  for (const job of Object.values(workflow.jobs)) {for (const step of job.steps) {
    if (step.uses !== undefined) {assert.match(step.uses, /^[a-z0-9-]+\/[a-z0-9-]+@[a-f0-9]{40}$/u, 'Every action must be pinned to a full SHA');}
    assert.ok(!(step.run?.includes('npm publish') === true));
  }}
});

void test('release admits a full exact main commit and successful required Checks, never a nearby run', () => {
  assert.equal(qualifiedChecksRun(commit, [run], jobs).id, 100);
  for (const change of [{ head_sha: 'b'.repeat(40) }, { event: 'pull_request' }, { head_branch: 'feature' }, { head_repository: { full_name: 'some-fork/payments-sdk' } }, { status: 'in_progress' }, { conclusion: 'failure' }]) {
    assert.throws(() => qualifiedChecksRun(commit, [{ ...run, ...change }], jobs));
  }
  assert.throws(() => qualifiedChecksRun(commit, [run, { ...run, id: 101, conclusion: 'failure' }], jobs), /Latest/u);
  for (const conclusion of ['skipped', 'cancelled', 'failure', null]) {assert.throws(() => qualifiedChecksRun(commit, [run], [{ ...jobs[0]!, conclusion }]));}
  assert.throws(() => qualifiedChecksRun(commit, [run], []));
  assert.throws(() => qualifiedChecksRun(commit, [run], [...jobs, ...jobs]));
});

void test('release target syntax excludes abbreviated SHAs and shell/path/tag ambiguity', () => {
  assert.equal(releaseVersion('v0.1.0'), '0.1.0');
  assert.equal(releaseVersion('v1.2.3-rc.1'), '1.2.3-rc.1');
  for (const tag of ['main', 'v01.2.3', 'v1.2', '../v1.2.3', 'v1.2.3\n', 'v1.2.3\ncommit=evil', 'v1.2.3+mutable', 'v1.2.3;echo bad']) {assert.throws(() => releaseVersion(tag));}
  for (const sha of ['abc123', 'A'.repeat(40), `${commit}\n`, 'main', `${commit};true`]) {assert.throws(() => { assertReleaseCommit(sha); });}
});

void test('archive admission validates identity/version and rejects unresolved or development dependencies', async () => {
  const root = await mkdtemp(join(tmpdir(), 'payments-release-policy-'));
  try {
    const directory = join(root, 'package'); await mkdir(join(directory, 'dist'), { recursive: true });
    await writeFile(join(directory, 'dist/index.js'), 'export {};\n');
    await writeFile(join(directory, 'dist/index.d.ts'), 'export {};\n');
    await writeFile(join(directory, 'LICENSE'), 'Apache-2.0 fixture');
    const manifest = { name: '@agent-teams/payments-core', version: '0.1.0', license: 'Apache-2.0', exports: { '.': './dist/index.js' } };
    const tarball = join(root, 'fixture.tgz');
    async function archive(body: unknown) { await writeFile(join(directory, 'package.json'), JSON.stringify(body)); await command('tar', ['-czf', tarball, 'package'], root); }
    await archive(manifest);
    assert.equal((await auditPackageArchive(tarball, manifest.name, '0.1.0')).manifest.version, '0.1.0');
    await assert.rejects(() => auditPackageArchive(tarball, '@agent-teams/payments-paddle', '0.1.0'));
    await assert.rejects(() => auditPackageArchive(tarball, manifest.name, '0.2.0'));
    for (const dependencies of [{ '@agent-teams/payments-core': 'workspace:*' }, { pg: 'catalog:' }, { '@agent-teams/engineering-foundation': '1.10.0' }, { 'node-or-bun': '0.2.2' }]) {
      await archive({ ...manifest, dependencies });
      await assert.rejects(() => auditPackageArchive(tarball, manifest.name, '0.1.0'));
    }
    await archive(manifest);
    await mkdir(join(directory, 'src')); await writeFile(join(directory, 'src/leak.ts'), 'secret fixture');
    await archive(manifest);
    await assert.rejects(() => auditPackageArchive(tarball, manifest.name, '0.1.0'), /development files/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});
