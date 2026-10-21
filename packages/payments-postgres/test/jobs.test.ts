import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { Pool } from 'pg';
import { createPaymentReconciler, createPayments, digest, money } from '@agent-teams/payments-core';
import type { EvidenceMessage, OfferSnapshot, PaymentProvider, PaymentScope, PaymentStore, ProviderResult, CheckoutReady, VerifiedInput } from '@agent-teams/payments-core';
import { createNodePostgresPaymentDatabase } from '@agent-teams/payments-postgres/node-postgres';
import { createPgBossPaymentTransport } from '@agent-teams/payments-postgres/pg-boss';
import { createPostgresPaymentJobs, createPostgresPaymentStore, migratePaymentSchema, PaymentJobHandlerError } from '@agent-teams/payments-postgres';
import { paymentBossFixture } from './pg-boss-fixture.ts';

const databaseUrl = process.env.DATABASE_URL;
assert.ok((databaseUrl !== undefined && databaseUrl !== ''), 'PostgreSQL 18 integration tests require DATABASE_URL');
const scope: PaymentScope = { applicationId: 'jobs-fixture', provider: 'fake', paymentAccountId: 'merchant', environment: 'sandbox' };
const offer: OfferSnapshot = { applicationId: scope.applicationId, offerId: 'offer', version: '1', policyVersion: '1', currency: 'USD', profile: 'one_time', allowZeroTotal: false, lines: [{ providerPriceRef: 'price', benefitSlotId: 'benefit', quantity: 1 }] };
const known = <T>(value: T) => ({ presence: 'known' as const, value });
function deferred<T>() { let complete!: (value: T) => void; const promise = new Promise<T>(resolve => { complete = resolve; }); return { promise, resolve: complete }; }
async function until(check: () => Promise<boolean>, label: string): Promise<void> {
  const deadline = performance.now() + 12_000;
  while (!await check()) { if (performance.now() > deadline) {throw new Error(`Timed out: ${label}`);} await delay(15); }
}
function runtime(store: PaymentStore, create?: PaymentProvider['createCheckout'], timeoutMs = 1000) {
  let calls = 0;
  const provider: PaymentProvider = { scope, capabilities: { checkout: true, transactionRead: true, subscriptionRead: true, cancellation: [], paymentUpdate: false, customerManagement: false },
    createCheckout: async command => { calls += 1; return create ? create(command) : { kind: 'succeeded', value: { intentId: command.intentId, transactionRef: `transaction-${command.intentId}`, checkout: { token: 'synthetic' } } }; },
    readTransaction: async () => ({ kind: 'unsupported', capability: 'fixture' }), readSubscription: async () => ({ kind: 'unsupported', capability: 'fixture' }) };
  return { payments: createPayments({ scope, producerNamespace: 'jobs-fixture', store, provider, catalog: { resolveOffer: async () => offer }, operationTimeoutMs: timeoutMs }), calls: () => calls };
}
async function prepare(store: PaymentStore, id: string): Promise<void> {
  const operation = { operationId: `operation-${id}`, kind: 'purchase' as const, buyerId: 'buyer', requestKey: id, fingerprint: digest(['purchase', 'buyer', 'offer']), intentId: id, revision: 1, state: 'prepared' as const, attempts: [], audits: [] };
  assert.equal((await store.admitIntent(scope, { operation, intent: { intentId: id, buyerId: 'buyer', requestKey: id, fingerprint: operation.fingerprint, offer, operationId: operation.operationId, transactionRefs: [], createdAt: '2026-10-01T00:00:00Z' } })).kind, 'created');
}
function input(transactionRef: string, id: string): VerifiedInput {
  const retainedRepresentation = { fixture: id }, source = { kind: 'authenticated_api' as const, receiptId: id, representationDigest: digest(retainedRepresentation), decoderVersion: '1', apiProfile: 'fake-v1' };
  return { scope, inputId: id, source, retainedRepresentation, observation: { kind: 'transaction', transactionRef, version: '2026-10-01T00:00:00.000001Z', status: 'completed', statusMeaning: { kind: 'completed' }, origin: known('api'), customerRef: known('customer'), subscriptionRef: known(null), intentCorrelation: { presence: 'unknown' }, currency: known('USD'), total: known(money('USD', '1000')), lines: known([{ providerLineRef: `line-${transactionRef}`, providerPriceRef: 'price', quantity: 1, amount: money('USD', '1000'), billingCycle: known(null), trial: known(false), proration: known(false), period: known(null) }]), source } };
}
async function fixture() {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 16), paymentSchema = `pj_${suffix}`, jobSchema = `jq_${suffix}`;
  const pool = new Pool({ connectionString: databaseUrl, max: 8 });
  const database = createNodePostgresPaymentDatabase(pool);
  const errors: Error[] = [], onError = (error: Error) => errors.push(error);
  const namespace = { database, paymentSchema, jobSchema, scope, onError };
  await migratePaymentSchema({ database, schema: paymentSchema, scope });
  const transport = createPgBossPaymentTransport(namespace);
  await transport.bootstrap();
  const boss = paymentBossFixture(namespace);
  const jobs = createPostgresPaymentJobs({ ...namespace, transport, cooldownSeconds: 1, maxCooldownSeconds: 2, pollingIntervalSeconds: 0.5 });
  const store = await createPostgresPaymentStore({ database, schema: paymentSchema, scope, queue: jobs.queue });
  return { ...namespace, pool, transport, boss, jobs, store, errors, async cleanup() { await jobs.stop(); await jobs.drain(); await pool.query(`DROP SCHEMA ${jobSchema} CASCADE`); await pool.query(`DROP SCHEMA ${paymentSchema} CASCADE`); await pool.end(); } };
}

