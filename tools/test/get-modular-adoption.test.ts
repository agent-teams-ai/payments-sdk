import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { observeSourceGraph } from '@agent-teams/engineering-foundation/source-graph';
import { API } from 'typescript/unstable/sync';
import * as ts from 'typescript/unstable/ast';
import { parse } from 'yaml';

const repository = resolve(import.meta.dirname, '../..');
const profilePath = 'architecture/get-modular-consumer-profile.json';
const sourcePolicyPath = 'architecture/foundation/source-dependencies.yaml';
const standard = {
  repository: 'agent-teams-ai/get-modular', commit: 'fe4a2fdc878b46feebaececa3b0172b4534be935',
  path: 'docs/architecture/common-assembly.md', sha256: 'a6dac5d303adf80be3151c6703c919b715fd880a941a4ad68e927c87a7ee5882',
  guide: 'docs/guides/module-authoring.md', guideSha256: '8d9e6ced096c3259ec8d7a35a1ee3c2f15e5832ba23c95da57f8cfc4c8622cfd',
};
type Authored = Record<string, Record<string, string[]>>;
type Profile = {
  status: string; decision: string; standard: typeof standard;
  organization: { repository: string; commit: string; path: string; sha256: string };
  publishedArtifacts: { path: string; sha256: string }; entrypoints: string[]; roots: string[];
  authored: Authored; exceptions: { id: string; rule: string; paths: string[]; owner: string; rationale: string; decision: string; reviewTrigger: string }[];
  outsideScope: { boundary: string; owner: string; mechanism: string; reviewTrigger: string }[];
  verification: { adoption: string; sourceGraph: string; runtime: string; packed: string; tests: string[] }; fullApplicationFms: string;
};
const read = (root: string, path: string) => readFile(join(root, path), 'utf8');
const json = async <T>(root: string, path: string): Promise<T> => JSON.parse(await read(root, path)) as T;
const normalized = (authored: Authored) => Object.entries(authored).flatMap(([path, apis]) =>
  Object.entries(apis).flatMap(([api, names]) => names.map(name => `${path}:${api}:${name}`))).toSorted();

/** Only authored GM declarations/entries are inventoried; ordinary owner-local helpers may grow. */
function authoredCalls(file: ts.SourceFile, path: string, found: Authored): void {
  const names = new Map<string, string>(), namespaces = new Set<string>();
  const admitted = new Set(['declareModule', 'defineContract', 'implement', 'input', 'group']);
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || statement.moduleSpecifier.text !== '@get-modular/assembly') {continue;}
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) {namespaces.add(bindings.name.text);}
    if (bindings && ts.isNamedImports(bindings)) {
      for (const binding of bindings.elements) {names.set(binding.name.text, binding.propertyName?.text ?? binding.name.text);}
    }
  }
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const api = ts.isIdentifier(callee) ? names.get(callee.text)
        : ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && namespaces.has(callee.expression.text) ? callee.name.text : undefined;
      if (api !== undefined && admitted.has(api)) {
        let owner: ts.Node = node.parent;
        while (owner.kind !== ts.SyntaxKind.SourceFile && !ts.isVariableDeclaration(owner)) {owner = owner.parent;}
        assert.ok(ts.isVariableDeclaration(owner) && ts.isIdentifier(owner.name), `${path}: authored ${api} needs an explicit named declaration`);
        const apis = found[path] ??= {};
        (apis[api] ??= []).push(owner.name.text);
      }
    }
    node.forEachChild(visit);
  }
  visit(file);
}

