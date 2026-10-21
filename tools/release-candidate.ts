import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFile, copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { auditPackageArchive, command, packageNames, repository } from './package-artifacts.ts';
import type { PackedManifest } from './package-artifacts.ts';
import { assertReleaseCommit, qualifiedChecksRun, releaseRepository, releaseVersion } from './release-policy.ts';
import type { ChecksJob, ChecksRun } from './release-policy.ts';

async function api<T>(path: string): Promise<T> { return JSON.parse(await command('gh', ['api', path])) as T; }
async function pages<T>(path: string, field: string): Promise<T[]> {
  const responses = JSON.parse(await command('gh', ['api', '--paginate', '--slurp', path])) as Record<string, T[]>[];
  return responses.flatMap(page => page[field] ?? []);
}
function required(name: string): string { const value = process.env[name]; assert.ok((value !== undefined && value !== ''), `Missing ${name}`); return value; }

async function verify(): Promise<void> {
  assert.equal(required('GITHUB_REPOSITORY'), releaseRepository, 'Release workflow is restricted to its authoritative repository');
  const tag = required('RELEASE_TAG'), commit = required('RELEASE_COMMIT'), version = releaseVersion(tag);
  assertReleaseCommit(commit);
  await command('git', ['merge-base', '--is-ancestor', commit, 'refs/remotes/origin/main']);
  const refs = (await command('git', ['tag', '--list', tag])).trim();
  if (refs) {assert.equal((await command('git', ['rev-parse', `${tag}^{commit}`])).trim(), commit, 'Existing release tag points at another commit');}
  else {assert.equal(required('GITHUB_EVENT_NAME'), 'workflow_dispatch', 'A push release must have an existing tag');}
  for (const short of packageNames) {
    const manifest = JSON.parse(await command('git', ['show', `${commit}:packages/payments-${short}/package.json`])) as PackedManifest;
    assert.equal(manifest.name, `@agent-teams/payments-${short}`);
    assert.equal(manifest.version, version, 'Every package version must match the release tag');
  }
  const runs = await pages<ChecksRun>(`repos/${releaseRepository}/actions/workflows/checks.yaml/runs?head_sha=${commit}&event=push&per_page=100`, 'workflow_runs');
  const runId = [...runs].filter(run => run.head_sha === commit && run.head_branch === 'main' && run.event === 'push' && run.head_repository?.full_name === releaseRepository).toSorted((left, right) => right.id - left.id)[0]?.id;
  assert.ok(runId !== undefined && Number.isSafeInteger(runId) && runId > 0, 'The exact commit has no main-push Checks run');
  const jobs = await pages<ChecksJob>(`repos/${releaseRepository}/actions/runs/${runId}/jobs?filter=latest&per_page=100`, 'jobs');
  const run = qualifiedChecksRun(commit, runs, jobs);
  // A release artifact must exist and remain unexpired before download; the action pins this run ID.
  const artifacts = await api<{ artifacts: readonly Readonly<{ name: string; expired: boolean }>[] }>(`repos/${releaseRepository}/actions/runs/${run.id}/artifacts?per_page=100`);
  assert.equal(artifacts.artifacts.filter(artifact => artifact.name === 'release-dry-run' && !artifact.expired).length, 1, 'Exactly one unexpired audited CI artifact is required');
  await appendFile(required('GITHUB_OUTPUT'), `commit=${commit}\ntag=${tag}\nversion=${version}\nrun_id=${run.id}\n`);
  console.log(`Qualified ${tag} at ${commit} using Checks run ${run.id}`);
}