void test('bootstrap binds the namespace and runtime starts scheduling, work and supervision without DDL privileges', { timeout: 30_000 }, async () => {
  const f = await fixture(), role = `jr_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
  let runtimePool: Pool | undefined;
  let jobs: ReturnType<typeof createPostgresPaymentJobs> | undefined;
  try {
    await f.pool.query(`CREATE ROLE ${role} LOGIN PASSWORD 'payments-runtime-fixture-only'`);
    await f.pool.query(`GRANT USAGE ON SCHEMA ${f.paymentSchema}, ${f.jobSchema} TO ${role}`);
    await f.pool.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${f.paymentSchema}, ${f.jobSchema} TO ${role}`);
    await f.pool.query(`REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA ${f.jobSchema} FROM PUBLIC`);
    await f.pool.query(`GRANT EXECUTE ON FUNCTION ${f.jobSchema}.job_now(), ${f.jobSchema}.create_queue(text, jsonb) TO ${role}`);
    const url = new URL(databaseUrl); url.username = role; url.password = 'payments-runtime-fixture-only';
    runtimePool = new Pool({ connectionString: url.toString(), max: 6 });
    await assert.rejects(runtimePool.query(`CREATE TABLE ${f.jobSchema}.forbidden (id text)`), /permission denied/);
    const errors: Error[] = [];
    const database = createNodePostgresPaymentDatabase(runtimePool);
    const runtimeNamespace = { ...f, database, onError: (error: Error) => errors.push(error) };
    jobs = createPostgresPaymentJobs({ ...runtimeNamespace, transport: createPgBossPaymentTransport(runtimeNamespace) });
    const runtimeBoss = paymentBossFixture(runtimeNamespace);
    const store = await createPostgresPaymentStore({ database, schema: f.paymentSchema, scope, queue: jobs.queue });
    const core = runtime(store);
    await jobs.start({ payments: core.payments, store });
    // Source-qualified create_queue(existing) is invoked by schedule:true. A new partition would
    // require DDL; runtime owns neither the schema nor its tables and has no CREATE privilege.
    await runtimeBoss.supervise();
    assert.equal((await runtimeBoss.getSchedule('payments_repair', 'durable_obligations'))?.cron, '* * * * *');
    await prepare(store, 'runtime-role');
    await until(async () => (await core.payments.readOperation('operation-runtime-role'))?.state === 'succeeded', 'runtime-role prepared worker');
    assert.equal(core.calls(), 1);
    assert.deepEqual(errors, []);
    assert.equal((await jobs.stop()).transportStopped, true);
    assert.equal((await runtimePool.query<{ usable: number }>('SELECT 1 AS usable')).rows[0]?.usable, 1);
    await assert.rejects(createPgBossPaymentTransport({ ...f, scope: { ...scope, applicationId: 'another' } }).bootstrap(), /scope mismatch/);
    await assert.rejects(createPgBossPaymentTransport({ ...f, jobSchema: `${f.jobSchema}_other` }).bootstrap(), /another job namespace/);
  } finally {
    await jobs?.stop(); await jobs?.drain(); await runtimePool?.end();
    await f.pool.query(`DROP OWNED BY ${role}`); await f.pool.query(`DROP ROLE ${role}`); await f.cleanup();
  }
});

