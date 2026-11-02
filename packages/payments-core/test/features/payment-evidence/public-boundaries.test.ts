import assert from 'node:assert/strict';
import test from 'node:test';
import { createPayments } from '../../../src/index.ts';
import type { CheckoutReady, OfferSnapshot, PaymentRuntimeOptions, PaymentScope } from '../../../src/index.ts';
import type { PaymentProvider, ProviderResult } from '../../../src/provider.ts';
import { MemoryPaymentStore } from '../../../src/memory.ts';

const scope: PaymentScope = { applicationId: 'public-contract', provider: 'fixture', paymentAccountId: 'merchant', environment: 'sandbox' };
const offer: OfferSnapshot = { applicationId: scope.applicationId, offerId: 'topup', version: '1', policyVersion: '1', profile: 'one_time', currency: 'USD', allowZeroTotal: false, lines: [{ providerPriceRef: 'price', benefitSlotId: 'credits', quantity: 1 }] };
const buyer = 'buyer-a';
function fixture(options: Partial<Pick<PaymentRuntimeOptions, 'operationTimeoutMs' | 'maxConcurrentMutations'>> = {}) {
  const store = new MemoryPaymentStore();
  let sequence = 0, calls = 0;
  const provider: PaymentProvider = {
    scope, capabilities: { checkout: true, transactionRead: true, subscriptionRead: true, cancellation: [], paymentUpdate: false, customerManagement: false },
    createCheckout: async command => {calls += 1; return { kind: 'succeeded', value: { intentId: command.intentId, transactionRef: `tx-${command.intentId}`, checkout: {} } };},
    readTransaction: async () => ({ kind: 'unsupported', capability: 'fixture' }),
    readSubscription: async () => ({ kind: 'unsupported', capability: 'fixture' }),
  };
  const settings = { scope, store, provider, catalog: { resolveOffer: async () => offer }, producerNamespace: 'public-contract/1', newId: () => `id-${++sequence}`, ...options };
  const payments = createPayments(settings);
  return { store, provider, settings, payments, calls: () => calls };
}
const command = (requestKey: string) => ({ buyerId: buyer, offerId: offer.offerId, requestKey });

void test('buyer reads require explicit valid ownership and snapshot the authorization query before awaiting storage', async () => {
  const f = fixture();
  try {
    const checkout = await f.payments.startPurchase(command('first'));
    assert.equal(checkout.kind, 'succeeded');
    const purchase = await f.payments.readPurchase(buyer, checkout.value.intentId); assert.ok(purchase);
    const operationId = purchase.intent.operationId;
    assert.equal((await f.payments.readOperation({ buyerId: buyer, operationId }))?.buyerId, buyer);
    assert.equal(await f.payments.readOperation({ buyerId: 'buyer-b', operationId }), undefined);
    assert.equal((await f.payments.inspectOperation(operationId))?.buyerId, buyer);
    const load = f.store.loadOperation.bind(f.store); let reads = 0;
    f.store.loadOperation = async (...args) => {reads += 1; return load(...args);};
    for (const args of [[], [operationId], [{ operationId }], [{ operationId, buyerId: undefined }], [{ operationId, buyerId: '' }]]) {
      await assert.rejects(async () => {await Reflect.apply(f.payments.readOperation, undefined, args);}, TypeError);
    }
    assert.equal(reads, 0, 'invalid ownership cannot fall back to privileged storage inspection');
    const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
    f.store.loadOperation = async (...args) => {entered.resolve(); await release.promise; return load(...args);};
    const query = { operationId, buyerId: 'buyer-b' };
    const reading = f.payments.readOperation(query);
    await entered.promise; query.buyerId = buyer; release.resolve();
    assert.equal(await reading, undefined, 'mutating a caller-owned object cannot change the admitted buyer');
  } finally {f.payments.stop(); await f.payments.drain();}
});

