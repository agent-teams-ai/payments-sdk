import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { Pool } from 'pg';
import { createPaymentReconciler, createPayments, digest, money } from '@agent-teams/payments-core';
import type { EvidenceMessage, OfferSnapshot, PaymentProvider, PaymentScope, PaymentStore, ProviderResult, CheckoutReady, VerifiedInput } from '@agent-teams/payments-core';
import { bootstrapPostgresPaymentJobs, createPostgresPaymentJobs, createPostgresPaymentStore, migratePaymentSchema } from '../dist/index.js';

const databaseUrl = process.env.DATABASE_URL;
assert.ok(databaseUrl, 'PostgreSQL 18 integration tests require DATABASE_URL');
const scope: PaymentScope = { applicationId: 'jobs-fixture', provider: 'fake', paymentAccountId: 'merchant', environment: 'sandbox' };
const offer: OfferSnapshot = { applicationId: scope.applicationId, offerId: 'offer', version: '1', policyVersion: '1', currency: 'USD', profile: 'one_time', allowZeroTotal: false, lines: [{ providerPriceRef: 'price', benefitSlotId: 'benefit', quantity: 1 }] };
const known = <T>(value: T) => ({ presence: 'known' as const, value });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
async function until(check: () => Promise<boolean>, label: string): Promise<void> {
  const deadline = performance.now() + 12_000;
  while (!await check()) { if (performance.now() > deadline) throw new Error(`Timed out: ${label}`); await delay(15); }
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
  return { scope, inputId: id, source, retainedRepresentation, observation: { kind: 'transaction', transactionRef, version: '2026-10-01T00:00:00.000001Z', status: 'completed', origin: known('api'), customerRef: known('customer'), subscriptionRef: known(null), intentCorrelation: { presence: 'unknown' }, currency: known('USD'), total: known(money('USD', '1000')), lines: known([{ providerLineRef: `line-${transactionRef}`, providerPriceRef: 'price', quantity: 1, amount: money('USD', '1000'), billingCycle: known(null), trial: known(false), proration: known(false), period: known(null) }]), source } };
}
async function fixture() {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 16), paymentSchema = `pj_${suffix}`, jobSchema = `jq_${suffix}`;
  const pool = new Pool({ connectionString: databaseUrl, max: 8 });
  const errors: Error[] = [], onError = (error: Error) => errors.push(error);
  const namespace = { pool, paymentSchema, jobSchema, scope, onError };
  await migratePaymentSchema({ pool, schema: paymentSchema, scope });
  await bootstrapPostgresPaymentJobs(namespace);
  const jobs = createPostgresPaymentJobs({ ...namespace, cooldownSeconds: 1, maxCooldownSeconds: 2, pollingIntervalSeconds: 0.5 });
  const store = await createPostgresPaymentStore({ pool, schema: paymentSchema, scope, queue: jobs.queue });
  return { ...namespace, jobs, store, errors, async cleanup() { await jobs.stop(); await jobs.drain(); await pool.query(`DROP SCHEMA ${jobSchema} CASCADE`); await pool.query(`DROP SCHEMA ${paymentSchema} CASCADE`); await pool.end(); } };
}