void test('deleted jobs are rebuilt from payment obligations; T2 replay and exact independent delivery targets stay idempotent', { timeout: 30_000 }, async () => {
  const f = await fixture(), core = runtime(f.store);
  const consumed = new Map<string, number>();
  const consume = (consumer: string) => async (message: EvidenceMessage) => { const key = `${consumer}:${message.messageId}`; consumed.set(key, (consumed.get(key) ?? 0) + 1); return { messageId: message.messageId, bodyDigest: message.bodyDigest }; };
  try {
    await core.payments.registerConsumer('credits'); await core.payments.registerConsumer('access');
    await prepare(f.store, 'prepared');
    const checkout = await core.payments.startPurchase({ buyerId: 'buyer', offerId: 'offer', requestKey: 'already-dispatched' });
    assert.equal(checkout.kind, 'succeeded');
    await core.payments.ingestVerifiedInput(input(checkout.value.transactionRef, 'inbox-pending'));
    await f.boss.deleteAllJobs();
    assert.equal((await f.pool.query<{ count: number }>(`SELECT count(*)::int AS count FROM ${f.jobSchema}.job`)).rows[0]?.count, 0);
    assert.ok((await f.jobs.repair()).enqueued >= 2);
    // A real claimed job commits T2, then loses queue settlement. Replay is the actual ordinary
    // work path, with the domain obligation already complete and evidence/deliveries preserved.
    const claimed = await f.boss.fetch<{ kind: string; id: string }>('payments_work', { batchSize: 100 });
    const inbox = claimed.find(job => job.data.kind === 'inbox'); assert.ok(inbox);
    assert.equal(await core.payments.processInbox(inbox.data.id), 'processed');
    await f.pool.query(`DELETE FROM ${f.jobSchema}.job WHERE data ->> 'kind' = 'delivery'`);
    assert.equal((await f.jobs.repair()).enqueued, 2);
    await f.boss.fail('payments_work', claimed);
    await f.boss.retry('payments_work', claimed.map(job => job.id));
    await f.jobs.start({ payments: core.payments, store: f.store, consumers: { credits: consume('credits'), access: consume('access') } });
    await until(async () => (await core.payments.readOperation('operation-prepared'))?.state === 'succeeded' && (await core.payments.readDeliveries('credits')).length === 0 && (await core.payments.readDeliveries('access')).length === 0, 'prepared and independent consumer delivery');
    assert.equal(core.calls(), 2);
    const purchase = await core.payments.readPurchase('buyer', checkout.value.intentId);
    assert.equal(purchase?.transactions[0]?.completion?.total.minorUnits, '1000');
    assert.equal(purchase.transactions[0].completion.lines[0]?.benefitSlotId, 'benefit');
    assert.equal(consumed.size, 2); assert.ok([...consumed.values()].every(count => count === 1));
    const deliveries = await f.pool.query<{ body: { acknowledged: boolean; consumerId: string } }>(`SELECT body FROM ${f.paymentSchema}.records WHERE kind = 'deliveries'`);
    assert.equal(deliveries.rows.length, 2); assert.ok(deliveries.rows.every(row => row.body.acknowledged));
    assert.deepEqual(f.errors, []);
  } finally { core.payments.stop(); await f.cleanup(); }
});

