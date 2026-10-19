import assert from 'node:assert/strict';
import test from 'node:test';
import { addMoney, canonicalJson, compareTime, createPayments, digest, exactTime, money, type EvidenceSource, type Field, type OfferSnapshot, type PaymentProvider, type PaymentScope, type ProviderResult, type SubscriptionObservation, type TransactionObservation, type VerifiedInput } from '../dist/index.js';
import { MemoryPaymentStore } from '../dist/memory.js';

const scope: PaymentScope = { applicationId: 'app-a', provider: 'fake', paymentAccountId: 'merchant', environment: 'sandbox' };
const yes = <T>(value: T): Field<T> => ({ presence: 'known', value });
const unknown = { presence: 'unknown' } as const;
const at = '2026-01-01T00:00:00.000001Z';
const period = { startsAt: '2026-01-01T00:00:00Z', endsAt: '2026-02-01T00:00:00Z' };
function source(id: string): EvidenceSource { return { kind: 'authenticated_api', receiptId: id, representationDigest: digest(id), decoderVersion: '1', apiProfile: 'fake-v1' }; }
function offer(profile: 'one_time' | 'monthly' = 'one_time', allowZeroTotal = false): OfferSnapshot { return { applicationId: 'app-a', offerId: 'offer', version: 'v1', policyVersion: 'policy-v1', currency: 'USD', profile, allowZeroTotal, lines: [{ providerPriceRef: 'price', benefitSlotId: 'benefit', quantity: 1 }] }; }
function transaction(ref: string, receiptId: string, profile: 'one_time' | 'monthly' = 'one_time', extra: Partial<TransactionObservation> = {}): TransactionObservation {
  return { kind: 'transaction', transactionRef: ref, version: at, status: 'completed', origin: yes('api'), customerRef: yes('payer'), subscriptionRef: profile === 'monthly' ? yes('sub-a') : yes(null), intentCorrelation: unknown, currency: yes('USD'), total: yes(money('USD', '1000')), lines: yes([{ providerLineRef: `line-${ref}`, providerPriceRef: 'price', quantity: 1, amount: money('USD', '1000'), billingCycle: profile === 'monthly' ? yes({ interval: 'month', frequency: 1 }) : yes(null), trial: yes(false), proration: yes(false), period: profile === 'monthly' ? yes(period) : yes(null) }]), source: source(receiptId), ...extra };
}
function input(observation: TransactionObservation | SubscriptionObservation, adverseTransactionRef?: string): VerifiedInput {
  return { scope, inputId: observation.source.receiptId, source: observation.source, observation, retainedRepresentation: JSON.parse(canonicalJson(observation)) as VerifiedInput['retainedRepresentation'], ...(adverseTransactionRef ? { adverseTransactionRef } : {}) };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function setup(profile: 'one_time' | 'monthly' = 'one_time', allowZeroTotal = false, timeoutMs = 1000) {
  const store = new MemoryPaymentStore(); let counter = 0, calls = 0, currentOffer = offer(profile, allowZeroTotal);
  let create: PaymentProvider['createCheckout'] = async command => ({ kind: 'succeeded', value: { intentId: command.intentId, transactionRef: `tx-${calls}`, checkout: { token: `token-${calls}` } } });
  const provider: PaymentProvider = { scope, capabilities: { checkout: true, transactionRead: true, subscriptionRead: true, cancellation: [], paymentUpdate: false, customerManagement: false }, createCheckout: command => { calls += 1; return create(command); }, readTransaction: async () => ({ kind: 'unsupported', capability: 'test-read' }), readSubscription: async () => ({ kind: 'unsupported', capability: 'test-read' }) };
  const payments = createPayments({ scope, producerNamespace: 'payments', provider, store, catalog: { resolveOffer: async () => currentOffer }, now: () => at, newId: () => `id-${++counter}`, operationTimeoutMs: timeoutMs });
  return { payments, store, provider, calls: () => calls, replaceCreate: (next: PaymentProvider['createCheckout']) => { create = next; }, replaceOffer: (next: OfferSnapshot) => { currentOffer = next; } };
}
async function purchase(context: ReturnType<typeof setup>) {
  const result = await context.payments.startPurchase({ buyerId: 'buyer', offerId: 'offer', requestKey: 'request' }); assert.equal(result.kind, 'succeeded');
  if (result.kind !== 'succeeded') throw new Error('Expected checkout'); return result.value;
}
async function observe(context: ReturnType<typeof setup>, observation: TransactionObservation | SubscriptionObservation) {
  assert.equal((await context.payments.ingestVerifiedInput(input(observation))).kind, 'succeeded');
  assert.equal(await context.payments.processInbox(observation.source.receiptId), 'processed');
}

test('minor-unit values retain arbitrary precision and reject implicit scaling or currency mixing', () => {
  assert.deepEqual(addMoney(money('JPY', '900719925474099312345'), money('JPY', '2')), { currency: 'JPY', minorUnits: '900719925474099312347' });
  assert.throws(() => money('USD', '1.2')); assert.throws(() => money('USD', '01')); assert.throws(() => money('USD', '-0'));
  assert.throws(() => addMoney(money('JPY', '1'), money('USD', '1')));
});

test('provider version ordering preserves nanoseconds and timezone equivalence', () => {
  assert.equal(compareTime('2026-01-01T00:00:00.000000001Z', '2026-01-01T00:00:00.000000002Z'), -1);
  assert.equal(compareTime('2026-01-01T01:00:00.123456+01:00', '2026-01-01T00:00:00.123456000Z'), 0);
  assert.equal(exactTime(at).original, at); assert.throws(() => exactTime('2026-02-29T00:00:00Z')); assert.throws(() => exactTime('2026-01-01T00:00:00.1234567890Z'));
});

test('request key repeats immutable order despite later catalog version; changed request conflicts', async () => {
  const context = setup(), checkout = await purchase(context);
  context.replaceOffer({ ...offer(), version: 'v2' });
  assert.deepEqual(await context.payments.startPurchase({ buyerId: 'buyer', offerId: 'offer', requestKey: 'request' }), { kind: 'succeeded', value: checkout });
  assert.deepEqual(await context.payments.startPurchase({ buyerId: 'buyer', offerId: 'different', requestKey: 'request' }), { kind: 'rejected', code: 'conflict' });
  assert.equal(context.calls(), 1);
  assert.equal((await context.payments.readPurchase('buyer', checkout.intentId))?.intent.offer.version, 'v1');
});

test('unconfirmed dispatch commit cannot authorize SDK call; repair sends only a prepared operation', async () => {
  const context = setup(), original = context.store.beginExternalDispatch.bind(context.store); let reject = true;
  context.store.beginExternalDispatch = async (...args) => { if (reject) { reject = false; throw new Error('commit reply lost'); } return original(...args); };
  await assert.rejects(context.payments.startPurchase({ buyerId: 'buyer', offerId: 'offer', requestKey: 'request' }));
  assert.equal(context.calls(), 0); await context.payments.repair(); assert.equal(context.calls(), 1);
});

test('unknown mutation is never automatically retried and late old success does not overwrite a new attempt', async () => {
  const context = setup('one_time', false, 1), first = deferred<ProviderResult<{ intentId: string; transactionRef: string; checkout: { token: string } }>>(); let firstIntent = '';
  context.replaceCreate(async command => { firstIntent = command.intentId; return first.promise; });
  const result = await context.payments.startPurchase({ buyerId: 'buyer', offerId: 'offer', requestKey: 'request' });
  assert.equal(result.kind, 'outcome_unknown'); if (result.kind !== 'outcome_unknown') throw new Error('Expected unknown');
  assert.equal(context.payments.lifecycle().unresolvedExternalCalls, 1);
  await context.payments.startPurchase({ buyerId: 'buyer', offerId: 'offer', requestKey: 'request' }); await context.payments.repair(); assert.equal(context.calls(), 1);
  const operation = await context.payments.readOperation(result.operationId); assert.ok(operation);
  assert.deepEqual(await context.payments.resolveUnknownOperation({ operationId: operation.operationId, expectedRevision: operation.revision, actorId: 'operator', auditRef: 'ticket', reason: 'reviewed', action: 'retry' }), { kind: 'rejected', code: 'validation' });
  const resolved = await context.payments.resolveUnknownOperation({ operationId: operation.operationId, expectedRevision: operation.revision, actorId: 'operator', auditRef: 'ticket', reason: 'reviewed', action: 'retry', acceptedDuplicateRisk: true }); assert.equal(resolved.kind, 'succeeded');
  context.replaceCreate(async command => ({ kind: 'succeeded', value: { intentId: command.intentId, transactionRef: 'new-tx', checkout: { token: 'new' } } }));
  assert.equal((await context.payments.executeOperation(operation.operationId)).kind, 'succeeded');
  first.resolve({ kind: 'succeeded', value: { intentId: firstIntent, transactionRef: 'old-tx', checkout: { token: 'old' } } }); await context.payments.drain();
  const final = await context.payments.readOperation(operation.operationId); assert.equal(final?.state, 'succeeded'); assert.equal(final?.attempts.length, 2);
  assert.equal((final?.result?.kind === 'succeeded' ? (final.result.value as { transactionRef: string }).transactionRef : ''), 'new-tx');
  assert.deepEqual((await context.payments.readPurchase('buyer', firstIntent))?.intent.transactionRefs.sort(), ['new-tx', 'old-tx']);
});

test('normal API-only one-time completion can prove profile with unknown optional subscription/period', async () => {
  const context = setup(), checkout = await purchase(context), observation = transaction(checkout.transactionRef, 'api-only', 'one_time', { subscriptionRef: unknown });
  if (observation.lines.presence !== 'known') throw new Error('Fixture');
  await observe(context, { ...observation, lines: yes(observation.lines.value.map(line => ({ ...line, period: unknown }))) });
  const result = await context.payments.readPurchase('buyer', checkout.intentId);
  assert.equal(result?.transactions[0]?.completion?.classification, 'one_time'); assert.equal(result?.transactions[0]?.completion?.lines[0]?.benefitSlotId, 'benefit');
});

test('zero-value commercial policy, management completion and trials remain distinct', async () => {
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
  if (trialObservation.lines.presence !== 'known') throw new Error('Fixture');
  await observe(trial, { ...trialObservation, lines: yes(trialObservation.lines.value.map(line => ({ ...line, trial: yes(true) }))) });
  assert.equal((await trial.payments.readPurchase('buyer', trialCheckout.intentId))?.transactions[0]?.completion, undefined);
});

test('paid is intermediate; distinct source deliveries produce one immutable completion', async () => {
  const context = setup(), checkout = await purchase(context); await context.payments.registerConsumer('credits');
  await observe(context, transaction(checkout.transactionRef, 'paid', 'one_time', { status: 'paid', version: '2026-01-01T00:00:00Z' }));
  assert.equal((await context.payments.readPurchase('buyer', checkout.intentId))?.transactions[0]?.completion, undefined);
  await observe(context, transaction(checkout.transactionRef, 'completed'));
  const before = (await context.payments.readPurchase('buyer', checkout.intentId))?.transactions[0]?.completion;
  await observe(context, transaction(checkout.transactionRef, 'another-source'));
  assert.deepEqual((await context.payments.readPurchase('buyer', checkout.intentId))?.transactions[0]?.completion, before);
  const deliveries = await context.payments.readDeliveries('credits'); assert.ok(deliveries.length >= 2);
  assert.equal(new Set(deliveries.flatMap(message => message.kind === 'complete' && message.completion ? [message.completion.factId] : [])).size, 1);
});

test('same-version compatible partial evidence upgrades; contradictory known evidence holds', async () => {
  const context = setup(), checkout = await purchase(context);
  await observe(context, transaction(checkout.transactionRef, 'partial', 'one_time', { customerRef: unknown }));
  await observe(context, transaction(checkout.transactionRef, 'full'));
  let aggregate = (await context.payments.readPurchase('buyer', checkout.intentId))?.transactions[0]; assert.ok(aggregate?.completion); assert.ok(!aggregate.flags.includes('conflict'));
  await observe(context, transaction(checkout.transactionRef, 'conflict', 'one_time', { total: yes(money('USD', '999')) }));
  aggregate = (await context.payments.readPurchase('buyer', checkout.intentId))?.transactions[0]; assert.ok(aggregate); assert.ok(aggregate.flags.includes('conflict')); assert.equal(aggregate.completion?.total.minorUnits, '1000');
});

test('newer subscription unknown does not carry old scheduled change into current projection', async () => {
  const context = setup('monthly'), checkout = await purchase(context); await observe(context, transaction(checkout.transactionRef, 'initial', 'monthly'));
  const basis = (await context.payments.readPurchase('buyer', checkout.intentId))?.intent.subscriptionBasisId; assert.ok(basis);
  const subscription: SubscriptionObservation = { kind: 'subscription', subscriptionRef: 'sub-a', version: at, status: yes('active'), customerRef: yes('payer'), scheduledChange: yes({ action: 'cancel', effectiveAt: period.endsAt }), currentPeriod: yes(period), priceRefs: yes(['price']), source: source('scheduled') };
  await observe(context, subscription);
  await observe(context, { ...subscription, version: '2026-01-01T00:00:00.000002Z', scheduledChange: unknown, source: source('newer-incomplete') });
  await observe(context, { ...subscription, version: '2026-01-01T00:00:00Z', status: yes('canceled'), source: source('older-cancel') });
  const projected = (await context.payments.readObservedSubscription('buyer', basis))?.observations[0];
  assert.equal(projected?.current?.scheduledChange.presence, 'unknown'); assert.equal(projected?.lastKnown?.scheduledChange.presence, 'known'); assert.ok(projected?.flags.includes('incomplete'));
  assert.equal(projected?.current?.status.presence === 'known' ? projected.current.status.value : '', 'active');
});

test('adverse T1 admission invalidates an already prepared completion reduction', async () => {
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

test('bounded evidence overflow publishes held control with original facts retained', async () => {
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

test('delivery identity includes digest and independent consumer acknowledgement', async () => {
  const context = setup(), checkout = await purchase(context); await context.payments.registerConsumer('a'); await context.payments.registerConsumer('b');
  await observe(context, transaction(checkout.transactionRef, 'delivery')); const message = (await context.payments.readDeliveries('a'))[0]; assert.ok(message);
  assert.equal(await context.payments.acknowledgeDelivery('a', message.messageId, 'wrong'), 'conflict');
  assert.equal(await context.payments.acknowledgeDelivery('a', message.messageId, message.bodyDigest), 'acknowledged');
  assert.equal(await context.payments.acknowledgeDelivery('a', message.messageId, message.bodyDigest), 'duplicate');
  assert.equal((await context.payments.readDeliveries('a')).length, 0); assert.equal((await context.payments.readDeliveries('b')).length, 1);
});

test('scope, ownership, unsupported capability and recovery fence fail closed', async () => {
  const context = setup(), checkout = await purchase(context);
  assert.equal(await context.payments.readPurchase('other', checkout.intentId), undefined);
  assert.deepEqual(await context.payments.requestCancellation({ buyerId: 'buyer', bindingId: 'unknown', requestKey: 'cancel', timing: 'now' }), { kind: 'unsupported', capability: 'cancellation:now' });
  assert.equal((await context.payments.ingestVerifiedInput({ ...input(transaction(checkout.transactionRef, 'foreign')), scope: { ...scope, applicationId: 'other' } })).kind, 'rejected');
  await context.store.setRecoveryFence(scope, true, 'restore');
  assert.deepEqual(await context.payments.startPurchase({ buyerId: 'buyer', offerId: 'offer', requestKey: 'new' }), { kind: 'rejected', code: 'unavailable' }); assert.equal(context.calls(), 1);
});

test('binding arriving after processed early completion reclassifies stored history through durable publication repair', async () => {
  const context = setup('one_time', false, 1), reply = deferred<ProviderResult<{ intentId: string; transactionRef: string; checkout: { token: string } }>>(); let intentId = '';
  context.replaceCreate(async command => { intentId = command.intentId; return reply.promise; });
  assert.equal((await context.payments.startPurchase({ buyerId: 'buyer', offerId: 'offer', requestKey: 'request' })).kind, 'outcome_unknown');
  await observe(context, transaction('early-tx', 'early-completed'));
  reply.resolve({ kind: 'succeeded', value: { intentId, transactionRef: 'early-tx', checkout: { token: 'ready' } } }); await context.payments.drain();
  assert.equal((await context.payments.readPurchase('buyer', intentId))?.transactions[0]?.completion, undefined);
  await context.payments.repair();
  const aggregate = (await context.payments.readPurchase('buyer', intentId))?.transactions[0]; assert.ok(aggregate?.completion); assert.ok(!aggregate.flags.includes('unresolved_binding'));
});

test('duplicate initial streams preserve both payments and hold renewals until audited technical stream selection', async () => {
  const context = setup('monthly', false, 1), first = deferred<ProviderResult<{ intentId: string; transactionRef: string; checkout: { token: string } }>>(); let intentId = '';
  context.replaceCreate(async command => { intentId = command.intentId; return first.promise; });
  const unknownResult = await context.payments.startPurchase({ buyerId: 'buyer', offerId: 'offer', requestKey: 'request' }); assert.equal(unknownResult.kind, 'outcome_unknown'); if (unknownResult.kind !== 'outcome_unknown') throw new Error('Fixture');
  const operation = await context.payments.readOperation(unknownResult.operationId); assert.ok(operation);
  await context.payments.resolveUnknownOperation({ operationId: operation.operationId, expectedRevision: operation.revision, actorId: 'operator', auditRef: 'duplicate-risk', reason: 'recover', action: 'retry', acceptedDuplicateRisk: true });
  context.replaceCreate(async command => ({ kind: 'succeeded', value: { intentId: command.intentId, transactionRef: 'initial-b', checkout: { token: 'b' } } }));
  await context.payments.executeOperation(operation.operationId);
  first.resolve({ kind: 'succeeded', value: { intentId, transactionRef: 'initial-a', checkout: { token: 'a' } } }); await context.payments.drain();
  await observe(context, transaction('initial-a', 'initial-a-paid', 'monthly'));
  const second = transaction('initial-b', 'initial-b-paid', 'monthly', { subscriptionRef: yes('sub-b') });
  if (second.lines.presence !== 'known') throw new Error('Fixture');
  await observe(context, { ...second, lines: yes(second.lines.value.map(line => ({ ...line, period: yes({ startsAt: '2026-01-02T00:00:00Z', endsAt: '2026-02-02T00:00:00Z' }) }))) });
  let result = await context.payments.readPurchase('buyer', intentId); assert.equal(result?.transactions.filter(item => item.completion).length, 2); assert.ok(result?.transactions.every(item => item.flags.includes('duplicate_initial_purchase')));
  await observe(context, transaction('renew-a', 'renew-a-paid', 'monthly', { origin: yes('subscription_recurring') }));
  await observe(context, transaction('renew-b', 'renew-b-paid', 'monthly', { origin: yes('subscription_recurring'), subscriptionRef: yes('sub-b') }));
  result = await context.payments.readPurchase('buyer', intentId);
  assert.ok(result?.transactions.filter(item => item.transactionRef.startsWith('renew')).every(item => item.completion && item.flags.includes('duplicate_initial_purchase')));
  const basis = result?.intent.subscriptionBasisId; assert.ok(basis);
  const selected = await context.payments.readSubscriptionSelection('buyer', basis, 'sub-b'); assert.ok(selected);
  const resolution = await context.payments.selectSubscriptionStream({ buyerId: 'buyer', bindingId: basis, providerSubscriptionRef: 'sub-b', expectedReadSet: selected.expectedReadSet, actorId: 'operator', auditRef: 'select-b', reason: 'choose duplicate support' }); assert.equal(resolution.kind, 'succeeded');
  await context.payments.flushPublication({ type: 'transaction', id: 'renew-b' });
  result = await context.payments.readPurchase('buyer', intentId);
  assert.ok(!result?.transactions.find(item => item.transactionRef === 'renew-b')?.flags.includes('duplicate_initial_purchase'));
  assert.ok(result?.transactions.find(item => item.transactionRef === 'renew-a')?.flags.includes('duplicate_initial_purchase'));
});

test('shutdown tracks physical safe reads and cleanup, including nested producer promises', async () => {
  const context = setup(), checkout = await purchase(context), read = deferred<ProviderResult<TransactionObservation>>();
  context.provider.readTransaction = async () => read.promise;
  const refreshing = context.payments.refreshPurchase('buyer', checkout.intentId);
  assert.equal(context.payments.stop().pendingWork, 1);
  let drained = false; const drain = context.payments.drain().then(() => { drained = true; });
  await Promise.resolve(); assert.equal(drained, false);
  read.resolve({ kind: 'succeeded', value: transaction(checkout.transactionRef, 'drained-read') }); await refreshing; await drain; assert.equal(drained, true);
});

test('unknown final line profile is incomplete and a fuller same-version receipt positively recovers', async () => {
  const context = setup(), checkout = await purchase(context), observation = transaction(checkout.transactionRef, 'partial-line');
  if (observation.lines.presence !== 'known') throw new Error('Fixture');
  await observe(context, { ...observation, lines: yes(observation.lines.value.map(line => ({ ...line, trial: unknown, proration: unknown, billingCycle: unknown }))) });
  let aggregate = (await context.payments.readPurchase('buyer', checkout.intentId))?.transactions[0]; assert.ok(aggregate); assert.ok(aggregate.flags.includes('incomplete')); assert.ok(!aggregate.flags.includes('catalog_mismatch'));
  await observe(context, transaction(checkout.transactionRef, 'full-line'));
  aggregate = (await context.payments.readPurchase('buyer', checkout.intentId))?.transactions[0]; assert.ok(aggregate?.completion); assert.ok(!aggregate.flags.includes('incomplete')); assert.ok(!aggregate.flags.includes('catalog_mismatch'));
});

test('late success before an authorized retry is dispatched prevents a gratuitous second create', async () => {
  const context = setup('one_time', false, 1), reply = deferred<ProviderResult<{ intentId: string; transactionRef: string; checkout: { token: string } }>>(); let intentId = '';
  context.replaceCreate(async command => { intentId = command.intentId; return reply.promise; });
  const unknownResult = await context.payments.startPurchase({ buyerId: 'buyer', offerId: 'offer', requestKey: 'request' }); assert.equal(unknownResult.kind, 'outcome_unknown'); if (unknownResult.kind !== 'outcome_unknown') throw new Error('Fixture');
  const operation = await context.payments.readOperation(unknownResult.operationId); assert.ok(operation);
  await context.payments.resolveUnknownOperation({ operationId: operation.operationId, expectedRevision: operation.revision, actorId: 'operator', auditRef: 'risk', reason: 'retry authorized', action: 'retry', acceptedDuplicateRisk: true });
  reply.resolve({ kind: 'succeeded', value: { intentId, transactionRef: 'proven-existing', checkout: { token: 'existing' } } }); await context.payments.drain();
  assert.equal((await context.payments.executeOperation(operation.operationId)).kind, 'succeeded'); assert.equal(context.calls(), 1);
});

test('payment update recovers the original recurring period and method updates remain noncommercial', async () => {
  const context = setup('monthly'), checkout = await purchase(context); await observe(context, transaction(checkout.transactionRef, 'monthly-initial', 'monthly'));
  const basis = (await context.payments.readPurchase('buyer', checkout.intentId))?.intent.subscriptionBasisId; assert.ok(basis);
  const renewal = transaction('failed-renewal', 'renewal-failed', 'monthly', { status: 'past_due', origin: yes('subscription_recurring'), version: '2026-02-01T00:00:00Z' });
  if (renewal.lines.presence !== 'known') throw new Error('Fixture');
  const renewalLines = renewal.lines.value.map(line => ({ ...line, period: yes({ startsAt: '2026-02-01T00:00:00Z', endsAt: '2026-03-01T00:00:00Z' }) }));
  await observe(context, { ...renewal, lines: yes(renewalLines) });
  Object.assign(context.provider.capabilities, { paymentUpdate: true });
  context.provider.openPaymentUpdate = async command => ({ kind: 'succeeded', value: { intentId: command.intentId, transactionRef: 'failed-renewal', purpose: 'recovery', checkout: { token: 'recover' } } });
  const ready = await context.payments.openPaymentUpdate({ buyerId: 'buyer', bindingId: basis, requestKey: 'recover' }); assert.equal(ready.kind, 'succeeded'); if (ready.kind === 'succeeded') assert.equal(ready.value.purpose, 'recovery');
  await observe(context, { ...renewal, lines: yes(renewalLines), status: 'completed', version: '2026-02-02T00:00:00Z', source: source('renewal-recovered') });
  const fact = (await context.payments.readPurchase('buyer', checkout.intentId))?.transactions.find(item => item.transactionRef === 'failed-renewal')?.completion;
  assert.equal(fact?.classification, 'recovery'); assert.equal(fact?.lines[0]?.period?.startsAt, '2026-02-01T00:00:00Z');
  context.provider.openPaymentUpdate = async command => ({ kind: 'succeeded', value: { intentId: command.intentId, transactionRef: 'method-change', purpose: 'payment_method', checkout: { token: 'method' } } });
  assert.equal((await context.payments.openPaymentUpdate({ buyerId: 'buyer', bindingId: basis, requestKey: 'method' })).kind, 'succeeded');
  await observe(context, transaction('method-change', 'method-completed', 'monthly', { origin: yes('subscription_payment_method_change'), total: yes(money('USD', '0')) }));
  assert.equal((await context.payments.readPurchase('buyer', checkout.intentId))?.transactions.find(item => item.transactionRef === 'method-change')?.completion, undefined);
});

test('conflicting raw event identity holds its original route even when the conflicting payload changes transaction', async () => {
  const context = setup(), checkout = await purchase(context);
  const raw = (receiptId: string, stableEnvelopeDigest: string): EvidenceSource => ({ ...source(receiptId), kind: 'verified_webhook', eventId: 'same-event', stableEnvelopeDigest, verification: { verifiedAt: at, endpointId: 'endpoint', rawBodyDigest: digest(receiptId) } });
  const first = transaction(checkout.transactionRef, 'raw-a', 'one_time', { source: raw('raw-a', 'body-a') }); await observe(context, first);
  const conflicting = transaction('different-transaction', 'raw-b', 'one_time', { source: raw('raw-b', 'body-b') });
  assert.equal((await context.payments.ingestVerifiedInput(input(conflicting))).kind, 'succeeded');
  assert.equal(await context.payments.processInbox('raw-b'), 'quarantined');
  assert.ok((await context.payments.readPurchase('buyer', checkout.intentId))?.transactions[0]?.flags.includes('conflict'));
});
