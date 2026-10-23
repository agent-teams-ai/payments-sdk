import assert from 'node:assert/strict';
import test from 'node:test';
import { addMoney, assertIdentifier, assertScope, canonicalJson, compareTime, createPayments, digest, exactTime, money, type AdjustmentObservation, type CancellationOutcome, type JsonValue, type Observation, type EvidenceSource, type Field, type OfferSnapshot, type PaymentScope, type SubscriptionObservation, type TransactionObservation, type VerifiedInput } from '../../../dist/index.js';
import { compareEventIdentity, eventIdentityEvidence, mergeEventIdentityEvidence, objectVersionKey, processInput, publishEvidence, reduceObservation, MAX_OBJECT_VERSION_EVIDENCE_BYTES } from '../../../dist/store.js';
import { type PaymentProvider, type ProviderResult } from '../../../dist/provider.js';
import { MemoryPaymentStore } from '../../../dist/memory.js';

const scope: PaymentScope = { applicationId: 'app-a', provider: 'fake', paymentAccountId: 'merchant', environment: 'sandbox' };
const yes = <T>(value: T): Field<T> => ({ presence: 'known', value });
const unknown = { presence: 'unknown' } as const;
const at = '2026-01-01T00:00:00.000001Z';
const period = { startsAt: '2026-01-01T00:00:00Z', endsAt: '2026-02-01T00:00:00Z' };
function source(id: string): EvidenceSource { return { kind: 'authenticated_api', receiptId: id, representationDigest: digest(id), decoderVersion: '1', apiProfile: 'fake-v1' }; }
function offer(profile: 'one_time' | 'monthly' = 'one_time', allowZeroTotal = false): OfferSnapshot { return { applicationId: 'app-a', offerId: 'offer', version: 'v1', policyVersion: 'policy-v1', currency: 'USD', profile, allowZeroTotal, lines: [{ providerPriceRef: 'price', benefitSlotId: 'benefit', quantity: 1 }] }; }
function transaction(ref: string, receiptId: string, profile: 'one_time' | 'monthly' = 'one_time', extra: Partial<TransactionObservation> = {}): TransactionObservation {
  return { kind: 'transaction', transactionRef: ref, version: at, status: 'completed', statusMeaning: { kind: 'completed' }, origin: yes('api'), customerRef: yes('payer'), subscriptionRef: profile === 'monthly' ? yes('sub-a') : yes(null), intentCorrelation: unknown, currency: yes('USD'), total: yes(money('USD', '1000')), lines: yes([{ providerLineRef: `line-${ref}`, providerPriceRef: 'price', quantity: 1, amount: money('USD', '1000'), billingCycle: profile === 'monthly' ? yes({ interval: 'month', frequency: 1 }) : yes(null), trial: yes(false), proration: yes(false), period: profile === 'monthly' ? yes(period) : yes(null) }]), source: source(receiptId), ...extra };
}
function input(observation: Observation, adverseTransactionRef?: string): VerifiedInput {
  return { scope, inputId: observation.source.receiptId, source: observation.source, observation, retainedRepresentation: JSON.parse(canonicalJson(observation)) as VerifiedInput['retainedRepresentation'], ...((typeof adverseTransactionRef === 'string' && adverseTransactionRef.length > 0) ? { adverseTransactionRef } : {}) };
}
function acquired(observation: TransactionObservation | SubscriptionObservation): VerifiedInput {
  const { source: original, ...projection } = observation;
  const retainedRepresentation = { representationKind: 'fake_mapped_receipt', projection: JSON.parse(canonicalJson(projection)) as VerifiedInput['retainedRepresentation'], diagnostic: { retainedOnlyHere: 'full provider diagnostic' } };
  const acquiredSource = { ...original, kind: 'authenticated_api' as const, representationDigest: digest(retainedRepresentation) };
  return { scope, inputId: acquiredSource.receiptId, source: acquiredSource, observation: { ...observation, source: acquiredSource }, retainedRepresentation };
}
function deferred<T>() { let resolveDeferred!: (value: T) => void; const promise = new Promise<T>(resolve => { resolveDeferred = resolve; }); return { promise, resolve: resolveDeferred }; }
function setup(profile: 'one_time' | 'monthly' = 'one_time', allowZeroTotal = false, timeoutMs = 1000) {
  const store = new MemoryPaymentStore(); let counter = 0, calls = 0, currentOffer = offer(profile, allowZeroTotal);
  let create: PaymentProvider['createCheckout'] = async command => ({ kind: 'succeeded', value: { intentId: command.intentId, transactionRef: `tx-${calls}`, checkout: { token: `token-${calls}` } } });
  const provider: PaymentProvider = { scope, capabilities: { checkout: true, transactionRead: true, subscriptionRead: true, cancellation: [], paymentUpdate: false, customerManagement: false }, createCheckout: command => { calls += 1; return create(command); }, readTransaction: async () => ({ kind: 'unsupported', capability: 'test-read' }), readSubscription: async ref => ({ kind: 'succeeded', value: { kind: 'subscription', subscriptionRef: ref, version: at, status: yes('active'), customerRef: yes('payer'), scheduledChange: yes(null), currentPeriod: yes(period), collection: yes({ kind: 'automatic' }), items: yes([{ providerPriceRef: 'price', quantity: yes(1), billingCycle: yes({ interval: 'month', frequency: 1 }), trial: yes(false) }]), source: source(`authority-${ref}`) } }) };
  provider.readTransactionInput = async ref => { const result = await provider.readTransaction(ref); return result.kind === 'succeeded' ? { kind: 'succeeded', value: acquired(result.value) } : result; };
  provider.readSubscriptionInput = async ref => { const result = await provider.readSubscription(ref); return result.kind === 'succeeded' ? { kind: 'succeeded', value: acquired(result.value) } : result; };
  const payments = createPayments({ scope, producerNamespace: 'payments', provider, store, catalog: { resolveOffer: async () => currentOffer }, now: () => at, newId: () => `id-${++counter}`, operationTimeoutMs: timeoutMs });
  return { payments, store, provider, calls: () => calls, replaceCreate: (next: PaymentProvider['createCheckout']) => { create = next; }, replaceOffer: (next: OfferSnapshot) => { currentOffer = next; } };
}
async function purchase(context: ReturnType<typeof setup>) {
  const result = await context.payments.startPurchase({ buyerId: 'buyer', offerId: 'offer', requestKey: 'request' }); assert.equal(result.kind, 'succeeded');
   return result.value;
}
async function observe(context: ReturnType<typeof setup>, observation: Observation) {
  assert.equal((await context.payments.ingestVerifiedInput(input(observation))).kind, 'succeeded');
  assert.equal(await context.payments.processInbox(observation.source.receiptId), 'processed');
}

void test('minor-unit values retain arbitrary precision and reject implicit scaling or currency mixing', () => {
  assert.deepEqual(addMoney(money('JPY', '900719925474099312345'), money('JPY', '2')), { currency: 'JPY', minorUnits: '900719925474099312347' });
  assert.throws(() => money('USD', '1.2')); assert.throws(() => money('USD', '01')); assert.throws(() => money('USD', '-0'));
  assert.throws(() => addMoney(money('JPY', '1'), money('USD', '1')));
});

void test('runtime identifiers and scopes reject malformed values independently of TypeScript declarations', () => {
  for (const value of [undefined, null, 1, true, {}, [], '', 'control\u0000character', 'x'.repeat(257)]) {assert.throws(() => { assertIdentifier(value); }, TypeError);}
  assert.doesNotThrow(() => { assertIdentifier('receipt-🧾'); });
  for (const value of [undefined, null, {}, { ...scope, provider: 1 }, { ...scope, applicationId: '' }, { ...scope, environment: 'other' }]) {assert.throws(() => { assertScope(value); }, TypeError);}
  assert.doesNotThrow(() => { assertScope(scope); });
});

void test('provider version ordering preserves nanoseconds and timezone equivalence', () => {
  assert.equal(compareTime('2026-01-01T00:00:00.000000001Z', '2026-01-01T00:00:00.000000002Z'), -1);
  assert.equal(compareTime('2026-01-01T01:00:00.123456+01:00', '2026-01-01T00:00:00.123456000Z'), 0);
  assert.equal(exactTime(at).original, at); assert.throws(() => exactTime('2026-02-29T00:00:00Z')); assert.throws(() => exactTime('2026-01-01T00:00:00.1234567890Z'));
});

void test('request key repeats immutable order despite later catalog version; changed request conflicts', async () => {
  const context = setup(), checkout = await purchase(context);
  context.replaceOffer({ ...offer(), version: 'v2' });
  assert.deepEqual(await context.payments.startPurchase({ buyerId: 'buyer', offerId: 'offer', requestKey: 'request' }), { kind: 'succeeded', value: checkout });
  assert.deepEqual(await context.payments.startPurchase({ buyerId: 'buyer', offerId: 'different', requestKey: 'request' }), { kind: 'rejected', code: 'conflict' });
  assert.equal(context.calls(), 1);
  assert.equal((await context.payments.readPurchase('buyer', checkout.intentId))?.intent.offer.version, 'v1');
});

void test('unconfirmed dispatch commit cannot authorize SDK call; repair sends only a prepared operation', async () => {
  const context = setup(), original = context.store.beginExternalDispatch.bind(context.store); let reject = true;
  context.store.beginExternalDispatch = async (...args) => { if (reject) { reject = false; throw new Error('commit reply lost'); } return original(...args); };
  await assert.rejects(context.payments.startPurchase({ buyerId: 'buyer', offerId: 'offer', requestKey: 'request' }));
  assert.equal(context.calls(), 0); await context.payments.repair(); assert.equal(context.calls(), 1);
});

void test('unknown mutation is never automatically retried and late old success does not overwrite a new attempt', async () => {
  const context = setup('one_time', false, 1), first = deferred<ProviderResult<{ intentId: string; transactionRef: string; checkout: { token: string } }>>(); let firstIntent = '';
  context.replaceCreate(async command => { firstIntent = command.intentId; return first.promise; });
  const result = await context.payments.startPurchase({ buyerId: 'buyer', offerId: 'offer', requestKey: 'request' });
  assert.equal(result.kind, 'outcome_unknown');
  assert.equal(context.payments.lifecycle().unresolvedExternalCalls, 1);
  await context.payments.startPurchase({ buyerId: 'buyer', offerId: 'offer', requestKey: 'request' }); await context.payments.repair(); assert.equal(context.calls(), 1);
  const operation = await context.payments.readOperation(result.operationId); assert.ok(operation);
  assert.deepEqual(await context.payments.resolveUnknownOperation({ operationId: operation.operationId, expectedRevision: operation.revision, actorId: 'operator', auditRef: 'ticket', reason: 'reviewed', action: 'retry' }), { kind: 'rejected', code: 'validation' });
  const resolved = await context.payments.resolveUnknownOperation({ operationId: operation.operationId, expectedRevision: operation.revision, actorId: 'operator', auditRef: 'ticket', reason: 'reviewed', action: 'retry', acceptedDuplicateRisk: true }); assert.equal(resolved.kind, 'succeeded');
  context.replaceCreate(async command => ({ kind: 'succeeded', value: { intentId: command.intentId, transactionRef: 'new-tx', checkout: { token: 'new' } } }));
  assert.equal((await context.payments.executeOperation(operation.operationId)).kind, 'succeeded');
  first.resolve({ kind: 'succeeded', value: { intentId: firstIntent, transactionRef: 'old-tx', checkout: { token: 'old' } } }); await context.payments.drain();
  const final = await context.payments.readOperation(operation.operationId); assert.equal(final?.state, 'succeeded'); assert.equal(final.attempts.length, 2);
  assert.equal((final.result?.kind === 'succeeded' ? (final.result.value as { transactionRef: string }).transactionRef : ''), 'new-tx');
  assert.deepEqual((await context.payments.readPurchase('buyer', firstIntent))?.intent.transactionRefs.toSorted(), ['new-tx', 'old-tx']);
});