void test('a retained terminal pg-boss job cannot suppress its immediately required repair wake-up', { timeout: 15_000 }, async () => {
  const f = await fixture(), core = runtime(f.store);
  try {
    await prepare(f.store, 'terminal');
    const claimed = await f.boss.fetch('payments_work', { batchSize: 1 }); assert.equal(claimed.length, 1);
    await f.boss.fail('payments_work', claimed);
    assert.equal((await f.pool.query<{ state: string }>(`SELECT state FROM ${f.jobSchema}.job WHERE id = $1`, [claimed[0]?.id])).rows[0]?.state, 'failed');
    assert.equal((await f.jobs.repair(1)).enqueued, 1, 'a terminal row is retained, but repair creates a new runnable row now');
    await f.jobs.start({ payments: core.payments, store: f.store });
    await until(async () => (await core.payments.readOperation('operation-terminal'))?.state === 'succeeded', 'terminal wake-up repair');
    assert.equal(core.calls(), 1);
  } finally {core.payments.stop(); await f.cleanup();}
});

void test('cold transactional pg-boss enqueue and startup repair use only a one-connection borrowed pool', { timeout: 15_000 }, async () => {
  const f = await fixture(), pool = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 1000 });
  const database = createNodePostgresPaymentDatabase(pool);
  const namespace = { ...f, database }, transport = createPgBossPaymentTransport(namespace);
  const jobs = createPostgresPaymentJobs({ ...namespace, transport, pollingIntervalSeconds: 0.5 });
  let core: ReturnType<typeof runtime> | undefined;
  try {
    const store = await createPostgresPaymentStore({ database, schema: f.paymentSchema, scope, queue: jobs.queue });
    // The worker vendor instance has never started or cached queue metadata.
    await prepare(store, 'cold-enqueue');
    const unqueued = await createPostgresPaymentStore({ database, schema: f.paymentSchema, scope });
    await prepare(unqueued, 'cold-repair');
    core = runtime(store); const payments = core.payments;
    await jobs.start({ payments, store });
    await until(async () => (await payments.readOperation('operation-cold-enqueue'))?.state === 'succeeded'
      && (await payments.readOperation('operation-cold-repair'))?.state === 'succeeded', 'one-checkout cold enqueue and repair');
    assert.equal(core.calls(), 2); assert.equal(pool.totalCount, 1); assert.deepEqual(f.errors, []);
  } finally {core?.payments.stop(); await jobs.stop(); await jobs.drain(); await pool.end(); await f.cleanup();}
});

