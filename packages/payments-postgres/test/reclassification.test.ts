import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { canonicalJson, createPayments, money, objectVersionKey, processInput, publishEvidence } from '@agent-teams/payments-core';
import type { AdjustmentObservation, CheckoutReady, EvidenceMessage, PaymentReadVersion, PaymentStore, ProviderResult, SubscriptionReclassification, TransactionAggregate } from '@agent-teams/payments-core';
import { bootstrapPostgresPaymentJobs, createPostgresPaymentJobs, createPostgresPaymentStore } from '../dist/index.js';
import { at, databaseFixture, deferred, known, observe, offer, receipt, runtime, scope, success, transaction } from './helpers.ts';

type Context = ReturnType<typeof runtime>;
type Fixture = Awaited<ReturnType<typeof databaseFixture>>;
async function duplicateCheckout(context: Context, store: PaymentStore): Promise<{ intentId: string; bindingId: string }> {
  const first = deferred<ProviderResult<CheckoutReady>>();
  context.provider.createCheckout = () => first.promise;
  try {
    const result = await context.payments.startPurchase({ buyerId: 'buyer', offerId: 'monthly', requestKey: 'duplicate' });
    assert.equal(result.kind, 'outcome_unknown'); if (result.kind !== 'outcome_unknown') throw new Error('Fixture');
    const operation = await context.payments.readOperation(result.operationId); assert.ok(operation?.intentId);
    success(await context.payments.resolveUnknownOperation({ operationId: operation.operationId, expectedRevision: operation.revision, actorId: 'operator', auditRef: 'accept-risk', reason: 'reviewed duplicate risk', action: 'retry', acceptedDuplicateRisk: true }));
    context.provider.createCheckout = async command => ({ kind: 'succeeded', value: { intentId: command.intentId, transactionRef: 'initial-b', checkout: {} } });
    const retry = createPayments({ scope, producerNamespace: 'database-fixture', provider: context.provider, store, catalog: { resolveOffer: async () => offer }, operationTimeoutMs: 1000 });
    success(await retry.executeOperation(operation.operationId));
    await retry.drain();
    first.resolve({ kind: 'succeeded', value: { intentId: operation.intentId, transactionRef: 'initial-a', checkout: {} } });
    await context.payments.drain();
    const purchase = await context.payments.readPurchase('buyer', operation.intentId); assert.ok(purchase?.intent.subscriptionBasisId);
    return { intentId: operation.intentId, bindingId: purchase.intent.subscriptionBasisId };
  } finally { first.resolve({ kind: 'outcome_unknown' }); }
}
async function repairAll(context: Context, f: Fixture): Promise<void> {
  for (let pass = 0; pass < 30; pass += 1) {
    await context.payments.repair(100);
    if (!(await f.store.listWork(scope, 'reclassification', 1)).length && !(await f.store.listWork(scope, 'publication', 1)).length) return;
  }
  assert.fail('Bounded durable work did not finish');
}
async function ackAll(context: Context): Promise<void> {
  for (;;) {
    const batch = await context.payments.readDeliveries('audit', 100);
    if (!batch.length) return;
    for (const message of batch) assert.equal(await context.payments.acknowledgeDelivery('audit', message.messageId, message.bodyDigest), 'acknowledged');
  }
}
async function cursor(f: Fixture, bindingId: string): Promise<SubscriptionReclassification | undefined> {
  return (await f.pool.query<{ body: SubscriptionReclassification }>(`SELECT body FROM "${f.schema}".records WHERE kind = 'reclassifications' AND id = $1`, [bindingId])).rows[0]?.body;
}
async function renewals(f: Fixture): Promise<TransactionAggregate[]> {
  return (await f.pool.query<{ body: TransactionAggregate }>(`SELECT body FROM "${f.schema}".records WHERE kind = 'transactions' AND body #>> '{completion,classification}' = 'renewal' ORDER BY id`)).rows.map(row => row.body);
}
function selectionCommand(bindingId: string, ref: string, expectedReadSet: readonly PaymentReadVersion[]) {
  return { buyerId: 'buyer', bindingId, providerSubscriptionRef: ref, expectedReadSet, actorId: 'operator', auditRef: `select-${ref}`, reason: 'reviewed stream' };
}
async function select(context: Context, bindingId: string, ref: string): Promise<void> {
  const snapshot = await context.payments.readSubscriptionSelection('buyer', bindingId, ref); assert.ok(snapshot);
  success(await context.payments.selectSubscriptionStream(selectionCommand(bindingId, ref, snapshot.expectedReadSet)));
}