async function check(root: string): Promise<void> {
  const profile = await json<Profile>(root, profilePath);
  assert.equal(profile.status, 'scoped-active');
  assert.deepEqual(profile.standard, standard, 'reviewed CMS/guide pin drift');
  assert.deepEqual(profile.organization, { repository: 'agent-teams-ai/.github', commit: 'a34ecc6bc9bb165771f3962dccd25970dd5c0d98', path: 'docs/engineering-quality-standard.md', sha256: 'a65fb5150837b010a71abe36cefd26c32709eb9b9e89f3938498a647e72f5587' }, 'organization source pin drift');
  assert.deepEqual(profile.publishedArtifacts, { path: 'qualification/observation/published-artifacts.json', sha256: '6f6190afcfcee4d0fec1d9bbba210b12fc678ded4777e0664aba406517fee5ea' }, 'published artifact record drift');
  const artifactsText = await read(root, profile.publishedArtifacts.path);
  assert.equal(createHash('sha256').update(artifactsText).digest('hex'), profile.publishedArtifacts.sha256, 'published archive identities changed');
  const artifacts = JSON.parse(artifactsText) as { archives: { name: string; version: string; integrity: string }[] };
  const workspace = parse(await read(root, 'pnpm-workspace.yaml')) as { catalog: Record<string, string> };
  assert.equal(workspace.catalog['typescript'], '7.0.2', 'public unstable AST API requires compiler requalification on upgrade');
  const lock = parse(await read(root, 'pnpm-lock.yaml')) as { packages: Record<string, { resolution: { integrity: string } }> };
  for (const archive of artifacts.archives) {
    assert.equal(workspace.catalog[archive.name], archive.version, `${archive.name}: reviewed catalog version drift`);
    assert.equal(lock.packages[`${archive.name}@${archive.version}`]?.resolution.integrity, archive.integrity, `${archive.name}: reviewed lock integrity drift`);
  }
  assert.equal(profile.decision, 'docs/get-modular-adoption.md#decision');
  assert.deepEqual(profile.entrypoints, ['packages/payments-get-modular/src/index.ts', 'packages/payments-get-modular/src/observation/index.ts']);
  assert.deepEqual(profile.roots, ['paymentsModule', 'purchaseProjectionModule', 'purchaseProjectionDisplayModule']);
  assert.deepEqual(profile.exceptions.map(exception => exception.id), ['technical-adapter-layout'], 'unknown or stale CMS exception');
  assert.deepEqual(profile.exceptions[0]?.paths, ['packages/payments-get-modular/src/contracts.ts', 'packages/payments-get-modular/src/module.ts', 'packages/payments-get-modular/src/observation/composition.ts', 'packages/payments-get-modular/src/observation/projection.ts'], 'exception paths changed');
  for (const exception of profile.exceptions) {
    assert.equal(exception.rule, 'CMS feature layout and separate declaration/entry files');
    assert.equal(exception.decision, profile.decision);
    for (const value of [exception.owner, exception.rationale, exception.reviewTrigger]) {assert.ok(value.trim(), 'exception needs its owner, rationale and review trigger');}
  }
  assert.deepEqual(profile.outsideScope.map(boundary => boundary.boundary), ['payments.core', 'payments.paddle', 'payments.postgres']);
  for (const boundary of profile.outsideScope) {
    for (const value of [boundary.owner, boundary.mechanism, boundary.reviewTrigger]) {assert.ok(value.trim(), 'outside scope classification needs an owner, mechanism and review trigger');}
  }
  assert.equal(profile.fullApplicationFms, 'not-adopted; separate owner decision and qualification required');
  const paths = [...profile.entrypoints, ...Object.keys(profile.authored), ...profile.exceptions.flatMap(exception => exception.paths), ...profile.verification.tests, profile.decision.split('#')[0] ?? ''];
  for (const path of paths) {assert.ok((await stat(join(root, path))).isFile(), `profile path missing: ${path}`);}
  const policy = parse(await read(root, sourcePolicyPath)) as { governedRoots: string[] };
  const graph = await observeSourceGraph({ consumerRoot: root, roots: policy.governedRoots.filter(path => path.endsWith('/src')) });
  assert.deepEqual(graph.parseFailures, [], 'source inventory must be complete');
  const found: Authored = {};
  const api = new API({ cwd: root });
  try {
    using snapshot = api.updateSnapshot({ openFiles: graph.files.map(path => join(root, path)) });
    for (const path of graph.files) {
      const fullPath = join(root, path);
      const project = snapshot.getDefaultProjectForFile(fullPath);
      const file = project?.program.getSourceFile(fullPath);
      assert.ok(file, `${path}: the pinned compiler must expose its authored AST`);
      authoredCalls(file, path, found);
    }
  } finally { api.close(); }
  assert.deepEqual(normalized(found), normalized(profile.authored), 'unknown or stale authored Get Modular boundary');
  const { scripts } = await json<{ scripts: Record<string, string> }>(root, 'package.json');
  assert.deepEqual({ ...profile.verification, tests: [] }, { adoption: 'test:modular:adoption', sourceGraph: 'foundation:check', runtime: 'test:modular', packed: 'test:observation', tests: [] });
  assert.equal(scripts['test:modular:adoption'], 'node --test tools/test/get-modular-adoption.test.ts', 'adoption command removed or retargeted');
  assert.equal(scripts['test:boundaries'], 'node --test tools/test/*.test.ts', 'boundary command must execute the scoped gate');
  assert.equal(scripts['foundation:check'], 'agent-teams-foundation check', 'Foundation graph command removed or retargeted');
  assert.equal(scripts['test:modular'], 'node tools/run-tests.ts modular', 'Modular runtime command removed or retargeted');
  assert.equal(scripts['test:observation'], 'node tools/qualify-observation.ts', 'packed Observation command removed or retargeted');
  for (const name of ['check:fast', 'check']) {
    assert.match(scripts[name] ?? '', /^pnpm [\w:-]+(?: && pnpm [\w:-]+)*$/u, `${name}: blocking command chain must use only pnpm scripts joined by &&`);
  }
  for (const command of ['pnpm test:modular:adoption', 'pnpm foundation:check']) {assert.equal(scripts['check:fast']?.split('&&').map(part => part.trim()).includes(command), true, `fast chain lost ${command}`);}
  for (const command of ['pnpm check:fast', 'pnpm test:boundaries', 'pnpm test:modular', 'pnpm test:observation']) {assert.equal(scripts['check']?.split('&&').map(part => part.trim()).includes(command), true, `full chain lost ${command}`);}
}

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'payments-modular-adoption-'));
  for (const path of ['architecture', 'docs/get-modular-adoption.md', 'package.json', 'pnpm-workspace.yaml', 'pnpm-lock.yaml', 'qualification/observation', 'tools/test']) {
    await mkdir(join(root, path, '..'), { recursive: true });
    await cp(join(repository, path), join(root, path), { recursive: true });
  }
  for (const name of ['core', 'paddle', 'postgres', 'get-modular']) {
    for (const path of ['src', 'test', 'package.json']) {
      const relative = `packages/payments-${name}/${path}`;
      await mkdir(join(root, relative, '..'), { recursive: true });
      await cp(join(repository, relative), join(root, relative), { recursive: true });
    }
  }
  return root;
}