void test('logical cooldown and quarantine survive queue deletion; unknown commands never redispatch; operator redrive is durable', { timeout: 30_000 }, async () => {
  const f = await fixture();
  let calls = 0;
  const core = runtime(f.store, async () => { calls += 1; return { kind: 'outcome_unknown' }; });
  const jobs = createPostgresPaymentJobs({ ...f, maxAttempts: 2, cooldownSeconds: 2, maxCooldownSeconds: 2, pollingIntervalSeconds: 0.5 });
  try {
    const unknown = await core.payments.startPurchase({ buyerId: 'buyer', offerId: 'offer', requestKey: 'unknown' });
    assert.equal(unknown.kind, 'outcome_unknown');
    await f.boss.deleteAllJobs();
    await f.pool.query(`INSERT INTO ${f.paymentSchema}.obligations (kind, id) VALUES ('delivery', 'missing-target')`);
    let acquired = 0;
    const reconciler = createPaymentReconciler({ scope, store: f.store, source: { scope, readPage: async (query, after) => {
      acquired += 1; assert.equal(query.kind, 'events');
      if (acquired > 2) {return { kind: 'page', inputs: [], hasMore: false, ...(after === undefined ? {} : { lastId: after }) };}
      const receipt = input(`scan-transaction-${acquired}`, `scan-receipt-${acquired}`), eventId = `evt-000${acquired}`;
      const source = { ...receipt.source, eventId, eventType: 'transaction.updated' };
      return { kind: 'page', inputs: [{ ...receipt, source, observation: { ...receipt.observation, source } }], ids: [eventId], lastId: eventId, hasMore: true };
    } } });
    const begun = await reconciler.beginScan({ scanId: 'scan-fixture', epoch: 'epoch-fixture', query: { kind: 'events', from: '2026-09-30T00:00:00Z', to: '2026-10-03T00:00:00Z', perPage: 2, eventType: 'transaction.updated', queryVersion: 'events/1', purpose: 'catch_up' } });
    assert.equal(begun.kind, 'saved'); assert.equal(acquired, 0);
    await f.boss.deleteAllJobs();
    // A failing read-only inspection is retried only through persisted logical attempt state.
    let inspected = 0, resumed = 0;
    const inspectionFailure = new Error('persistent decoder fault');
    await jobs.start({ payments: core.payments, store: f.store, inspectUnknown: async () => { inspected += 1; throw inspectionFailure; }, resumeScan: async saved => { resumed += 1; assert.equal((await reconciler.resumeScan(saved)).kind, 'saved'); } });
    await until(async () => (await f.pool.query<{ attempts: number }>(`SELECT attempts FROM ${f.paymentSchema}.obligations WHERE kind = 'unknown'`)).rows[0]?.attempts === 1, 'first unknown inspection');
    await f.boss.deleteAllJobs();
    await jobs.repair();
    assert.equal((await f.pool.query<{ count: number }>(`SELECT count(*)::int AS count FROM ${f.jobSchema}.job WHERE data ->> 'kind' = 'unknown'`)).rows[0]?.count, 0);
    assert.equal(calls, 1); assert.equal(inspected, 1);
    await until(async () => { await jobs.repair(); return (await f.pool.query<{ state: string }>(`SELECT state FROM ${f.paymentSchema}.obligations WHERE kind = 'unknown'`)).rows[0]?.state === 'quarantined'; }, 'persistent quarantine');
    assert.equal(inspected, 2); assert.equal(calls, 1);
    await until(async () => f.errors.length === 2, 'bounded inspection diagnostics');
    for (const [index, error] of f.errors.entries()) {
      assert.ok(error instanceof PaymentJobHandlerError);
      assert.equal(error.cause, inspectionFailure);
      assert.deepEqual(error.work, { kind: 'unknown', id: unknown.operationId });
      assert.equal(error.attempt, index + 1);
    }
    await until(async () => { await jobs.repair(); return (await f.store.readCheckpoint(scope, 'scan-fixture'))?.status === 'complete'; }, 'forward-progress scan does not spend the fault retry bound');
    assert.equal(resumed, 3); assert.equal(acquired, 3);
    assert.equal((await core.payments.readOperation(unknown.operationId))?.state, 'outcome_unknown');
    await jobs.redrive({ kind: 'unknown', id: unknown.operationId }, 'review-ticket-1');
    assert.equal((await f.pool.query<{ count: number }>(`SELECT count(*)::int AS count FROM ${f.paymentSchema}.records WHERE kind = 'jobRedrives'`)).rows[0]?.count, 1);
    assert.equal((await f.pool.query<{ state: string }>(`SELECT state FROM ${f.paymentSchema}.obligations WHERE kind = 'delivery' AND id = 'missing-target'`)).rows[0]?.state, 'quarantined');
    assert.equal(calls, 1);
  } finally { core.payments.stop(); await jobs.stop(); await jobs.drain(); await f.cleanup(); }
});