test('real PostgreSQL reclassification resumes 205 acknowledged renewals, rejects stale CAS, and covers new members behind its cursor', { timeout: 90_000 }, async () => {
  const f = await databaseFixture(); let context = runtime(f.store, 25);
  try {
    const { bindingId } = await duplicateCheckout(context, f.store);
    await observe(context.payments, receipt(transaction('initial-a', 'initial-a-paid')));
    await context.payments.registerConsumer('audit');
    for (let i = 0; i < 205; i += 1) {
      const ref = `renewal-${String(i).padStart(3, '0')}`;
      await observe(context.payments, receipt(transaction(ref, `paid-${ref}`, { origin: known('subscription_recurring') })));
    }
    const before = await renewals(f); assert.equal(before.length, 205); assert.ok(before.every(row => row.flags.length === 0));
    const completions = before.map(row => canonicalJson(row.completion));
    await ackAll(context);
    const immutableHistory = (await f.pool.query<{ id: string; body: EvidenceMessage }>(`SELECT id, body FROM "${f.schema}".records WHERE kind = 'evidence' ORDER BY id`)).rows;
    await observe(context.payments, receipt(transaction('initial-b', 'initial-b-paid', { subscriptionRef: known('sub-b') })));
    assert.deepEqual(await f.store.listWork(scope, 'reclassification', 100), [bindingId]);
    const staleSelection = await context.payments.readSubscriptionSelection('buyer', bindingId, 'sub-a'); assert.ok(staleSelection);
    const revisions = new Map((await renewals(f)).map(row => [row.transactionRef, row.revision]));
    assert.equal(await context.payments.processReclassification(bindingId, 17), 'committed');
    const page = await cursor(f, bindingId); assert.equal(page?.complete, false); assert.ok(page?.afterTransactionRef);
    const changed = (await renewals(f)).filter(row => row.revision !== revisions.get(row.transactionRef));
    assert.ok(changed.length > 0 && changed.length <= 17, 'one page changes no more than its requested bound');
    assert.deepEqual(await context.payments.selectSubscriptionStream(selectionCommand(bindingId, 'sub-a', staleSelection.expectedReadSet)), { kind: 'rejected', code: 'conflict' });
    await f.store.setRecoveryFence(scope, true, 'fanout-paused');
    assert.equal(await context.payments.processReclassification(bindingId, 100), 'recovery_fenced');
    assert.deepEqual(await cursor(f, bindingId), page);
    await f.store.setRecoveryFence(scope, false, 'fanout-resumed');
    await context.payments.drain();
    const restarted = await createPostgresPaymentStore({ pool: f.pool, schema: f.schema, scope });
    context = runtime(restarted); // No in-memory traversal state survives this replacement.
    await repairAll(context, f);
    assert.equal((await cursor(f, bindingId))?.complete, true);
    assert.ok((await renewals(f)).every(row => row.flags.includes('duplicate_initial_purchase')));
    const newMessages = (await f.pool.query<{ body: EvidenceMessage }>(`SELECT body FROM "${f.schema}".records WHERE kind = 'evidence' AND id <> ALL($1::text[])`, [immutableHistory.map(row => row.id)])).rows.map(row => row.body);
    assert.equal(new Set(newMessages.filter(message => message.kind === 'complete' && message.aggregate.id.startsWith('renewal-') && message.flags.includes('duplicate_initial_purchase')).map(message => message.aggregate.id)).size, 205);
    await ackAll(context);
    await select(context, bindingId, 'sub-a');
    assert.equal((await cursor(f, bindingId))?.afterTransactionRef, undefined, 'a selection atomically resets traversal');
    await repairAll(context, f);
    assert.ok((await renewals(f)).every(row => row.flags.length === 0), 'selected stream clears every renewal through repair alone');
    await ackAll(context);
    await select(context, bindingId, 'sub-b');
    assert.equal(await context.payments.processReclassification(bindingId, 100), 'committed');
    const competingSelection = await context.payments.readSubscriptionSelection('buyer', bindingId, 'sub-b'); assert.ok(competingSelection);
    const [fanout, selected] = await Promise.all([
      context.payments.processReclassification(bindingId, 25),
      context.payments.selectSubscriptionStream(selectionCommand(bindingId, 'sub-b', competingSelection.expectedReadSet)),
    ]);
    assert.ok(fanout === 'committed' || fanout === 'conflict');
    if (selected.kind !== 'succeeded') { assert.deepEqual(selected, { kind: 'rejected', code: 'conflict' }); await select(context, bindingId, 'sub-b'); }
    assert.equal((await cursor(f, bindingId))?.decisionRevision, 4, 'a concurrent reselection cannot lose its new decision cursor');
    assert.equal(await context.payments.processReclassification(bindingId, 100), 'committed');
    await observe(context.payments, receipt(transaction('000-new-behind-cursor', 'new-membership', { origin: known('subscription_recurring') })));
    assert.ok((await renewals(f)).find(row => row.transactionRef === '000-new-behind-cursor')?.flags.includes('duplicate_initial_purchase'));
    assert.deepEqual(await Promise.all([context.payments.processReclassification(bindingId, 25), context.payments.processReclassification(bindingId, 25)]), ['committed', 'committed']);
    await repairAll(context, f);
    const final = await renewals(f); assert.equal(final.length, 206); assert.ok(final.every(row => row.flags.includes('duplicate_initial_purchase')));
    assert.deepEqual(final.filter(row => row.transactionRef.startsWith('renewal-')).map(row => canonicalJson(row.completion)), completions, 'reclassification never rewrites immutable completion facts');
    for (const history of immutableHistory) {
      const stored = (await f.pool.query<{ body: EvidenceMessage }>(`SELECT body FROM "${f.schema}".records WHERE kind = 'evidence' AND id = $1`, [history.id])).rows[0]?.body;
      assert.deepEqual(stored, history.body, 'acknowledged evidence remains immutable');
    }
    const pendingMessages = await context.payments.readDeliveries('audit', 100);
    assert.ok(pendingMessages.some(message => message.kind === 'complete' && message.flags.includes('duplicate_initial_purchase')));
  } finally { await context.payments.drain(); await f.close(); }
});