test('bootstrap binds the namespace and runtime starts scheduling, work and supervision without DDL privileges', { timeout: 30_000 }, async () => {
  const f = await fixture(), role = `jr_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
  let runtimePool: Pool | undefined;
  let jobs: ReturnType<typeof createPostgresPaymentJobs> | undefined;
  try {
    await f.pool.query(`CREATE ROLE ${role} LOGIN`);
    await f.pool.query(`GRANT USAGE ON SCHEMA ${f.paymentSchema}, ${f.jobSchema} TO ${role}`);
    await f.pool.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${f.paymentSchema}, ${f.jobSchema} TO ${role}`);
    await f.pool.query(`REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA ${f.jobSchema} FROM PUBLIC`);
    await f.pool.query(`GRANT EXECUTE ON FUNCTION ${f.jobSchema}.job_now(), ${f.jobSchema}.create_queue(text, jsonb) TO ${role}`);
    const url = new URL(databaseUrl); url.username = role; url.password = '';
    runtimePool = new Pool({ connectionString: url.toString(), max: 6 });
    await assert.rejects(runtimePool.query(`CREATE TABLE ${f.jobSchema}.forbidden (id text)`), /permission denied/);
    const errors: Error[] = [];
    jobs = createPostgresPaymentJobs({ ...f, pool: runtimePool, onError: error => errors.push(error) });
    const store = await createPostgresPaymentStore({ pool: runtimePool, schema: f.paymentSchema, scope, queue: jobs.queue });
    const core = runtime(store);
    await jobs.start({ payments: core.payments, store });
    // Source-qualified create_queue(existing) is invoked by schedule:true. A new partition would
    // require DDL; runtime owns neither the schema nor its tables and has no CREATE privilege.
    await jobs.queue.boss.supervise();
    assert.equal((await jobs.queue.boss.getSchedule('payments_repair', 'durable_obligations'))?.cron, '* * * * *');
    await prepare(store, 'runtime-role');
    await until(async () => (await core.payments.readOperation('operation-runtime-role'))?.state === 'succeeded', 'runtime-role prepared worker');
    assert.equal(core.calls(), 1);
    assert.deepEqual(errors, []);
    assert.equal((await jobs.stop()).transportStopped, true);
    assert.equal((await runtimePool.query('SELECT 1 AS usable')).rows[0]?.usable, 1);
    await assert.rejects(bootstrapPostgresPaymentJobs({ ...f, scope: { ...scope, applicationId: 'another' } }), /scope mismatch/);
    await assert.rejects(bootstrapPostgresPaymentJobs({ ...f, jobSchema: `${f.jobSchema}_other` }), /another job namespace/);
  } finally {
    await jobs?.stop(); await jobs?.drain(); await runtimePool?.end();
    await f.pool.query(`DROP OWNED BY ${role}`); await f.pool.query(`DROP ROLE ${role}`); await f.cleanup();
  }
});

test('deleted jobs are rebuilt from payment obligations; T2 replay and exact independent delivery targets stay idempotent', { timeout: 30_000 }, async () => {
  const f = await fixture(), core = runtime(f.store);
  const consumed = new Map<string, number>();
  const consume = (consumer: string) => async (message: EvidenceMessage) => { const key = `${consumer}:${message.messageId}`; consumed.set(key, (consumed.get(key) ?? 0) + 1); return { messageId: message.messageId, bodyDigest: message.bodyDigest }; };
  try {
    await core.payments.registerConsumer('credits'); await core.payments.registerConsumer('access');
    await prepare(f.store, 'prepared');
    const checkout = await core.payments.startPurchase({ buyerId: 'buyer', offerId: 'offer', requestKey: 'already-dispatched' });
    assert.equal(checkout.kind, 'succeeded'); if (checkout.kind !== 'succeeded') throw new Error('Fixture checkout failed');
    await core.payments.ingestVerifiedInput(input(checkout.value.transactionRef, 'inbox-pending'));
    await f.jobs.queue.boss.deleteAllJobs();
    assert.equal((await f.pool.query(`SELECT count(*)::int AS count FROM ${f.jobSchema}.job`)).rows[0]?.count, 0);
    assert.ok((await f.jobs.repair()).enqueued >= 2);
    // A real claimed job commits T2, then loses queue settlement. Replay is the actual ordinary
    // work path, with the domain obligation already complete and evidence/deliveries preserved.
    const claimed = await f.jobs.queue.boss.fetch<{ kind: string; id: string }>('payments_work', { batchSize: 100 });
    const inbox = claimed.find(job => job.data.kind === 'inbox'); assert.ok(inbox);
    assert.equal(await core.payments.processInbox(inbox.data.id), 'processed');
    await f.pool.query(`DELETE FROM ${f.jobSchema}.job WHERE data ->> 'kind' = 'delivery'`);
    assert.equal((await f.jobs.repair()).enqueued, 2);
    await f.jobs.queue.boss.fail('payments_work', claimed);
    await f.jobs.queue.boss.retry('payments_work', claimed.map(job => job.id));
    await f.jobs.start({ payments: core.payments, store: f.store, consumers: { credits: consume('credits'), access: consume('access') } });
    await until(async () => (await core.payments.readOperation('operation-prepared'))?.state === 'succeeded' && (await core.payments.readDeliveries('credits')).length === 0 && (await core.payments.readDeliveries('access')).length === 0, 'prepared and independent consumer delivery');
    assert.equal(core.calls(), 2);
    const purchase = await core.payments.readPurchase('buyer', checkout.value.intentId);
    assert.equal(purchase?.transactions[0]?.completion?.total.minorUnits, '1000');
    assert.equal(purchase?.transactions[0]?.completion?.lines[0]?.benefitSlotId, 'benefit');
    assert.equal(consumed.size, 2); assert.ok([...consumed.values()].every(count => count === 1));
    const deliveries = await f.pool.query<{ body: { acknowledged: boolean; consumerId: string } }>(`SELECT body FROM ${f.paymentSchema}.records WHERE kind = 'deliveries'`);
    assert.equal(deliveries.rows.length, 2); assert.ok(deliveries.rows.every(row => row.body.acknowledged));
    assert.deepEqual(f.errors, []);
  } finally { core.payments.stop(); await f.cleanup(); }
});

