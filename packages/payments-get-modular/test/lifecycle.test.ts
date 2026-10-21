import assert from 'node:assert/strict';
import test from 'node:test';
import { assemblyFor } from '@get-modular/assembly';
import { createScope } from '@get-modular/resources';
import { liveSubscriptions, settled } from '@get-modular/observation/testing';
import { PaymentsConfiguration, paymentsConfiguration, paymentsGroup, paymentsModule, type PaymentsCapabilities } from '../dist/index.js';
import { createPurchaseProjection } from '../dist/observation/index.js';
import { deferred, fixture } from './fixtures.ts';

void test('staged Host shutdown retains the payment runtime and borrowed pool after an escalated projection debt', { timeout: 10_000 }, async () => {
  const host = fixture();
  const started = deferred<void>(), release = deferred<void>();
  const read = host.store.readPurchase.bind(host.store);
  host.store.readPurchase = async (...args) => {
    started.resolve();
    await release.promise;
    return read(...args);
  };
  let poolClosed = false;
  const infrastructure = createScope({ name: 'borrowed-pool-owner' });
  infrastructure.resources.use({ [Symbol.dispose]: () => { poolClosed = true; } }, 'pool');
  const runtimeScope = infrastructure.resources.child({ name: 'payment-runtime' });
  const preparation = await assemblyFor<PaymentsCapabilities>().prepare({
    profileId: 'test/staged-projection-shutdown', modules: [paymentsGroup],
    inputs: { configuration: paymentsConfiguration }, roots: { payments: paymentsModule },
  });
  assert.equal(preparation.status, 'prepared');
  const result = await preparation.prepared.run({ scope: runtimeScope.resources, inputs: { configuration: { [PaymentsConfiguration.id]: host.options } } });
  assert.equal(result.status, 'succeeded');
  const payments = result.roots.payments;
  const viewScope = runtimeScope.resources.child({ name: 'purchase-view' });
  const projection = createPurchaseProjection({
    read: payments.read, initialQuery: { buyerId: 'buyer', intentId: 'missing' }, reportError: () => {},
  }, { resources: viewScope.resources });
  try {
    await started.promise;
    const report = await viewScope.control.close({ escalate: AbortSignal.abort('shutdown deadline') });
    assert.equal(report.complete, false);
    assert.equal(report.settled, true);
    assert.ok(report.debts.some(debt => debt.state === 'failed' && debt.cause instanceof Error && 'code' in debt.cause && debt.cause.code === 'observation.load.still-running'));
    assert.equal(liveSubscriptions(projection.view), 0, 'subscription release does not prove physical read settlement');
    assert.equal(poolClosed, false, 'the Host keeps infrastructure while the dependent close has debt');
    assert.equal(payments.lifecycle().accepting, true, 'the borrowed runtime is retained until its dependent view settles');

    release.resolve();
    await settled({ stores: [projection.view] });
    assert.deepEqual(await viewScope.control.close(), { complete: true, settled: true, debts: [] });
    assert.equal((await runtimeScope.control.close()).complete, true);
    assert.equal(payments.lifecycle().accepting, false);
    assert.equal(poolClosed, false);
    assert.equal((await infrastructure.control.close()).complete, true);
    assert.equal(poolClosed, true);
  } finally {
    release.resolve();
    await settled({ stores: [projection.view] });
    assert.equal((await viewScope.control.close()).complete, true);
    assert.equal((await runtimeScope.control.close()).complete, true);
    assert.equal((await infrastructure.control.close()).complete, true);
  }
});

void test('Host defers ancestor shutdown requested from an abort listener until the projection subscriber detaches', { timeout: 10_000 }, async () => {
  const sourceOwner = createScope({ name: 'independent-projection-owner' });
  const reader = fixture();
  const projection = createPurchaseProjection({
    read: { readPurchase: (buyerId, intentId) => reader.store.readPurchase(reader.options.scope, buyerId, intentId) }, initialQuery: undefined, reportError: () => {},
  }, { resources: sourceOwner.resources });
  const host = createScope({ name: 'display-host' });
  let subscriptionsAtRelease: number | undefined;
  host.resources.use({ [Symbol.dispose]: () => { subscriptionsAtRelease = liveSubscriptions(projection.view); } }, 'borrowed-renderer');
  const display = host.resources.child({ name: 'display' });
  const closing = deferred<Promise<Awaited<ReturnType<typeof host.control.close>>>>();
  display.resources.signal.addEventListener('abort', () => {
    // Published Resources 0.2.0 has synchronous close-reentry limitations. The Host
    // requests shutdown after abort notification rather than running it inside it.
    queueMicrotask(() => { closing.resolve(host.control.close()); });
  }, { once: true });
  projection.view.watch(projection.view.read(['state']), { resources: display.resources, name: 'purchase-display', onChange: () => {} });
  try {
    await settled({ stores: [projection.view] });
    assert.equal(liveSubscriptions(projection.view), 1);
    assert.equal((await display.control.close()).complete, true);
    assert.equal((await closing.promise).complete, true);
    assert.equal(subscriptionsAtRelease, 0);
    assert.equal(projection.view.read(['state']).values.state.status, 'idle', 'closing the subscriber never closes its borrowed source');
  } finally {
    assert.equal((await host.control.close()).complete, true);
    assert.equal((await sourceOwner.control.close()).complete, true);
  }
});
