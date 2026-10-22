import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';
import { canonicalJson, createPayments, digest } from '@agent-teams/payments-core';
import type { EvidenceMessage, OfferSnapshot, PaymentOperation, PaymentProvider, PaymentScope, PaymentStore, VerifiedInput } from '@agent-teams/payments-core';
import { createNodePostgresPaymentDatabase } from '@agent-teams/payments-postgres/node-postgres';
import { createPostgresPaymentJobs, createPostgresPaymentStore, migratePaymentSchema, PaymentDatabaseError } from '@agent-teams/payments-postgres';
import { CreditFixture } from '../fixtures/consumers/index.ts';
import type { Effect } from '../fixtures/consumers/index.ts';
import { postgresFaultProxy } from '@agent-teams/payments-postgres/testing';
import { sqlWakeupFixture } from './queue-transport-fixture.ts';

const scope: PaymentScope = { applicationId: 'queue-contract', provider: 'fixture', paymentAccountId: 'merchant', environment: 'sandbox' };
const producerNamespace = 'queue-contract/1';
const offer: OfferSnapshot = { applicationId: scope.applicationId, offerId: 'topup', version: '1', policyVersion: '1', profile: 'one_time', currency: 'USD', allowZeroTotal: false, lines: [{ providerPriceRef: 'price', benefitSlotId: 'purchased', quantity: 1 }] };
const known = <T>(value: T) => ({ presence: 'known' as const, value });
function input(transactionRef: string, id: string): VerifiedInput {
  const retainedRepresentation = { payment: transactionRef }, source = { kind: 'authenticated_api' as const, receiptId: id, representationDigest: digest(retainedRepresentation), apiProfile: 'fixture/1', decoderVersion: '1' };
  return { scope, inputId: id, retainedRepresentation, source, observation: {
    kind: 'transaction', transactionRef, version: '2026-10-01T00:00:00.000001Z', status: 'completed', statusMeaning: { kind: 'completed' },
    origin: known('api'), customerRef: known('payer'), subscriptionRef: known(null), intentCorrelation: { presence: 'unknown' },
    currency: known('USD'), total: known({ currency: 'USD', minorUnits: '1000' }),
    lines: known([{ providerLineRef: `line-${transactionRef}`, providerPriceRef: 'price', quantity: 1, amount: { currency: 'USD', minorUnits: '1000' }, billingCycle: known(null), trial: known(false), proration: known(false), period: known(null) }]), source,
  } };
}
function runtime(store: PaymentStore, create?: PaymentProvider['createCheckout'], timeoutMs = 1000) {
  let calls = 0;
  const provider: PaymentProvider = { scope, capabilities: { checkout: true, transactionRead: true, subscriptionRead: true, cancellation: [], paymentUpdate: false, customerManagement: false },
    createCheckout: async command => { calls += 1; return create ? create(command) : { kind: 'succeeded', value: { intentId: command.intentId, transactionRef: `tx-${command.intentId}`, checkout: {} } }; },
    readTransaction: async () => ({ kind: 'unsupported', capability: 'fixture' }), readSubscription: async () => ({ kind: 'unsupported', capability: 'fixture' }),
  };
  const options = { scope, producerNamespace, store, provider, catalog: { resolveOffer: async () => offer }, operationTimeoutMs: timeoutMs };
  return { payments: createPayments(options), options, calls: () => calls };
}
async function prepare(store: PaymentStore, id: string): Promise<void> {
  const operation: PaymentOperation = { operationId: `op-${id}`, kind: 'purchase', buyerId: 'buyer', requestKey: id, fingerprint: digest(['purchase', 'buyer', 'topup']), intentId: id, revision: 1, state: 'prepared', attempts: [], audits: [] };
  assert.equal((await store.admitIntent(scope, { operation, intent: { intentId: id, buyerId: 'buyer', requestKey: id, fingerprint: operation.fingerprint, offer, operationId: operation.operationId, transactionRefs: [], createdAt: '2026-10-01T00:00:00Z' } })).kind, 'created');
}
async function fixture() {
  const connectionString = process.env['DATABASE_URL']; assert.ok(connectionString !== undefined && connectionString !== '', 'Queue-transport E2E requires disposable PostgreSQL18');
  const pool = new Pool({ connectionString, max: 10, connectionTimeoutMillis: 1000 });
  const database = createNodePostgresPaymentDatabase(pool);
  const suffix = randomUUID().replaceAll('-', '').slice(0, 16), schema = `queue_pay_${suffix}`, wakeSchema = `queue_wake_${suffix}`, creditSchema = `queue_credit_${suffix}`;
  await migratePaymentSchema({ database, schema, scope });
  const wakeups = sqlWakeupFixture({ pool, schema: wakeSchema, paymentSchema: schema, scope }); await wakeups.bootstrap();
  const errors: Error[] = [];
  const options = { database, paymentSchema: schema, scope, transport: wakeups.transport, onError: (error: Error) => { errors.push(error); } };
  const jobs = createPostgresPaymentJobs(options);
  const store = await createPostgresPaymentStore({ database, schema, scope, queue: jobs.queue });
  return { pool, database, schema, wakeSchema, creditSchema, wakeups, store, jobs, options, errors, connectionString, async close() {
    await jobs.stop(); await jobs.drain();
    for (const name of [schema, wakeSchema, creditSchema]) {await pool.query(`DROP SCHEMA IF EXISTS "${name}" CASCADE`);}
    await pool.end();
  } };
}

