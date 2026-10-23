import assert from 'node:assert/strict';
import { join } from 'node:path';
import { observeSourceGraph } from '@agent-teams/engineering-foundation/source-graph';
import { API, type Project, type NodeHandle } from 'typescript/unstable/sync';
import * as ts from 'typescript/unstable/ast';
import type { FeatureProfile } from './check-feature-modules.ts';

const ambient = new Set(['globalThis', 'global', 'window', 'self', 'process', 'console', 'crypto', 'fetch', 'WebSocket', 'EventSource',
  'setTimeout', 'setInterval', 'setImmediate', 'clearTimeout', 'clearInterval', 'clearImmediate', 'queueMicrotask', 'performance', 'eval', 'Function']);

function memberName(node: ts.Node): string | undefined {
  if (ts.isPropertyAccessExpression(node)) { return node.name.text; }
  if (ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression)) { return node.argumentExpression.text; }
  return undefined;
}

function concreteLocalDeclaration(handle: NodeHandle, project: Project, root: string): boolean {
  if (!handle.path.startsWith(`${root}/`) || handle.path.includes('/node_modules/') || handle.path.endsWith('.d.ts')) { return false; }
  let declaration = handle.resolve(project);
  if (declaration === undefined) { return false; }
  for (;;) {
    if (ts.isSourceFile(declaration)) { return !declaration.isDeclarationFile; }
    const erased = declaration.forEachChild(child => child.kind === ts.SyntaxKind.DeclareKeyword ? true : undefined);
    if (erased === true) { return false; }
    declaration = declaration.parent;
  }
}

function assertDeterministicGlobals(file: ts.SourceFile, path: string, project: Project, root: string): void {
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) {
      const parent = node.parent;
      const propertyName = ts.isPropertyAccessExpression(parent) && parent.name === node;
      const declarationName = (ts.isPropertySignatureDeclaration(parent) || ts.isPropertyAssignment(parent) || ts.isMethodSignatureDeclaration(parent)) && parent.name === node;
      const governed = ambient.has(node.text) || node.text === 'Date' || node.text === 'Math';
      const symbol = governed ? project.checker.getSymbolAtLocation(node) : undefined;
      const localBinding = symbol !== undefined && symbol.declarations.length > 0
        && symbol.declarations.every(declaration => concreteLocalDeclaration(declaration, project, root));
      if (!propertyName && !declarationName && !localBinding) {
        assert.ok(!ambient.has(node.text), `Ambient capability ${node.text} is forbidden in inner source: ${path}`);
        if (node.text === 'Date') {
          const firstArgument = ts.isNewExpression(parent) && parent.expression === node ? parent.arguments?.[0] : undefined;
          const explicitConstruction = firstArgument !== undefined && !ts.isSpreadElement(firstArgument);
          const deterministicMember = (ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) && parent.expression === node
            && ['parse', 'UTC'].includes(memberName(parent) ?? '');
          const typeReference = ts.isTypeReferenceNode(parent) && parent.typeName === node;
          assert.ok(explicitConstruction || deterministicMember || typeReference, `Ambient Date access is forbidden in inner source: ${path}`);
        }
        if (node.text === 'Math') {
          const namedMember = (ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) && parent.expression === node ? memberName(parent) : undefined;
          assert.ok(namedMember !== undefined && namedMember !== 'random', `Ambient randomness is forbidden in inner source: ${path}`);
        }
      }
    }
    node.forEachChild(visit);
  };
  visit(file);
}

/** Complements FMS local-file layers with this SDK's finite external capability policy. */
export async function checkInnerEffects(root: string, module: FeatureProfile['modules'][number]): Promise<void> {
  const layers = module.features.flatMap(feature => feature.layers).filter(layer => layer.role === 'domain' || layer.role === 'application');
  if (layers.length === 0) { return; }
  const graph = await observeSourceGraph({ consumerRoot: root, roots: [module.sourceRoot] });
  const files = graph.files.filter(file => layers.some(layer => file === layer.root || file.startsWith(`${layer.root}/`)));
  for (const reference of graph.external.filter(item => files.includes(item.from))) {
    const pureHash = module.id === 'payments-core' && reference.from.endsWith('/payment-evidence/domain/values.ts') && reference.specifier === 'node:crypto';
    const borrowedCore = module.id === 'payments-get-modular' && reference.specifier === '@agent-teams/payments-core';
    assert.ok(pureHash || borrowedCore, `External capability ${reference.specifier} is forbidden in inner source: ${reference.from}`);
    assert.ok(['static', 'static-type'].includes(reference.kind), `Inner capabilities must use explicit static imports: ${reference.from}`);
  }
  const api = new API({ cwd: root });
  try {
    using snapshot = api.updateSnapshot({ openFiles: files.map(path => join(root, path)) });
    for (const path of files) {
      const full = join(root, path);
      const project = snapshot.getDefaultProjectForFile(full);
      assert.ok(project, `Inner source has no compiler project: ${path}`);
      const file = project.program.getSourceFile(full);
      assert.ok(file, `Inner source is outside compiler coverage: ${path}`);
      for (const statement of file.statements) {
        if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || statement.moduleSpecifier.text !== 'node:crypto') { continue; }
        const clause = statement.importClause;
        assert.ok(clause !== undefined && clause.name === undefined && clause.namedBindings !== undefined && ts.isNamedImports(clause.namedBindings), `Only the pure named hash capability is admitted: ${path}`);
        assert.ok(clause.namedBindings.elements.length > 0 && clause.namedBindings.elements.every(binding => (binding.propertyName ?? binding.name).text === 'createHash'), `Only deterministic createHash is admitted in the domain: ${path}`);
      }
      assertDeterministicGlobals(file, path, project, root);
    }
  } finally { api.close(); }
}