void test('the scoped Modular record matches actual boundaries, reviewed artifacts and blocking commands', () => check(repository));
void test('scoped adoption permits owner-local helpers and rejects meaningful drift', async context => {
  const changes: Readonly<Record<string, (root: string) => Promise<void>>> = {
    'reviewed pin drift': async root => { const profile = await json<Profile>(root, profilePath); profile.standard.commit = '0'.repeat(40); await writeFile(join(root, profilePath), JSON.stringify(profile)); },
    'unknown authored module': root => writeFile(join(root, 'packages/payments-get-modular/src/unknown.ts'), "import { declareModule as declare } from '@get-modular/assembly'; export const unknown = declare({});\n"),
    'hidden input in existing file': async root => { const path = 'packages/payments-get-modular/src/module.ts'; await writeFile(join(root, path), `${await read(root, path)}\nconst hidden = input<PaymentsCapabilities>()(paymentsConfigurationDeclaration);\n`); },
    'missing owned path': root => rm(join(root, 'packages/payments-get-modular/src/module.ts')),
    'unknown exception': async root => { const profile = await json<Profile>(root, profilePath); profile.exceptions.push({ ...profile.exceptions[0]!, id: 'blanket-exemption' }); await writeFile(join(root, profilePath), JSON.stringify(profile)); },
    'no-op command': async root => { const manifest = await json<{ scripts: Record<string, string> }>(root, 'package.json'); manifest.scripts['test:modular:adoption'] = 'node -e "process.exit(0)"'; await writeFile(join(root, 'package.json'), JSON.stringify(manifest)); },
    'no-op runtime command': async root => { const manifest = await json<{ scripts: Record<string, string> }>(root, 'package.json'); manifest.scripts['test:modular'] = 'node -e "process.exit(0)"'; await writeFile(join(root, 'package.json'), JSON.stringify(manifest)); },
    'no-op packed command': async root => { const manifest = await json<{ scripts: Record<string, string> }>(root, 'package.json'); manifest.scripts['test:observation'] = 'node -e "process.exit(0)"'; await writeFile(join(root, 'package.json'), JSON.stringify(manifest)); },
    'removed fast chain': async root => { const manifest = await json<{ scripts: Record<string, string> }>(root, 'package.json'); manifest.scripts['check:fast'] = 'pnpm typecheck'; await writeFile(join(root, 'package.json'), JSON.stringify(manifest)); },
    'masked fast failure': async root => { const manifest = await json<{ scripts: Record<string, string> }>(root, 'package.json'); manifest.scripts['check:fast'] += ' && true || true'; await writeFile(join(root, 'package.json'), JSON.stringify(manifest)); },
    'masked full failure': async root => { const manifest = await json<{ scripts: Record<string, string> }>(root, 'package.json'); manifest.scripts['check'] += ' && true || true'; await writeFile(join(root, 'package.json'), JSON.stringify(manifest)); },
  };
  const expected: Readonly<Record<string, RegExp>> = {
    'reviewed pin drift': /reviewed CMS\/guide pin drift/u,
    'unknown authored module': /unknown or stale authored Get Modular boundary/u,
    'hidden input in existing file': /unknown or stale authored Get Modular boundary/u,
    'missing owned path': /ENOENT/u,
    'unknown exception': /unknown or stale CMS exception/u,
    'no-op command': /adoption command removed or retargeted/u,
    'no-op runtime command': /Modular runtime command removed or retargeted/u,
    'no-op packed command': /packed Observation command removed or retargeted/u,
    'removed fast chain': /fast chain lost pnpm test:modular:adoption/u,
    'masked fast failure': /check:fast: blocking command chain/u,
    'masked full failure': /check: blocking command chain/u,
  };
  for (const [name, change] of Object.entries(changes)) {
    await context.test(name, async () => {
      const root = await fixture();
      try {
        await writeFile(join(root, 'packages/payments-get-modular/src/private-helper.ts'), 'export const privateHelper = 1;\n');
        await check(root);
        await change(root);
        const message = expected[name];
        assert.ok(message);
        await assert.rejects(check(root), message);
      } finally { await rm(root, { recursive: true, force: true }); }
    });
  }
});
