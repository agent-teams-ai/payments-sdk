/** Disposable delivery helper. Creates verified Git objects only; never a commit or ref. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';

const repository = 'agent-teams-ai/payments-sdk';
const baseline = '40e61f82c6f645e6b42116c0499925a5457adb2d';
const baselineTree = 'f8e7fa53325c0296e4e05dbf3f6fd7b3a1cf3476';
const expectedTree = '8790c68e3f06d9e54da2b90415ddac001c23ef9b';
const recipeBlobs = [
  '464a843ddb9fb93d70e186f2da34ff33fcbb68a3',
  'cb07370522b4a70c72604f2450429319caf50e1e',
  '75558da198f095cffecf3e9b98950c8fefb24f13',
  'b070fea69cf0dccb90847a8c0fb134d7a0848d14',
  '17cfea232f8e76463fa8537aef73c0a27b8a3e34',
  '0cffe0673cbafd002582e4769896be5866077969',
  'a735a608d1d6e1fab59b555150ed810efd4105af',
  '3bf8124360ba7b71afefee39f610160c103828bd',
];
assert.equal(process.env.GITHUB_REPOSITORY, repository);
assert.equal(process.env.GITHUB_ACTOR, '777genius');
assert.equal(process.env.GITHUB_REF, 'refs/heads/chore/sdk-05-source-transfer');
const token = process.env.GH_TOKEN;
assert.ok(token);
function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: 'source', encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }).trim();
}
function blobHash(bytes: Buffer): string {
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
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
type Recipe = { path: string; old: string | null; new: string; edits: [number, number, string][]; replace?: [string, string][] };
assert.equal(git('rev-parse', 'HEAD'), baseline);
assert.equal(git('rev-parse', 'HEAD^{tree}'), baselineTree);
const files: { path: string; sha: string; content: Buffer }[] = [];
const seen = new Set<string>();
for (const recipeBlob of recipeBlobs) {
  const saved = await api(`git/blobs/${recipeBlob}`);
  assert.equal(saved.encoding, 'base64'); assert.equal(typeof saved.content, 'string');
  const bytes = Buffer.from(saved.content as string, 'base64');
  assert.equal(blobHash(bytes), recipeBlob);
  const recipes = JSON.parse(bytes.toString('utf8')) as Recipe[];
  assert.ok(Array.isArray(recipes));
  for (const recipe of recipes) {
    const path = recipe.path;
    assert.ok(/^(?:packages\/|tests\/|qualification\/|docs\/|README\.md$|CHANGELOG\.md$)/u.test(path));
    assert.ok(!path.includes('..') && !seen.has(path)); seen.add(path);
    assert.match(recipe.new, /^[0-9a-f]{40}$/u);
    const fullPath = `source/${path}`;
    let text = '';
    if (recipe.old === null) {assert.ok(!existsSync(fullPath));}
    else {
      const original = readFileSync(fullPath);
      assert.equal(blobHash(original), recipe.old, `Baseline drift: ${path}`);
      text = original.toString('utf8');
    }
    for (const [from, to] of recipe.replace ?? []) {assert.ok(from.length > 0); text = text.replaceAll(from, to);}
    const lines = text.match(/[^\n]*\n|[^\n]+$/gu) ?? [];
    let previous = lines.length + 1;
    for (const [start, count, insert] of [...recipe.edits].reverse()) {
      assert.ok(Number.isSafeInteger(start) && Number.isSafeInteger(count) && start >= 0 && count >= 0 && start + count <= lines.length && start < previous);
      assert.equal(typeof insert, 'string'); previous = start;
      lines.splice(start, count, insert);
    }
    const content = Buffer.from(lines.join(''), 'utf8');
    assert.equal(blobHash(content), recipe.new, `Reconstructed source mismatch: ${path}`);
    mkdirSync(dirname(fullPath), { recursive: true }); writeFileSync(fullPath, content);
    files.push({ path, sha: recipe.new, content });
  }
}
assert.equal(files.length, 38);
git('add', '--', ...files.map(file => file.path));
assert.equal(git('write-tree'), expectedTree, 'Complete tree must match the independently reconstructed local source');
const elements: { path: string; mode: string; type: string; sha: string }[] = [];
for (const file of files) {
  const result = await api('git/blobs', { content: file.content.toString('base64'), encoding: 'base64' });
  assert.equal(result.sha, file.sha);
  elements.push({ path: file.path, mode: '100644', type: 'blob', sha: file.sha });
}
const result = await api('git/trees', { base_tree: baselineTree, tree: elements });
assert.equal(result.sha, expectedTree);
writeFileSync('source-tree-result.json', JSON.stringify({ repository, baseline, recipeBlobs, expectedTree, actualTree: result.sha, files: elements, refUpdated: false, commitCreated: false }, null, 2));
console.log(`Verified ${files.length} source objects: ${expectedTree}; no ref or commit was written.`);