void test('alternate durable transport uses the same store/runner for atomic admission, restart repair, independent T3 and exact ACK', { timeout: 30_000 }, async () => {
  const f = await fixture(), original = runtime(f.store);
  let jobs = f.jobs, payments = original.payments;
  const credit = new CreditFixture({ pool: f.pool, schema: f.creditSchema, trust: { scope, producerNamespace } });
  try {
    await credit.migrate(); await payments.registerConsumer('credits');
    f.wakeups.rejectNextEnqueue();
    await assert.rejects(payments.startPurchase({ buyerId: 'buyer', offerId: 'topup', requestKey: 'rollback' }), /admission failure/);
    assert.equal(original.calls(), 0);
    assert.equal((await f.pool.query(`SELECT 1 FROM "${f.schema}".records WHERE kind IN ('intents', 'operations')`)).rows.length, 0);
    assert.equal((await f.pool.query(`SELECT 1 FROM "${f.schema}".obligations`)).rows.length, 0);
    assert.equal((await f.pool.query(`SELECT 1 FROM "${f.wakeSchema}".wakeups`)).rows.length, 0);
    await prepare(f.store, 'purchase');
    await jobs.start({ payments, store: f.store });
    const prepared = await f.wakeups.pump('prepared'); assert.ok(prepared);
    assert.equal((await payments.readOperation('op-purchase'))?.state, 'succeeded'); assert.equal(original.calls(), 1);
    await payments.ingestVerifiedInput(input('tx-purchase', 'paid'));
    await f.wakeups.empty(); payments.stop(); await jobs.stop(); await jobs.drain();

    // No transport metadata or payment identity changes across reconstruction; no pg-boss setup.
    const wakeups = sqlWakeupFixture({ pool: f.pool, schema: f.wakeSchema, paymentSchema: f.schema, scope });
    jobs = createPostgresPaymentJobs({ ...f.options, transport: wakeups.transport });
    const store = await createPostgresPaymentStore({ database: f.database, schema: f.schema, scope, queue: jobs.queue });
    payments = createPayments({ ...original.options, store });
    let receipts = 0;
    const consumer = async (message: EvidenceMessage) => {
      assert.equal((await credit.receive(message)).acknowledge, true); receipts += 1;
      if (receipts === 1) {throw new Error('lost consumer receipt after durable T3');}
      return { messageId: message.messageId, bodyDigest: receipts === 2 ? 'wrong-digest' : message.bodyDigest };
    };
    await jobs.start({ payments, store, consumers: { credits: consumer } });
    assert.ok(await wakeups.pump('inbox')); // T2 creates the independent delivery obligation.
    await wakeups.pumpAll();
    const pending = await payments.readDeliveries('credits'); assert.equal(pending.length, 1);
    const message = pending[0]; assert.ok(message);
    const effects = async () => (await f.pool.query<{ body: Effect }>(`SELECT body FROM "${f.creditSchema}".effects`)).rows.map(row => row.body);
    assert.deepEqual((await effects()).map(effect => [effect.kind, effect.amount]), [['grant', '25']]);
    const purchase = await payments.readPurchase('buyer', 'purchase');
    assert.equal(purchase?.transactions[0]?.completion?.total.minorUnits, '1000');
    assert.equal(purchase.transactions[0].completion.classification, 'one_time');
    const work = { kind: 'delivery' as const, id: canonicalJson([message.messageId, 'credits']) };
    await f.pool.query(`UPDATE "${f.schema}".obligations SET next_attempt_at = clock_timestamp() WHERE kind = 'delivery'`);
    await wakeups.empty(); assert.equal((await jobs.repair(1)).enqueued, 1);
    await wakeups.pumpAll();
    assert.equal((await payments.readDeliveries('credits')).length, 1, 'a mismatched receipt cannot ACK even after T3');
    assert.equal((await f.pool.query<{ state: string }>(`SELECT state FROM "${f.schema}".obligations WHERE kind = 'delivery'`)).rows[0]?.state, 'quarantined');
    await jobs.redrive(work, 'reviewed-transport-receipt'); await wakeups.pumpAll();
    assert.deepEqual(await payments.readDeliveries('credits'), []);
    await wakeups.replay(work); await wakeups.replay(prepared);
    assert.equal(receipts, 3); assert.equal(original.calls(), 1); assert.equal((await effects()).length, 1);
    assert.equal(await payments.acknowledgeDelivery('credits', message.messageId, message.bodyDigest), 'duplicate');
    assert.equal(f.errors.length, 1, 'only the injected lost receipt is an unexpected handler failure');
  } finally { payments.stop(); await jobs.stop(); await jobs.drain(); await f.close(); }
});

