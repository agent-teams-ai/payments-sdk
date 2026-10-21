import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { canonicalJson, createPayments, money, objectVersionKey, processInput, publishEvidence, reduceObservation } from '@agent-teams/payments-core';
import type { AdjustmentObservation, CheckoutReady, EvidenceMessage, PaymentReadVersion, PaymentStore, ProviderResult, SubscriptionReclassification, TransactionAggregate, VerifiedInput } from '@agent-teams/payments-core';
import { createPgBossPaymentTransport } from '../dist/job-transport.js';
import { createPostgresPaymentJobs, createPostgresPaymentStore, PaymentJobHandlerError } from '../dist/index.js';
import { paymentBossFixture } from './pg-boss-fixture.ts';
import { at, databaseFixture, deferred, known, observe, offer, receipt, runtime, scope, success, transaction } from './helpers.ts';

type Context = ReturnType<typeof runtime>;
type Fixture = Awaited<ReturnType<typeof databaseFixture>>;
async function duplicateCheckout(context: Context, store: PaymentStore): Promise<{ intentId: string; bindingId: string }> {
  const first = deferred<ProviderResult<CheckoutReady>>();
  context.provider.createCheckout = () => first.promise;
  try {
    const result = await context.payments.startPurchase({ buyerId: 'buyer', offerId: 'monthly', requestKey: 'duplicate' });
    assert.equal(result.kind, 'outcome_unknown');
    const operation = await context.payments.readOperation(result.operationId); assert.ok((operation?.intentId !== undefined && operation.intentId !== ''));
    success(await context.payments.resolveUnknownOperation({ operationId: operation.operationId, expectedRevision: operation.revision, actorId: 'operator', auditRef: 'accept-risk', reason: 'reviewed duplicate risk', action: 'retry', acceptedDuplicateRisk: true }));
    context.provider.createCheckout = async command => ({ kind: 'succeeded', value: { intentId: command.intentId, transactionRef: 'initial-b', checkout: {} } });
    const retry = createPayments({ scope, producerNamespace: 'database-fixture', provider: context.provider, store, catalog: { resolveOffer: async () => offer }, operationTimeoutMs: 1000 });
    success(await retry.executeOperation(operation.operationId));
    await retry.drain();
    first.resolve({ kind: 'succeeded', value: { intentId: operation.intentId, transactionRef: 'initial-a', checkout: {} } });
    await context.payments.drain();
    const purchase = await context.payments.readPurchase('buyer', operation.intentId); assert.ok((purchase?.intent.subscriptionBasisId !== undefined && purchase.intent.subscriptionBasisId !== ''));
    return { intentId: operation.intentId, bindingId: purchase.intent.subscriptionBasisId };
  } finally { first.resolve({ kind: 'outcome_unknown' }); }
}
async function repairAll(context: Context, f: Fixture): Promise<void> {
  for (let pass = 0; pass < 30; pass += 1) {
    await context.payments.repair(100);
    if (!(await f.store.listWork(scope, 'reclassification', 1)).length && !(await f.store.listWork(scope, 'publication', 1)).length) {return;}
  }
  assert.fail('Bounded durable work did not finish');
}
async function ackAll(context: Context): Promise<void> {
  for (;;) {
    const batch = await context.payments.readDeliveries('audit', 100);
    if (!batch.length) {return;}
    for (const message of batch) {assert.equal(await context.payments.acknowledgeDelivery('audit', message.messageId, message.bodyDigest), 'acknowledged');}
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

void test('real PostgreSQL reclassification resumes 205 acknowledged renewals, rejects stale CAS, and covers new members behind its cursor', { timeout: 90_000 }, async () => {
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
    const page = await cursor(f, bindingId); assert.equal(page?.complete, false); assert.ok((page.afterTransactionRef !== undefined && page.afterTransactionRef !== ''));
    const changed = (await renewals(f)).filter(row => row.revision !== revisions.get(row.transactionRef));
    assert.ok(changed.length > 0 && changed.length <= 17, 'one page changes no more than its requested bound');
    assert.deepEqual(await context.payments.selectSubscriptionStream(selectionCommand(bindingId, 'sub-a', staleSelection.expectedReadSet)), { kind: 'rejected', code: 'conflict' });
    await f.store.setRecoveryFence(scope, true, 'fanout-paused');
    assert.equal(await context.payments.processReclassification(bindingId, 100), 'recovery_fenced');
    assert.deepEqual(await cursor(f, bindingId), page);
    await f.store.setRecoveryFence(scope, false, 'fanout-resumed');
    await context.payments.drain();
    const restarted = await createPostgresPaymentStore({ database: f.database, schema: f.schema, scope });
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
    assert.ok(((await renewals(f)).find(row => row.transactionRef === '000-new-behind-cursor')?.flags.includes('duplicate_initial_purchase') === true));
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

void test('real PostgreSQL historical adjustment reparenting fences both parents after restart and preserves the certified original version', async () => {
  const f = await databaseFixture(), base = runtime(f.store);
  const payments = createPayments({ scope, producerNamespace: 'database-fixture', provider: base.provider, store: f.store, catalog: { resolveOffer: async () => ({ ...offer, profile: 'one_time' }) } });
  try {
    const a = success(await payments.startPurchase({ buyerId: 'buyer', offerId: 'one-time', requestKey: 'a' }));
    const b = success(await payments.startPurchase({ buyerId: 'buyer', offerId: 'one-time', requestKey: 'b' }));
    for (const checkout of [a, b]) {await observe(payments, receipt(transaction(checkout.transactionRef, `paid-${checkout.transactionRef}`, { subscriptionRef: known(null), lines: known([{ providerLineRef: `line-${checkout.transactionRef}`, providerPriceRef: 'price', quantity: 1, amount: money('USD', '1000'), billingCycle: known(null), trial: known(false), proration: known(false), period: known(null) }]) })));}
    await payments.registerConsumer('audit');
    const v1: AdjustmentObservation = { kind: 'adjustment', adjustmentRef: 'historical-refund', transactionRef: a.transactionRef, version: at, action: 'refund', status: 'approved', amount: money('USD', '100'), allocations: [{ providerLineRef: `line-${a.transactionRef}`, amount: money('USD', '100') }], source: transaction(a.transactionRef, 'refund-v1').source };
    await observe(payments, receipt(v1));
    await observe(payments, receipt({ ...v1, version: '2026-01-02T00:00:00Z', amount: money('USD', '200'), allocations: [{ providerLineRef: `line-${a.transactionRef}`, amount: money('USD', '200') }], source: { ...v1.source, receiptId: 'refund-v2' } }));
    const beforeA = (await payments.readPurchase('buyer', a.intentId))?.transactions[0]; assert.ok(beforeA?.completion);
    for (const message of await payments.readDeliveries('audit', 100)) {await payments.acknowledgeDelivery('audit', message.messageId, message.bodyDigest);}
    const restarted = runtime(await createPostgresPaymentStore({ database: f.database, schema: f.schema, scope }));
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
      const after = (await restarted.payments.readPurchase('buyer', checkout.intentId))?.transactions[0]; assert.ok((after?.flags.includes('conflict') === true));
      assert.ok((await restarted.payments.readDeliveries('audit', 100)).some(message => message.kind === 'complete' && message.aggregate.id === checkout.transactionRef && message.flags.includes('conflict')));
    }
    const afterA = (await restarted.payments.readPurchase('buyer', a.intentId))?.transactions[0];
    assert.deepEqual(afterA?.completion, beforeA.completion); assert.deepEqual(afterA.adjustments, beforeA.adjustments);
    const certified = (await f.pool.query<{ body: { projection: { transactionRef: string }; conflict: boolean } }>(`SELECT body FROM "${f.schema}".records WHERE kind = 'versionEvidence' AND id = $1`, [objectVersionKey(v1)])).rows[0]?.body;
    assert.equal(certified?.projection.transactionRef, a.transactionRef); assert.equal(certified.conflict, true);
  } finally { await payments.drain(); await f.close(); }
});


void test('real pg-boss rebuilds deleted reclassification jobs and successful pages do not spend the fault budget', { timeout: 40_000 }, async () => {
  const f = await databaseFixture(), context = runtime(f.store, 25), jobSchema = `q_${f.schema}`;
  const errors: Error[] = [];
  const namespace = { database: f.database, paymentSchema: f.schema, jobSchema, scope, onError: (error: Error) => errors.push(error) };
  let jobs: ReturnType<typeof createPostgresPaymentJobs> | undefined;
  try {
    const { bindingId } = await duplicateCheckout(context, f.store);
    await observe(context.payments, receipt(transaction('initial-a', 'initial-a-paid')));
    for (let i = 0; i < 7; i += 1) {await observe(context.payments, receipt(transaction(`renewal-${i}`, `paid-${i}`, { origin: known('subscription_recurring') })));}
    await observe(context.payments, receipt(transaction('initial-b', 'initial-b-paid', { subscriptionRef: known('sub-b') })));
    const transport = createPgBossPaymentTransport(namespace); await transport.bootstrap();
    jobs = createPostgresPaymentJobs({ ...namespace, transport, batchSize: 1, concurrency: 1, maxAttempts: 1, cooldownSeconds: 1, maxCooldownSeconds: 1, pollingIntervalSeconds: 0.5 });
    await jobs.repair(100);
    assert.ok((await f.pool.query(`SELECT id FROM "${jobSchema}".job WHERE data ->> 'kind' = 'reclassification'`)).rows.length > 0);
    await paymentBossFixture(namespace).deleteAllJobs();
    assert.equal((await f.pool.query<{ count: number }>(`SELECT count(*)::int AS count FROM "${jobSchema}".job`)).rows[0]?.count, 0);
    assert.equal((await jobs.repair(100)).enqueued, 1, 'payment-owned cursor obligation alone rebuilds the wakeup');
    let pages = 0, sawProgressCooldown = false;
    const process = f.store.processReclassification.bind(f.store);
    f.store.processReclassification = async (...args) => { const result = await process(...args); if (result.kind === 'committed') {pages += 1;} return result; };
    await jobs.start({ payments: context.payments, store: f.store });
    const deadline = performance.now() + 25_000;
    for (;;) {
      await jobs.repair(100);
      const progress = (await f.pool.query<{ attempts: number; cooling: boolean }>(`SELECT attempts, next_attempt_at > clock_timestamp() AS cooling FROM "${f.schema}".obligations WHERE kind = 'reclassification' AND state = 'pending'`)).rows[0];
      if (pages > 0 && progress?.attempts === 0 && progress.cooling) {sawProgressCooldown = true;}
      const remaining = await f.pool.query(`SELECT id FROM "${f.schema}".obligations WHERE kind IN ('reclassification', 'publication') AND state <> 'complete'`);
      if (!remaining.rows.length) {break;}
      if (performance.now() >= deadline) {assert.fail('Durable reclassification did not complete under a one-fault retry bound');}
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


async function untilPersisted(check: () => Promise<boolean>, label: string): Promise<void> {
  const deadline = performance.now() + 12_000;
  while (!await check()) { assert.ok(performance.now() < deadline, label); await delay(15); }
}
async function workDisposition(f: Fixture, bindingId: string) {
  return (await f.pool.query<{ state: string; attempts: number; issue: string | null; nextAttemptAt: string; revision: string }>(`SELECT state, attempts, issue, next_attempt_at::text AS "nextAttemptAt", revision::text FROM "${f.schema}".obligations WHERE kind = 'reclassification' AND id = $1`, [bindingId])).rows[0];
}
async function selectedInitial(context: Context): Promise<string> {
  const checkout = success(await context.payments.startPurchase({ buyerId: 'buyer', offerId: 'monthly', requestKey: 'retry-policy' }));
  await observe(context.payments, receipt(transaction(checkout.transactionRef, 'initial-paid')));
  const purchase = await context.payments.readPurchase('buyer', checkout.intentId); assert.ok((purchase?.intent.subscriptionBasisId !== undefined && purchase.intent.subscriptionBasisId !== ''));
  await select(context, purchase.intent.subscriptionBasisId, 'sub-a');
  return purchase.intent.subscriptionBasisId;
}

for (const maxAttempts of [1, 2]) {void test(`ordinary renewal preserves exact reclassification ${maxAttempts === 1 ? 'quarantine' : 'cooldown'}; audited redrive and a new decision reset work`, { timeout: 25_000 }, async () => {
  const f = await databaseFixture(), context = runtime(f.store), jobSchema = `q_${f.schema}`;
  const errors: Error[] = [], namespace = { database: f.database, paymentSchema: f.schema, jobSchema, scope, onError: (error: Error) => errors.push(error) };
  let jobs: ReturnType<typeof createPostgresPaymentJobs> | undefined;
  try {
    const bindingId = await selectedInitial(context), decision = await cursor(f, bindingId);
    const transport = createPgBossPaymentTransport(namespace); await transport.bootstrap();
    let attempts = 0;
    const persistentFault = new Error('persistent fault');
    f.store.processReclassification = async () => { attempts += 1; throw persistentFault; };
    jobs = createPostgresPaymentJobs({ ...namespace, transport, maxAttempts, cooldownSeconds: 30, maxCooldownSeconds: 30, pollingIntervalSeconds: 0.5 });
    await jobs.start({ payments: context.payments, store: f.store });
    await untilPersisted(async () => (await workDisposition(f, bindingId))?.issue === 'handler_failed', 'worker must persist its fault');
    await jobs.stop(); await jobs.drain();
    const before = await workDisposition(f, bindingId); assert.ok(before); assert.equal(before.attempts, 1); assert.equal(attempts, 1);
    assert.equal(before.state, maxAttempts === 1 ? 'quarantined' : 'pending');
    await observe(context.payments, receipt(transaction('ordinary-new-renewal', 'ordinary-renewal', { origin: known('subscription_recurring') })));
    assert.deepEqual(await cursor(f, bindingId), decision);
    assert.deepEqual(await workDisposition(f, bindingId), before, 'unchanged generation retains state, attempt, issue, exact deadline and claim revision');
    await paymentBossFixture(namespace).deleteAllJobs(); await jobs.repair(100);
    assert.equal((await f.pool.query(`SELECT id FROM "${jobSchema}".job WHERE data ->> 'kind' = 'reclassification'`)).rows.length, 0, 'queue deletion cannot bypass quarantine/cooldown');
    await jobs.redrive({ kind: 'reclassification', id: bindingId }, 'operator-reviewed-fault');
    const redriven = await workDisposition(f, bindingId); assert.ok(redriven); assert.equal(redriven.state, 'pending'); assert.equal(redriven.attempts, 0); assert.equal(redriven.issue, 'redrive:operator-reviewed-fault');
    assert.equal((await f.pool.query(`SELECT id FROM "${f.schema}".records WHERE kind = 'jobRedrives'`)).rows.length, 1);
    await select(context, bindingId, 'sub-a');
    const replacement = await workDisposition(f, bindingId); assert.ok(replacement); assert.equal(replacement.state, 'pending'); assert.equal(replacement.attempts, 0); assert.equal(replacement.issue, null);
    assert.equal((await cursor(f, bindingId))?.decisionRevision, (decision?.decisionRevision ?? 0) + 1);
    assert.ok(BigInt(replacement.revision) > BigInt(redriven.revision));
    assert.equal(errors.length, 1);
    const diagnostic = errors[0]; assert.ok(diagnostic instanceof PaymentJobHandlerError);
    assert.equal(diagnostic.cause, persistentFault);
    assert.deepEqual(diagnostic.work, { kind: 'reclassification', id: bindingId });
    assert.equal(diagnostic.attempt, 1);
  } finally { await jobs?.stop(); await jobs?.drain(); await context.payments.drain(); await f.pool.query(`DROP SCHEMA IF EXISTS "${jobSchema}" CASCADE`); await f.close(); }
});}

void test('an old failed claimant cannot quarantine replacement work claimed again at attempt one', { timeout: 25_000 }, async () => {
  const f = await databaseFixture(), context = runtime(f.store), jobSchema = `q_${f.schema}`;
  const errors: Error[] = [], namespace = { database: f.database, paymentSchema: f.schema, jobSchema, scope, onError: (error: Error) => errors.push(error) };
  const enteredOld = deferred<void>(), releaseOld = deferred<void>(), enteredNew = deferred<void>(), releaseNew = deferred<void>();
  let jobs: ReturnType<typeof createPostgresPaymentJobs> | undefined;
  try {
    const bindingId = await selectedInitial(context);
    const transport = createPgBossPaymentTransport(namespace); await transport.bootstrap();
    let calls = 0;
    const oldFault = new Error('old generation fault'), replacementFault = new Error('replacement generation fault');
    f.store.processReclassification = async () => {
      calls += 1;
      if (calls === 1) { enteredOld.resolve(); await releaseOld.promise; throw oldFault; }
      enteredNew.resolve(); await releaseNew.promise; throw replacementFault;
    };
    jobs = createPostgresPaymentJobs({ ...namespace, transport, concurrency: 2, maxAttempts: 1, cooldownSeconds: 30, maxCooldownSeconds: 30, pollingIntervalSeconds: 0.5 });
    await jobs.repair(100);
    const oldId = (await f.pool.query<{ id: string }>(`SELECT id FROM "${jobSchema}".job WHERE data ->> 'kind' = 'reclassification'`)).rows[0]?.id; assert.ok((oldId !== undefined && oldId !== ''));
    await jobs.start({ payments: context.payments, store: f.store }); await enteredOld.promise;
    await select(context, bindingId, 'sub-a');
    await paymentBossFixture(namespace).send('payments_work', { kind: 'reclassification', id: bindingId }, { singletonKey: 'new-generation-race' });
    await enteredNew.promise;
    const current = await workDisposition(f, bindingId); assert.ok(current); assert.equal(current.attempts, 1); assert.equal(current.state, 'pending');
    releaseOld.resolve();
    await untilPersisted(async () => (await f.pool.query<{ state: string }>(`SELECT state FROM "${jobSchema}".job WHERE id = $1`, [oldId])).rows[0]?.state === 'completed', 'old claimant must physically finish settlement');
    assert.deepEqual(await workDisposition(f, bindingId), current, 'old attempt one cannot overwrite the current generation attempt one');
    releaseNew.resolve();
    await untilPersisted(async () => (await workDisposition(f, bindingId))?.state === 'quarantined', 'the current claimant retains its own fault policy');
    assert.equal((await workDisposition(f, bindingId))?.attempts, 1); assert.equal(calls, 2);
    await jobs.stop(); await jobs.drain();
    await select(context, bindingId, 'sub-a');
    const replacedFault = await workDisposition(f, bindingId); assert.ok(replacedFault);
    assert.equal(replacedFault.state, 'pending'); assert.equal(replacedFault.attempts, 0); assert.equal(replacedFault.issue, null);
    assert.equal((await cursor(f, bindingId))?.decisionRevision, 3, 'a genuine new decision directly replaces the prior quarantined generation');
    assert.equal(errors.length, 2);
    for (const [index, cause] of [oldFault, replacementFault].entries()) {
      const diagnostic = errors[index]; assert.ok(diagnostic instanceof PaymentJobHandlerError);
      assert.equal(diagnostic.cause, cause);
      assert.deepEqual(diagnostic.work, { kind: 'reclassification', id: bindingId });
      assert.equal(diagnostic.attempt, 1, 'each generation owns its first logical attempt');
    }
  } finally { releaseOld.resolve(); releaseNew.resolve(); await jobs?.stop(); await jobs?.drain(); await context.payments.drain(); await f.pool.query(`DROP SCHEMA IF EXISTS "${jobSchema}" CASCADE`); await f.close(); }
});

for (const channel of ['authenticated', 'webhook', 'reconciliation'] as const) {void test(`${channel} T1 fences both historical adjustment parents before stale publication T2; cleanup and page rollback stay atomic`, { timeout: 25_000 }, async () => {
  const f = await databaseFixture(), context = runtime(f.store);
  try {
    const a = success(await context.payments.startPurchase({ buyerId: 'buyer', offerId: 'monthly', requestKey: 'a' })), b = success(await context.payments.startPurchase({ buyerId: 'buyer', offerId: 'monthly', requestKey: 'b' }));
    await observe(context.payments, receipt(transaction(a.transactionRef, 'paid-a')));
    await observe(context.payments, receipt(transaction(b.transactionRef, 'paid-b', { subscriptionRef: known('sub-b') })));
    const adjustment: AdjustmentObservation = { kind: 'adjustment', adjustmentRef: 'historical-admission', transactionRef: a.transactionRef, version: at, action: 'refund', status: 'rejected', amount: money('USD', '1000'), allocations: [{ providerLineRef: `line-${a.transactionRef}`, amount: money('USD', '1000') }], source: transaction(a.transactionRef, 'adjustment-v1').source };
    await observe(context.payments, receipt(adjustment));
    await observe(context.payments, receipt({ ...adjustment, version: '2026-01-02T00:00:00Z', source: { ...adjustment.source, receiptId: 'adjustment-v2' } }));
    const staged = [];
    for (const checkout of [a, b]) {
      const loaded = await f.store.loadPublicationInput(scope, { type: 'transaction', id: checkout.transactionRef }); assert.ok(loaded); assert.equal(loaded.incompleteReason, undefined);
      for (const observation of loaded.state.transactions[checkout.transactionRef]?.observations ?? []) {reduceObservation(loaded.state, scope, observation);}
      publishEvidence(loaded.state, scope, 'database-fixture', 65536); staged.push(loaded);
    }
    const plain = receipt({ ...adjustment, transactionRef: b.transactionRef, source: { ...adjustment.source, receiptId: `contradiction-${channel}` } });
    const incoming: VerifiedInput = channel === 'webhook' ? { ...plain, source: { ...plain.source, kind: 'verified_webhook', eventId: 'contradictory-event', stableEnvelopeDigest: 'fixture-envelope', verification: { endpointId: 'fixture', verifiedAt: at, rawBodyDigest: 'fixture-body' } } } : plain;
    const submitted = { ...incoming, observation: { ...incoming.observation, source: incoming.source } };
    if (channel === 'reconciliation') {
      const page = [submitted, ...Array.from({ length: 199 }, (_, index) => receipt(transaction(`page-${index}`, index === 198 ? 'fail-after-custody' : `page-input-${index}`)))];
      const next = { scanId: 'historical-page', epoch: 'test', queryFingerprint: 'fixture', status: 'complete' as const };
      // All route locks precede writes. The migration-role fixture both bounds the real lock set
      // and injects a failure after the prior receipts and both affected routes were written.
      await f.pool.query(`CREATE FUNCTION "${f.schema}".admission_probe() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF (SELECT count(*) FROM pg_locks WHERE pid = pg_backend_pid() AND locktype = 'advisory') > 512 THEN RAISE EXCEPTION 'admission lock bound'; END IF;
        IF NEW.id = 'fail-after-custody' THEN RAISE EXCEPTION 'injected custody rollback'; END IF;
        RETURN NEW; END $$`);
      await f.pool.query(`CREATE TRIGGER admission_probe BEFORE INSERT OR UPDATE ON "${f.schema}".records FOR EACH ROW EXECUTE FUNCTION "${f.schema}".admission_probe()`);
      const before = await Promise.all([a, b].map(checkout => context.payments.readPurchase('buyer', checkout.intentId)));
      await assert.rejects(f.store.commitScanPage(scope, undefined, next, page), /injected custody rollback/);
      assert.deepEqual(await Promise.all([a, b].map(checkout => context.payments.readPurchase('buyer', checkout.intentId))), before);
      assert.equal(await f.store.readCheckpoint(scope, next.scanId), undefined);
      assert.equal((await f.pool.query(`SELECT id FROM "${f.schema}".records WHERE kind = 'inbox' AND (id = $1 OR id LIKE 'page-input-%')`, [submitted.inputId])).rows.length, 0);
      await f.pool.query(`CREATE OR REPLACE FUNCTION "${f.schema}".admission_probe() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF (SELECT count(*) FROM pg_locks WHERE pid = pg_backend_pid() AND locktype = 'advisory') > 512 THEN RAISE EXCEPTION 'admission lock bound'; END IF; RETURN NEW; END $$`);
      assert.deepEqual(await f.store.commitScanPage(scope, undefined, next, page), { kind: 'committed' });
      assert.equal((await f.pool.query(`SELECT id FROM "${f.schema}".records WHERE kind = 'inbox' AND (id IN ($1, 'fail-after-custody') OR id LIKE 'page-input-%')`, [submitted.inputId])).rows.length, 200);
    } else {success(await context.payments.ingestVerifiedInput(submitted));}
    for (const loaded of staged) {assert.deepEqual(await f.store.commitReduction(scope, { inputId: loaded.inputId, expected: loaded.expected, state: loaded.state }), { kind: 'conflict' }, 'successful adverse T1 invalidates every already-known parent T2');}
    for (const checkout of [a, b]) {
      const aggregate = (await context.payments.readPurchase('buyer', checkout.intentId))?.transactions[0]; assert.ok(aggregate); assert.ok(aggregate.pendingAdverse.includes(submitted.inputId)); assert.equal(aggregate.flags.includes('conflict'), false);
      assert.ok((await f.store.listWork(scope, 'publication', 100)).some(id => id === canonicalJson({ type: 'transaction', id: checkout.transactionRef })));
    }
    assert.equal(await context.payments.processInbox(submitted.inputId), 'processed');
    for (const checkout of [a, b]) {
      const aggregate = (await context.payments.readPurchase('buyer', checkout.intentId))?.transactions[0]; assert.ok(aggregate); assert.ok(aggregate.flags.includes('conflict')); assert.ok(!aggregate.pendingAdverse.includes(submitted.inputId));
    }
    const original = (await f.pool.query<{ body: { projection: { transactionRef: string } } }>(`SELECT body FROM "${f.schema}".records WHERE kind = 'versionEvidence' AND id = $1`, [objectVersionKey(adjustment)])).rows[0]?.body;
    assert.equal(original?.projection.transactionRef, a.transactionRef);
  } finally { await context.payments.drain(); await f.close(); }
});}

void test('T1 parent discovery waits for a concurrent first exact-version certification and then fences its retained parent', { timeout: 15_000 }, async () => {
  const f = await databaseFixture(), context = runtime(f.store), blocker = await f.pool.connect();
  let gateHeld = false;
  try {
    const a = success(await context.payments.startPurchase({ buyerId: 'buyer', offerId: 'monthly', requestKey: 'a' })), b = success(await context.payments.startPurchase({ buyerId: 'buyer', offerId: 'monthly', requestKey: 'b' }));
    await observe(context.payments, receipt(transaction(a.transactionRef, 'paid-a'))); await observe(context.payments, receipt(transaction(b.transactionRef, 'paid-b', { subscriptionRef: known('sub-b') })));
    const adjustment: AdjustmentObservation = { kind: 'adjustment', adjustmentRef: 'first-certification', transactionRef: a.transactionRef, version: at, action: 'refund', status: 'rejected', amount: money('USD', '100'), allocations: [], source: transaction(a.transactionRef, 'original-certification').source };
    const original = receipt(adjustment); success(await context.payments.ingestVerifiedInput(original));
    const prepared = await f.store.loadReductionInput(scope, original.inputId); assert.ok(prepared);
    processInput(prepared.state, scope, prepared.inputId); publishEvidence(prepared.state, scope, 'database-fixture', 65536);
    await f.pool.query(`CREATE FUNCTION "${f.schema}".certification_gate() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.kind = 'versionEvidence' AND NEW.body ->> 'entityRef' = 'first-certification' THEN PERFORM pg_advisory_xact_lock(hashtextextended('${f.schema}:certification-gate', 0)); END IF; RETURN NEW; END $$`);
    await f.pool.query(`CREATE TRIGGER certification_gate BEFORE INSERT OR UPDATE ON "${f.schema}".records FOR EACH ROW EXECUTE FUNCTION "${f.schema}".certification_gate()`);
    await blocker.query('BEGIN'); gateHeld = true;
    const blockerPid = (await blocker.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
    await blocker.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`${f.schema}:certification-gate`]);
    const certification = f.store.commitReduction(scope, { inputId: prepared.inputId, expected: prepared.expected, state: prepared.state });
    let writerPid = 0;
    await untilPersisted(async () => {
      const writer = (await f.pool.query<{ pid: number }>('SELECT pid FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))', [blockerPid])).rows[0];
      writerPid = writer?.pid ?? 0; return writerPid !== 0;
    }, 'certification writer must reach its database barrier');
    const incoming = receipt({ ...adjustment, transactionRef: b.transactionRef, source: { ...adjustment.source, receiptId: 'concurrent-contradiction' } });
    const admission = context.payments.ingestVerifiedInput(incoming);
    await untilPersisted(async () => (await f.pool.query('SELECT pid FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))', [writerPid])).rows.length > 0, 'admission must wait for the in-flight certification lock');
    await blocker.query('ROLLBACK'); gateHeld = false;
    assert.deepEqual(await certification, { kind: 'committed' }); success(await admission);
    for (const checkout of [a, b]) {assert.ok(((await context.payments.readPurchase('buyer', checkout.intentId))?.transactions[0]?.pendingAdverse.includes(incoming.inputId) === true));}
    assert.equal(await context.payments.processInbox(incoming.inputId), 'processed');
    for (const checkout of [a, b]) {
      const aggregate = (await context.payments.readPurchase('buyer', checkout.intentId))?.transactions[0]; assert.ok(aggregate); assert.ok(aggregate.flags.includes('conflict')); assert.ok(!aggregate.pendingAdverse.includes(incoming.inputId));
    }
  } finally { if (gateHeld) {await blocker.query('ROLLBACK');} blocker.release(); await context.payments.drain(); await f.close(); }
});


void test('a duplicate pending receipt fences a historical parent certified since its first admission', async () => {
  const f = await databaseFixture(), context = runtime(f.store);
  try {
    const a = success(await context.payments.startPurchase({ buyerId: 'buyer', offerId: 'monthly', requestKey: 'a' })), b = success(await context.payments.startPurchase({ buyerId: 'buyer', offerId: 'monthly', requestKey: 'b' }));
    await observe(context.payments, receipt(transaction(a.transactionRef, 'paid-a'))); await observe(context.payments, receipt(transaction(b.transactionRef, 'paid-b', { subscriptionRef: known('sub-b') })));
    const original: AdjustmentObservation = { kind: 'adjustment', adjustmentRef: 'late-certification', transactionRef: a.transactionRef, version: at, action: 'refund', status: 'rejected', amount: money('USD', '100'), allocations: [], source: transaction(a.transactionRef, 'original').source };
    const early = receipt({ ...original, transactionRef: b.transactionRef, source: { ...original.source, receiptId: 'early-other-parent' } });
    success(await context.payments.ingestVerifiedInput(early));
    await observe(context.payments, receipt(original));
    const stale = await f.store.loadPublicationInput(scope, { type: 'transaction', id: a.transactionRef }); assert.ok(stale);
    for (const observation of stale.state.transactions[a.transactionRef]?.observations ?? []) {reduceObservation(stale.state, scope, observation);}
    publishEvidence(stale.state, scope, 'database-fixture', 65536);
    success(await context.payments.ingestVerifiedInput(early));
    assert.deepEqual(await f.store.commitReduction(scope, { inputId: stale.inputId, expected: stale.expected, state: stale.state }), { kind: 'conflict' });
    for (const checkout of [a, b]) {assert.ok(((await context.payments.readPurchase('buyer', checkout.intentId))?.transactions[0]?.pendingAdverse.includes(early.inputId) === true));}
    assert.equal(await context.payments.processInbox(early.inputId), 'processed');
    for (const checkout of [a, b]) {
      const aggregate = (await context.payments.readPurchase('buyer', checkout.intentId))?.transactions[0]; assert.ok(aggregate); assert.ok(aggregate.flags.includes('conflict')); assert.ok(!aggregate.pendingAdverse.includes(early.inputId));
    }
    const beforeReplay = await Promise.all([a, b].map(checkout => context.payments.readPurchase('buyer', checkout.intentId)));
    const evidence = async () => (await f.pool.query<{ id: string; body: EvidenceMessage }>(`SELECT id, body FROM "${f.schema}".records WHERE kind = 'evidence' ORDER BY id`)).rows;
    const immutableEvidence = await evidence();
    success(await context.payments.ingestVerifiedInput(early));
    assert.equal(await context.payments.processInbox(early.inputId), 'duplicate');
    assert.deepEqual(await Promise.all([a, b].map(checkout => context.payments.readPurchase('buyer', checkout.intentId))), beforeReplay, 'processed duplicates cannot recreate pending markers or rewrite completion');
    assert.deepEqual(await evidence(), immutableEvidence, 'processed replay creates no new evidence and preserves immutable messages');
  } finally { await context.payments.drain(); await f.close(); }
});