for (const sink of ['throws', 'rejects'] as const) {
  void test(`consumer failure preserves retry/quarantine and its cause when the diagnostic sink ${sink}`, { timeout: 30_000 }, async () => {
    const f = await fixture(), core = runtime(f.store), reported: Error[] = [];
    const consumerFailure = new Error('synthetic consumer transaction failure');
    const sinkFailure = new Error('synthetic diagnostic sink failure');
    const onError = (error: Error): unknown => { reported.push(error); if (sink === 'rejects') {return Promise.reject(sinkFailure);} throw sinkFailure; };
    const jobs = createPostgresPaymentJobs({
      ...f, maxAttempts: 2, cooldownSeconds: 1, maxCooldownSeconds: 1, pollingIntervalSeconds: 0.5,
      onError,
    });
    let consumed = 0;
    try {
      await core.payments.registerConsumer('credits');
      const checkout = await core.payments.startPurchase({ buyerId: 'buyer', offerId: 'offer', requestKey: `diagnostic-${sink}` });
      assert.equal(checkout.kind, 'succeeded');
      await core.payments.ingestVerifiedInput(input(checkout.value.transactionRef, `receipt-${sink}`));
      assert.equal(await core.payments.processInbox(`receipt-${sink}`), 'processed');
      const messages = await core.payments.readDeliveries('credits');
      assert.equal(messages.length, 1); const message = messages[0]; assert.ok(message);
      const deliveryId = JSON.stringify([message.messageId, 'credits']);
      await jobs.start({ payments: core.payments, store: f.store, consumers: { credits: async () => { consumed += 1; throw consumerFailure; } } });
      await until(async () => {
        await jobs.repair();
        const row = (await f.pool.query<{ state: string; attempts: number; issue: string | null }>(`SELECT state, attempts, issue FROM ${f.paymentSchema}.obligations WHERE kind = 'delivery' AND id = $1`, [deliveryId])).rows[0];
        return row?.state === 'quarantined' && row.attempts === 2 && row.issue === 'handler_failed' && reported.length === 2;
      }, 'durable quarantine despite a failed diagnostic sink');
      assert.equal(consumed, 2);
      for (const [index, error] of reported.entries()) {
        assert.ok(error instanceof PaymentJobHandlerError);
        assert.equal(error.cause, consumerFailure);
        assert.equal(error.message, 'Payment job handler failed');
        assert.deepEqual(error.work, { kind: 'delivery', id: deliveryId });
        assert.equal(Object.isFrozen(error.work), true);
        assert.equal(error.attempt, index + 1);
      }
      assert.deepEqual((await core.payments.readDeliveries('credits')).map(item => item.messageId), [message.messageId], 'failed T3 never acknowledges delivery');
      assert.equal(core.calls(), 1, 'diagnostic failure cannot redispatch checkout');
    } finally { core.payments.stop(); await jobs.stop(); await jobs.drain(); await f.cleanup(); }
  });
}

