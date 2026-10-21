import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';
import { createPayments, digest, subscriptionStatuses, transactionOrigins } from '@agent-teams/payments-core';
import type { EvidenceMessage, Field, OfferSnapshot, PaymentProvider, PaymentScope, Period, SubscriptionObservation, TransactionObservation, VerifiedInput } from '@agent-teams/payments-core';
import { createNodePostgresPaymentDatabase } from '@agent-teams/payments-postgres/node-postgres';
import { createPostgresPaymentStore, migratePaymentSchema } from '@agent-teams/payments-postgres';
import { CreditFixture } from '../fixtures/consumers/index.ts';
import type { Effect } from '../fixtures/consumers/index.ts';

// Deliberately unrelated wire vocabulary. This is a disposable contract fixture, not another
// production provider. Expected classifications, totals and effect counts below are constants.
type ForeignTransaction = Readonly<{
  reference: string; originCode: string; stateCode: string; changedAt: string;
  subscription: string | null; plan: 'one_time' | 'monthly'; period: Period | null; amount: string;
}>;
const known = <T>(value: T): Field<T> => ({ presence: 'known', value });
const firstPeriod = { startsAt: '2026-10-01T00:00:00Z', endsAt: '2026-11-01T00:00:00Z' };
const secondPeriod = { startsAt: firstPeriod.endsAt, endsAt: '2026-12-01T00:00:00Z' };
const firstVersion = '2026-10-01T00:00:00.000001Z';

function foreignOrigin(code: string): Field<string> {
  switch (code) {
    case 'ORDER_CHECKOUT': return known(transactionOrigins.checkoutApi);
    case 'PLAN_ACTIVATION': return known(transactionOrigins.initialSubscription);
    case 'CYCLE_INVOICE': return known(transactionOrigins.recurringSubscription);
    case 'CARD_PROFILE_WRITE': return known(transactionOrigins.paymentMethodChange);
    default: return { presence: 'unknown' }; // Exact raw code remains in the retained receipt.
  }
}

