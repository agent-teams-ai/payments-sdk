/** Disposable delivery helper. Creates Git objects only; never updates a ref or commit. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

const repository = 'agent-teams-ai/payments-sdk';
const baseline = '40e61f82c6f645e6b42116c0499925a5457adb2d';
const checkpoint = '3ad58b9141c310269cfcb2e20bc8ea64d4b4544a';
const expectedTree = '8790c68e3f06d9e54da2b90415ddac001c23ef9b';
const baselineTree = 'f8e7fa53325c0296e4e05dbf3f6fd7b3a1cf3476';
const patchBlob = '9ac936f6ad9b44e0972c86918036672e56b4a496';
assert.equal(process.env.GITHUB_REPOSITORY, repository);
assert.equal(process.env.GITHUB_ACTOR, '777genius');
assert.equal(process.env.GITHUB_REF, 'refs/heads/chore/sdk-05-source-transfer');
const token = process.env.GH_TOKEN;
assert.ok(token);
function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: 'source', encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }).trim();
}
async function api(path: string, data?: unknown): Promise<Record<string, unknown>> {
  assert.ok(/^git\/(blobs(?:\/[0-9a-f]{40})?|trees)$/u.test(path));
  const response = await fetch(`https://api.github.com/repos/${repository}/${path}`, {
    method: data === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {throw new Error(`Git object operation failed: ${response.status}`);}
  return await response.json() as Record<string, unknown>;
}
assert.equal(git('rev-parse', `${baseline}^{tree}`), baselineTree);
const saved = await api(`git/blobs/${patchBlob}`);
assert.equal(saved.encoding, 'base64');
assert.equal(typeof saved.content, 'string');
const compressed = Buffer.from(saved.content as string, 'base64');
assert.equal(createHash('sha1').update(`blob ${compressed.length}\0`).update(compressed).digest('hex'), patchBlob);
const patch = gunzipSync(compressed, { maxOutputLength: 2 * 1024 * 1024 });
writeFileSync('source/approved-source.patch', patch);
let matched = false;
for (const base of [baseline, checkpoint]) {
  git('reset', '--hard', base);
  // Only this disposable checkout is reset; the source patch lives outside tracked input.
  try { git('apply', '--index', '--unidiff-zero', 'approved-source.patch'); }
  catch { continue; }
  const tree = git('write-tree');
  console.log(JSON.stringify({ attemptedBase: base, actualTree: tree, expectedTree }));
  if (tree === expectedTree) {matched = true; break;}
}
assert.ok(matched, 'Saved patch does not recreate the independently expected full source tree');
const paths = git('diff', '--cached', '--name-only', baseline).split('\n');
assert.equal(paths.length, 38);
const elements: { path: string; mode: string; type: string; sha: unknown }[] = [];
for (const path of paths) {
  assert.ok(/^(?:packages\/|tests\/|qualification\/|docs\/|README\.md$|CHANGELOG\.md$)/u.test(path));
  assert.ok(!path.includes('..'));
  const stage = git('ls-files', '--stage', '--', path).split(/\s/u);
  assert.equal(stage[0], '100644');
  const bytes = readFileSync(`source/${path}`);
  const created = await api('git/blobs', { content: bytes.toString('base64'), encoding: 'base64' });
  assert.equal(created.sha, stage[1]);
  elements.push({ path, mode: '100644', type: 'blob', sha: created.sha });
}
const tree = await api('git/trees', { base_tree: baselineTree, tree: elements });
assert.equal(tree.sha, expectedTree);
writeFileSync('source-tree-result.json', JSON.stringify({ repository, baseline, patchBlob, patchSha256: createHash('sha256').update(patch).digest('hex'), expectedTree, actualTree: tree.sha, files: elements.map(({path,sha}) => ({path,sha})), refUpdated: false, commitCreated: false }, null, 2));
console.log(`Verified source objects ready: ${expectedTree}; no ref or commit was written.`);