void test('a timed-out physical mutation keeps its capacity; deferred durable commands execute only after settlement', async () => {
  const f = fixture({ operationTimeoutMs: 5, maxConcurrentMutations: 1 });
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<ProviderResult<CheckoutReady>>();
  let calls = 0, firstIntent = '';
  f.provider.createCheckout = async input => {
    calls += 1;
    if (calls === 1) {firstIntent = input.intentId; entered.resolve(); return release.promise;}
    return { kind: 'succeeded', value: { intentId: input.intentId, transactionRef: `tx-${input.intentId}`, checkout: {} } };
  };
  try {
    const firstCall = f.payments.startPurchase(command('first'));
    await entered.promise;
    const first = await firstCall;
    assert.equal(first.kind, 'outcome_unknown');
    assert.equal(f.payments.lifecycle().admittedMutations, 1);
    const waiting = await Promise.all(Array.from({ length: 8 }, (_, index) => f.payments.startPurchase(command(`next-${index}`))));
    for (const item of waiting) {
      assert.equal(item.kind, 'deferred');
      const saved = await f.payments.inspectOperation(item.operationId); assert.ok(saved);
      assert.equal(saved.state, 'prepared'); assert.equal(saved.attempts.length, 0);
      assert.equal((await f.payments.executeOperation(item.operationId)).kind, 'deferred');
    }
    assert.equal((await f.payments.startPurchase(command('first'))).kind, 'outcome_unknown');
    assert.equal(calls, 1, 'neither retries nor queued commands overrun physical admission');
    release.resolve({ kind: 'succeeded', value: { intentId: firstIntent, transactionRef: 'tx-first', checkout: {} } });
    await f.payments.drain();
    assert.equal(f.payments.lifecycle().admittedMutations, 0);
    for (const item of waiting) {
      assert.equal(item.kind, 'deferred');
      assert.equal((await f.payments.executeOperation(item.operationId)).kind, 'succeeded');
    }
    assert.equal(calls, 9);
    assert.equal(f.payments.lifecycle().admittedMutations, 0);
    assert.equal((await f.payments.inspectOperation(first.operationId))?.state, 'succeeded');
  } finally {release.resolve({ kind: 'outcome_unknown' }); f.payments.stop(); await f.payments.drain();}
});

void test('failed or conflicted dispatch custody releases admission without issuing a provider mutation', async () => {
  const f = fixture({ maxConcurrentMutations: 1 });
  const mark = f.store.beginExternalDispatch.bind(f.store);
  try {
    f.store.beginExternalDispatch = async () => {throw new Error('injected marker failure');};
    await assert.rejects(f.payments.startPurchase(command('failed')), /marker failure/u);
    assert.equal(f.calls(), 0); assert.equal(f.payments.lifecycle().admittedMutations, 0);
    f.store.beginExternalDispatch = async () => ({ kind: 'conflict' });
    assert.equal((await f.payments.startPurchase(command('conflict'))).kind, 'pending');
    assert.equal(f.calls(), 0); assert.equal(f.payments.lifecycle().admittedMutations, 0);
    f.store.beginExternalDispatch = mark;
    assert.equal((await f.payments.startPurchase(command('ready'))).kind, 'succeeded');
    assert.equal(f.calls(), 1); assert.equal(f.payments.lifecycle().admittedMutations, 0);
    for (const maximum of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 1025]) {
      assert.throws(() => createPayments({ ...f.settings, maxConcurrentMutations: maximum }), RangeError);
    }
  } finally {f.payments.stop(); await f.payments.drain();}
});

void test('absolute retry advice survives restart and public snapshots without leaking provider diagnostics or enabling automatic retry', async () => {
  const f = fixture(); let calls = 0;
  const retryAt = '2026-12-01T00:01:00.000Z';
  f.provider.createCheckout = async () => {calls += 1; return { kind: 'rejected', code: 'rate_limited', retryAt, diagnostic: { providerCode: 'private-limit', requestId: 'private-request' } };};
  const request = command('limited');
  try {
    assert.deepEqual(await f.payments.startPurchase(request), { kind: 'rejected', code: 'rate_limited', retryAt });
    const stored = await f.store.findRequest(scope, buyer, request.requestKey); assert.ok(stored);
    f.payments.stop(); await f.payments.drain();
    const restarted = createPayments(f.settings);
    try {
      assert.deepEqual(await restarted.startPurchase(request), { kind: 'rejected', code: 'rate_limited', retryAt });
      const snapshot = await restarted.readOperation({ buyerId: buyer, operationId: stored.operationId }); assert.ok(snapshot);
      assert.deepEqual(snapshot.result, { kind: 'rejected', code: 'rate_limited', retryAt });
      assert.deepEqual(snapshot.attempts[0]?.observations[0], { kind: 'rejected', code: 'rate_limited', retryAt });
      assert.equal(JSON.stringify(snapshot).includes('private-'), false);
      await restarted.repair(); assert.equal(calls, 1);
    } finally {restarted.stop(); await restarted.drain();}
  } finally {f.payments.stop(); await f.payments.drain();}
});