function foreignProvider(scope: PaymentScope) {
  const transactions = new Map<string, ForeignTransaction>();
  let creates = 0, updates = 0;
  function receipt(raw: ForeignTransaction): VerifiedInput & Readonly<{ observation: TransactionObservation }> {
    const source = {
      kind: 'authenticated_api' as const, receiptId: digest([scope, raw.reference, raw.changedAt]),
      representationDigest: digest(raw), decoderVersion: 'foreign-fixture/1', apiProfile: 'foreign-fixture/1',
    };
    const observation: TransactionObservation = {
      kind: 'transaction', transactionRef: raw.reference, version: raw.changedAt,
      status: raw.stateCode, statusMeaning: raw.stateCode === 'SETTLED_OK' ? { kind: 'completed' } : { kind: 'unsupported' },
      origin: foreignOrigin(raw.originCode), customerRef: known('foreign-payer'), subscriptionRef: known(raw.subscription),
      intentCorrelation: { presence: 'unknown' }, currency: known('USD'), total: known({ currency: 'USD', minorUnits: raw.amount }),
      lines: known([{
        providerLineRef: `line-${raw.reference}`, providerPriceRef: `foreign-${raw.plan}`, quantity: 1,
        amount: { currency: 'USD', minorUnits: raw.amount },
        billingCycle: known(raw.plan === 'monthly' ? { interval: 'month', frequency: 1 } : null),
        trial: known(false), proration: known(false), period: known(raw.period),
      }]), source,
    };
    return { scope, inputId: source.receiptId, source, observation, retainedRepresentation: raw };
  }
  function subscriptionReceipt(): VerifiedInput & Readonly<{ observation: SubscriptionObservation }> {
    const raw = { reference: 'foreign-subscription', stateCode: 'ENABLED_RENEWING', changedAt: firstVersion };
    const source = { kind: 'authenticated_api' as const, receiptId: digest(raw), representationDigest: digest(raw), decoderVersion: 'foreign-fixture/1', apiProfile: 'foreign-fixture/1' };
    const observation: SubscriptionObservation = {
      kind: 'subscription', subscriptionRef: raw.reference, version: raw.changedAt,
      status: known(raw.stateCode === 'ENABLED_RENEWING' ? subscriptionStatuses.active : raw.stateCode), customerRef: known('foreign-payer'),
      scheduledChange: known(null), currentPeriod: known(firstPeriod), collection: known({ kind: 'automatic' }),
      items: known([{ providerPriceRef: 'foreign-monthly', quantity: known(1), billingCycle: known({ interval: 'month', frequency: 1 }), trial: known(false) }]), source,
    };
    return { scope, inputId: source.receiptId, source, observation, retainedRepresentation: raw };
  }
  const provider: PaymentProvider = {
    scope, capabilities: { checkout: true, transactionRead: true, subscriptionRead: true, cancellation: [], paymentUpdate: true, customerManagement: false },
    createCheckout: async command => {
      creates += 1;
      const reference = `foreign-order-${creates}`, monthly = command.offer.profile === 'monthly';
      transactions.set(reference, { reference, originCode: monthly ? 'PLAN_ACTIVATION' : 'ORDER_CHECKOUT', stateCode: 'SETTLED_OK', changedAt: firstVersion, subscription: monthly ? 'foreign-subscription' : null, plan: command.offer.profile, period: monthly ? firstPeriod : null, amount: '1000' });
      return { kind: 'succeeded', value: { intentId: command.intentId, transactionRef: reference, checkout: { token: `foreign-token-${creates}` } } };
    },
    readTransaction: async reference => {
      const raw = transactions.get(reference);
      if (!raw) {return { kind: 'rejected', code: 'unavailable' };}
      return { kind: 'succeeded', value: receipt(raw).observation };
    },
    readTransactionInput: async reference => {
      const raw = transactions.get(reference);
      return raw ? { kind: 'succeeded', value: receipt(raw) } : { kind: 'rejected', code: 'unavailable' };
    },
    readSubscription: async () => ({ kind: 'succeeded', value: subscriptionReceipt().observation }),
    readSubscriptionInput: async () => ({ kind: 'succeeded', value: subscriptionReceipt() }),
    openPaymentUpdate: async command => {
      updates += 1;
      const reference = 'foreign-card-maintenance';
      transactions.set(reference, { reference, originCode: 'CARD_PROFILE_WRITE', stateCode: 'SETTLED_OK', changedAt: firstVersion, subscription: command.subscriptionRef, plan: 'monthly', period: firstPeriod, amount: '0' });
      return { kind: 'succeeded', value: { intentId: command.intentId, transactionRef: reference, purpose: 'payment_method', checkout: { token: 'foreign-card-token' } } };
    },
  };
  return { provider, transactions, receipt, calls: () => ({ creates, updates }) };
}

function compareFactRows(a: readonly string[], b: readonly string[]): number {
  const left = a.join(','), right = b.join(',');
  return left < right ? -1 : left > right ? 1 : 0;
}