void test('normal API-only one-time completion can prove profile with unknown optional subscription/period', async () => {
  const context = setup(), checkout = await purchase(context), observation = transaction(checkout.transactionRef, 'api-only', 'one_time', { subscriptionRef: unknown });
  if (observation.lines.presence !== 'known') {throw new Error('Fixture');}
  await observe(context, { ...observation, lines: yes(observation.lines.value.map(line => ({ ...line, period: unknown }))) });
  const result = await context.payments.readPurchase('buyer', checkout.intentId);
  assert.equal(result?.transactions[0]?.completion?.classification, 'one_time'); assert.equal(result.transactions[0].completion.lines[0]?.benefitSlotId, 'benefit');
});

void test('zero-value commercial policy, management completion and trials remain distinct', async () => {
  for (const allowed of [false, true]) {
    const context = setup('one_time', allowed), checkout = await purchase(context);
    await observe(context, transaction(checkout.transactionRef, `zero-${allowed}`, 'one_time', { total: yes(money('USD', '0')) }));
    const aggregate = (await context.payments.readPurchase('buyer', checkout.intentId))?.transactions[0];
    assert.equal(aggregate?.completion !== undefined, allowed);
  }
  const management = setup(), checkout = await purchase(management);
  await observe(management, transaction(checkout.transactionRef, 'management', 'one_time', { origin: yes('subscription_payment_method_change'), total: yes(money('USD', '0')) }));
  assert.equal((await management.payments.readPurchase('buyer', checkout.intentId))?.transactions[0]?.completion, undefined);
  const trial = setup('monthly'), trialCheckout = await purchase(trial), trialObservation = transaction(trialCheckout.transactionRef, 'trial', 'monthly');
  if (trialObservation.lines.presence !== 'known') {throw new Error('Fixture');}
  await observe(trial, { ...trialObservation, lines: yes(trialObservation.lines.value.map(line => ({ ...line, trial: yes(true) }))) });
  assert.equal((await trial.payments.readPurchase('buyer', trialCheckout.intentId))?.transactions[0]?.completion, undefined);
});

void test('paid is intermediate; distinct source deliveries produce one immutable completion', async () => {
  const context = setup(), checkout = await purchase(context); await context.payments.registerConsumer('credits');
  await observe(context, transaction(checkout.transactionRef, 'paid', 'one_time', { status: 'paid', statusMeaning: { kind: 'not_completed' }, version: '2026-01-01T00:00:00Z' }));
  assert.equal((await context.payments.readPurchase('buyer', checkout.intentId))?.transactions[0]?.completion, undefined);
  await observe(context, transaction(checkout.transactionRef, 'completed'));
  const before = (await context.payments.readPurchase('buyer', checkout.intentId))?.transactions[0]?.completion;
  await observe(context, transaction(checkout.transactionRef, 'another-source'));
  assert.deepEqual((await context.payments.readPurchase('buyer', checkout.intentId))?.transactions[0]?.completion, before);
  const deliveries = await context.payments.readDeliveries('credits'); assert.ok(deliveries.length >= 2);
  assert.equal(new Set(deliveries.flatMap(message => message.kind === 'complete' && message.completion ? [message.completion.factId] : [])).size, 1);
});

void test('same-version compatible partial evidence upgrades; contradictory known evidence holds', async () => {
  const context = setup(), checkout = await purchase(context);
  await observe(context, transaction(checkout.transactionRef, 'partial', 'one_time', { customerRef: unknown }));
  await observe(context, transaction(checkout.transactionRef, 'full'));
  let aggregate = (await context.payments.readPurchase('buyer', checkout.intentId))?.transactions[0]; assert.ok(aggregate?.completion); assert.ok(!aggregate.flags.includes('conflict'));
  await observe(context, transaction(checkout.transactionRef, 'conflict', 'one_time', { total: yes(money('USD', '999')) }));
  aggregate = (await context.payments.readPurchase('buyer', checkout.intentId))?.transactions[0]; assert.ok(aggregate); assert.ok(aggregate.flags.includes('conflict')); assert.equal(aggregate.completion?.total.minorUnits, '1000');
});

void test('newer subscription unknown does not carry old scheduled change into current projection', async () => {
  const context = setup('monthly'), checkout = await purchase(context); await observe(context, transaction(checkout.transactionRef, 'initial', 'monthly'));
  const basis = (await context.payments.readPurchase('buyer', checkout.intentId))?.intent.subscriptionBasisId; assert.ok((typeof basis === 'string' && basis.length > 0));
  const subscription: SubscriptionObservation = { kind: 'subscription', subscriptionRef: 'sub-a', version: at, status: yes('active'), customerRef: yes('payer'), scheduledChange: yes({ action: 'cancel', effectiveAt: period.endsAt }), currentPeriod: yes(period), collection: yes({ kind: 'automatic' }), items: yes([{ providerPriceRef: 'price', quantity: yes(1), billingCycle: yes({ interval: 'month', frequency: 1 }), trial: yes(false) }]), source: source('scheduled') };
  await observe(context, subscription);
  await observe(context, { ...subscription, version: '2026-01-01T00:00:00.000002Z', scheduledChange: unknown, source: source('newer-incomplete') });
  await observe(context, { ...subscription, version: '2026-01-01T00:00:00Z', status: yes('canceled'), source: source('older-cancel') });
  const projected = (await context.payments.readObservedSubscription('buyer', basis))?.observations[0];
  assert.equal(projected?.current?.scheduledChange.presence, 'unknown'); assert.equal(projected.lastKnown?.scheduledChange.presence, 'known'); assert.ok(projected.flags.includes('incomplete'));
  assert.equal(projected.current.status.presence === 'known' ? projected.current.status.value : '', 'active');
});

void test('adverse T1 admission invalidates an already prepared completion reduction', async () => {
  const context = setup(), checkout = await purchase(context), observation = transaction(checkout.transactionRef, 'before-refund'); await context.payments.ingestVerifiedInput(input(observation));
  const prepared = await context.store.loadReductionInput(scope, observation.source.receiptId); assert.ok(prepared);
  const adjustmentSource = source('refund');
  await context.store.admitVerifiedInputs(scope, [{ scope, inputId: 'refund', source: adjustmentSource, retainedRepresentation: {}, adverseTransactionRef: checkout.transactionRef, observation: { kind: 'adjustment', transactionRef: checkout.transactionRef, adjustmentRef: 'adj', version: at, action: 'refund', status: 'approved', amount: money('USD', '-1000'), allocations: [], source: adjustmentSource } }]);
  assert.deepEqual(await context.store.commitReduction(scope, { inputId: prepared.inputId, state: prepared.state, expected: prepared.expected }), { kind: 'conflict' });
  await context.payments.processInbox(observation.source.receiptId);
  const aggregate = (await context.payments.readPurchase('buyer', checkout.intentId))?.transactions[0]; assert.deepEqual(aggregate?.pendingAdverse, ['refund']);
  await context.payments.processInbox('refund');
  assert.deepEqual((await context.payments.readPurchase('buyer', checkout.intentId))?.transactions[0]?.pendingAdverse, []);
});

void test('bounded evidence overflow publishes held control with original facts retained', async () => {
  const context = setup(), checkout = await purchase(context);
  const bounded = createPayments({ scope, producerNamespace: 'bounded', provider: context.provider, store: context.store, catalog: { resolveOffer: async () => offer() }, maxEvidenceBytes: 4096 });
  await bounded.registerConsumer('consumer');
  await bounded.ingestVerifiedInput(input(transaction(checkout.transactionRef, 'bounded-completion'))); await bounded.processInbox('bounded-completion');
  for (let index = 0; index < 12; index += 1) {
    const receipt = source(`adjust-${index}`);
    await bounded.ingestVerifiedInput({ scope, inputId: receipt.receiptId, source: receipt, retainedRepresentation: {}, adverseTransactionRef: checkout.transactionRef, observation: { kind: 'adjustment', adjustmentRef: `adjustment-${index}`, transactionRef: checkout.transactionRef, version: at, action: 'refund', status: 'pending_approval', amount: money('USD', '-1'), allocations: [], source: receipt } });
    await bounded.processInbox(receipt.receiptId);
  }
  const messages = await bounded.readDeliveries('consumer', 100), last = messages.at(-1); assert.equal(last?.kind, 'held'); assert.ok(Buffer.byteLength(canonicalJson(last)) <= 4096);
  const stored = await bounded.readPurchase('buyer', checkout.intentId); assert.equal(Object.keys(stored?.transactions[0]?.adjustments ?? {}).length, 12); assert.ok(stored?.transactions[0]?.completion);
});

void test('delivery identity includes digest and independent consumer acknowledgement', async () => {
  const context = setup(), checkout = await purchase(context); await context.payments.registerConsumer('a'); await context.payments.registerConsumer('b');
  await observe(context, transaction(checkout.transactionRef, 'delivery')); const message = (await context.payments.readDeliveries('a'))[0]; assert.ok(message);
  assert.equal(await context.payments.acknowledgeDelivery('a', message.messageId, 'wrong'), 'conflict');
  assert.equal(await context.payments.acknowledgeDelivery('a', message.messageId, message.bodyDigest), 'acknowledged');
  assert.equal(await context.payments.acknowledgeDelivery('a', message.messageId, message.bodyDigest), 'duplicate');
  assert.equal((await context.payments.readDeliveries('a')).length, 0); assert.equal((await context.payments.readDeliveries('b')).length, 1);
});

void test('scope, ownership, unsupported capability and recovery fence fail closed', async () => {
  const context = setup(), checkout = await purchase(context);
  assert.equal(await context.payments.readPurchase('other', checkout.intentId), undefined);
  assert.deepEqual(await context.payments.requestCancellation({ buyerId: 'buyer', bindingId: 'unknown', requestKey: 'cancel', timing: 'now' }), { kind: 'unsupported', capability: 'cancellation:now' });
  assert.equal((await context.payments.ingestVerifiedInput({ ...input(transaction(checkout.transactionRef, 'foreign')), scope: { ...scope, applicationId: 'other' } })).kind, 'rejected');
  await context.store.setRecoveryFence(scope, true, 'restore');
  assert.deepEqual(await context.payments.startPurchase({ buyerId: 'buyer', offerId: 'offer', requestKey: 'new' }), { kind: 'rejected', code: 'unavailable' }); assert.equal(context.calls(), 1);
});

void test('binding arriving after processed early completion reclassifies stored history through durable publication repair', async () => {
  const context = setup('one_time', false, 1), reply = deferred<ProviderResult<{ intentId: string; transactionRef: string; checkout: { token: string } }>>(); let intentId = '';
  context.replaceCreate(async command => { intentId = command.intentId; return reply.promise; });
  assert.equal((await context.payments.startPurchase({ buyerId: 'buyer', offerId: 'offer', requestKey: 'request' })).kind, 'outcome_unknown');
  await observe(context, transaction('early-tx', 'early-completed'));
  reply.resolve({ kind: 'succeeded', value: { intentId, transactionRef: 'early-tx', checkout: { token: 'ready' } } }); await context.payments.drain();
  assert.equal((await context.payments.readPurchase('buyer', intentId))?.transactions[0]?.completion, undefined);
  await context.payments.repair();
  const aggregate = (await context.payments.readPurchase('buyer', intentId))?.transactions[0]; assert.ok(aggregate?.completion); assert.ok(!aggregate.flags.includes('unresolved_binding'));
});

