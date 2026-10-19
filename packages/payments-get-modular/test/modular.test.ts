import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalJson, digest, money, type PaymentProvider, type TransactionObservation, type VerifiedInput } from '@agent-teams/payments-core';
import { assemblyFor, declareModule, defineContract, implement, type CapabilitiesOf } from '@get-modular/assembly';
import { createScope, scoped } from '@get-modular/resources';
import { checkNamespaces, checkWiring, isolate, smoke } from '@get-modular/conformance';
import { Checkout, Delivery, Management, PaymentsConfiguration, Processing, Read, paymentsConfiguration, paymentsConfigurationDeclaration, paymentsDeclaration, paymentsGroup, paymentsModule, type PaymentsCapabilities } from '../dist/index.js';
import { command, deferred, fixture } from './fixtures.ts';

function compose(api = assemblyFor<PaymentsCapabilities>()) {
  return api.prepare({ profileId: 'test/payments-fixture', modules: [paymentsGroup], inputs: { configuration: paymentsConfiguration }, roots: { payments: paymentsModule } });
}
const inputs = (options: ReturnType<typeof fixture>['options']) => ({ configuration: { [PaymentsConfiguration.id]: options } });

test('published composition prepares without effects and matches an independent namespace/wiring oracle', async () => {
  const host = fixture(), result = await compose();
  assert.equal(result.status, 'prepared');
  if (result.status !== 'prepared') throw new Error('Expected prepared composition');
  assert.equal(host.calls(), 0);
  const declarations = [paymentsDeclaration, paymentsConfigurationDeclaration];
  checkNamespaces({ namespace: 'agent-teams/payments', declarations });
  checkWiring(result.composition, [{
    providers: {
      'agent-teams/payments/configuration': 'agent-teams/payments/configuration/host',
      'agent-teams/payments/checkout': 'agent-teams/payments/runtime/default',
      'agent-teams/payments/read': 'agent-teams/payments/runtime/default',
      'agent-teams/payments/management': 'agent-teams/payments/runtime/default',
      'agent-teams/payments/processing': 'agent-teams/payments/runtime/default',
      'agent-teams/payments/delivery': 'agent-teams/payments/runtime/default',
    },
    roots: ['agent-teams/payments/runtime/default'],
  }], { declarations });
});

test('real isolation exposes segregated immutable capability facets and disposes the runtime', async () => {
  const host = fixture();
  const built = await isolate(paymentsModule, { dependencies: { configuration: host.options } });
  assert.deepEqual(Object.keys(built.capabilities[Checkout.id]), ['startPurchase']);
  assert.deepEqual(Object.keys(built.capabilities[Read.id]), ['readOperation', 'readPurchase', 'readObservedSubscription', 'readSubscriptionSelection']);
  assert.deepEqual(Object.keys(built.capabilities[Management.id]), ['requestCancellation', 'openPaymentUpdate', 'createManagementLink']);
  assert.deepEqual(Object.keys(built.capabilities[Delivery.id]), ['registerConsumer', 'readDeliveries', 'acknowledgeDelivery']);
  assert.equal(built.capabilities[Processing.id], built.instance.processing);
  assert.ok(Object.isFrozen(built.instance.checkout));
  assert.equal('startPurchase' in built.capabilities[Read.id], false);
  assert.equal('control' in built.instance, false);
  assert.equal(host.calls(), 0);
  assert.equal((await built.capabilities[Checkout.id].startPurchase(command)).kind, 'succeeded');
  assert.equal(host.calls(), 1);
  assert.deepEqual(await built.close(), { complete: true, settled: true, debts: [] });
  assert.equal(built.instance.lifecycle().accepting, false);
  await assert.rejects(built.instance.checkout.startPurchase({ ...command, requestKey: 'after-close' }));
});

test('conformance smoke releases real scoped modules for success, injected failure and cancellation', async () => {
  const host = fixture();
  const steps = await smoke({ api: assemblyFor<PaymentsCapabilities>(), compose, inputs: inputs(host.options) });
  assert.deepEqual(steps.map(step => step.outcome), ['succeeded', 'failed', 'cancelled']);
  for (const step of steps) { assert.equal(step.problem, undefined); assert.equal(step.report.complete, true); }
  assert.equal(host.calls(), 0);
});