void test('foreign provider vocabulary preserves public completion, renewal and management semantics with durable replay and one grant per cause', { timeout: 30_000 }, async () => {
  const databaseUrl = process.env['DATABASE_URL'];
  assert.ok((databaseUrl !== undefined && databaseUrl !== ''), 'Foreign-provider E2E requires disposable PostgreSQL18');
  const pool = new Pool({ connectionString: databaseUrl, max: 8, connectionTimeoutMillis: 1000 });
  const database = createNodePostgresPaymentDatabase(pool);
  const suffix = randomUUID().replaceAll('-', '').slice(0, 16), schema = `foreign_${suffix}`, consumerSchema = `foreign_credit_${suffix}`;
  const scope: PaymentScope = { applicationId: 'foreign-contract', provider: 'foreign-fixture', paymentAccountId: 'foreign-account', environment: 'sandbox' };
  const producerNamespace = 'foreign-contract/1';
  const foreign = foreignProvider(scope);
  let payments: ReturnType<typeof createPayments> | undefined;
  try {
    await migratePaymentSchema({ database, schema, scope });
    const store = await createPostgresPaymentStore({ database, schema, scope });
    const credit = new CreditFixture({ pool, schema: consumerSchema, trust: { scope, producerNamespace } });
    await credit.migrate();
    const catalog = { resolveOffer: async (_scope: PaymentScope, offerId: string): Promise<OfferSnapshot | undefined> => {
      if (offerId !== 'one_time' && offerId !== 'monthly') {return undefined;}
      return { applicationId: scope.applicationId, offerId, version: '1', policyVersion: '1', profile: offerId, currency: 'USD', allowZeroTotal: false, lines: [{ providerPriceRef: `foreign-${offerId}`, benefitSlotId: 'benefit', quantity: 1 }] };
    } };
    const runtime = createPayments({ scope, producerNamespace, provider: foreign.provider, store, catalog });
    payments = runtime;
    await runtime.registerConsumer('credits');
    const delivered = new Map<string, EvidenceMessage>();
    async function deliver() {
      for (const message of await runtime.readDeliveries('credits', 100)) {
        assert.equal((await credit.receive(message)).acknowledge, true);
        assert.deepEqual(await credit.receive(message), { acknowledge: true, outcome: 'duplicate' });
        assert.equal(await runtime.acknowledgeDelivery('credits', message.messageId, message.bodyDigest), 'acknowledged');
        assert.equal(await runtime.acknowledgeDelivery('credits', message.messageId, message.bodyDigest), 'duplicate');
        delivered.set(message.messageId, message);
      }
    }
    async function purchase(profile: 'one_time' | 'monthly', requestKey: string) {
      const result = await runtime.startPurchase({ buyerId: 'buyer', offerId: profile, requestKey });
      assert.equal(result.kind, 'succeeded');
      return result.value;
    }
    const oneTime = await purchase('one_time', 'topup');
    assert.deepEqual(await runtime.refreshPurchase('buyer', oneTime.intentId), { kind: 'succeeded', value: 1 });
    await deliver();
    const monthly = await purchase('monthly', 'subscription');
    await runtime.refreshPurchase('buyer', monthly.intentId);
    await deliver();
    const renewal: ForeignTransaction = { reference: 'foreign-renewal', originCode: 'CYCLE_INVOICE', stateCode: 'SETTLED_OK', changedAt: '2026-11-01T00:00:00.000001Z', subscription: 'foreign-subscription', plan: 'monthly', period: secondPeriod, amount: '1000' };
    const renewalInput = foreign.receipt(renewal);
    assert.equal((await runtime.ingestVerifiedInput(renewalInput)).kind, 'succeeded');
    assert.equal(await runtime.processInbox(renewalInput.inputId), 'processed');
    await deliver();
    const bindingId = (await runtime.readPurchase('buyer', monthly.intentId))?.intent.subscriptionBasisId;
    assert.ok((bindingId !== undefined && bindingId !== ''));
    const management = await runtime.openPaymentUpdate({ buyerId: 'buyer', bindingId, requestKey: 'card-update' });
    assert.equal(management.kind, 'succeeded');
    const maintenanceRaw = foreign.transactions.get('foreign-card-maintenance');
    assert.ok(maintenanceRaw);
    const maintenanceInput = foreign.receipt(maintenanceRaw);
    assert.equal((await runtime.ingestVerifiedInput(maintenanceInput)).kind, 'succeeded');
    assert.equal(await runtime.processInbox(maintenanceInput.inputId), 'processed');
    await deliver();
    const unknown = await purchase('one_time', 'unknown-origin');
    const unknownRaw = foreign.transactions.get(unknown.transactionRef);
    assert.ok(unknownRaw);
    foreign.transactions.set(unknown.transactionRef, { ...unknownRaw, originCode: 'UNRECOGNIZED_UPGRADE' });
    await runtime.refreshPurchase('buyer', unknown.intentId);
    await deliver();
    // A provider's unrecognized wire code may exactly equal a reserved core token.
    // Only deliberate mapping grants meaning; preserving raw custody does not require
    // presenting that code as a known canonical origin to the reducer.
    const collidingCheckout = { ...unknownRaw, originCode: 'api', changedAt: '2026-10-02T00:00:00.000001Z' };
    foreign.transactions.set(unknown.transactionRef, collidingCheckout);
    await runtime.refreshPurchase('buyer', unknown.intentId);
    await deliver();
    const collidingRenewal = foreign.receipt({ ...renewal, reference: 'foreign-unrecognized-renewal', originCode: 'subscription_recurring', changedAt: '2026-11-02T00:00:00.000001Z' });
    assert.equal((await runtime.ingestVerifiedInput(collidingRenewal)).kind, 'succeeded');
    assert.equal(await runtime.processInbox(collidingRenewal.inputId), 'processed');
    await deliver();
    const rejectedRenewal = await store.loadReductionInput(scope, collidingRenewal.inputId);
    assert.equal(rejectedRenewal?.state.bindings['foreign-unrecognized-renewal'], undefined);
    assert.equal(rejectedRenewal?.state.transactions['foreign-unrecognized-renewal']?.completion, undefined);
    assert.deepEqual(rejectedRenewal?.state.transactions['foreign-unrecognized-renewal']?.current?.origin, { presence: 'unknown' });
    assert.deepEqual(rejectedRenewal.state.inbox[collidingRenewal.inputId]?.input.retainedRepresentation, collidingRenewal.retainedRepresentation);

    const facts = [...delivered.values()].flatMap(message => message.kind === 'complete' && message.completion ? [message.completion] : []);
    assert.deepEqual(facts.map(fact => [fact.transactionRef, fact.classification, fact.total.minorUnits]).toSorted(compareFactRows), [
      [oneTime.transactionRef, 'one_time', '1000'], [monthly.transactionRef, 'initial', '1000'], ['foreign-renewal', 'renewal', '1000'],
    ].toSorted(compareFactRows));
    assert.ok(facts.every(fact => fact.scope.provider === 'foreign-fixture'));
    const monthlyRead = await runtime.readPurchase('buyer', monthly.intentId);
    const maintenance = monthlyRead?.transactions.find(transaction => transaction.transactionRef === 'foreign-card-maintenance');
    assert.ok(maintenance);
    assert.equal(maintenance.completion, undefined);
    assert.deepEqual(maintenance.current?.origin, known('subscription_payment_method_change'));
    assert.deepEqual(maintenance.current.statusMeaning, { kind: 'completed' });
    const unknownRead = await runtime.readPurchase('buyer', unknown.intentId);
    assert.equal(unknownRead?.transactions[0]?.completion, undefined);
    assert.ok((unknownRead?.transactions[0]?.flags.includes('incomplete') === true));
    assert.deepEqual(unknownRead.transactions[0].current?.origin, { presence: 'unknown' });
    const rejectedCheckout = await store.loadReductionInput(scope, foreign.receipt(collidingCheckout).inputId);
    assert.deepEqual(rejectedCheckout?.state.inbox[foreign.receipt(collidingCheckout).inputId]?.input.retainedRepresentation, collidingCheckout);
    const savedRenewal = await store.loadReductionInput(scope, renewalInput.inputId);
    assert.deepEqual(savedRenewal?.state.inbox[renewalInput.inputId]?.input.retainedRepresentation, renewal);
    assert.equal(savedRenewal.state.inbox[renewalInput.inputId]?.input.source.representationDigest, digest(renewal));
    assert.equal(await runtime.processInbox(renewalInput.inputId), 'duplicate');
    await runtime.repair(); await deliver();
    const restartedCredit = new CreditFixture({ pool, schema: consumerSchema, trust: { scope, producerNamespace } });
    for (const message of delivered.values()) {assert.equal((await restartedCredit.receive(message)).outcome, 'duplicate');}
    const effects = (await restartedCredit.owner.inspect<{ body: Effect }>('effects')).map(row => row.body);
    assert.equal(effects.length, 3);
    assert.ok(effects.every(effect => effect.kind === 'grant'));
    assert.equal(effects.reduce((sum, effect) => sum + BigInt(effect.amount), 0n), 225n);
    assert.equal((await restartedCredit.decisions()).reduce((sum, decision) => sum + BigInt(decision.body.eligible), 0n), 225n);
    assert.deepEqual(await runtime.readDeliveries('credits'), []);
    assert.deepEqual(foreign.calls(), { creates: 3, updates: 1 });
  } finally {
    payments?.stop(); await payments?.drain();
    await pool.query(`DROP SCHEMA IF EXISTS "${consumerSchema}" CASCADE; DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await pool.end();
  }
});