async function duplicateStreams() {
  const context = setup('monthly', false, 1), first = deferred<ProviderResult<{ intentId: string; transactionRef: string; checkout: { token: string } }>>(); let intentId = '';
  context.replaceCreate(async command => { intentId = command.intentId; return first.promise; });
  const unknownResult = await context.payments.startPurchase({ buyerId: 'buyer', offerId: 'offer', requestKey: 'request' }); assert.equal(unknownResult.kind, 'outcome_unknown');
  const operation = await context.payments.readOperation(unknownResult.operationId); assert.ok(operation);
  await context.payments.resolveUnknownOperation({ operationId: operation.operationId, expectedRevision: operation.revision, actorId: 'operator', auditRef: 'duplicate-risk', reason: 'recover', action: 'retry', acceptedDuplicateRisk: true });
  context.replaceCreate(async command => ({ kind: 'succeeded', value: { intentId: command.intentId, transactionRef: 'initial-b', checkout: { token: 'b' } } }));
  await context.payments.executeOperation(operation.operationId);
  first.resolve({ kind: 'succeeded', value: { intentId, transactionRef: 'initial-a', checkout: { token: 'a' } } }); await context.payments.drain();
  const basis = (await context.payments.readPurchase('buyer', intentId))?.intent.subscriptionBasisId; assert.ok((typeof basis === 'string' && basis.length > 0));
  return { context, intentId, basis };
}
async function selectStream(context: ReturnType<typeof setup>, bindingId: string, providerSubscriptionRef: string) {
  const selected = await context.payments.readSubscriptionSelection('buyer', bindingId, providerSubscriptionRef); assert.ok(selected);
  const resolution = await context.payments.selectSubscriptionStream({ buyerId: 'buyer', bindingId, providerSubscriptionRef, version: selected.version, actorId: 'operator', auditRef: `select-${providerSubscriptionRef}`, reason: 'choose duplicate support' }); assert.equal(resolution.kind, 'succeeded');
}

void test('late duplicate initial durably reclassifies an acknowledged renewal without rewriting completion or replaying receipt', async () => {
  const { context, intentId, basis } = await duplicateStreams();
  await observe(context, transaction('initial-a', 'initial-a-paid', 'monthly'));
  await context.payments.registerConsumer('stream-consumer');
  const renewal = transaction('renew-a', 'renew-a-paid', 'monthly', { origin: yes('subscription_recurring') });
  await observe(context, renewal);
  const before = (await context.payments.readPurchase('buyer', intentId))?.transactions.find(item => item.transactionRef === 'renew-a'); assert.ok(before?.completion); assert.deepEqual(before.flags, []);
  for (const message of await context.payments.readDeliveries('stream-consumer')) {await context.payments.acknowledgeDelivery('stream-consumer', message.messageId, message.bodyDigest);}
  await observe(context, transaction('initial-b', 'initial-b-paid', 'monthly', { subscriptionRef: yes('sub-b') }));
  assert.deepEqual(await context.store.listWork(scope, 'reclassification', 10), [basis]);
  context.payments = createPayments({ scope, producerNamespace: 'payments', provider: context.provider, store: context.store, catalog: { resolveOffer: async () => offer('monthly') } });
  await context.payments.repair();
  const after = (await context.payments.readPurchase('buyer', intentId))?.transactions.find(item => item.transactionRef === 'renew-a'); assert.ok(after); assert.ok(after.flags.includes('duplicate_initial_purchase')); assert.ok(after.evidenceRevision > before.evidenceRevision); assert.deepEqual(after.completion, before.completion);
  const corrected = (await context.payments.readDeliveries('stream-consumer')).find(message => message.aggregate.id === 'renew-a'); assert.ok(corrected?.kind === 'complete'); assert.ok(corrected.flags.includes('duplicate_initial_purchase'));
  for (const message of await context.payments.readDeliveries('stream-consumer')) {await context.payments.acknowledgeDelivery('stream-consumer', message.messageId, message.bodyDigest);}
  await context.payments.ingestVerifiedInput(input(renewal)); assert.equal(await context.payments.processInbox(renewal.source.receiptId), 'duplicate'); await context.payments.repair();
  assert.equal((await context.payments.readDeliveries('stream-consumer')).length, 0);
  assert.deepEqual(await context.store.listWork(scope, 'reclassification', 10), []);
});

void test('bounded stream selection traversal restarts on reselection and new members classify against the current decision', async () => {
  const { context, intentId, basis } = await duplicateStreams();
  await observe(context, transaction('initial-a', 'initial-a-paid', 'monthly'));
  await observe(context, transaction('initial-b', 'initial-b-paid', 'monthly', { subscriptionRef: yes('sub-b') }));
  for (const ref of ['renew-a', 'renew-b', 'renew-c', 'renew-d']) {await observe(context, transaction(ref, `${ref}-paid`, 'monthly', { origin: yes('subscription_recurring'), subscriptionRef: yes('sub-b') }));}
  await context.payments.repair();
  const before = (await context.payments.readPurchase('buyer', intentId))?.transactions.find(item => item.transactionRef === 'renew-b'); assert.ok(before?.completion); assert.ok(before.flags.includes('duplicate_initial_purchase'));
  const stale = await context.payments.readSubscriptionSelection('buyer', basis, 'sub-a'); assert.ok(stale);
  await selectStream(context, basis, 'sub-b');
  const rejected = await context.payments.selectSubscriptionStream({ buyerId: 'buyer', bindingId: basis, providerSubscriptionRef: 'sub-a', version: stale.version, actorId: 'operator', auditRef: 'stale', reason: 'stale decision' }); assert.deepEqual(rejected, { kind: 'rejected', code: 'conflict' });
  const snapshot = await context.store.loadPublicationInput(scope, { type: 'subscription', id: 'sub-b' }); assert.ok(snapshot);
  const decision = snapshot.state.subscriptionBindings[basis]?.classificationDecision?.revision; assert.ok((decision !== undefined && decision !== 0 && !Number.isNaN(decision)));
  assert.equal(await context.payments.processReclassification(basis, 2), 'committed');
  const pending = await context.store.listWork(scope, 'publication', 100); assert.equal(pending.length, 2);
  const cursor = (await context.store.loadPublicationInput(scope, { type: 'subscription', id: 'sub-b' }))?.state.reclassifications[basis]; assert.equal(cursor?.complete, false); assert.equal(cursor.decisionRevision, decision);
  // A new lexically earlier member is already behind the durable cursor; current binding classification is sufficient.
  await observe(context, transaction('00-new-renewal-b', 'new-member-paid', 'monthly', { origin: yes('subscription_recurring'), subscriptionRef: yes('sub-b') }));
  assert.deepEqual((await context.payments.readPurchase('buyer', intentId))?.transactions.find(item => item.transactionRef === '00-new-renewal-b')?.flags, []);
  for (let page = 0; page < 5 && (await context.store.listWork(scope, 'reclassification', 10)).length > 0; page += 1) {await context.payments.repair(2);}
  for (let page = 0; page < 5 && (await context.store.listWork(scope, 'publication', 10)).length > 0; page += 1) {await context.payments.repair(2);}
  const selected = (await context.payments.readPurchase('buyer', intentId))?.transactions.find(item => item.transactionRef === 'renew-b'); assert.ok(selected); assert.deepEqual(selected.flags, []); assert.deepEqual(selected.completion, before.completion);
  const inflight = transaction('01-inflight-renewal-b', 'inflight-member', 'monthly', { origin: yes('subscription_recurring'), subscriptionRef: yes('sub-b') });
  await context.payments.ingestVerifiedInput(input(inflight));
  const staleReduction = await context.store.loadReductionInput(scope, inflight.source.receiptId); assert.ok(staleReduction);
  await selectStream(context, basis, 'sub-a');
  processInput(staleReduction.state, scope, inflight.source.receiptId);
  assert.equal((await context.store.commitReduction(scope, { inputId: staleReduction.inputId, expected: staleReduction.expected, state: staleReduction.state })).kind, 'conflict');
  assert.equal(await context.payments.processInbox(inflight.source.receiptId), 'processed');
  assert.ok(((await context.payments.readPurchase('buyer', intentId))?.transactions.find(item => item.transactionRef === inflight.transactionRef)?.flags.includes('duplicate_initial_purchase') === true));
  const reset = (await context.store.loadPublicationInput(scope, { type: 'subscription', id: 'sub-a' }))?.state.reclassifications[basis]; assert.equal(reset?.afterTransactionRef, undefined); assert.ok((reset?.decisionRevision ?? 0) > decision);
  await context.payments.repair();
  const deselected = (await context.payments.readPurchase('buyer', intentId))?.transactions.find(item => item.transactionRef === 'renew-b'); assert.ok(deselected); assert.ok(deselected.flags.includes('duplicate_initial_purchase')); assert.ok(deselected.evidenceRevision > selected.evidenceRevision); assert.deepEqual(deselected.completion, before.completion);
  const initials = (await context.payments.readPurchase('buyer', intentId))?.transactions.filter(item => item.completion?.classification === 'initial'); assert.equal(initials?.length, 2); assert.ok(initials.every(item => item.flags.includes('duplicate_initial_purchase')));
});

void test('shutdown tracks physical safe reads and cleanup, including nested producer promises', async () => {
  const context = setup(), checkout = await purchase(context), read = deferred<ProviderResult<TransactionObservation>>();
  context.provider.readTransaction = async () => read.promise;
  const refreshing = context.payments.refreshPurchase('buyer', checkout.intentId);
  assert.equal(context.payments.stop().pendingWork, 1);
  let drained = false; const drain = context.payments.drain().then(() => { drained = true; return; });
  await Promise.resolve(); assert.equal(drained, false);
  read.resolve({ kind: 'succeeded', value: transaction(checkout.transactionRef, 'drained-read') }); await refreshing; await drain; assert.equal(drained, true);
});

void test('unknown final line profile is incomplete and a fuller same-version receipt positively recovers', async () => {
  const context = setup(), checkout = await purchase(context), observation = transaction(checkout.transactionRef, 'partial-line');
  if (observation.lines.presence !== 'known') {throw new Error('Fixture');}
  await observe(context, { ...observation, lines: yes(observation.lines.value.map(line => ({ ...line, trial: unknown, proration: unknown, billingCycle: unknown }))) });
  let aggregate = (await context.payments.readPurchase('buyer', checkout.intentId))?.transactions[0]; assert.ok(aggregate); assert.ok(aggregate.flags.includes('incomplete')); assert.ok(!aggregate.flags.includes('catalog_mismatch'));
  await observe(context, transaction(checkout.transactionRef, 'full-line'));
  aggregate = (await context.payments.readPurchase('buyer', checkout.intentId))?.transactions[0]; assert.ok(aggregate?.completion); assert.ok(!aggregate.flags.includes('incomplete')); assert.ok(!aggregate.flags.includes('catalog_mismatch'));
});

void test('late success before an authorized retry is dispatched prevents a gratuitous second create', async () => {
  const context = setup('one_time', false, 1), reply = deferred<ProviderResult<{ intentId: string; transactionRef: string; checkout: { token: string } }>>(); let intentId = '';
  context.replaceCreate(async command => { intentId = command.intentId; return reply.promise; });
  const unknownResult = await context.payments.startPurchase({ buyerId: 'buyer', offerId: 'offer', requestKey: 'request' }); assert.equal(unknownResult.kind, 'outcome_unknown');
  const operation = await context.payments.readOperation(unknownResult.operationId); assert.ok(operation);
  await context.payments.resolveUnknownOperation({ operationId: operation.operationId, expectedRevision: operation.revision, actorId: 'operator', auditRef: 'risk', reason: 'retry authorized', action: 'retry', acceptedDuplicateRisk: true });
  reply.resolve({ kind: 'succeeded', value: { intentId, transactionRef: 'proven-existing', checkout: { token: 'existing' } } }); await context.payments.drain();
  assert.equal((await context.payments.executeOperation(operation.operationId)).kind, 'succeeded'); assert.equal(context.calls(), 1);
});