test('logical cooldown and quarantine survive queue deletion; unknown commands never redispatch; operator redrive is durable', { timeout: 30_000 }, async () => {
  const f = await fixture();
  let calls = 0;
  const core = runtime(f.store, async () => { calls += 1; return { kind: 'outcome_unknown' }; });
  const jobs = createPostgresPaymentJobs({ ...f, maxAttempts: 2, cooldownSeconds: 2, maxCooldownSeconds: 2, pollingIntervalSeconds: 0.5 });
  try {
    const unknown = await core.payments.startPurchase({ buyerId: 'buyer', offerId: 'offer', requestKey: 'unknown' });
    assert.equal(unknown.kind, 'outcome_unknown'); if (unknown.kind !== 'outcome_unknown') throw new Error('Fixture');
    await jobs.queue.boss.deleteAllJobs();
    await f.pool.query(`INSERT INTO ${f.paymentSchema}.obligations (kind, id) VALUES ('delivery', 'missing-target')`);
    let acquired = 0;
    const reconciler = createPaymentReconciler({ scope, store: f.store, source: { scope, readPage: async (query, after) => {
      acquired += 1; assert.equal(query.kind, 'events');
      if (acquired > 2) return { kind: 'page', inputs: [], hasMore: false, ...(after === undefined ? {} : { lastId: after }) };
      const receipt = input(`scan-transaction-${acquired}`, `scan-receipt-${acquired}`), eventId = `evt-000${acquired}`;
      const source = { ...receipt.source, eventId, eventType: 'transaction.updated' };
      return { kind: 'page', inputs: [{ ...receipt, source, observation: { ...receipt.observation, source } }], ids: [eventId], lastId: eventId, hasMore: true };
    } } });
    const begun = await reconciler.beginScan({ scanId: 'scan-fixture', epoch: 'epoch-fixture', query: { kind: 'events', from: '2026-09-30T00:00:00Z', to: '2026-10-03T00:00:00Z', perPage: 2, eventType: 'transaction.updated', queryVersion: 'events/1', purpose: 'catch_up' } });
    assert.equal(begun.kind, 'saved'); assert.equal(acquired, 0);
    await jobs.queue.boss.deleteAllJobs();
    // A failing read-only inspection is retried only through persisted logical attempt state.
    let inspected = 0, resumed = 0;
    await jobs.start({ payments: core.payments, store: f.store, inspectUnknown: async () => { inspected += 1; throw new Error('persistent decoder fault'); }, resumeScan: async saved => { resumed += 1; assert.equal((await reconciler.resumeScan(saved)).kind, 'saved'); } });
    await until(async () => (await f.pool.query(`SELECT attempts FROM ${f.paymentSchema}.obligations WHERE kind = 'unknown'`)).rows[0]?.attempts === 1, 'first unknown inspection');
    await jobs.queue.boss.deleteAllJobs();
    await jobs.repair();
    assert.equal((await f.pool.query(`SELECT count(*)::int AS count FROM ${f.jobSchema}.job WHERE data ->> 'kind' = 'unknown'`)).rows[0]?.count, 0);
    assert.equal(calls, 1); assert.equal(inspected, 1);
    await until(async () => { await jobs.repair(); return (await f.pool.query(`SELECT state FROM ${f.paymentSchema}.obligations WHERE kind = 'unknown'`)).rows[0]?.state === 'quarantined'; }, 'persistent quarantine');
    assert.equal(inspected, 2); assert.equal(calls, 1);
    await until(async () => { await jobs.repair(); return (await f.store.readCheckpoint(scope, 'scan-fixture'))?.status === 'complete'; }, 'forward-progress scan does not spend the fault retry bound');
    assert.equal(resumed, 3); assert.equal(acquired, 3);
    assert.equal((await core.payments.readOperation(unknown.operationId))?.state, 'outcome_unknown');
    await jobs.redrive({ kind: 'unknown', id: unknown.operationId }, 'review-ticket-1');
    assert.equal((await f.pool.query(`SELECT count(*)::int AS count FROM ${f.paymentSchema}.records WHERE kind = 'jobRedrives'`)).rows[0]?.count, 1);
    assert.equal((await f.pool.query(`SELECT state FROM ${f.paymentSchema}.obligations WHERE kind = 'delivery' AND id = 'missing-target'`)).rows[0]?.state, 'quarantined');
    assert.equal(calls, 1);
  } finally { core.payments.stop(); await jobs.stop(); await jobs.drain(); await f.cleanup(); }
});