test('real PostgreSQL historical adjustment reparenting fences both parents after restart and preserves the certified original version', async () => {
  const f = await databaseFixture(), base = runtime(f.store);
  const payments = createPayments({ scope, producerNamespace: 'database-fixture', provider: base.provider, store: f.store, catalog: { resolveOffer: async () => ({ ...offer, profile: 'one_time' }) } });
  try {
    const a = success(await payments.startPurchase({ buyerId: 'buyer', offerId: 'one-time', requestKey: 'a' }));
    const b = success(await payments.startPurchase({ buyerId: 'buyer', offerId: 'one-time', requestKey: 'b' }));
    for (const checkout of [a, b]) await observe(payments, receipt(transaction(checkout.transactionRef, `paid-${checkout.transactionRef}`, { subscriptionRef: known(null), lines: known([{ providerLineRef: `line-${checkout.transactionRef}`, providerPriceRef: 'price', quantity: 1, amount: money('USD', '1000'), billingCycle: known(null), trial: known(false), proration: known(false), period: known(null) }]) })));
    await payments.registerConsumer('audit');
    const v1: AdjustmentObservation = { kind: 'adjustment', adjustmentRef: 'historical-refund', transactionRef: a.transactionRef, version: at, action: 'refund', status: 'approved', amount: money('USD', '100'), allocations: [{ providerLineRef: `line-${a.transactionRef}`, amount: money('USD', '100') }], source: transaction(a.transactionRef, 'refund-v1').source };
    await observe(payments, receipt(v1));
    await observe(payments, receipt({ ...v1, version: '2026-01-02T00:00:00Z', amount: money('USD', '200'), allocations: [{ providerLineRef: `line-${a.transactionRef}`, amount: money('USD', '200') }], source: { ...v1.source, receiptId: 'refund-v2' } }));
    const beforeA = (await payments.readPurchase('buyer', a.intentId))?.transactions[0]; assert.ok(beforeA?.completion);
    for (const message of await payments.readDeliveries('audit', 100)) await payments.acknowledgeDelivery('audit', message.messageId, message.bodyDigest);
    const restarted = runtime(await createPostgresPaymentStore({ pool: f.pool, schema: f.schema, scope }));
    const contradictory = receipt({ ...v1, transactionRef: b.transactionRef, version: '2026-01-01T00:00:00.000001000+00:00', source: { ...v1.source, receiptId: 'contradictory-old-parent' } });
    success(await restarted.payments.ingestVerifiedInput(contradictory));
    const loaded = await f.store.loadReductionInput(scope, contradictory.inputId); assert.ok(loaded);
    for (const checkout of [a, b]) {
      assert.ok(loaded.state.transactions[checkout.transactionRef]); assert.ok(loaded.state.bindings[checkout.transactionRef]); assert.ok(loaded.state.intents[checkout.intentId]);
      assert.ok(loaded.expected.some(read => read.table === 'transactions' && read.id === checkout.transactionRef));
    }
    // A concurrent change on the retained parent invalidates the entire two-parent commit.
    processInput(loaded.state, scope, contradictory.inputId); publishEvidence(loaded.state, scope, 'database-fixture', 65536);
    await f.pool.query(`UPDATE "${f.schema}".records SET revision = revision + 1 WHERE kind = 'transactions' AND id = $1`, [a.transactionRef]);
    assert.deepEqual(await f.store.commitReduction(scope, { inputId: loaded.inputId, expected: loaded.expected, state: loaded.state }), { kind: 'conflict' });
    assert.equal(await restarted.payments.processInbox(contradictory.inputId), 'processed');
    await restarted.payments.repair(100);
    for (const checkout of [a, b]) {
      const after = (await restarted.payments.readPurchase('buyer', checkout.intentId))?.transactions[0]; assert.ok(after?.flags.includes('conflict'));
      assert.ok((await restarted.payments.readDeliveries('audit', 100)).some(message => message.kind === 'complete' && message.aggregate.id === checkout.transactionRef && message.flags.includes('conflict')));
    }
    const afterA = (await restarted.payments.readPurchase('buyer', a.intentId))?.transactions[0];
    assert.deepEqual(afterA?.completion, beforeA.completion); assert.deepEqual(afterA?.adjustments, beforeA.adjustments);
    const certified = (await f.pool.query<{ body: { projection: { transactionRef: string }; conflict: boolean } }>(`SELECT body FROM "${f.schema}".records WHERE kind = 'versionEvidence' AND id = $1`, [objectVersionKey(v1)])).rows[0]?.body;
    assert.equal(certified?.projection.transactionRef, a.transactionRef); assert.equal(certified.conflict, true);
  } finally { await payments.drain(); await f.close(); }
});