void test('payment update recovers the original recurring period and method updates remain noncommercial', async () => {
  const context = setup('monthly'), checkout = await purchase(context); await observe(context, transaction(checkout.transactionRef, 'monthly-initial', 'monthly'));
  const basis = (await context.payments.readPurchase('buyer', checkout.intentId))?.intent.subscriptionBasisId; assert.ok((typeof basis === 'string' && basis.length > 0));
  const renewal = transaction('failed-renewal', 'renewal-failed', 'monthly', { status: 'past_due', statusMeaning: { kind: 'not_completed' }, origin: yes('subscription_recurring'), version: '2026-02-01T00:00:00Z' });
  if (renewal.lines.presence !== 'known') {throw new Error('Fixture');}
  const renewalLines = renewal.lines.value.map(line => ({ ...line, period: yes({ startsAt: '2026-02-01T00:00:00Z', endsAt: '2026-03-01T00:00:00Z' }) }));
  await observe(context, { ...renewal, lines: yes(renewalLines) });
  Object.assign(context.provider.capabilities, { paymentUpdate: true });
  context.provider.openPaymentUpdate = async command => ({ kind: 'succeeded', value: { intentId: command.intentId, transactionRef: 'failed-renewal', purpose: 'recovery', checkout: { token: 'recover' } } });
  const ready = await context.payments.openPaymentUpdate({ buyerId: 'buyer', bindingId: basis, requestKey: 'recover' }); assert.equal(ready.kind, 'succeeded'); {assert.equal(ready.value.purpose, 'recovery');}
  await observe(context, { ...renewal, lines: yes(renewalLines), status: 'completed', statusMeaning: { kind: 'completed' }, version: '2026-02-02T00:00:00Z', source: source('renewal-recovered') });
  const fact = (await context.payments.readPurchase('buyer', checkout.intentId))?.transactions.find(item => item.transactionRef === 'failed-renewal')?.completion;
  assert.equal(fact?.classification, 'recovery'); assert.equal(fact.lines[0]?.period?.startsAt, '2026-02-01T00:00:00Z');
  context.provider.openPaymentUpdate = async command => ({ kind: 'succeeded', value: { intentId: command.intentId, transactionRef: 'method-change', purpose: 'payment_method', checkout: { token: 'method' } } });
  assert.equal((await context.payments.openPaymentUpdate({ buyerId: 'buyer', bindingId: basis, requestKey: 'method' })).kind, 'succeeded');
  await observe(context, transaction('method-change', 'method-completed', 'monthly', { origin: yes('subscription_payment_method_change'), total: yes(money('USD', '0')) }));
  assert.equal((await context.payments.readPurchase('buyer', checkout.intentId))?.transactions.find(item => item.transactionRef === 'method-change')?.completion, undefined);
});

void test('conflicting raw event identity holds its original route even when the conflicting payload changes transaction', async () => {
  const context = setup(), checkout = await purchase(context);
  const raw = (receiptId: string, stableEnvelopeDigest: string): EvidenceSource => ({ ...source(receiptId), kind: 'verified_webhook', eventId: 'same-event', stableEnvelopeDigest, verification: { verifiedAt: at, endpointId: 'endpoint', rawBodyDigest: digest(receiptId) } });
  const first = transaction(checkout.transactionRef, 'raw-a', 'one_time', { source: raw('raw-a', 'body-a') }); await observe(context, first);
  const conflicting = transaction('different-transaction', 'raw-b', 'one_time', { source: raw('raw-b', 'body-b') });
  assert.equal((await context.payments.ingestVerifiedInput(input(conflicting))).kind, 'succeeded');
  assert.equal(await context.payments.processInbox('raw-b'), 'quarantined');
  assert.ok(((await context.payments.readPurchase('buyer', checkout.intentId))?.transactions[0]?.flags.includes('conflict') === true));
});

async function duplicateMonthly() {
  const context = setup('monthly', false, 1), first = deferred<ProviderResult<{ intentId: string; transactionRef: string; checkout: { token: string } }>>(); let intentId = '';
  context.replaceCreate(async command => { intentId = command.intentId; return first.promise; });
  const pending = await context.payments.startPurchase({ buyerId: 'buyer', offerId: 'offer', requestKey: 'request' }); assert.equal(pending.kind, 'outcome_unknown');
  const operation = await context.payments.readOperation(pending.operationId); assert.ok(operation);
  assert.equal((await context.payments.resolveUnknownOperation({ operationId: operation.operationId, expectedRevision: operation.revision, actorId: 'operator', auditRef: 'duplicate-risk', reason: 'reviewed retry', action: 'retry', acceptedDuplicateRisk: true })).kind, 'succeeded');
  context.replaceCreate(async command => ({ kind: 'succeeded', value: { intentId: command.intentId, transactionRef: 'initial-b', checkout: { token: 'b' } } }));
  assert.equal((await context.payments.executeOperation(operation.operationId)).kind, 'succeeded');
  first.resolve({ kind: 'succeeded', value: { intentId, transactionRef: 'initial-a', checkout: { token: 'a' } } }); await context.payments.drain();
  await observe(context, transaction('initial-a', 'duplicate-initial-a', 'monthly'));
  await observe(context, transaction('initial-b', 'duplicate-initial-b', 'monthly', { subscriptionRef: yes('sub-b') }));
  const basis = (await context.payments.readPurchase('buyer', intentId))?.intent.subscriptionBasisId; assert.ok((typeof basis === 'string' && basis.length > 0));
  return { ...context, basis, intentId };
}

void test('audited cancellation retry preserves its pinned provider subject across independent stream selection', async () => {
  const context = await duplicateMonthly(), old = deferred<ProviderResult<{ kind: 'applied'; observedStatus: string }>>(), targets: string[] = [];
  Object.assign(context.provider.capabilities, { cancellation: ['now'] });
  context.provider.cancelSubscription = async command => { targets.push(command.subscriptionRef); return targets.length === 1 ? old.promise : { kind: 'succeeded', value: { kind: 'applied', observedStatus: 'canceled' } }; };
  const result = await context.payments.requestCancellation({ buyerId: 'buyer', bindingId: context.basis, requestKey: 'pinned-cancel', timing: 'now' }); assert.equal(result.kind, 'outcome_unknown');
  const selection = await context.payments.readSubscriptionSelection('buyer', context.basis, 'sub-b'); assert.ok(selection);
  assert.equal((await context.payments.selectSubscriptionStream({ buyerId: 'buyer', bindingId: context.basis, providerSubscriptionRef: 'sub-b', version: selection.version, actorId: 'operator', auditRef: 'select-b', reason: 'choose stream' })).kind, 'succeeded');
  const operation = await context.payments.readOperation(result.operationId); assert.ok(operation);
  assert.equal((await context.payments.resolveUnknownOperation({ operationId: operation.operationId, expectedRevision: operation.revision, actorId: 'operator', auditRef: 'retry-a', reason: 'retry same command', action: 'retry', acceptedDuplicateRisk: true })).kind, 'succeeded');
  assert.equal((await context.payments.executeOperation(operation.operationId)).kind, 'succeeded');
  assert.deepEqual(targets, ['sub-a', 'sub-a']);
  const saved = await context.payments.readOperation(operation.operationId); assert.equal(saved?.providerSubscriptionRef, 'sub-a'); assert.deepEqual(saved.attempts.map(attempt => attempt.providerSubscriptionRef), ['sub-a', 'sub-a']); assert.equal(new Set(saved.attempts.map(attempt => attempt.fingerprint)).size, 1);
  old.resolve({ kind: 'outcome_unknown' }); await context.payments.drain();
});

void test('cancellation timing constrains provider and audited success before releasing the unresolved mutation lane', async () => {
  for (const timing of ['now', 'period_end'] as const) {
    const context = setup('monthly'), checkout = await purchase(context);
    await observe(context, transaction(checkout.transactionRef, `cancellation-timing-${timing}`, 'monthly'));
    const bindingId = (await context.payments.readPurchase('buyer', checkout.intentId))?.intent.subscriptionBasisId; assert.ok(typeof bindingId === 'string' && bindingId.length > 0);
    Object.assign(context.provider.capabilities, { cancellation: ['now', 'period_end'] });
    const scheduled: CancellationOutcome = { kind: 'scheduled', effectiveAt: period.endsAt };
    // Terminal status interpretation belongs to this provider; core checks the requested timing.
    const applied: CancellationOutcome = { kind: 'applied', observedStatus: 'provider-terminal-state' };
    const matching = timing === 'now' ? applied : scheduled, mismatched = timing === 'now' ? scheduled : applied;
    let dispatches = 0;
    context.provider.cancelSubscription = async () => { dispatches += 1; return { kind: 'succeeded', value: mismatched }; };
    const command = { buyerId: 'buyer', bindingId, requestKey: `cancel-${timing}`, timing };
    const unknownResult = await context.payments.requestCancellation(command); assert.equal(unknownResult.kind, 'outcome_unknown');
    const operation = await context.payments.readOperation(unknownResult.operationId); assert.ok(operation);
    assert.equal(operation.state, 'outcome_unknown'); assert.equal(operation.result, undefined);
    assert.deepEqual(operation.attempts[0]?.observations, [{ kind: 'succeeded', value: mismatched }]);
    assert.equal(dispatches, 1);

    const waiting = await context.payments.requestCancellation({ ...command, requestKey: `waiting-${timing}` }); assert.equal(waiting.kind, 'pending');
    assert.equal((await context.payments.readOperation(waiting.operationId))?.attempts.length, 0);
    assert.equal(dispatches, 1, 'a mismatched provider success must retain the mutation lane');
    const audit = { operationId: operation.operationId, expectedRevision: operation.revision, actorId: 'operator', auditRef: `timing-proof-${timing}`, reason: 'reviewed cancellation evidence', action: 'bind_outcome' as const };
    assert.deepEqual(await context.payments.resolveUnknownOperation({ ...audit, outcome: { kind: 'succeeded', value: mismatched } }), { kind: 'rejected', code: 'validation' });
    assert.deepEqual(await context.payments.readOperation(operation.operationId), operation, 'invalid audit must not change the operation or append an audit');
    assert.equal((await context.payments.executeOperation(waiting.operationId)).kind, 'pending');
    assert.equal(dispatches, 1, 'a rejected audit must not release the unresolved lane');

    assert.equal((await context.payments.resolveUnknownOperation({ ...audit, outcome: { kind: 'succeeded', value: matching } })).kind, 'succeeded');
    assert.deepEqual(await context.payments.requestCancellation(command), { kind: 'succeeded', value: matching });
    const resolved = await context.payments.readOperation(operation.operationId); assert.equal(resolved?.audits.length, 1);
    assert.deepEqual(resolved.attempts, operation.attempts, 'resolution preserves the mismatched provider response as attempt evidence');
    context.provider.cancelSubscription = async () => { dispatches += 1; return { kind: 'succeeded', value: matching }; };
    assert.deepEqual(await context.payments.executeOperation(waiting.operationId), { kind: 'succeeded', value: matching });
    assert.equal(dispatches, 2, 'matching audited evidence releases the lane for the waiting command');
  }
});

void test('audited payment update retry preserves its pinned provider subject across independent stream selection', async () => {
  const context = await duplicateMonthly(), old = deferred<ProviderResult<{ intentId: string; transactionRef: string; purpose: 'payment_method'; checkout: { token: string } }>>(), targets: string[] = [];
  Object.assign(context.provider.capabilities, { paymentUpdate: true });
  context.provider.openPaymentUpdate = async command => { targets.push(command.subscriptionRef); return targets.length === 1 ? old.promise : { kind: 'succeeded', value: { intentId: command.intentId, transactionRef: 'update-a', purpose: 'payment_method', checkout: { token: 'method' } } }; };
  const result = await context.payments.openPaymentUpdate({ buyerId: 'buyer', bindingId: context.basis, requestKey: 'pinned-update' }); assert.equal(result.kind, 'outcome_unknown');
  const selection = await context.payments.readSubscriptionSelection('buyer', context.basis, 'sub-b'); assert.ok(selection);
  assert.equal((await context.payments.selectSubscriptionStream({ buyerId: 'buyer', bindingId: context.basis, providerSubscriptionRef: 'sub-b', version: selection.version, actorId: 'operator', auditRef: 'select-b', reason: 'choose stream' })).kind, 'succeeded');
  const operation = await context.payments.readOperation(result.operationId); assert.ok(operation);
  assert.equal((await context.payments.resolveUnknownOperation({ operationId: operation.operationId, expectedRevision: operation.revision, actorId: 'operator', auditRef: 'retry-a', reason: 'retry same command', action: 'retry', acceptedDuplicateRisk: true })).kind, 'succeeded');
  assert.equal((await context.payments.executeOperation(operation.operationId)).kind, 'succeeded');
  assert.deepEqual(targets, ['sub-a', 'sub-a']); assert.equal((await context.payments.readOperation(operation.operationId))?.providerSubscriptionRef, 'sub-a');
  old.resolve({ kind: 'outcome_unknown' }); await context.payments.drain();
});