test('one prepared template keeps two run inputs and sibling lifetimes isolated under a borrowed owner', async () => {
  const first = fixture(), second = fixture('app-b', first.store), result = await compose();
  assert.equal(result.status, 'prepared');
  if (result.status !== 'prepared') throw new Error('Expected prepared composition');
  let borrowedClosed = 0;
  const owner = createScope({ name: 'host-pool-owner' });
  owner.resources.use({ [Symbol.dispose]: () => { borrowedClosed += 1; } }, 'borrowed-pool');
  const a = owner.resources.child({ name: 'app-a' }), b = owner.resources.child({ name: 'app-b' });
  const [runA, runB] = await Promise.all([
    result.prepared.run({ scope: a.resources, inputs: inputs(first.options) }),
    result.prepared.run({ scope: b.resources, inputs: inputs(second.options) }),
  ]);
  assert.equal(runA.status, 'succeeded'); assert.equal(runB.status, 'succeeded');
  if (runA.status !== 'succeeded' || runB.status !== 'succeeded') throw new Error('Expected successful runs');
  assert.notEqual(runA.roots.payments, runB.roots.payments);
  const checkout = await runA.roots.payments.checkout.startPurchase(command);
  assert.equal(checkout.kind, 'succeeded');
  if (checkout.kind !== 'succeeded') throw new Error('Expected checkout');
  assert.equal(await runB.roots.payments.read.readPurchase(command.buyerId, checkout.value.intentId), undefined);
  assert.equal((await a.control.close()).complete, true);
  assert.equal(borrowedClosed, 0); assert.equal(runB.roots.payments.lifecycle().accepting, true);
  assert.equal((await runB.roots.payments.checkout.startPurchase(command)).kind, 'succeeded');
  assert.equal(second.calls(), 1);
  assert.equal((await b.control.close()).complete, true); assert.equal(borrowedClosed, 0);
  assert.equal((await owner.control.close()).complete, true); assert.equal(borrowedClosed, 1);
});

test('shutdown retains borrowed dependencies until an expired provider call physically settles', async () => {
  const host = fixture(), started = deferred<void>(), response = deferred<Awaited<ReturnType<PaymentProvider['createCheckout']>>>();
  host.replaceCheckout(command => { started.resolve(); return response.promise.then(result => result.kind === 'succeeded' ? { ...result, value: { ...result.value, intentId: command.intentId } } : result); });
  const scope = createScope({ name: 'held-provider' });
  const built = await isolate(paymentsModule, { dependencies: { configuration: host.options }, within: scope.resources });
  const checkout = built.instance.checkout.startPurchase(command);
  await started.promise;
  assert.equal((await checkout).kind, 'outcome_unknown');
  assert.equal(built.instance.lifecycle().unresolvedExternalCalls, 1);
  const report = await scope.control.close({ abandon: AbortSignal.abort('inspect physical drain') });
  assert.equal(report.complete, false); assert.equal(report.settled, false); assert.ok(report.debts.length > 0);
  assert.equal(built.instance.lifecycle().accepting, false);
  response.resolve({ kind: 'succeeded', value: { intentId: 'replaced-by-fixture', transactionRef: 'late-transaction', checkout: { token: 'late-checkout' } } });
  assert.equal((await scope.control.close()).complete, true);
  assert.equal(built.instance.lifecycle().unresolvedExternalCalls, 0);
  const operation = await host.store.findRequest(host.options.scope, command.buyerId, command.requestKey);
  assert.equal(operation?.state, 'succeeded'); assert.equal(host.calls(), 1);
  assert.deepEqual(await host.store.listWork(host.options.scope, 'unknown', 10), []);
});

test('shutdown waits for admitted read calls before borrowed storage can be released', async () => {
  const host = fixture(), started = deferred<void>(), release = deferred<void>();
  const read = host.store.readPurchase.bind(host.store);
  host.store.readPurchase = async (...args) => { started.resolve(); await release.promise; return read(...args); };
  let storageClosed = false;
  const owner = createScope({ name: 'storage-owner' });
  owner.resources.use({ [Symbol.dispose]: () => { storageClosed = true; } }, 'borrowed-storage');
  const built = await isolate(paymentsModule, { dependencies: { configuration: host.options }, within: owner.resources });
  const pendingRead = built.instance.read.readPurchase('buyer', 'missing'); await started.promise;
  const snapshot = await owner.control.close({ abandon: AbortSignal.abort() });
  assert.equal(snapshot.complete, false); assert.equal(storageClosed, false);
  release.resolve(); assert.equal(await pendingRead, undefined);
  assert.equal((await owner.control.close()).complete, true); assert.equal(storageClosed, true);
});