test('real pg-boss rebuilds deleted reclassification jobs and successful pages do not spend the fault budget', { timeout: 40_000 }, async () => {
  const f = await databaseFixture(), context = runtime(f.store, 25), jobSchema = `q_${f.schema}`;
  const errors: Error[] = [];
  const namespace = { pool: f.pool, paymentSchema: f.schema, jobSchema, scope, onError: (error: Error) => errors.push(error) };
  let jobs: ReturnType<typeof createPostgresPaymentJobs> | undefined;
  try {
    const { bindingId } = await duplicateCheckout(context, f.store);
    await observe(context.payments, receipt(transaction('initial-a', 'initial-a-paid')));
    for (let i = 0; i < 7; i += 1) await observe(context.payments, receipt(transaction(`renewal-${i}`, `paid-${i}`, { origin: known('subscription_recurring') })));
    await observe(context.payments, receipt(transaction('initial-b', 'initial-b-paid', { subscriptionRef: known('sub-b') })));
    await bootstrapPostgresPaymentJobs(namespace);
    jobs = createPostgresPaymentJobs({ ...namespace, batchSize: 1, concurrency: 1, maxAttempts: 1, cooldownSeconds: 1, maxCooldownSeconds: 1, pollingIntervalSeconds: 0.5 });
    await jobs.repair(100);
    assert.ok((await f.pool.query(`SELECT id FROM "${jobSchema}".job WHERE data ->> 'kind' = 'reclassification'`)).rows.length > 0);
    await jobs.queue.boss.deleteAllJobs();
    assert.equal((await f.pool.query(`SELECT count(*)::int AS count FROM "${jobSchema}".job`)).rows[0]?.count, 0);
    assert.equal((await jobs.repair(100)).enqueued, 1, 'payment-owned cursor obligation alone rebuilds the wakeup');
    let pages = 0, sawProgressCooldown = false;
    const process = f.store.processReclassification.bind(f.store);
    f.store.processReclassification = async (...args) => { const result = await process(...args); if (result.kind === 'committed') pages += 1; return result; };
    await jobs.start({ payments: context.payments, store: f.store });
    const deadline = performance.now() + 25_000;
    for (;;) {
      await jobs.repair(100);
      const progress = (await f.pool.query<{ attempts: number; cooling: boolean }>(`SELECT attempts, next_attempt_at > clock_timestamp() AS cooling FROM "${f.schema}".obligations WHERE kind = 'reclassification' AND state = 'pending'`)).rows[0];
      if (pages > 0 && progress?.attempts === 0 && progress.cooling) sawProgressCooldown = true;
      const remaining = await f.pool.query(`SELECT id FROM "${f.schema}".obligations WHERE kind IN ('reclassification', 'publication') AND state <> 'complete'`);
      if (!remaining.rows.length) break;
      if (performance.now() >= deadline) assert.fail('Durable reclassification did not complete under a one-fault retry bound');
      await delay(20);
    }
    assert.ok(sawProgressCooldown, 'successful pages retain the durable cooldown instead of hot-looping');
    assert.equal(pages, 9, 'all nine structural dependents require separate successful bounded pages');
    assert.ok((await renewals(f)).every(row => row.flags.includes('duplicate_initial_purchase')));
    assert.equal((await cursor(f, bindingId))?.complete, true);
    const obligation = (await f.pool.query<{ state: string; attempts: number }>(`SELECT state, attempts FROM "${f.schema}".obligations WHERE kind = 'reclassification' AND id = $1`, [bindingId])).rows[0];
    assert.equal(obligation?.state, 'complete'); assert.ok(obligation.attempts <= 1);
    assert.deepEqual(errors, []);
  } finally {
    await jobs?.stop(); await jobs?.drain(); await context.payments.drain();
    await f.pool.query(`DROP SCHEMA IF EXISTS "${jobSchema}" CASCADE`); await f.close();
  }
});