void test('public refresh preserves exact acquired receipts and honestly rejects providers without custody capability', async () => {
  const context = setup('monthly'), checkout = await purchase(context), transactionReceipt = acquired(transaction(checkout.transactionRef, 'full-provider-transaction', 'monthly'));
  context.provider.readTransactionInput = async () => ({ kind: 'succeeded', value: transactionReceipt });
  assert.deepEqual(await context.payments.refreshPurchase('buyer', checkout.intentId), { kind: 'succeeded', value: 1 });
  const storedTransaction = await context.store.loadReductionInput(scope, transactionReceipt.inputId); assert.ok(storedTransaction);
  assert.deepEqual(storedTransaction.state.inbox[transactionReceipt.inputId]?.input, transactionReceipt);
  assert.equal(digest(storedTransaction.state.inbox[transactionReceipt.inputId]?.input.retainedRepresentation), transactionReceipt.source.representationDigest);
  const basis = (await context.payments.readPurchase('buyer', checkout.intentId))?.intent.subscriptionBasisId; assert.ok((typeof basis === 'string' && basis.length > 0));
  const subscriptionReceipt = acquired({ kind: 'subscription', subscriptionRef: 'sub-a', version: at, status: yes('active'), customerRef: yes('payer'), currentPeriod: yes(period), scheduledChange: yes(null), collection: yes({ kind: 'automatic' }), items: yes([{ providerPriceRef: 'price', quantity: yes(1), billingCycle: yes({ interval: 'month', frequency: 1 }), trial: yes(false) }]), source: source('full-provider-subscription') });
  context.provider.readSubscriptionInput = async () => ({ kind: 'succeeded', value: subscriptionReceipt });
  assert.deepEqual(await context.payments.refreshSubscription('buyer', basis), { kind: 'succeeded', value: 1 });
  assert.deepEqual((await context.store.loadReductionInput(scope, subscriptionReceipt.inputId))?.state.inbox[subscriptionReceipt.inputId]?.input, subscriptionReceipt);
  assert.equal((await context.payments.ingestVerifiedInput(transactionReceipt)).kind, 'succeeded');
  assert.deepEqual((await context.store.loadReductionInput(scope, transactionReceipt.inputId))?.state.inbox[transactionReceipt.inputId]?.input, transactionReceipt);
  delete context.provider.readTransactionInput; delete context.provider.readSubscriptionInput;
  context.provider.readTransaction = async () => { throw new Error('Neutral read must not masquerade as custody'); };
  assert.deepEqual(await context.payments.refreshPurchase('buyer', checkout.intentId), { kind: 'unsupported', capability: 'transaction_evidence_acquisition' });
  assert.deepEqual(await context.payments.refreshSubscription('buyer', basis), { kind: 'unsupported', capability: 'subscription_evidence_acquisition' });
});

void test('refresh rejects a substituted body under an otherwise valid receipt digest', async () => {
  const context = setup(), checkout = await purchase(context), receipt = acquired(transaction(checkout.transactionRef, 'digest-substitution'));
  context.provider.readTransactionInput = async () => ({ kind: 'succeeded', value: { ...receipt, retainedRepresentation: {} } });
  assert.deepEqual(await context.payments.refreshPurchase('buyer', checkout.intentId), { kind: 'rejected', code: 'validation' });
  assert.equal(await context.store.loadReductionInput(scope, receipt.inputId), undefined);
});

void test('known subscription customer mismatch blocks both mutations without reusing historical ownership', async () => {
  const context = setup('monthly'), checkout = await purchase(context); await observe(context, transaction(checkout.transactionRef, 'ownership-initial', 'monthly'));
  const basis = (await context.payments.readPurchase('buyer', checkout.intentId))?.intent.subscriptionBasisId; assert.ok((typeof basis === 'string' && basis.length > 0));
  await observe(context, { kind: 'subscription', subscriptionRef: 'sub-a', version: '2026-01-02T00:00:00Z', status: yes('active'), customerRef: yes('other-payer'), scheduledChange: yes(null), currentPeriod: yes(period), collection: yes({ kind: 'automatic' }), items: yes([{ providerPriceRef: 'price', quantity: yes(1), billingCycle: yes({ interval: 'month', frequency: 1 }), trial: yes(false) }]), source: source('ownership-changed') });
  let cancellations = 0, updates = 0;
  Object.assign(context.provider.capabilities, { cancellation: ['now'], paymentUpdate: true });
  context.provider.cancelSubscription = async () => { cancellations += 1; return { kind: 'succeeded', value: { kind: 'applied', observedStatus: 'canceled' } }; };
  context.provider.openPaymentUpdate = async command => { updates += 1; return { kind: 'succeeded', value: { intentId: command.intentId, transactionRef: 'must-not-create', purpose: 'payment_method', checkout: {} } }; };
  assert.deepEqual(await context.payments.requestCancellation({ buyerId: 'buyer', bindingId: basis, requestKey: 'wrong-owner-cancel', timing: 'now' }), { kind: 'rejected', code: 'ownership_mismatch' });
  assert.deepEqual(await context.payments.openPaymentUpdate({ buyerId: 'buyer', bindingId: basis, requestKey: 'wrong-owner-update' }), { kind: 'rejected', code: 'ownership_mismatch' });
  assert.equal(cancellations, 0); assert.equal(updates, 0);
  const projection = await context.payments.readObservedSubscription('buyer', basis); assert.equal(projection?.binding.customerRef, 'payer'); assert.ok((projection.observations[0]?.flags.includes('ownership_mismatch') === true));
});

void test('authority read set fences a customer mismatch committed between preflight and dispatch marker', async () => {
  const context = setup('monthly'), checkout = await purchase(context); await observe(context, transaction(checkout.transactionRef, 'interleave-initial', 'monthly'));
  const basis = (await context.payments.readPurchase('buyer', checkout.intentId))?.intent.subscriptionBasisId; assert.ok((typeof basis === 'string' && basis.length > 0));
  Object.assign(context.provider.capabilities, { cancellation: ['now'] }); let mutations = 0;
  context.provider.cancelSubscription = async () => { mutations += 1; return { kind: 'succeeded', value: { kind: 'applied', observedStatus: 'canceled' } }; };
  const original = context.store.beginExternalDispatch.bind(context.store); let inject = true;
  context.store.beginExternalDispatch = async (paymentScope, commit) => {
    if (inject && commit.operation.kind === 'cancellation') {
      inject = false; assert.ok((commit.expectedReadSet?.some(row => row.table === 'subscriptions' && row.id === 'sub-a') === true));
      await observe(context, { kind: 'subscription', subscriptionRef: 'sub-a', version: '2026-01-02T00:00:00Z', status: yes('active'), customerRef: yes('changed-after-preflight'), scheduledChange: yes(null), currentPeriod: yes(period), collection: yes({ kind: 'automatic' }), items: yes([{ providerPriceRef: 'price', quantity: yes(1), billingCycle: yes({ interval: 'month', frequency: 1 }), trial: yes(false) }]), source: source('interleaved-mismatch') });
    }
    return original(paymentScope, commit);
  };
  const result = await context.payments.requestCancellation({ buyerId: 'buyer', bindingId: basis, requestKey: 'interleaved-cancel', timing: 'now' }); assert.equal(result.kind, 'pending'); assert.equal(mutations, 0);
  const operation = await context.store.findRequest(scope, 'buyer', 'interleaved-cancel'); assert.equal(operation?.state, 'prepared'); assert.equal(operation.attempts.length, 0);
  assert.deepEqual(await context.payments.executeOperation(operation.operationId), { kind: 'rejected', code: 'ownership_mismatch' }); assert.equal(mutations, 0);
});

void test('billing eligibility holds do not remove proven authority to cancel, and failed preflight never dispatches', async () => {
  const context = await duplicateMonthly(); Object.assign(context.provider.capabilities, { cancellation: ['now'] }); let mutations = 0;
  context.provider.cancelSubscription = async () => { mutations += 1; return { kind: 'succeeded', value: { kind: 'applied', observedStatus: 'canceled' } }; };
  context.provider.readSubscription = async ref => ({ kind: 'succeeded', value: { kind: 'subscription', subscriptionRef: ref, version: at, status: yes('paused'), customerRef: yes('payer'), scheduledChange: unknown, currentPeriod: unknown, collection: yes({ kind: 'automatic' }), items: yes([{ providerPriceRef: 'different-price', quantity: yes(1), billingCycle: yes({ interval: 'month', frequency: 1 }), trial: yes(false) }]), source: source('held-but-owned') } });
  assert.equal((await context.payments.requestCancellation({ buyerId: 'buyer', bindingId: context.basis, requestKey: 'owned-held-cancel', timing: 'now' })).kind, 'succeeded'); assert.equal(mutations, 1);
  const current = await context.payments.readObservedSubscription('buyer', context.basis); assert.ok((current?.observations.find(row => row.subscriptionRef === 'sub-a')?.flags.includes('unsupported') === true));
  context.provider.readSubscriptionInput = async () => ({ kind: 'outcome_unknown' });
  assert.deepEqual(await context.payments.requestCancellation({ buyerId: 'buyer', bindingId: context.basis, requestKey: 'unavailable-preflight', timing: 'now' }), { kind: 'rejected', code: 'unavailable' });
  assert.equal(mutations, 1); const unknownOperation = await context.store.findRequest(scope, 'buyer', 'unavailable-preflight'); assert.equal(unknownOperation?.attempts.length, 0);
});

function eventSource(id: string, kind: EvidenceSource['kind'], extra: Partial<EvidenceSource> = {}): EvidenceSource {
  return { ...source(id), kind, eventId: 'shared-event', eventType: 'transaction.completed', occurredAt: at,
    ...(kind === 'verified_webhook' ? { stableEnvelopeDigest: 'certified-raw-stable', verification: { verifiedAt: at, endpointId: 'test-endpoint', rawBodyDigest: digest(id) } } : {}), ...extra };
}

void test('same-event certified headers and entity identity conflict symmetrically across raw and API acquisitions', async () => {
  const directions = [['verified_webhook', 'authenticated_api'], ['authenticated_api', 'verified_webhook'], ['authenticated_api', 'authenticated_api']] as const;
  for (const [firstKind, secondKind] of directions) {for (const changed of ['type', 'time', 'entity'] as const) {
    const context = setup(), checkout = await purchase(context), secondCheckout = await context.payments.startPurchase({ buyerId: 'buyer', offerId: 'offer', requestKey: 'second-intent' }); assert.equal(secondCheckout.kind, 'succeeded');
    await context.payments.registerConsumer('event-consumer');
    const first = transaction(checkout.transactionRef, 'first-receipt', 'one_time', { source: eventSource('first-receipt', firstKind) });
    const second = transaction(changed === 'entity' ? secondCheckout.value.transactionRef : checkout.transactionRef, 'second-receipt', 'one_time', { source: eventSource('second-receipt', secondKind, changed === 'type' ? { eventType: 'transaction.updated' } : changed === 'time' ? { occurredAt: '2026-01-01T00:00:00.000002Z' } : {}) });
    const aa = eventIdentityEvidence(input(first)), bb = eventIdentityEvidence(input(second)); assert.equal(compareEventIdentity(aa, bb), 'conflict'); assert.equal(compareEventIdentity(bb, aa), 'conflict');
    await observe(context, first);
    const originalMessage = (await context.payments.readDeliveries('event-consumer'))[0]; assert.ok(originalMessage); await context.payments.acknowledgeDelivery('event-consumer', originalMessage.messageId, originalMessage.bodyDigest);
    const admission = await context.payments.ingestVerifiedInput(input(second)); assert.equal(admission.kind, 'succeeded'); {assert.equal(admission.value?.kind, 'conflict');}
    assert.equal(await context.payments.processInbox(second.source.receiptId), 'quarantined');
    const original = (await context.payments.readPurchase('buyer', checkout.intentId))?.transactions[0]; assert.ok(original?.completion); assert.ok(original.flags.includes('conflict'));
    if (changed === 'entity') { const incoming = (await context.payments.readPurchase('buyer', secondCheckout.value.intentId))?.transactions[0]; assert.ok(incoming); assert.ok(incoming.flags.includes('conflict')); assert.equal(incoming.completion, undefined); }
    await context.payments.flushPublication({ type: 'transaction', id: checkout.transactionRef });
    assert.ok((await context.payments.readDeliveries('event-consumer')).some(message => message.kind === 'complete' && message.flags.includes('conflict')));
  }}
});