void test('shutdown reports a physically unresolved SDK call and leaves the shared pool and sibling namespace usable', { timeout: 30_000 }, async () => {
  const f = await fixture(), sibling = await fixture(), held = deferred<ProviderResult<CheckoutReady>>(), entered = deferred<void>();
  let intentId = '';
  const core = runtime(f.store, async command => { intentId = command.intentId; entered.resolve(); return held.promise; }, 25);
  try {
    await prepare(f.store, 'held');
    await f.jobs.start({ payments: core.payments, store: f.store });
    await entered.promise;
    core.payments.stop();
    const stopped = await f.jobs.stop(100);
    assert.equal(stopped.unresolvedExternalCalls, 1);
    assert.equal((await f.pool.query<{ alive: number }>('SELECT 1 AS alive')).rows[0]?.alive, 1);
    assert.equal((await sibling.store.listWork(scope, 'inbox', 1)).length, 0);
    held.resolve({ kind: 'succeeded', value: { intentId, transactionRef: 'late-transaction', checkout: { token: 'late' } } });
    const drained = await f.jobs.drain();
    assert.equal(drained.unresolvedExternalCalls, 0); assert.equal(drained.admittedHandlers, 0); assert.equal(drained.transportStopped, true);
    assert.equal((await core.payments.readOperation('operation-held'))?.state, 'succeeded'); assert.equal(core.calls(), 1);
    const missing = createPostgresPaymentJobs({ ...sibling, transport: createPgBossPaymentTransport({ ...sibling, jobSchema: 'missing_jobs_fixture' }) });
    await assert.rejects(missing.start({ payments: runtime(sibling.store).payments, store: sibling.store }));
    assert.equal(missing.status().transportStopped, true); assert.equal(missing.status().admittedHandlers, 0);
    const partialTransport = createPgBossPaymentTransport(sibling);
    const partial = createPostgresPaymentJobs({ ...sibling, transport: { ...partialTransport, start: async (...args) => {
      await partialTransport.start(...args);
      throw new Error('injected second worker registration failure');
    } } });
    await assert.rejects(partial.start({ payments: runtime(sibling.store).payments, store: sibling.store }), /injected second worker/);
    assert.equal(partial.status().transportStopped, true); assert.equal(partial.status().admittedHandlers, 0);
    assert.equal((await sibling.pool.query<{ alive: number }>('SELECT 1 AS alive')).rows[0]?.alive, 1);
  } finally { held.resolve({ kind: 'outcome_unknown' }); await f.cleanup(); await sibling.cleanup(); }
});

void test('partial worker startup retains physical SDK debt and cannot replace its drain owner', { timeout: 30_000 }, async () => {
  const f = await fixture(), held = deferred<ProviderResult<CheckoutReady>>(), entered = deferred<void>();
  const core = runtime(f.store, async command => { entered.resolve(); return held.promise.then(result => result.kind === 'succeeded' ? { ...result, value: { ...result.value, intentId: command.intentId } } : result); }, 25);
  const startTransport = f.transport.start.bind(f.transport);
  f.transport.start = async (...args) => {
    await startTransport(...args);
    await entered.promise;
    throw new Error('injected registration failure after dispatch');
  };
  try {
    await prepare(f.store, 'startup-debt');
    await assert.rejects(f.jobs.start({ payments: core.payments, store: f.store }), /registration failure after dispatch/);
    assert.equal(core.payments.lifecycle().unresolvedExternalCalls, 1);
    assert.equal(f.jobs.status().unresolvedExternalCalls, 1);
    assert.equal(f.jobs.status().transportStopped, true);
    await assert.rejects(f.jobs.start({ payments: runtime(f.store).payments, store: f.store }), /stopping/);
    core.payments.stop();
    const reachedCoreDrain = deferred<void>(), originalDrain = core.payments.drain;
    core.payments.drain = () => { reachedCoreDrain.resolve(); return originalDrain(); };
    let settled = false;
    const draining = f.jobs.drain().then(result => { settled = true; return result; });
    await reachedCoreDrain.promise;
    assert.equal(settled, false, 'the physical provider barrier still owns late settlement');
    held.resolve({ kind: 'succeeded', value: { intentId: 'startup-debt', transactionRef: 'startup-late', checkout: {} } });
    const result = await draining;
    assert.deepEqual(result, { transportStopped: true, admittedHandlers: 0, unresolvedExternalCalls: 0, pendingCoreWork: 0 });
    assert.equal((await core.payments.readOperation('operation-startup-debt'))?.state, 'succeeded');
    assert.equal(core.calls(), 1);
    assert.equal((await f.pool.query<{ alive: number }>('SELECT 1 AS alive')).rows[0]?.alive, 1);
  } finally { held.resolve({ kind: 'outcome_unknown' }); await core.payments.drain(); await f.cleanup(); }
});
