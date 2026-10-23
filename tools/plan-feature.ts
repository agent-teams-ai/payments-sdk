import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { FeatureProfile } from './check-feature-modules.ts';
import { repository } from './package-artifacts.ts';

const [moduleId, featureId, role, sourceFile] = process.argv.slice(2);
assert.ok(moduleId !== undefined && moduleId !== '' && featureId !== undefined && featureId !== ''
  && role !== undefined && role !== '' && sourceFile !== undefined && sourceFile !== '',
'Usage: pnpm architecture:features:plan <module-id> <feature-id> <role> <authored-source.ts>');
assert.match(featureId, /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u, 'Use a stable kebab-case feature name');
assert.ok(['domain', 'application', 'adapters', 'composition', 'testing'].includes(role), 'Choose the first meaningful owned role');
assert.ok(sourceFile.endsWith('.ts'), 'Provide an authored TypeScript source file');
const source = await readFile(resolve(sourceFile), 'utf8');
assert.ok(source.trim() !== '', 'Do not scaffold empty ceremonial layers');
const profile = JSON.parse(await readFile(resolve(repository, 'architecture/feature-module-standard.json'), 'utf8')) as FeatureProfile;
const module = profile.modules.find(item => item.id === moduleId);
assert.ok(module, `Unknown owned module: ${moduleId}`);
assert.ok(!module.features.some(feature => feature.id === featureId), `Feature already exists: ${featureId}`);
console.log(JSON.stringify({
  module: module.id,
  feature: { id: featureId, root: `${module.sourceRoot}/features/${featureId}`, layers: [{ root: `${module.sourceRoot}/features/${featureId}/${role}`, role }] },
  authoredSource: resolve(sourceFile),
  requiredDecisions: ['Name the invariant and semantic owner', 'Declare a curated surface and only real use edges', 'Place the first meaningful test under the mirrored feature root'],
  verification: ['pnpm architecture:features:check', 'pnpm check'],
  writes: [],
}, null, 2));