void test('same-event partial raw/API evidence and equivalent instants remain compatible without invented wire equality', async () => {
  const context = setup(), checkout = await purchase(context), raw = transaction(checkout.transactionRef, 'compatible-raw', 'one_time', { source: eventSource('compatible-raw', 'verified_webhook') });
  const api = transaction(checkout.transactionRef, 'compatible-api', 'one_time', { subscriptionRef: unknown, version: '2026-01-01T01:00:00.000001000+01:00', source: eventSource('compatible-api', 'authenticated_api', { occurredAt: '2026-01-01T01:00:00.000001000+01:00', stableEnvelopeDigest: 'not-a-certified-raw-envelope' }) });
  if (api.lines.presence !== 'known') {throw new Error('Fixture');}
  const partial = { ...api, lines: yes(api.lines.value.map(line => ({ ...line, period: unknown, trial: { presence: 'known' as const, value: false, provenance: 'schema_assumed_null' as const }, billingCycle: { presence: 'known' as const, value: null, provenance: 'schema_assumed_null' as const } }))) };
  const aa = eventIdentityEvidence(input(raw)), bb = eventIdentityEvidence(input(partial)); assert.equal(compareEventIdentity(aa, bb), 'compatible'); assert.equal(compareEventIdentity(bb, aa), 'compatible'); assert.equal(bb.rawStableEnvelopeDigest, undefined);
  await observe(context, raw); await observe(context, partial);
  const aggregate = (await context.payments.readPurchase('buyer', checkout.intentId))?.transactions[0]; assert.ok(aggregate?.completion); assert.ok(!aggregate.flags.includes('conflict'));
});

void test('merged certified identity preserves richer evidence so pairwise partial compatibility cannot hide a contradiction', () => {
  const partial = transaction('tx', 'partial-event', 'one_time', { total: unknown, source: eventSource('partial-event', 'authenticated_api') });
  const firstKnown = transaction('tx', 'known-event', 'one_time', { total: yes(money('USD', '1000')), source: eventSource('known-event', 'authenticated_api') });
  const contradictory = transaction('tx', 'different-event', 'one_time', { total: yes(money('USD', '999')), source: eventSource('different-event', 'authenticated_api') });
  const aa = eventIdentityEvidence(input(partial)), bb = eventIdentityEvidence(input(firstKnown)), cc = eventIdentityEvidence(input(contradictory));
  assert.equal(compareEventIdentity(aa, bb), 'compatible'); assert.equal(compareEventIdentity(aa, cc), 'compatible'); assert.equal(compareEventIdentity(bb, cc), 'conflict');
  const merged = mergeEventIdentityEvidence(aa, bb); assert.equal(compareEventIdentity(merged, cc), 'conflict'); assert.equal(compareEventIdentity(cc, merged), 'conflict'); assert.throws(() => mergeEventIdentityEvidence(merged, cc));
});

void test('merging partial unsupported identities retains a certified route for later contradictions', () => {
  const firstSource = eventSource('unsupported-route', 'authenticated_api'), secondSource = eventSource('unsupported-partial', 'authenticated_api');
  const first: VerifiedInput = { scope, inputId: firstSource.receiptId, source: firstSource, observation: { kind: 'unsupported', transactionRef: 'tx-a', reason: 'unmapped', source: firstSource }, retainedRepresentation: {} };
  const second: VerifiedInput = { scope, inputId: secondSource.receiptId, source: secondSource, observation: { kind: 'unsupported', reason: 'unmapped', source: secondSource }, retainedRepresentation: {} };
  const merged = mergeEventIdentityEvidence(eventIdentityEvidence(first), eventIdentityEvidence(second));
  const contradictory = eventIdentityEvidence(input(transaction('tx-b', 'contradictory-supported', 'one_time', { source: eventSource('contradictory-supported', 'authenticated_api') })));
  assert.equal(compareEventIdentity(merged, contradictory), 'conflict'); assert.deepEqual(merged.routes, [{ type: 'transaction', id: 'tx-a' }]);
});

void test('quarantined preflight custody cannot authorize dispatch using an older matching projection', async () => {
  const context = setup('monthly'), checkout = await purchase(context); await observe(context, transaction(checkout.transactionRef, 'quarantine-authority-initial', 'monthly'));
  const basis = (await context.payments.readPurchase('buyer', checkout.intentId))?.intent.subscriptionBasisId; assert.ok((typeof basis === 'string' && basis.length > 0));
  const prior: SubscriptionObservation = { kind: 'subscription', subscriptionRef: 'sub-a', version: at, status: yes('active'), customerRef: yes('payer'), scheduledChange: yes(null), currentPeriod: yes(period), collection: yes({ kind: 'automatic' }), items: yes([{ providerPriceRef: 'price', quantity: yes(1), billingCycle: yes({ interval: 'month', frequency: 1 }), trial: yes(false) }]), source: eventSource('prior-authority', 'authenticated_api', { eventType: 'subscription.updated' }) };
  await observe(context, prior);
  const conflicting = acquired({ ...prior, source: eventSource('contradictory-authority', 'authenticated_api', { eventType: 'subscription.canceled' }) });
  context.provider.readSubscriptionInput = async () => ({ kind: 'succeeded', value: conflicting });
  Object.assign(context.provider.capabilities, { cancellation: ['now'] }); let mutations = 0;
  context.provider.cancelSubscription = async () => { mutations += 1; return { kind: 'succeeded', value: { kind: 'applied', observedStatus: 'canceled' } }; };
  assert.deepEqual(await context.payments.requestCancellation({ buyerId: 'buyer', bindingId: basis, requestKey: 'quarantined-authority-command', timing: 'now' }), { kind: 'rejected', code: 'unclassified_external_state' }); assert.equal(mutations, 0);
  assert.equal((await context.store.loadReductionInput(scope, conflicting.inputId))?.state.inbox[conflicting.inputId]?.state, 'quarantined');
});

void test('an acknowledged subscription feed receives a higher revision for a newly retained stale ownership hold', async () => {
  const context = setup('monthly'), checkout = await purchase(context); await observe(context, transaction(checkout.transactionRef, 'stale-hold-initial', 'monthly'));
  const basis = (await context.payments.readPurchase('buyer', checkout.intentId))?.intent.subscriptionBasisId; assert.ok((typeof basis === 'string' && basis.length > 0));
  await context.payments.registerConsumer('stale-hold-consumer');
  const current: SubscriptionObservation = { kind: 'subscription', subscriptionRef: 'sub-a', version: '2026-01-02T00:00:00Z', status: yes('active'), customerRef: yes('payer'), scheduledChange: yes(null), currentPeriod: yes(period), collection: yes({ kind: 'automatic' }), items: yes([{ providerPriceRef: 'price', quantity: yes(1), billingCycle: yes({ interval: 'month', frequency: 1 }), trial: yes(false) }]), source: source('latest-owned-subscription') };
  await observe(context, current);
  const first = (await context.payments.readDeliveries('stale-hold-consumer'))[0]; assert.ok(first); await context.payments.acknowledgeDelivery('stale-hold-consumer', first.messageId, first.bodyDigest);
  const stale = { ...current, version: '2026-01-01T00:00:00Z', customerRef: yes('old-contradictory-payer'), source: source('stale-customer-contradiction') };
  await observe(context, stale); await context.payments.repair();
  const projection = (await context.payments.readObservedSubscription('buyer', basis))?.observations[0]; assert.ok(projection); assert.equal(projection.current?.version, current.version); assert.ok(projection.flags.includes('ownership_mismatch'));
  const delivery = (await context.payments.readDeliveries('stale-hold-consumer'))[0]; assert.ok(delivery); assert.ok(delivery.revision > first.revision); assert.equal(delivery.kind, 'subscription_complete'); {assert.ok(delivery.flags.includes('ownership_mismatch'));}
  await context.payments.acknowledgeDelivery('stale-hold-consumer', delivery.messageId, delivery.bodyDigest);
  await context.payments.ingestVerifiedInput(input(stale)); assert.equal(await context.payments.processInbox(stale.source.receiptId), 'duplicate'); await context.payments.repair();
  assert.equal((await context.payments.readDeliveries('stale-hold-consumer')).length, 0);
});

void test('subscription exact-version contradictions remain held across watermark advancement, acknowledgement and restart', async () => {
  for (const late of [false, true]) {
    const context = setup('monthly'), checkout = await purchase(context); await observe(context, transaction(checkout.transactionRef, `history-initial-${late}`, 'monthly'));
    const basis = (await context.payments.readPurchase('buyer', checkout.intentId))?.intent.subscriptionBasisId; assert.ok((typeof basis === 'string' && basis.length > 0)); await context.payments.registerConsumer('history-consumer');
    const first: SubscriptionObservation = { kind: 'subscription', subscriptionRef: 'sub-a', version: at, status: yes('active'), customerRef: yes('payer'), scheduledChange: yes(null), currentPeriod: yes(period), collection: yes({ kind: 'automatic' }), items: yes([{ providerPriceRef: 'price', quantity: yes(1), billingCycle: yes({ interval: 'month', frequency: 1 }), trial: yes(false) }]), source: source(`subscription-v1-${late}`) };
    const latest = { ...first, version: '2026-01-01T00:00:00.000002Z', source: source(`subscription-v2-${late}`) }, contradiction = { ...first, version: '2026-01-01T01:00:00.000001000+01:00', status: yes('canceled'), source: source(`subscription-v1-conflict-${late}`) };
    await observe(context, first); if (late) {await observe(context, latest);}
    for (const message of await context.payments.readDeliveries('history-consumer')) {await context.payments.acknowledgeDelivery('history-consumer', message.messageId, message.bodyDigest);}
    context.payments = createPayments({ scope, producerNamespace: 'payments', provider: context.provider, store: context.store, catalog: { resolveOffer: async () => offer('monthly') } });
    await observe(context, contradiction); if (!late) {await observe(context, latest);}
    const aggregate = (await context.payments.readObservedSubscription('buyer', basis))?.observations[0]; assert.ok(aggregate); assert.ok(aggregate.flags.includes('conflict')); assert.equal(aggregate.current?.version, latest.version);
    const loaded = await context.store.loadReductionInput(scope, contradiction.source.receiptId), key = objectVersionKey(contradiction); assert.ok((typeof key === 'string' && key.length > 0)); const version = loaded?.state.versionEvidence[key]; assert.equal(version?.kind, 'certified'); { assert.equal(version.conflict, true); assert.equal(version.projection.kind, 'subscription'); {assert.deepEqual(version.projection.status, yes('active'));} }
    assert.ok((await context.payments.readDeliveries('history-consumer')).some(message => message.kind === 'subscription_complete' && message.flags.includes('conflict')));
  }
});

