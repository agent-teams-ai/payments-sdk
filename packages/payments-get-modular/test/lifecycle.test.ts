import assert from 'node:assert/strict';
import test from 'node:test';
import { assemblyFor } from '@get-modular/assembly';
import { createScope } from '@get-modular/resources';
import type { ListenerError } from '@get-modular/observation';
import { liveSubscriptions, settled } from '@get-modular/observation/testing';
import { PaymentsConfiguration, paymentsConfiguration, paymentsGroup, paymentsModule, type PaymentsCapabilities } from '../dist/index.js';
import { createPurchaseProjection } from '../dist/observation/index.js';
import { deferred, fixture } from './fixtures.ts';

void test('staged Host shutdown retains the payment runtime and borrowed pool until the escalated projection read and cleanup settle', { timeout: 10_000 }, async () => {
  const host = fixture();
  const started = deferred<void>(), release = deferred<void>();
  const cleanupStarted = deferred<void>(), releaseCleanup = deferred<void>();
  const reported = deferred<ListenerError>();
  const read = host.store.readPurchase.bind(host.store);
  host.store.readPurchase = async (...args) => {
    started.resolve();
    try {
      await release.promise;
      return await read(...args);
    } finally {
      cleanupStarted.resolve();
      await releaseCleanup.promise;
    }
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
    read: payments.read, initialQuery: { buyerId: 'buyer', intentId: 'missing' },
    reportError: report => { reported.resolve(report); },
  }, { resources: viewScope.resources });
  let viewClosed = false;
  let closing: ReturnType<typeof viewScope.control.close> | undefined;
  try {
    await started.promise;
    closing = viewScope.control.close({ escalate: AbortSignal.abort('shutdown deadline') })
      .then(report => { viewClosed = true; return report; });
    const notice = await reported.promise;
    assert.equal(notice.source, 'payments-purchase/requests');
    assert.equal(notice.subscription, 'payments-purchase/read');
    assert.ok(notice.cause instanceof Error && 'code' in notice.cause && notice.cause.code === 'observation.load.still-running');
    const report = await viewScope.control.close({ abandon: AbortSignal.abort('Host observer deadline') });
    assert.equal(report.complete, false);
    assert.equal(report.settled, false);
    assert.ok(report.debts.some(debt => debt.state === 'pending' && debt.path.slice(-2).join('/') === 'load:payments-purchase/read/drain'));
    assert.equal(viewClosed, false, 'reporting and observer abandonment leave the original close pending');
    assert.equal(liveSubscriptions(projection.view), 0, 'subscription release does not prove physical read settlement');
    assert.equal(poolClosed, false, 'the Host keeps infrastructure while the dependent close has debt');
    assert.equal(payments.lifecycle().accepting, true, 'the borrowed runtime is retained until its dependent view settles');

    release.resolve();
    await cleanupStarted.promise;
    assert.equal(viewClosed, false, 'the original close also retains the borrowed read cleanup');
    assert.equal(poolClosed, false);
    assert.equal(payments.lifecycle().accepting, true);
    releaseCleanup.resolve();
    assert.deepEqual(await closing, { complete: true, settled: true, debts: [] });
    assert.equal((await runtimeScope.control.close()).complete, true);
    assert.equal(payments.lifecycle().accepting, false);
    assert.equal(poolClosed, false);
    assert.equal((await infrastructure.control.close()).complete, true);
    assert.equal(poolClosed, true);
  } finally {
    release.resolve(); releaseCleanup.resolve();
    await settled({ stores: [projection.view] });
    assert.equal((await (closing ?? viewScope.control.close())).complete, true);
    assert.equal((await runtimeScope.control.close()).complete, true);
    assert.equal((await infrastructure.control.close()).complete, true);
  }
});

void test('Host ancestor shutdown requested synchronously from an abort listener retains subscriber detachment order', { timeout: 10_000 }, async () => {
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
    closing.resolve(host.control.close());
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
