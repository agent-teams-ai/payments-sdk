import assert from 'node:assert/strict';

export const releaseRepository = 'agent-teams-ai/payments-sdk';
export type ChecksRun = Readonly<{
  id: number; head_sha: string; head_branch: string; event: string; status: string; conclusion: string | null;
  head_repository: Readonly<{ full_name: string }> | null;
}>;
export type ChecksJob = Readonly<{ name: string; status: string; conclusion: string | null }>;

export function releaseVersion(tag: string): string {
  const matched = /^v((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?)$/u.exec(tag);
  assert.ok(matched, 'Release tag must be v<semver> without build metadata');
  assert.equal(matched[0], tag, 'Release tag contains trailing data');
  return matched[1]!;
}

export function assertReleaseCommit(commit: string): void {
  assert.equal(commit.length, 40, 'Use the full lowercase 40-character main commit SHA');
  assert.match(commit, /^[0-9a-f]{40}$/u, 'Use the full lowercase 40-character main commit SHA');
}

/** Runs come only from checks.yaml; require its latest exact-SHA main push and final aggregate job. */
export function qualifiedChecksRun(commit: string, runs: readonly ChecksRun[], jobs: readonly ChecksJob[]): ChecksRun {
  assertReleaseCommit(commit);
  const run = [...runs].filter(item => item.head_sha === commit && item.head_branch === 'main' && item.event === 'push' && item.head_repository?.full_name === releaseRepository).toSorted((left, right) => right.id - left.id)[0];
  assert.ok(run, 'No Checks main-push run exists for this exact commit');
  assert.ok(Number.isSafeInteger(run.id) && run.id > 0, 'Invalid Checks run identity');
  assert.equal(run.status, 'completed', 'Latest exact-commit Checks run is not complete');
  assert.equal(run.conclusion, 'success', 'Latest exact-commit Checks run did not succeed');
  const required = jobs.filter(job => job.name === 'Required checks');
  assert.equal(required.length, 1, 'Expected one Required checks aggregate job');
  assert.equal(required[0]?.status, 'completed', 'Required checks did not complete');
  assert.equal(required[0].conclusion, 'success', 'Required checks did not succeed');
  return run;
}