void test('adjustment exact-version contradictions cannot disappear behind an approved newer watermark', async () => {
  for (const late of [false, true]) {
    const context = setup(), checkout = await purchase(context); await observe(context, transaction(checkout.transactionRef, `adjustment-history-initial-${late}`)); await context.payments.registerConsumer('adjustment-history');
    const first: AdjustmentObservation = { kind: 'adjustment', adjustmentRef: 'historical-adjustment', transactionRef: checkout.transactionRef, version: at, action: 'refund', status: 'pending_approval', type: 'full', amount: money('USD', '100'), allocations: [], source: source(`adjustment-v1-${late}`) };
    const latest = { ...first, version: '2026-01-01T00:00:00.000002Z', status: 'approved', source: source(`adjustment-v2-${late}`) }, contradiction = { ...first, version: '2026-01-01T01:00:00.000001000+01:00', amount: money('USD', '90'), source: source(`adjustment-v1-conflict-${late}`) };
    await observe(context, first); if (late) {await observe(context, latest);}
    for (const message of await context.payments.readDeliveries('adjustment-history')) {await context.payments.acknowledgeDelivery('adjustment-history', message.messageId, message.bodyDigest);}
    context.payments = createPayments({ scope, producerNamespace: 'payments', provider: context.provider, store: context.store, catalog: { resolveOffer: async () => offer() } });
    await observe(context, contradiction); if (!late) {await observe(context, latest);}
    const aggregate = (await context.payments.readPurchase('buyer', checkout.intentId))?.transactions[0]; assert.ok(aggregate); assert.ok(aggregate.flags.includes('conflict')); assert.equal(aggregate.adjustments['historical-adjustment']?.status, 'approved'); assert.equal(aggregate.adjustments['historical-adjustment'].amount.minorUnits, '100');
    assert.ok((await context.payments.readDeliveries('adjustment-history')).some(message => message.kind === 'complete' && message.flags.includes('conflict')));
  }
});

void test('an exact-version adjustment parent contradiction atomically holds both acknowledged payment routes and retains original certification', async () => {
  const context = setup(), first = await purchase(context);
  const second = await context.payments.startPurchase({ buyerId: 'buyer', offerId: 'offer', requestKey: 'second-purchase' }); assert.equal(second.kind, 'succeeded');
  await observe(context, transaction(first.transactionRef, 'parent-a-paid'));
  await observe(context, transaction(second.value.transactionRef, 'parent-b-paid'));
  await context.payments.registerConsumer('parent-conflicts');
  const original: AdjustmentObservation = { kind: 'adjustment', adjustmentRef: 'cross-parent-adjustment', transactionRef: first.transactionRef, version: at, action: 'refund', status: 'approved', amount: money('USD', '100'), allocations: [], source: source('original-parent-adjustment') };
  await observe(context, original);
  const latest = { ...original, version: '2026-01-01T00:00:00.000002Z', source: source('latest-parent-adjustment') }; await observe(context, latest);
  const before = (await context.payments.readPurchase('buyer', first.intentId))?.transactions[0]; assert.ok(before);
  for (const message of await context.payments.readDeliveries('parent-conflicts')) {await context.payments.acknowledgeDelivery('parent-conflicts', message.messageId, message.bodyDigest);}
  context.payments = createPayments({ scope, producerNamespace: 'payments', provider: context.provider, store: context.store, catalog: { resolveOffer: async () => offer() } });
  const contradiction = { ...original, transactionRef: second.value.transactionRef, version: '2026-01-01T01:00:00.000001000+01:00', source: source('contradictory-parent-adjustment') };
  await context.payments.ingestVerifiedInput(input(contradiction));
  const loaded = await context.store.loadReductionInput(scope, contradiction.source.receiptId); assert.ok(loaded);
  assert.ok(loaded.expected.some(item => item.table === 'transactions' && item.id === first.transactionRef)); assert.ok(loaded.expected.some(item => item.table === 'transactions' && item.id === second.value.transactionRef));
  // A change to the original parent invalidates an already prepared two-parent reduction.
  await observe(context, { ...latest, version: '2026-01-01T00:00:00.000003Z', source: source('concurrent-original-parent') });
  processInput(loaded.state, scope, contradiction.source.receiptId);
  assert.equal((await context.store.commitReduction(scope, { inputId: loaded.inputId, expected: loaded.expected, state: loaded.state })).kind, 'conflict');
  assert.equal(await context.payments.processInbox(contradiction.source.receiptId), 'processed');
  const after = (await context.payments.readPurchase('buyer', first.intentId))?.transactions[0], other = (await context.payments.readPurchase('buyer', second.value.intentId))?.transactions[0];
  assert.ok(after); assert.ok(other); assert.ok(after.flags.includes('conflict')); assert.ok(other.flags.includes('conflict')); assert.ok(after.evidenceRevision > before.evidenceRevision); assert.equal(after.adjustments[original.adjustmentRef]?.version, '2026-01-01T00:00:00.000003Z'); assert.equal(other.adjustments[original.adjustmentRef], undefined); assert.deepEqual(after.completion, before.completion);
  const version = (await context.store.loadReductionInput(scope, contradiction.source.receiptId))?.state.versionEvidence[objectVersionKey(original) ?? '']; assert.equal(version?.kind, 'certified'); { assert.equal(version.conflict, true); assert.equal(version.projection.kind, 'adjustment'); {assert.equal(version.projection.transactionRef, first.transactionRef);} }
  const heldRoutes = (await context.payments.readDeliveries('parent-conflicts')).filter(message => message.kind === 'complete' && message.flags.includes('conflict')).map(message => message.aggregate.id).toSorted(); assert.deepEqual(heldRoutes, [first.transactionRef, second.value.transactionRef].toSorted());
  for (const message of await context.payments.readDeliveries('parent-conflicts')) {await context.payments.acknowledgeDelivery('parent-conflicts', message.messageId, message.bodyDigest);}
  await context.payments.ingestVerifiedInput(input(contradiction)); assert.equal(await context.payments.processInbox(contradiction.source.receiptId), 'duplicate'); await context.payments.repair(); assert.equal((await context.payments.readDeliveries('parent-conflicts')).length, 0);
});

void test('historical exact-version partial summaries merge compatible knowledge and nanosecond-equivalent spellings', async () => {
  const context = setup('monthly'), checkout = await purchase(context); await observe(context, transaction(checkout.transactionRef, 'compatible-history-initial', 'monthly'));
  const first: SubscriptionObservation = { kind: 'subscription', subscriptionRef: 'sub-a', version: at, status: yes('active'), customerRef: yes('payer'), scheduledChange: unknown, currentPeriod: yes(period), collection: yes({ kind: 'automatic' }), items: yes([{ providerPriceRef: 'price', quantity: yes(1), billingCycle: yes({ interval: 'month', frequency: 1 }), trial: yes(false) }]), source: source('historical-partial') };
  await observe(context, first); await observe(context, { ...first, version: '2026-01-01T00:00:00.000002Z', scheduledChange: yes(null), source: source('historical-latest') });
  const richer = { ...first, version: '2026-01-01T01:00:00.000001000+01:00', scheduledChange: yes(null), source: source('historical-richer') }; await observe(context, richer);
  const key = objectVersionKey(first); assert.ok((typeof key === 'string' && key.length > 0)); assert.equal(objectVersionKey(richer), key);
  const version = (await context.store.loadReductionInput(scope, richer.source.receiptId))?.state.versionEvidence[key]; assert.equal(version?.kind, 'certified'); { assert.equal(version.conflict, false); assert.equal(version.projection.kind, 'subscription'); {assert.deepEqual(version.projection.scheduledChange, yes(null));} }
  const basis = (await context.payments.readPurchase('buyer', checkout.intentId))?.intent.subscriptionBasisId; assert.ok((typeof basis === 'string' && basis.length > 0)); assert.ok(!((await context.payments.readObservedSubscription('buyer', basis))?.observations[0]?.flags.includes('conflict') === true));
});

void test('oversized version certification retains custody and a bounded persistent hold tombstone', async () => {
  const context = setup(), checkout = await purchase(context); await observe(context, transaction(checkout.transactionRef, 'version-budget-initial')); await context.payments.registerConsumer('version-budget');
  const adjustment: AdjustmentObservation = { kind: 'adjustment', adjustmentRef: 'large-adjustment', transactionRef: checkout.transactionRef, version: at, action: 'refund', status: 'approved', amount: money('USD', '100'), allocations: Array.from({ length: 1500 }, (_, index) => ({ providerLineRef: `line-${index}-${'x'.repeat(200)}`, amount: money('USD', '1') })), source: source('large-version-evidence') };
  await context.payments.ingestVerifiedInput(input(adjustment)); assert.equal(await context.payments.processInbox(adjustment.source.receiptId), 'quarantined');
  const loaded = await context.store.loadReductionInput(scope, adjustment.source.receiptId), key = objectVersionKey(adjustment); assert.ok((typeof key === 'string' && key.length > 0)); const tombstone = loaded?.state.versionEvidence[key]; assert.equal(tombstone?.kind, 'held'); assert.ok(Buffer.byteLength(canonicalJson(tombstone)) < MAX_OBJECT_VERSION_EVIDENCE_BYTES); assert.ok(loaded?.state.inbox[adjustment.source.receiptId]?.input.observation.kind === 'adjustment');
  assert.equal((await context.payments.readDeliveries('version-budget')).at(-1)?.kind, 'held');
  await observe(context, transaction(checkout.transactionRef, 'after-version-budget'));
  const aggregate = (await context.payments.readPurchase('buyer', checkout.intentId))?.transactions[0]; assert.ok(aggregate); assert.ok(aggregate.flags.includes('incomplete_history')); assert.ok(aggregate.pendingAdverse.includes(adjustment.source.receiptId)); assert.equal((await context.payments.readDeliveries('version-budget')).at(-1)?.kind, 'held');
});

void test('audited payment update outcomes bind the same durable purpose and reclassify early evidence', async () => {
  for (const purpose of ['payment_method', 'recovery'] as const) {
    const context = setup('monthly'), checkout = await purchase(context); await observe(context, transaction(checkout.transactionRef, `operator-initial-${purpose}`, 'monthly'));
    const basis = (await context.payments.readPurchase('buyer', checkout.intentId))?.intent.subscriptionBasisId; assert.ok((typeof basis === 'string' && basis.length > 0)); Object.assign(context.provider.capabilities, { paymentUpdate: true });
    context.provider.openPaymentUpdate = async () => ({ kind: 'outcome_unknown' });
    const unknownResult = await context.payments.openPaymentUpdate({ buyerId: 'buyer', bindingId: basis, requestKey: `operator-${purpose}` }); assert.equal(unknownResult.kind, 'outcome_unknown');
    const ref = `operator-transaction-${purpose}`, early = transaction(ref, `early-operator-evidence-${purpose}`, 'monthly', { origin: yes(purpose === 'payment_method' ? 'subscription_payment_method_change' : 'subscription_recurring') });
    if (early.lines.presence !== 'known') {throw new Error('Fixture');}
    await observe(context, { ...early, lines: yes(early.lines.value.map(line => ({ ...line, period: yes({ startsAt: '2026-02-01T00:00:00Z', endsAt: '2026-03-01T00:00:00Z' }) }))) });
    const priorFact = (await context.payments.readPurchase('buyer', checkout.intentId))?.transactions.find(aggregate => aggregate.transactionRef === ref)?.completion;
    const operation = await context.payments.readOperation(unknownResult.operationId); assert.ok(operation);
    const value = { intentId: checkout.intentId, transactionRef: ref, purpose, checkout: { token: 'proven-checkout' } };
    const resolved = await context.payments.resolveUnknownOperation({ operationId: operation.operationId, expectedRevision: operation.revision, actorId: 'operator', auditRef: `proven-${purpose}`, reason: 'verified provider outcome', action: 'bind_outcome', outcome: { kind: 'succeeded', value } }); assert.equal(resolved.kind, 'succeeded');
    assert.deepEqual(await context.payments.openPaymentUpdate({ buyerId: 'buyer', bindingId: basis, requestKey: `operator-${purpose}` }), { kind: 'succeeded', value });
    const loaded = await context.store.loadPublicationInput(scope, { type: 'transaction', id: ref }); assert.equal(loaded?.state.bindings[ref]?.purpose, purpose); assert.equal(loaded.state.bindings[ref].intentId, checkout.intentId);
    assert.deepEqual(await context.payments.resolveUnknownOperation({ operationId: operation.operationId, expectedRevision: operation.revision, actorId: 'operator', auditRef: 'repeat', reason: 'repeat stale decision', action: 'bind_outcome', outcome: { kind: 'succeeded', value } }), { kind: 'rejected', code: 'conflict' });
    await context.payments.repair(); const aggregate = (await context.payments.readPurchase('buyer', checkout.intentId))?.transactions.find(item => item.transactionRef === ref); assert.ok(aggregate); assert.ok(!aggregate.flags.includes('unresolved_binding')); assert.ok(!aggregate.flags.includes('conflict'));
    if (purpose === 'payment_method') {assert.equal(aggregate.completion, undefined);}
    else { assert.equal(aggregate.completion?.lines[0]?.period?.startsAt, '2026-02-01T00:00:00Z'); assert.equal(aggregate.completion.factId, priorFact?.factId); assert.deepEqual(aggregate.completion, priorFact); }
  }
});