async function assemble(): Promise<void> {
  const tag = required('RELEASE_TAG'), version = releaseVersion(tag), commit = required('RELEASE_COMMIT');
  assertReleaseCommit(commit);
  const input = resolve(repository, '.artifacts/ci/packages'), target = resolve(repository, '.artifacts/release');
  const expected = packageNames.map(short => `agent-teams-payments-${short}-${version}.tgz`).toSorted();
  assert.deepEqual((await readdir(input)).toSorted(), expected, 'CI artifact must contain exactly the four versioned package tarballs');
  await mkdir(target, { recursive: true });
  const packages = [];
  for (const short of packageNames) {
    const name = `@agent-teams/payments-${short}`, filename = `agent-teams-payments-${short}-${version}.tgz`, source = join(input, filename);
    await auditPackageArchive(source, name, version);
    const sha256 = createHash('sha256').update(await readFile(source)).digest('hex');
    await copyFile(source, join(target, filename));
    packages.push({ name, version, filename, sha256 });
  }
  await writeFile(join(target, 'SHA256SUMS'), packages.map(item => `${item.sha256}  ${item.filename}`).join('\n') + '\n');
  const runId = required('CHECKS_RUN_ID'); assert.match(runId, /^[1-9]\d*$/u);
  const checksUrl = `https://github.com/${releaseRepository}/actions/runs/${runId}`;
  await writeFile(join(target, 'release-manifest.json'), JSON.stringify({ repository: releaseRepository, tag, commit, checksUrl, npmPublished: false, packages }, null, 2) + '\n');
  await writeFile(join(target, 'release-notes.md'), `# Payments SDK ${tag}\n\n**Integration/fixture prerelease; production admission requires separate deployment gates.** Current runtime guidance requires corrected official Linux Node 24.22.1 LTS or 26.12.1. See the maintained [runtime correction evidence and admission requirements](https://github.com/${releaseRepository}/blob/main/docs/runtime-security-admission.md). That current record does not retroactively qualify an older artifact or change its declared engine range. The linked Checks run records functional qualification for this artifact commit and its recorded runtime inputs; live Paddle account, host policy, production credit/access owners and deployment recovery still require their own evidence. Development-only Undici does not patch a host runtime, and a prerelease label does not establish production readiness.\n\nCandidate artifacts from commit \`${commit}\`, functionally qualified by [Checks](${checksUrl}).\n\nFour independently audited ESM package tarballs, SHA256SUMS and a source/CI manifest are attached. These are GitHub release candidate artifacts; no npm publication or live Paddle qualification is claimed.\n\nSee [installation and checksum verification](https://github.com/${releaseRepository}/blob/${commit}/docs/releasing.md) and [qualification limits](https://github.com/${releaseRepository}/blob/${commit}/docs/qualification.md).\n`);
  console.log(`Audited ${packages.length} package archives into ${basename(target)}`);
}

async function publish(): Promise<void> {
  assert.equal(required('GITHUB_REPOSITORY'), releaseRepository);
  const tag = required('RELEASE_TAG'), version = releaseVersion(tag), commit = required('RELEASE_COMMIT');
  assertReleaseCommit(commit);
  const target = resolve(repository, '.artifacts/release');
  const manifest = JSON.parse(await readFile(join(target, 'release-manifest.json'), 'utf8')) as { tag: string; commit: string; repository: string; packages: readonly { filename: string; sha256: string }[] };
  assert.equal(manifest.tag, tag); assert.equal(manifest.commit, commit); assert.equal(manifest.repository, releaseRepository);
  const expected = packageNames.map(short => `agent-teams-payments-${short}-${version}.tgz`).toSorted();
  assert.deepEqual(manifest.packages.map(item => item.filename).toSorted(), expected);
  for (const item of manifest.packages) {
    assert.equal(createHash('sha256').update(await readFile(join(target, item.filename))).digest('hex'), item.sha256, 'Downloaded candidate digest changed');
  }
  type GitObject = Readonly<{ type: string; sha: string }>;
  const refs = await api<readonly Readonly<{ ref: string; object: GitObject }>[]>(`repos/${releaseRepository}/git/matching-refs/tags/${tag}`);
  let reference = refs.find(ref => ref.ref === `refs/tags/${tag}`)?.object;
  if (!reference) {
    assert.equal(required('GITHUB_EVENT_NAME'), 'workflow_dispatch', 'Only explicit manual dispatch can create a missing release tag');
    reference = (await api<{ object: GitObject }>(`repos/${releaseRepository}/git/ref/heads/main`)).object;
    // Main can advance after admission; exact commit was already checked for main ancestry.
    assert.equal(reference.type, 'commit');
    await command('gh', ['api', '--method', 'POST', `repos/${releaseRepository}/git/refs`, '-f', `ref=refs/tags/${tag}`, '-f', `sha=${commit}`]);
    reference = { type: 'commit', sha: commit };
  }
  for (let depth = 0; reference.type === 'tag' && depth < 10; depth += 1) {reference = (await api<{ object: GitObject }>(`repos/${releaseRepository}/git/tags/${reference.sha}`)).object;}
  assert.equal(reference.type, 'commit', 'Release tag must resolve to a commit');
  assert.equal(reference.sha, commit, 'Remote release tag no longer resolves to the admitted commit');
  const assets = [...expected, 'SHA256SUMS', 'release-manifest.json'].map(filename => join(target, filename));
  // No --clobber or release-edit path: an existing release fails visibly instead of replacing assets.
  await command('gh', ['release', 'create', tag, '--repo', releaseRepository, '--verify-tag', '--prerelease', '--title', `Payments SDK ${tag}`, '--notes-file', join(target, 'release-notes.md'), ...assets]);
}

const operation = process.argv[2];
if (operation === 'verify') {await verify();}
else if (operation === 'assemble') {await assemble();}
else if (operation === 'publish') {await publish();}
else {throw new Error('Expected release-candidate.ts verify|assemble|publish');}