test('financial facts and delivery advance only through explicit durable commands, with no observation hooks', async () => {
  const host = fixture(), built = await isolate(paymentsModule, { dependencies: { configuration: host.options } });
  try {
    await built.instance.delivery.registerConsumer('consumer');
    const checkout = await built.instance.checkout.startPurchase(command);
    assert.equal(checkout.kind, 'succeeded'); if (checkout.kind !== 'succeeded') throw new Error('Expected checkout');
    assert.deepEqual(await built.instance.delivery.readDeliveries('consumer'), []);
    const source = { kind: 'authenticated_api', receiptId: 'receipt', representationDigest: digest('representation'), decoderVersion: '1', apiProfile: 'fixture-v1' } as const;
    const known = <T>(value: T) => ({ presence: 'known', value }) as const;
    const observation: TransactionObservation = {
      kind: 'transaction', transactionRef: checkout.value.transactionRef, version: '2026-01-01T00:00:00Z', status: 'completed', statusMeaning: { kind: 'completed' },
      origin: known('api'), customerRef: known('customer'), subscriptionRef: known(null), intentCorrelation: known(checkout.value.intentId),
      currency: known('USD'), total: known(money('USD', '1000')),
      lines: known([{ providerLineRef: 'line', providerPriceRef: 'price', quantity: 1, amount: money('USD', '1000'), billingCycle: known(null), trial: known(false), proration: known(false), period: known(null) }]), source,
    };
    const verified: VerifiedInput = { scope: host.options.scope, inputId: source.receiptId, source, observation, retainedRepresentation: JSON.parse(canonicalJson(observation)) as VerifiedInput['retainedRepresentation'] };
    assert.equal((await built.instance.processing.ingestVerifiedInput(verified)).kind, 'succeeded');
    assert.deepEqual(await built.instance.delivery.readDeliveries('consumer'), []);
    assert.equal(await built.instance.processing.processInbox(source.receiptId), 'processed');
    const messages = await built.instance.delivery.readDeliveries('consumer');
    assert.equal(messages.length, 1);
    const message = messages[0]; assert.ok(message); assert.equal(message.kind, 'complete');
    if (message.kind !== 'complete') throw new Error('Expected complete evidence');
    assert.equal(message.completion?.classification, 'one_time');
    assert.deepEqual(message.completion?.lines.map(line => [line.providerLineRef, line.benefitSlotId, line.amount.minorUnits]), [['line', 'top-up', '1000']]);
    assert.equal(await built.instance.delivery.acknowledgeDelivery('consumer', message.messageId, message.bodyDigest), 'acknowledged');
    assert.equal(await built.instance.processing.processInbox(source.receiptId), 'duplicate');
    assert.deepEqual(await built.instance.delivery.readDeliveries('consumer'), []);
    assert.equal(host.calls(), 1);
  } finally { assert.equal((await built.close()).complete, true); }
});