void test('alternate transport repair excludes queued older work before LIMIT and competing passes advance later obligations', { timeout: 15_000 }, async () => {
  const f = await fixture();
  try {
    for (const id of ['a', 'b', 'c']) {await prepare(f.store, id);}
    await f.pool.query(`UPDATE "${f.schema}".obligations SET next_attempt_at = clock_timestamp() - CASE id WHEN 'op-a' THEN interval '3 seconds' WHEN 'op-b' THEN interval '2 seconds' ELSE interval '1 second' END`);
    await f.pool.query(`DELETE FROM "${f.wakeSchema}".wakeups WHERE id <> 'op-a'`);
    const results = await Promise.all([f.jobs.repair(1), f.jobs.repair(1)]);
    assert.equal(results.reduce((sum, result) => sum + result.enqueued, 0), 2);
    assert.deepEqual((await f.pool.query<{ id: string }>(`SELECT id FROM "${f.wakeSchema}".wakeups ORDER BY id`)).rows.map(row => row.id), ['op-a', 'op-b', 'op-c']);
    const mismatched = { ...f.wakeups.transport, namespace: { paymentSchema: f.schema, scope: { ...scope, applicationId: 'foreign' } } };
    assert.throws(() => createPostgresPaymentJobs({ ...f.options, transport: mismatched }), /namespace mismatch/);
    await assert.rejects(createPostgresPaymentStore({ database: f.database, schema: f.schema, scope, queue: mismatched }), /namespace mismatch/);
  } finally { await f.close(); }
});

void test('alternate enqueue shares the real unknown COMMIT boundary and no wake-up can redispatch its marker', { timeout: 15_000 }, async () => {
  const f = await fixture(), proxy = await postgresFaultProxy(f.connectionString);
  const proxyPool = new Pool({ connectionString: proxy.connectionString, max: 3, connectionTimeoutMillis: 1000 });
  let context: ReturnType<typeof runtime> | undefined;
  try {
    const store = await createPostgresPaymentStore({ database: createNodePostgresPaymentDatabase(proxyPool), schema: f.schema, scope, queue: f.jobs.queue });
    const dispatch = store.beginExternalDispatch.bind(store);
    store.beginExternalDispatch = async (...args) => {proxy.loseNextCommit(); return dispatch(...args);};
    context = runtime(store);
    await assert.rejects(context.payments.startPurchase({ buyerId: 'buyer', offerId: 'topup', requestKey: 'lost-marker' }), error => error instanceof PaymentDatabaseError && error.kind === 'commit_unknown');
    assert.equal(context.calls(), 0);
    const saved = (await f.pool.query<{ body: PaymentOperation }>(`SELECT body FROM "${f.schema}".records WHERE kind = 'operations'`)).rows[0]?.body;
    assert.equal(saved?.state, 'dispatch_started');
    assert.equal((await f.pool.query(`SELECT 1 FROM "${f.wakeSchema}".wakeups WHERE kind = 'unknown'`)).rows.length, 1, 'marker and replacement wake-up committed atomically');
    await f.wakeups.empty(); await f.jobs.start({ payments: context.payments, store }); await f.wakeups.pumpAll();
    await context.payments.repair();
    assert.equal((await context.payments.readOperation(saved.operationId))?.state, 'dispatch_started', 'manual-review quarantine preserves the uncertain durable marker'); assert.equal(context.calls(), 0);
  } finally { context?.payments.stop(); await context?.payments.drain(); await f.close(); await proxyPool.end(); await proxy.close(); }
});

