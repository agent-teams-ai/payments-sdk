import assert from 'node:assert/strict';
import test from 'node:test';
import { assemblyFor } from '@get-modular/assembly';
import { checkNamespaces, checkWiring } from '@get-modular/conformance';
import { createScope } from '@get-modular/resources';
import { delivered, settled } from '@get-modular/observation/testing';
import type { PurchaseRead } from '@agent-teams/payments-core';
import {
  createPurchaseProjection, PurchaseReader, ProjectionConfiguration,
  purchaseProjectionModule, purchaseProjectionDeclaration, purchaseReadInput, purchaseReadDeclaration,
  projectionConfigurationInput, projectionConfigurationDeclaration,
  type PurchaseObservationCapabilities, type PurchaseProjectionState,
} from '../../../../dist/observation/index.js';
import { fixture } from '../../../module/fixtures.ts';

void test('the optional projection has independent declared read/configuration wiring and independent run inputs', async () => {
  let calls = 0;
  const prepared = await assemblyFor<PurchaseObservationCapabilities>().prepare({
    profileId: 'test/projection-only', modules: [purchaseProjectionModule],
    inputs: { reader: purchaseReadInput, configuration: projectionConfigurationInput },
    roots: { projection: purchaseProjectionModule },
  });
  assert.equal(prepared.status, 'prepared');
  const declarations = [purchaseProjectionDeclaration, purchaseReadDeclaration, projectionConfigurationDeclaration];
  checkNamespaces({ namespace: 'agent-teams/payments', declarations });
  checkWiring(prepared.composition, [{ providers: {
    'agent-teams/payments/observation/reader': 'agent-teams/payments/observation/host-reader/input',
    'agent-teams/payments/observation/configuration': 'agent-teams/payments/observation/host-configuration/input',
    'agent-teams/payments/observation/view': 'agent-teams/payments/observation/projection/default',
    'agent-teams/payments/observation/commands': 'agent-teams/payments/observation/projection/default',
  }, roots: ['agent-teams/payments/observation/projection/default'] }], { declarations });
  assert.equal(calls, 0, 'preparation cannot execute the borrowed reader');
  const first = createScope({ name: 'projection-first' }), second = createScope({ name: 'projection-second' });
  const input = (buyerId: string) => ({
    reader: { [PurchaseReader.id]: { readPurchase: async () => { calls += 1; return undefined; } } },
    configuration: { [ProjectionConfiguration.id]: { initialQuery: { buyerId, intentId: 'intent' }, reportError: (): undefined => {} } },
  });
  try {
    const a = await prepared.prepared.run({ scope: first.resources, inputs: input('first-buyer') });
    const b = await prepared.prepared.run({ scope: second.resources, inputs: input('second-buyer') });
    assert.equal(a.status, 'succeeded'); assert.equal(b.status, 'succeeded');
    await settled();
    const stateA = a.roots.projection.view.read(['state']).values.state;
    const stateB = b.roots.projection.view.read(['state']).values.state;
    assert.deepEqual(stateA, { status: 'ready', query: { buyerId: 'first-buyer', intentId: 'intent' }, purchase: undefined });
    assert.deepEqual(stateB, { status: 'ready', query: { buyerId: 'second-buyer', intentId: 'intent' }, purchase: undefined });
    assert.notEqual(a.roots.projection, b.roots.projection);
    assert.equal(calls, 2);
    assert.equal((await first.control.close()).complete, true);
    b.roots.projection.commands.refresh();
    await settled();
    assert.equal(calls, 3, 'closing one run preserves the sibling read projection');
  } finally {
    assert.equal((await first.control.close()).complete, true);
    assert.equal((await second.control.close()).complete, true);
  }
});

void test('the finite view copies borrowed nested values, catches read/watch gaps and refreshes only on request', async () => {
  const owner = createScope({ name: 'finite-purchase-view' });
  const host = fixture();
  const offer = await host.options.catalog.resolveOffer(host.options.scope, 'top-up');
  assert.ok(offer);
  const borrowed: PurchaseRead = {
    intent: { intentId: 'intent', buyerId: 'buyer', requestKey: 'request', operationId: 'operation', transactionRefs: ['transaction'], offer, createdAt: '2026-01-01T00:00:00Z' },
    transactions: [{ transactionRef: 'transaction', revision: 2, evidenceRevision: 1, observations: [], adjustments: {}, pendingAdverse: ['pending'], flags: [], currentProfileFlags: [], retainedFlags: [] }],
  };
  const query = { buyerId: 'buyer', intentId: 'intent' };
  let calls = 0, fail = false;
  const states: PurchaseProjectionState[] = [];
  const projection = createPurchaseProjection({
    initialQuery: query, reportError: (): undefined => {},
    read: { readPurchase: async () => {
      calls += 1;
      if (fail) {throw new Error('private connection credentials must not enter the view');}
      return borrowed;
    } },
  }, { resources: owner.resources });
  try {
    const before = projection.view.read(['state']);
    await settled();
    assert.equal(states.length, 0, 'no subscriber or initial callback is installed implicitly');
    assert.equal(projection.view.watch(before, { resources: owner.resources, name: 'catch-up', onChange: ({ values }) => { states.push(values.state); } }), undefined);
    assert.equal(states.length, 0, 'watch registration is synchronous and notification is deferred');
    await delivered();
    const ready = projection.view.read(['state']).values.state;
    assert.equal(ready.status, 'ready'); assert.ok(ready.purchase);
    assert.equal(states.at(-1)?.status, 'ready', 'the actual earlier snapshot catches the intervening load completion');
    assert.equal(Object.isFrozen(query), false);
    assert.equal(Object.isFrozen(borrowed.intent.offer.lines), false);
    assert.equal(Object.isFrozen(borrowed.transactions[0]?.pendingAdverse), false);
    assert.notEqual(ready.purchase.intent.offer, borrowed.intent.offer);
    assert.ok(Object.isFrozen(ready.purchase.intent.offer.lines));
    assert.ok(Object.isFrozen(ready.purchase.transactions[0]?.pendingAdverse));
    assert.deepEqual(Object.keys(ready.purchase.intent).sort(), ['buyerId', 'createdAt', 'intentId', 'offer']);
    assert.equal('observations' in (ready.purchase.transactions[0] ?? {}), false);
    assert.equal('adjustments' in (ready.purchase.transactions[0] ?? {}), false);
    assert.equal(calls, 1);
    fail = true;
    projection.commands.refresh();
    assert.equal(projection.view.read(['state']).values.state.status, 'loading', 'refresh invalidates the old ready value synchronously');
    await settled();
    assert.deepEqual(projection.view.read(['state']).values.state, { status: 'failed', query, error: { code: 'purchase_read_failed' } });
    await delivered();
    assert.equal(calls, 2, 'a failed read does not schedule an automatic retry');
    fail = false;
    projection.commands.refresh();
    await settled();
    assert.equal(projection.view.read(['state']).values.state.status, 'ready');
    projection.commands.select(undefined);
    assert.deepEqual(projection.view.read(['state']).values.state, { status: 'idle' });
    projection.commands.refresh();
    await settled();
    assert.equal(calls, 3, 'clearing and refreshing an idle view do not query');
  } finally { assert.equal((await owner.control.close()).complete, true); }
});