test('a public Assembly runtime can audit and select duplicate initial subscription streams', async () => {
  const host = fixture('app-a', undefined, 'monthly'), first = deferred<Awaited<ReturnType<PaymentProvider['createCheckout']>>>();
  const lateSettled = deferred<void>(), originalFinish = host.store.finishAttempt.bind(host.store);
  host.store.finishAttempt = async (...args) => {
    const result = await originalFinish(...args);
    if (args[1].binding?.transactionRef === 'initial-a' && result.kind === 'committed') lateSettled.resolve();
    return result;
  };
  let intentId = '';
  host.replaceCheckout(input => { intentId = input.intentId; return first.promise; });
  const prepared = await compose();
  assert.equal(prepared.status, 'prepared'); if (prepared.status !== 'prepared') throw new Error('Expected prepared composition');
  const attempt = createScope({ name: 'duplicate-stream-selection' });
  const outcome = await prepared.prepared.run({ scope: attempt.resources, inputs: inputs(host.options) });
  assert.equal(outcome.status, 'succeeded'); if (outcome.status !== 'succeeded') throw new Error('Expected successful run');
  const { read, processing, checkout } = outcome.roots.payments;
  const known = <T>(value: T) => ({ presence: 'known', value }) as const;
  async function observe(transactionRef: string, subscriptionRef: string, initial: boolean, day = '01'): Promise<void> {
    const receiptId = `${transactionRef}-receipt`;
    const source = { kind: 'authenticated_api', receiptId, representationDigest: digest(receiptId), decoderVersion: '1', apiProfile: 'fixture-v1' } as const;
    const observation: TransactionObservation = {
      kind: 'transaction', transactionRef, version: '2026-01-01T00:00:00Z', status: 'completed', statusMeaning: { kind: 'completed' }, origin: known(initial ? 'api' : 'subscription_recurring'),
      customerRef: known('customer'), subscriptionRef: known(subscriptionRef), intentCorrelation: { presence: 'unknown' }, currency: known('USD'), total: known(money('USD', '1000')),
      lines: known([{ providerLineRef: `${transactionRef}-line`, providerPriceRef: 'price', quantity: 1, amount: money('USD', '1000'), billingCycle: known({ interval: 'month', frequency: 1 }), trial: known(false), proration: known(false), period: known({ startsAt: `2026-01-${day}T00:00:00Z`, endsAt: `2026-02-${day}T00:00:00Z` }) }]), source,
    };
    const verified: VerifiedInput = { scope: host.options.scope, inputId: receiptId, source, observation, retainedRepresentation: JSON.parse(canonicalJson(observation)) as VerifiedInput['retainedRepresentation'] };
    assert.equal((await processing.ingestVerifiedInput(verified)).kind, 'succeeded');
    assert.equal(await processing.processInbox(receiptId), 'processed');
  }
  try {
    const unknown = await checkout.startPurchase(command);
    assert.equal(unknown.kind, 'outcome_unknown'); if (unknown.kind !== 'outcome_unknown') throw new Error('Expected unknown first attempt');
    const operation = await read.readOperation(unknown.operationId); assert.ok(operation);
    assert.equal((await processing.resolveUnknownOperation({ operationId: operation.operationId, expectedRevision: operation.revision, actorId: 'operator', auditRef: 'accepted-duplicate-risk', reason: 'recover unknown checkout', action: 'retry', acceptedDuplicateRisk: true })).kind, 'succeeded');
    host.replaceCheckout(async input => ({ kind: 'succeeded', value: { intentId: input.intentId, transactionRef: 'initial-b', checkout: { token: 'b' } } }));
    assert.equal((await processing.executeOperation(operation.operationId)).kind, 'succeeded');
    first.resolve({ kind: 'succeeded', value: { intentId, transactionRef: 'initial-a', checkout: { token: 'a' } } });
    await lateSettled.promise;
    await observe('initial-a', 'sub-a', true);
    await observe('initial-b', 'sub-b', true, '02');
    await observe('renew-a', 'sub-a', false);
    await observe('renew-b', 'sub-b', false);
    const before = await read.readPurchase('buyer', intentId), basis = before?.intent.subscriptionBasisId; assert.ok(basis);
    assert.equal(before.transactions.filter(item => item.completion).length, 4);
    assert.ok(before.transactions.every(item => item.flags.includes('duplicate_initial_purchase')));
    const selection = await read.readSubscriptionSelection('buyer', basis, 'sub-b'); assert.ok(selection);
    const resolution = await processing.selectSubscriptionStream({ buyerId: 'buyer', bindingId: basis, providerSubscriptionRef: 'sub-b', expectedReadSet: selection.expectedReadSet, actorId: 'operator', auditRef: 'choose-sub-b', reason: 'choose duplicate support stream' });
    assert.equal(resolution.kind, 'succeeded');
    if (resolution.kind !== 'succeeded') throw new Error('Expected selected stream');
    assert.equal(resolution.value.selectedSubscriptionRef, 'sub-b');
    assert.deepEqual(resolution.value.streamSelection, { actorId: 'operator', auditRef: 'choose-sub-b', reason: 'choose duplicate support stream', at: '2026-01-01T00:00:00Z' });
    assert.equal((await processing.selectSubscriptionStream({ buyerId: 'buyer', bindingId: basis, providerSubscriptionRef: 'sub-b', expectedReadSet: selection.expectedReadSet, actorId: 'operator', auditRef: 'stale-selection', reason: 'stale read set' })).kind, 'rejected');
    assert.equal(await processing.flushPublication({ type: 'transaction', id: 'renew-b' }), 'committed');
    const after = await read.readPurchase('buyer', intentId); assert.ok(after);
    assert.equal(after.transactions.filter(item => item.completion).length, 4);
    assert.ok(!after.transactions.find(item => item.transactionRef === 'renew-b')?.flags.includes('duplicate_initial_purchase'));
    assert.ok(after.transactions.find(item => item.transactionRef === 'renew-a')?.flags.includes('duplicate_initial_purchase'));
    assert.equal(host.calls(), 2);
  } finally {
    // A failed assertion must not strand the deliberately held first provider call.
    first.resolve({ kind: 'succeeded', value: { intentId, transactionRef: 'initial-a', checkout: { token: 'a' } } });
    assert.equal((await attempt.control.close()).complete, true);
  }
  await assert.rejects(read.readSubscriptionSelection('buyer', 'basis', 'sub-b'));
  await assert.rejects(processing.selectSubscriptionStream({ buyerId: 'buyer', bindingId: 'basis', providerSubscriptionRef: 'sub-b', expectedReadSet: [], actorId: 'operator', auditRef: 'after-close', reason: 'scope closed' }));
});