test('shutdown reports a physically unresolved SDK call and leaves the shared pool and sibling namespace usable', { timeout: 30_000 }, async () => {
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
    assert.equal((await f.pool.query('SELECT 1 AS alive')).rows[0]?.alive, 1);
    assert.equal((await sibling.store.listWork(scope, 'inbox', 1)).length, 0);
    held.resolve({ kind: 'succeeded', value: { intentId, transactionRef: 'late-transaction', checkout: { token: 'late' } } });
    const drained = await f.jobs.drain();
    assert.equal(drained.unresolvedExternalCalls, 0); assert.equal(drained.admittedHandlers, 0); assert.equal(drained.transportStopped, true);
    assert.equal((await core.payments.readOperation('operation-held'))?.state, 'succeeded'); assert.equal(core.calls(), 1);
    const missing = createPostgresPaymentJobs({ ...sibling, jobSchema: 'missing_jobs_fixture' });
    await assert.rejects(missing.start({ payments: runtime(sibling.store).payments, store: sibling.store }));
    assert.equal(missing.status().transportStopped, true); assert.equal(missing.queue.boss.getWipData().length, 0);
    const partial = createPostgresPaymentJobs(sibling), originalWork = partial.queue.boss.work;
    Object.defineProperty(partial.queue.boss, 'work', { value: async (name: string, ...args: unknown[]) => {
      if (name === 'payments_repair') throw new Error('injected second worker registration failure');
      return Reflect.apply(originalWork, partial.queue.boss, [name, ...args]) as Promise<string>;
    } });
    await assert.rejects(partial.start({ payments: runtime(sibling.store).payments, store: sibling.store }), /injected second worker/);
    assert.equal(partial.status().transportStopped, true); assert.equal(partial.queue.boss.getWipData().length, 0);
    assert.equal((await sibling.pool.query('SELECT 1 AS alive')).rows[0]?.alive, 1);
  } finally { held.resolve({ kind: 'outcome_unknown' }); await f.cleanup(); await sibling.cleanup(); }
});
