import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = (name: string) => realpathSync(fileURLToPath(import.meta.resolve(name)));

void test('installed public observation surface uses one physical GM peer graph without development tooling', () => {
  const relationships: Readonly<Record<string, readonly string[]>> = {
    '@agent-teams/payments-get-modular/observation': ['@get-modular/core', '@get-modular/assembly', '@get-modular/resources', '@get-modular/observation'],
    '@get-modular/assembly': ['@get-modular/core'],
    '@get-modular/observation': ['@get-modular/resources'],
    '@get-modular/conformance': ['@get-modular/core', '@get-modular/assembly', '@get-modular/resources'],
  };
  for (const [consumer, peers] of Object.entries(relationships)) {
    const require = createRequire(import.meta.resolve(consumer));
    for (const peer of peers) {assert.equal(realpathSync(require.resolve(peer)), root(peer), `${consumer} must use the Host's physical ${peer}`);}
  }
  for (const absent of ['@agent-teams/engineering-foundation']) {
    assert.throws(() => import.meta.resolve(absent), { code: 'ERR_MODULE_NOT_FOUND' }, `${absent} must remain outside the published runtime graph`);
  }
});
