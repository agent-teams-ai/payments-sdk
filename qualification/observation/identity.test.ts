import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

test('installed candidate uses one physical GM peer graph without the older static adapter or development tooling', () => {
  const root = (name: string) => realpathSync(fileURLToPath(import.meta.resolve(name)));
  const relationships: Readonly<Record<string, readonly string[]>> = {
    '@get-modular/assembly': ['@get-modular/core'],
    '@get-modular/observation': ['@get-modular/resources'],
    '@get-modular/conformance': ['@get-modular/core', '@get-modular/assembly', '@get-modular/resources'],
  };
  for (const [consumer, peers] of Object.entries(relationships)) {
    const require = createRequire(import.meta.resolve(consumer));
    for (const peer of peers) assert.equal(realpathSync(require.resolve(peer)), root(peer), `${consumer} must use the Host's physical ${peer}`);
  }
  for (const absent of ['@agent-teams/payments-get-modular', '@agent-teams/engineering-foundation']) {
    assert.throws(() => import.meta.resolve(absent), { code: 'ERR_MODULE_NOT_FOUND' }, `${absent} must remain outside the candidate runtime graph`);
  }
});