void test('invalid audited successful outcomes preserve the unknown operation and cannot expose checkout', async () => {
  const context = setup('monthly'), checkout = await purchase(context); await observe(context, transaction(checkout.transactionRef, 'invalid-operator-initial', 'monthly'));
  const basis = (await context.payments.readPurchase('buyer', checkout.intentId))?.intent.subscriptionBasisId; assert.ok((typeof basis === 'string' && basis.length > 0)); Object.assign(context.provider.capabilities, { paymentUpdate: true });
  let updates = 0; context.provider.openPaymentUpdate = async () => { updates += 1; return { kind: 'outcome_unknown' }; };
  const unknownResult = await context.payments.openPaymentUpdate({ buyerId: 'buyer', bindingId: basis, requestKey: 'invalid-operator' }); assert.equal(unknownResult.kind, 'outcome_unknown');
  const operation = await context.payments.readOperation(unknownResult.operationId); assert.ok(operation);
  const invalidValues: readonly JsonValue[] = [null, [], {},
    { intentId: checkout.intentId, transactionRef: 'invalid-proof', purpose: 'recovery', checkout: null },
    { intentId: checkout.intentId, transactionRef: 'invalid-proof', purpose: 'recovery', checkout: [] },
    { intentId: checkout.intentId, transactionRef: 'invalid-proof', purpose: 'recovery', checkout: { token: 42 } },
    { intentId: checkout.intentId, transactionRef: 'invalid-proof', purpose: 'recovery', checkout: { url: '' } },
    { intentId: 'wrong-intent', transactionRef: 'invalid-proof', purpose: 'payment_method', checkout: {} },
    { intentId: checkout.intentId, transactionRef: 'invalid-proof', purpose: 'unproven', checkout: {} },
    { intentId: checkout.intentId, transactionRef: '', purpose: 'recovery', checkout: {} },
  ];
  for (const invalid of invalidValues) {
    assert.deepEqual(await context.payments.resolveUnknownOperation({ operationId: operation.operationId, expectedRevision: operation.revision, actorId: 'operator', auditRef: 'bad-proof', reason: 'invalid proof submitted', action: 'bind_outcome', outcome: { kind: 'succeeded', value: invalid } }), { kind: 'rejected', code: 'validation' });
    assert.deepEqual(await context.payments.readOperation(operation.operationId), operation);
  }
  assert.deepEqual(await context.payments.openPaymentUpdate({ buyerId: 'buyer', bindingId: basis, requestKey: 'invalid-operator' }), { kind: 'outcome_unknown', operationId: operation.operationId });
  assert.equal(updates, 1);
  assert.equal((await context.store.loadPublicationInput(scope, { type: 'transaction', id: 'invalid-proof' }))?.state.bindings['invalid-proof'], undefined);
});


void test('memory admission fences a certified historical adjustment parent before stale T2 and cleans both receipt markers', async () => {
  const context = setup('monthly');
  const first = await purchase(context);
  const second = await context.payments.startPurchase({ buyerId: 'buyer', offerId: 'offer', requestKey: 'another' });
  assert.equal(second.kind, 'succeeded');
  await observe(context, transaction(first.transactionRef, 'initial-a', 'monthly'));
  await observe(context, transaction(second.value.transactionRef, 'initial-b', 'monthly', { subscriptionRef: yes('sub-b') }));
  const original: AdjustmentObservation = { kind: 'adjustment', adjustmentRef: 'historical-parent', transactionRef: first.transactionRef, version: at, action: 'refund', status: 'rejected', amount: money('USD', '100'), allocations: [], source: source('adjustment-old') };
  await observe(context, original);
  await observe(context, { ...original, version: '2026-01-02T00:00:00Z', source: source('adjustment-newer') });
  const old = await context.store.loadPublicationInput(scope, { type: 'transaction', id: first.transactionRef }); assert.ok(old);
  for (const observation of old.state.transactions[first.transactionRef]?.observations ?? []) {reduceObservation(old.state, scope, observation);}
  publishEvidence(old.state, scope, 'payments', 65536);
  const incoming = input({ ...original, transactionRef: second.value.transactionRef, source: source('changed-old-parent') });
  assert.equal((await context.payments.ingestVerifiedInput(incoming)).kind, 'succeeded');
  assert.deepEqual(await context.store.commitReduction(scope, { inputId: old.inputId, expected: old.expected, state: old.state }), { kind: 'conflict' });
  for (const checkout of [first, second.value]) {assert.ok(((await context.payments.readPurchase('buyer', checkout.intentId))?.transactions[0]?.pendingAdverse.includes(incoming.inputId) === true));}
  assert.equal(await context.payments.processInbox(incoming.inputId), 'processed');
  for (const checkout of [first, second.value]) {
    const aggregate = (await context.payments.readPurchase('buyer', checkout.intentId))?.transactions[0]; assert.ok(aggregate);
    assert.ok(aggregate.flags.includes('conflict')); assert.ok(!aggregate.pendingAdverse.includes(incoming.inputId));
  }
});

void test('public operation reads detach snapshots and strip provider diagnostics while custody retains them', async () => {
  const context = setup();
  context.replaceCreate(async () => ({ kind: 'rejected', code: 'rate_limited', diagnostic: { requestId: 'provider-secret-id', providerCode: 'raw-provider-code' } }));
  assert.deepEqual(await context.payments.startPurchase({ buyerId: 'buyer', offerId: 'offer', requestKey: 'diagnostic' }), { kind: 'rejected', code: 'rate_limited' });
  const stored = await context.store.findRequest(scope, 'buyer', 'diagnostic'); assert.ok(stored);
  assert.deepEqual(stored.result, { kind: 'rejected', code: 'rate_limited', diagnostic: { requestId: 'provider-secret-id', providerCode: 'raw-provider-code' } });
  const snapshot = await context.payments.readOperation(stored.operationId, 'buyer'); assert.ok(snapshot);
  assert.deepEqual(snapshot.result, { kind: 'rejected', code: 'rate_limited' });
  assert.deepEqual(snapshot.attempts[0]?.observations, [{ kind: 'rejected', code: 'rate_limited' }]);
  assert.equal(JSON.stringify(snapshot).includes('provider-secret-id'), false);
  Object.assign(snapshot, { buyerId: 'tampered' });
  Object.assign(snapshot.attempts, { length: 0 });
  assert.equal((await context.payments.readOperation(stored.operationId, 'buyer'))?.buyerId, 'buyer');
  assert.equal((await context.payments.readOperation(stored.operationId, 'buyer'))?.attempts.length, 1);
  assert.equal(await context.payments.readOperation(stored.operationId, 'other-buyer'), undefined);
});

void test('purchase and subscription snapshots hide mutable policy metadata and detach nested values', async () => {
  const context = setup('monthly'), checkout = await purchase(context);
  await observe(context, transaction(checkout.transactionRef, 'snapshot-completion', 'monthly'));
  const read = await context.payments.readPurchase('buyer', checkout.intentId); assert.ok(read);
  assert.equal('fingerprint' in read.intent, false);
  assert.equal('publicationRequired' in (read.transactions[0] ?? {}), false);
  const basis = read.intent.subscriptionBasisId; assert.ok(basis);
  await context.payments.refreshSubscription('buyer', basis);
  const subscription = await context.payments.readObservedSubscription('buyer', basis); assert.ok(subscription);
  assert.equal('classificationDecision' in subscription.binding, false);
  assert.equal('publicationRequired' in (subscription.observations[0] ?? {}), false);
  Object.assign(read.intent.offer.lines[0] ?? {}, { providerPriceRef: 'tampered' });
  Object.assign(read.transactions[0]?.flags ?? [], { 0: 'tampered' });
  Object.assign(subscription.binding.providerSubscriptionRefs, { length: 0 });
  assert.equal((await context.payments.readPurchase('buyer', checkout.intentId))?.intent.offer.lines[0]?.providerPriceRef, 'price');
  assert.deepEqual((await context.payments.readObservedSubscription('buyer', basis))?.binding.providerSubscriptionRefs, ['sub-a']);
});

void test('opaque stream versions bind buyer, binding and target and are stable under read-set ordering', async () => {
  const context = setup('monthly'), checkout = await purchase(context);
  await observe(context, transaction(checkout.transactionRef, 'selection-a', 'monthly'));
  const basis = (await context.payments.readPurchase('buyer', checkout.intentId))?.intent.subscriptionBasisId; assert.ok(basis);
  const loaded = await context.store.loadPublicationInput(scope, { type: 'subscription', id: 'sub-a' }); assert.ok(loaded);
  const binding = loaded.state.subscriptionBindings[basis]; assert.ok(binding); binding.providerSubscriptionRefs.push('sub-b');
  assert.deepEqual(await context.store.commitReduction(scope, { inputId: loaded.inputId, expected: loaded.expected, state: loaded.state }), { kind: 'committed' });
  const originalLoad = context.store.loadPublicationInput.bind(context.store);
  let reverse = false;
  context.store.loadPublicationInput = async (...args) => {
    const current = await originalLoad(...args); reverse = !reverse;
    return current && reverse ? { ...current, expected: [...current.expected].reverse() } : current;
  };
  const selection = await context.payments.readSubscriptionSelection('buyer', basis, 'sub-a'); assert.ok(selection);
  const sameSelection = await context.payments.readSubscriptionSelection('buyer', basis, 'sub-a'); assert.ok(sameSelection);
  assert.equal(selection.version, sameSelection.version);
  assert.equal('expectedReadSet' in selection, false);
  assert.equal('classificationDecision' in selection.binding, false);
  const command = { buyerId: 'buyer', bindingId: basis, providerSubscriptionRef: 'sub-b', version: selection.version, actorId: 'operator', auditRef: 'audited-selection', reason: 'operator choice' };
  assert.deepEqual(await context.payments.selectSubscriptionStream(command), { kind: 'rejected', code: 'conflict' });
  assert.deepEqual(await context.payments.selectSubscriptionStream({ ...command, buyerId: 'other-buyer', providerSubscriptionRef: 'sub-a' }), { kind: 'rejected', code: 'ownership_mismatch' });
  assert.deepEqual(await context.payments.selectSubscriptionStream({ ...command, bindingId: 'other-binding', providerSubscriptionRef: 'sub-a' }), { kind: 'rejected', code: 'ownership_mismatch' });
  const fresh = await context.payments.readSubscriptionSelection('buyer', basis, 'sub-b'); assert.ok(fresh);
  assert.equal((await context.payments.selectSubscriptionStream({ ...command, version: fresh.version })).kind, 'succeeded');
});

void test('operation CAS independently rejects changes to each immutable command field', async () => {
  const context = setup(), checkout = await purchase(context);
  const operationId = (await context.payments.readPurchase('buyer', checkout.intentId))?.intent.operationId; assert.ok(operationId);
  const original = await context.store.loadOperation(scope, operationId); assert.ok(original);
  const changes: readonly Partial<typeof original.operation>[] = [
    { operationId: 'another-operation' }, { kind: 'cancellation' }, { buyerId: 'another-buyer' },
    { requestKey: 'another-key' }, { fingerprint: 'another-fingerprint' }, { intentId: 'another-intent' },
    { subscriptionBindingId: 'another-binding' }, { providerSubscriptionRef: 'another-subscription' }, { timing: 'now' },
  ];
  for (const change of changes) {
    assert.deepEqual(await context.store.commitOperation(scope, { expectedRevision: original.operation.revision, expectedLaneRevision: original.laneRevision, operation: { ...original.operation, ...change, revision: original.operation.revision + 1 } }), { kind: 'conflict' }, `immutable field ${Object.keys(change)[0]}`);
  }
  assert.deepEqual((await context.store.loadOperation(scope, operationId))?.operation, original.operation);
});