const Diagnostics = defineContract<Readonly<{ healthy: boolean }>>()({ id: 'test/diagnostics', revision: 1 });
interface HostCapabilities extends PaymentsCapabilities, CapabilitiesOf<typeof Diagnostics> {}
const diagnosticsDeclaration = declareModule({
  moduleId: 'test/diagnostics', implementationId: 'test/diagnostics/default', owner: { authority: 'test', path: ['diagnostics'] },
  provides: [Diagnostics.provide()], slots: [Read.slot('payments', { kind: 'required' })],
});

test('a later factory failure leaves cleanup to Host control and preserves the construction journal', async () => {
  const host = fixture(); let released = 0;
  const failure = implement<HostCapabilities>()(diagnosticsDeclaration, async (_deps, { resources }) => {
    await resources.setup({ name: 'diagnostics-handle', setup: () => 1, cleanup: () => { released += 1; } });
    throw new Error('startup failed');
  }, scoped);
  const prepared = await assemblyFor<HostCapabilities>().prepare({ profileId: 'test/failed-startup', modules: [paymentsGroup, failure], inputs: { configuration: paymentsConfiguration }, roots: { diagnostics: failure } });
  assert.equal(prepared.status, 'prepared'); if (prepared.status !== 'prepared') throw new Error('Expected prepared composition');
  const attempt = createScope({ name: 'failed-startup' });
  const outcome = await prepared.prepared.run({ scope: attempt.resources, inputs: inputs(host.options) });
  assert.equal(outcome.status, 'failed'); assert.equal(released, 0);
  assert.deepEqual(outcome.created.map(entry => entry.implementationId), ['agent-teams/payments/runtime/default']);
  assert.equal((await attempt.control.close()).complete, true); assert.equal(released, 1); assert.equal(host.calls(), 0);
});

test('cancelled acquisition waits for physical setup and cleans its late resource before settlement', async () => {
  const host = fixture(), started = deferred<void>(), acquire = deferred<number>(); let released = 0;
  const pending = implement<HostCapabilities>()(diagnosticsDeclaration, async (_deps, { resources }) => {
    await resources.setup({ name: 'late-diagnostics', setup: () => { started.resolve(); return acquire.promise; }, cleanup: () => { released += 1; } });
    return { instance: { healthy: true }, capabilities: { [Diagnostics.id]: { healthy: true } } };
  }, scoped);
  const prepared = await assemblyFor<HostCapabilities>().prepare({ profileId: 'test/cancel-startup', modules: [paymentsGroup, pending], inputs: { configuration: paymentsConfiguration }, roots: { diagnostics: pending } });
  assert.equal(prepared.status, 'prepared'); if (prepared.status !== 'prepared') throw new Error('Expected prepared composition');
  const attempt = createScope({ name: 'cancel-startup' }), signal = new AbortController();
  const running = prepared.prepared.run({ signal: signal.signal, scope: attempt.resources, inputs: inputs(host.options) });
  await started.promise; signal.abort('host cancelled');
  const snapshot = await attempt.control.close({ abandon: AbortSignal.abort() });
  assert.equal(snapshot.complete, false); assert.equal(released, 0);
  acquire.resolve(1);
  const outcome = await running;
  assert.ok(outcome.status === 'cancelled' || (outcome.status === 'failed' && outcome.cancellation !== undefined));
  assert.equal((await attempt.control.close()).complete, true); assert.equal(released, 1); assert.equal(host.calls(), 0);
});

test('missing declared input fails preparation; invalid runtime configuration fails run without provider effects', async () => {
  const missing = await assemblyFor<PaymentsCapabilities>().prepare({ profileId: 'test/missing-input', modules: [paymentsGroup], roots: { payments: paymentsModule } });
  assert.equal(missing.status, 'failed');
  if (missing.status === 'failed') assert.equal(missing.error.code, 'assembly.prepare.unresolved-binding');
  const host = fixture(), prepared = await compose();
  assert.equal(prepared.status, 'prepared'); if (prepared.status !== 'prepared') throw new Error('Expected prepared composition');
  const attempt = createScope({ name: 'invalid-input' });
  const result = await prepared.prepared.run({ scope: attempt.resources, inputs: inputs({ ...host.options, producerNamespace: '' }) });
  assert.equal(result.status, 'failed'); assert.equal((await attempt.control.close()).complete, true); assert.equal(host.calls(), 0);
});