void test('alternate transport stop retains admitted consumer I/O until physical drain and preserves a sibling on the borrowed pool', { timeout: 15_000 }, async () => {
  const f = await fixture(), context = runtime(f.store), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const credit = new CreditFixture({ pool: f.pool, schema: f.creditSchema, trust: { scope, producerNamespace } });
  const siblingSchema = `${f.schema}_s`, siblingScope = { ...scope, applicationId: 'queue-sibling' };
  let pumping: Promise<unknown> | undefined;
  try {
    await credit.migrate(); await context.payments.registerConsumer('credits');
    const checkout = await context.payments.startPurchase({ buyerId: 'buyer', offerId: 'topup', requestKey: 'held-consumer' }); assert.equal(checkout.kind, 'succeeded');
    await context.payments.ingestVerifiedInput(input(checkout.value.transactionRef, 'held-paid'));
    await f.jobs.start({ payments: context.payments, store: f.store, consumers: { credits: async message => {
      entered.resolve(); await release.promise; assert.equal((await credit.receive(message)).acknowledge, true);
      return { messageId: message.messageId, bodyDigest: message.bodyDigest };
    } } });
    await f.wakeups.pump('inbox'); pumping = f.wakeups.pump('delivery'); await entered.promise;
    const stopTransport = f.wakeups.transport.stop.bind(f.wakeups.transport);
    let cleanupAttempts = 0;
    f.wakeups.transport.stop = async timeout => {cleanupAttempts += 1; if (cleanupAttempts === 1) {throw new Error('injected transport stop failure');} await stopTransport(timeout);};
    context.payments.stop(); const stopping = f.jobs.stop(10);
    let drained = false; const draining = f.jobs.drain().then(result => {drained = true; return result;});
    await assert.rejects(stopping, /transport stop failure/);
    await Promise.resolve(); assert.equal(drained, false, 'failed stop cannot abandon already admitted physical I/O');
    assert.equal(f.jobs.status().transportStopped, false, 'failed transport cleanup is not reported as stopped');
    const stopped = await f.jobs.stop(10);
    assert.equal(stopped.transportStopped, true); assert.equal(stopped.admittedHandlers, 1);
    assert.equal((await context.payments.readDeliveries('credits')).length, 1, 'unconfirmed T3 remains pending');
    await migratePaymentSchema({ database: f.database, schema: siblingSchema, scope: siblingScope });
    const sibling = await createPostgresPaymentStore({ database: f.database, schema: siblingSchema, scope: siblingScope });
    await sibling.registerConsumer(siblingScope, 'sibling-audit', false);
    assert.deepEqual(await sibling.listWork(siblingScope, 'inbox', 1), []);
    assert.equal(await sibling.readPurchase(siblingScope, 'buyer', checkout.value.intentId), undefined, 'a sibling namespace remains usable and independent');
    await Promise.resolve(); assert.equal(drained, false);
    release.resolve(); await pumping;
    assert.deepEqual(await draining, { transportStopped: true, admittedHandlers: 0, unresolvedExternalCalls: 0, pendingCoreWork: 0 });
    assert.deepEqual(await context.payments.readDeliveries('credits'), []); assert.equal(context.calls(), 1);
    assert.equal(cleanupAttempts, 2); assert.equal(f.errors.length, 1);
    assert.equal((await f.pool.query<{ alive: number }>('SELECT 1 AS alive')).rows[0]?.alive, 1);
  } finally {release.resolve(); await pumping; context.payments.stop(); await f.pool.query(`DROP SCHEMA IF EXISTS "${siblingSchema}" CASCADE`); await f.close();}
});
