import assert from 'node:assert/strict';
import test from 'node:test';
import { Pool } from 'pg';
import { canonicalJson, digest, money, processInput, publishEvidence } from '@agent-teams/payments-core';
import type { AdjustmentObservation, CheckoutReady, EvidenceSource, InboxRecord, PaymentOperation, ProviderResult, TransactionAggregate, VerifiedInput } from '@agent-teams/payments-core';
import { assertPostgresDurability, createPostgresPaymentStore, migratePaymentSchema, PaymentDatabaseError } from '../dist/index.js';
import { createPaymentSqlExecutor, withPaymentTransaction } from '../dist/database.js';
import { at, databaseFixture, deferred, known, observe, receipt, runtime, scope, subscription, success, transaction } from './helpers.ts';
import { postgresFaultProxy } from './fault-proxy.ts';

test('one locked admission page retains sequential duplicate/conflict identity and processed receipts', async () => {
  const f = await databaseFixture(), context = runtime(f.store);
  try {
    const processed = receipt(transaction('already-processed', 'processed-receipt'));
    await observe(context.payments, processed);
    const original = receipt(transaction('first-parent', 'same-page'), { adverseTransactionRef: 'adverse-parent' });
    const contradictory = receipt(transaction('second-parent', 'same-page'), { adverseTransactionRef: 'adverse-parent' });
    assert.deepEqual(await f.store.admitVerifiedInputs(scope, [original, original, contradictory, processed, processed]), [
      { inputId: 'same-page', kind: 'admitted' }, { inputId: 'same-page', kind: 'duplicate' }, { inputId: 'same-page', kind: 'conflict' },
      { inputId: 'processed-receipt', kind: 'duplicate' }, { inputId: 'processed-receipt', kind: 'duplicate' },
    ]);
    const saved = (await f.pool.query<{ body: InboxRecord }>(`SELECT body FROM "${f.schema}".records WHERE kind = 'inbox' AND id = 'same-page'`)).rows[0]?.body;
    assert.deepEqual(saved?.input, original, 'a later representation cannot replace the first durable receipt');
    assert.equal(saved?.conflict, true);
    const conflicts = await f.pool.query<{ body: VerifiedInput }>(`SELECT body FROM "${f.schema}".records WHERE kind = 'conflictingInputs'`);
    assert.deepEqual(conflicts.rows.map(row => row.body), [contradictory]);
    for (const id of ['adverse-parent', 'first-parent', 'second-parent']) {
      const aggregate = (await f.pool.query<{ body: TransactionAggregate }>(`SELECT body FROM "${f.schema}".records WHERE kind = 'transactions' AND id = $1`, [id])).rows[0]?.body;
      assert.ok(aggregate);
      assert.ok(aggregate.flags.includes('conflict'), `both old/new observations and the explicit adverse route retain custody: ${id}`);
      assert.equal(new Set(aggregate.pendingAdverse).size, aggregate.pendingAdverse.length);
      if (id === 'adverse-parent') assert.deepEqual(aggregate.pendingAdverse, ['same-page'], 'later page inputs must read the preceding aggregate write');
    }
    assert.equal(await context.payments.processInbox('same-page'), 'quarantined');
    const completed = (await f.pool.query<{ body: InboxRecord }>(`SELECT body FROM "${f.schema}".records WHERE kind = 'inbox' AND id = 'processed-receipt'`)).rows[0]?.body;
    assert.equal(completed?.state, 'processed'); assert.equal(completed?.attempts, 1);
    const work = (await f.pool.query<{ state: string }>(`SELECT state FROM "${f.schema}".obligations WHERE kind = 'inbox' AND id = 'processed-receipt'`)).rows[0];
    assert.equal(work?.state, 'complete', 'same-page replays do not reopen completed processing');
  } finally { await context.payments.drain(); await f.close(); }
});

test('PostgreSQL ownership and durability are qualified without changing a borrowed host session', async () => {
  const f = await databaseFixture();
  const pool = new Pool({ connectionString: f.connectionString, max: 1, options: '-c synchronous_commit=off' });
  try {
    assert.equal((await pool.query('SHOW synchronous_commit')).rows[0]?.synchronous_commit, 'off');
    await withPaymentTransaction(pool, async tx => {
      assert.equal((await tx.query('SHOW synchronous_commit')).rows[0]?.synchronous_commit, 'on');
      await tx.query(`INSERT INTO "${f.schema}".records VALUES ('proof', 'owner', 1, '{}', clock_timestamp())`);
    });
    assert.equal((await pool.query('SHOW synchronous_commit')).rows[0]?.synchronous_commit, 'off');
    const executor = createPaymentSqlExecutor(pool);
    const answer = await executor.executeSql("BEGIN; SELECT current_setting('synchronous_commit') AS value; COMMIT; SELECT current_setting('synchronous_commit') AS value");
    assert.equal(answer.rows[0]?.['value'], 'on');
    assert.equal((await pool.query('SHOW synchronous_commit')).rows[0]?.synchronous_commit, 'off');
    await assert.rejects(executor.executeSql('BEGIN; SELECT deliberately_missing_function()'));
    assert.equal((await pool.query('SELECT 1 AS alive')).rows[0]?.alive, 1, 'failed executor checkout cannot close the borrowed pool');
    await assert.rejects(createPostgresPaymentStore({ pool, schema: f.schema, scope: { ...scope, applicationId: 'foreign' } }));
    await assert.rejects(migratePaymentSchema({ pool, schema: f.schema, scope: { ...scope, paymentAccountId: 'foreign' } }));
    await f.pool.query(`CREATE UNLOGGED TABLE "${f.schema}".invalid_durability (id integer)`);
    await assert.rejects(assertPostgresDurability(pool, f.schema), error => error instanceof PaymentDatabaseError && error.kind === 'durability_profile');
  } finally { await pool.end(); await f.close(); }
});

test('a lost real COMMIT reply cannot authorize a Paddle-style external mutation or an automatic retry', { timeout: 15_000 }, async () => {
  const f = await databaseFixture(), proxy = await postgresFaultProxy(f.connectionString);
  const pool = new Pool({ connectionString: proxy.connectionString, max: 3, connectionTimeoutMillis: 1000 });
  try {
    const store = await createPostgresPaymentStore({ pool, schema: f.schema, scope });
    const dispatch = store.beginExternalDispatch.bind(store);
    store.beginExternalDispatch = async (...args) => { proxy.loseNextCommit(); return dispatch(...args); };
    const context = runtime(store);
    await assert.rejects(context.payments.startPurchase({ buyerId: 'buyer', offerId: 'monthly', requestKey: 'commit-reply-lost' }), error => error instanceof PaymentDatabaseError && error.kind === 'commit_unknown');
    assert.equal(context.calls(), 0);
    const saved = (await f.pool.query<{ body: PaymentOperation }>(`SELECT body FROM "${f.schema}".records WHERE kind = 'operations'`)).rows[0]?.body;
    assert.equal(saved?.state, 'dispatch_started', 'server commit happened even though the client could not confirm it');
    await context.payments.repair();
    assert.equal(context.calls(), 0, 'durable dispatch marker forbids automatic redispatch');
    assert.equal((await context.payments.readOperation(saved!.operationId))?.state, 'outcome_unknown');
    await context.payments.drain();
  } finally { await pool.end(); await proxy.close(); await f.close(); }
});

test('database acquisition, lock and blackholed socket deadlines leave no borrowed connection debt', { timeout: 15_000 }, async () => {
  const f = await databaseFixture(), proxy = await postgresFaultProxy(f.connectionString);
  const pool = new Pool({ connectionString: proxy.connectionString, max: 1, connectionTimeoutMillis: 1000 });
  const limits = { acquireMs: 30, lockMs: 40, statementMs: 90, transactionMs: 180, deadlineMs: 300 };
  try {
    const held = await pool.connect();
    await assert.rejects(withPaymentTransaction(pool, async () => { throw new Error('must not acquire'); }, limits), error => error instanceof PaymentDatabaseError && error.kind === 'acquisition_timeout');
    held.release();
    await pool.query('SELECT 1');
    assert.equal(pool.waitingCount, 0);
    const blocker = await f.pool.connect();
    try {
      await blocker.query('BEGIN'); await blocker.query('SELECT pg_advisory_xact_lock(882114)');
      await assert.rejects(withPaymentTransaction(pool, tx => tx.query('SELECT pg_advisory_xact_lock(882114)'), limits), error => error instanceof Error && 'code' in error && error.code === '55P03');
    } finally { await blocker.query('ROLLBACK'); blocker.release(); }
    await pool.query('SELECT 1');
    proxy.blackholeReplies(true);
    const started = performance.now();
    await assert.rejects(withPaymentTransaction(pool, tx => tx.query('SELECT 1'), limits));
    assert.ok(performance.now() - started < 1500, 'owned absolute deadline bounds a peer which consumes requests but never replies');
    proxy.blackholeReplies(false);
    assert.equal((await pool.query('SELECT 1 AS alive')).rows[0]?.alive, 1);
    assert.equal(pool.waitingCount, 0); assert.equal(pool.totalCount, 1); assert.equal(pool.idleCount, 1);
  } finally { await pool.end(); await proxy.close(); await f.close(); }
});

test('late old checkout evidence cannot release a newer unresolved subscription mutation lane', { timeout: 15_000 }, async () => {
  const f = await databaseFixture(), context = runtime(f.store, 25);
  // Only the deliberately held calls use the fault deadline. A separate public runtime
  // records the successful retry with an ordinary budget on the same durable owner.
  const successfulRetry = runtime(f.store, 1000);
  const old = deferred<ProviderResult<CheckoutReady>>(), cancellation = deferred<ProviderResult<{ kind: 'applied'; observedStatus: string }>>();
  try {
    context.provider.createCheckout = () => old.promise;
    const first = await context.payments.startPurchase({ buyerId: 'buyer', offerId: 'monthly', requestKey: 'initial' });
    assert.equal(first.kind, 'outcome_unknown'); if (first.kind !== 'outcome_unknown') throw new Error('Fixture');
    const op = await context.payments.readOperation(first.operationId); assert.ok(op?.intentId);
    assert.equal((await context.payments.resolveUnknownOperation({ operationId: op.operationId, expectedRevision: op.revision, actorId: 'operator', auditRef: 'approved-risk', reason: 'reviewed', action: 'retry', acceptedDuplicateRisk: true })).kind, 'succeeded');
    successfulRetry.provider.createCheckout = async command => ({ kind: 'succeeded', value: { intentId: command.intentId, transactionRef: 'new-tx', checkout: {} } });
    assert.equal((await successfulRetry.payments.executeOperation(op.operationId)).kind, 'succeeded');
    await observe(context.payments, receipt(transaction('new-tx', 'completed-new')));
    const basis = (await context.payments.readPurchase('buyer', op.intentId))?.intent.subscriptionBasisId; assert.ok(basis);
    context.provider.cancelSubscription = () => cancellation.promise;
    const cancel = await context.payments.requestCancellation({ buyerId: 'buyer', bindingId: basis, requestKey: 'cancel', timing: 'now' });
    assert.equal(cancel.kind, 'outcome_unknown'); if (cancel.kind !== 'outcome_unknown') throw new Error('Fixture');
    const lateCommitted = deferred<void>(), finish = f.store.finishAttempt.bind(f.store);
    f.store.finishAttempt = async (s, commit) => { const outcome = await finish(s, commit); if (commit.binding?.transactionRef === 'old-tx' && outcome.kind === 'committed') lateCommitted.resolve(); return outcome; };
    old.resolve({ kind: 'succeeded', value: { intentId: op.intentId, transactionRef: 'old-tx', checkout: {} } });
    await lateCommitted.promise;
    const lane = (await f.pool.query<{ body: { unresolvedOperationId?: string } }>(`SELECT body FROM "${f.schema}".records WHERE kind = 'lanes' AND id = $1`, [`subscription:${basis}`])).rows[0]?.body;
    assert.equal(lane?.unresolvedOperationId, cancel.operationId);
    let updates = 0;
    context.provider.openPaymentUpdate = async command => { updates += 1; return { kind: 'succeeded', value: { intentId: command.intentId, transactionRef: 'method-tx', purpose: 'payment_method', checkout: {} } }; };
    assert.equal((await context.payments.openPaymentUpdate({ buyerId: 'buyer', bindingId: basis, requestKey: 'blocked-update' })).kind, 'pending');
    assert.equal(updates, 0);
    assert.deepEqual((await context.payments.readPurchase('buyer', op.intentId))?.intent.transactionRefs.sort(), ['new-tx', 'old-tx']);
  } finally { old.resolve({ kind: 'outcome_unknown' }); cancellation.resolve({ kind: 'outcome_unknown' }); await context.payments.drain(); await successfulRetry.payments.drain(); await f.close(); }
});

test('T1 adverse custody invalidates a prepared T2 read set and cross-source conflicts fence both routes', async () => {
  const f = await databaseFixture(), context = runtime(f.store);
  try {
    const checkout = success(await context.payments.startPurchase({ buyerId: 'buyer', offerId: 'monthly', requestKey: 'paid' }));
    await context.payments.registerConsumer('credit');
    const completed = receipt(transaction(checkout.transactionRef, 'paid'));
    await context.payments.ingestVerifiedInput(completed);
    const old = await f.store.loadReductionInput(scope, completed.inputId); assert.ok(old);
    processInput(old.state, scope, completed.inputId); publishEvidence(old.state, scope, 'database-fixture', 65536);
    const adjustment: AdjustmentObservation = { kind: 'adjustment', adjustmentRef: 'refund', transactionRef: checkout.transactionRef, version: at, action: 'refund', status: 'pending_approval', amount: money('USD', '1000'), allocations: [{ providerLineRef: `line-${checkout.transactionRef}`, amount: money('USD', '1000') }], source: { ...completed.source, receiptId: 'refund' } };
    await context.payments.ingestVerifiedInput(receipt(adjustment, { adverseTransactionRef: checkout.transactionRef }));
    assert.deepEqual(await f.store.commitReduction(scope, { inputId: completed.inputId, expected: old.expected, state: old.state }), { kind: 'conflict' });
    assert.equal(await context.payments.processInbox(completed.inputId), 'processed');
    const pending = (await context.payments.readPurchase('buyer', checkout.intentId))?.transactions[0];
    assert.deepEqual(pending?.pendingAdverse, ['refund']);
    assert.ok((await context.payments.readDeliveries('credit')).some(message => message.kind === 'complete' && message.flags.includes('pending_adverse')));
    assert.equal(await context.payments.processInbox('refund'), 'processed');
    const withEvent = (input: VerifiedInput, source: EvidenceSource): VerifiedInput => ({ ...input, source, observation: { ...input.observation, source } });
    const base = receipt(transaction('original-route', 'raw-event'));
    const raw = withEvent(base, { ...base.source, kind: 'verified_webhook', eventId: 'shared-event', eventType: 'transaction.completed', occurredAt: at, stableEnvelopeDigest: digest('raw-canonical'), verification: { endpointId: 'fixture', verifiedAt: at, rawBodyDigest: digest(base.retainedRepresentation) } });
    await observe(context.payments, raw);
    const later = receipt(transaction('changed-route', 'api-event'));
    const api = withEvent(later, { ...later.source, eventId: 'shared-event', eventType: 'transaction.paid', occurredAt: '2026-01-02T00:00:00Z' });
    assert.equal((await f.store.admitVerifiedInputs(scope, [api]))[0]?.kind, 'conflict');
    assert.equal(await context.payments.processInbox(api.inputId), 'quarantined');
    for (const id of ['original-route', 'changed-route']) {
      const aggregate = (await f.pool.query<{ body: TransactionAggregate }>(`SELECT body FROM "${f.schema}".records WHERE kind = 'transactions' AND id = $1`, [id])).rows[0]?.body;
      assert.ok(aggregate?.flags.includes('conflict'));
      await context.payments.flushPublication({ type: 'transaction', id });
    }
    const messages = await context.payments.readDeliveries('credit', 100);
    for (const id of ['original-route', 'changed-route']) assert.ok(messages.some(message => message.aggregate.id === id && message.kind === 'complete' && message.flags.includes('conflict')));
  } finally { await context.payments.drain(); await f.close(); }
});

test('bounded overflow publishes an immutable held revision and preserves existing financial history', async () => {
  const f = await databaseFixture(), context = runtime(f.store);
  try {
    const checkout = success(await context.payments.startPurchase({ buyerId: 'buyer', offerId: 'monthly', requestKey: 'bounded' }));
    await context.payments.registerConsumer('credit');
    await observe(context.payments, receipt(transaction(checkout.transactionRef, 'normal')));
    const before = (await context.payments.readPurchase('buyer', checkout.intentId))?.transactions[0]; assert.ok(before?.completion);
    const larger = receipt(transaction(checkout.transactionRef, 'large'));
    const retainedRepresentation = { projection: larger.retainedRepresentation, diagnostic: 'x'.repeat(12_000) };
    const source = { ...larger.source, representationDigest: digest(retainedRepresentation) };
    const large: VerifiedInput = { ...larger, source, observation: { ...larger.observation, source }, retainedRepresentation };
    await context.payments.ingestVerifiedInput(large);
    const limited = runtime(await createPostgresPaymentStore({ pool: f.pool, schema: f.schema, scope, maxWorkingSetBytes: 4096 }));
    assert.equal(await limited.payments.processInbox(large.inputId), 'quarantined');
    const after = (await context.payments.readPurchase('buyer', checkout.intentId))?.transactions[0];
    assert.equal(canonicalJson(after?.completion), canonicalJson(before.completion));
    const messages = await context.payments.readDeliveries('credit', 100);
    const held = messages.find(message => message.kind === 'held'); assert.ok(held);
    assert.ok(held.revision > before.evidenceRevision);
    const { bodyDigest, ...body } = held; assert.equal(bodyDigest, digest(body));
    assert.equal(await context.payments.acknowledgeDelivery('credit', held.messageId, 'wrong-digest'), 'conflict');
    assert.equal(await context.payments.acknowledgeDelivery('credit', held.messageId, held.bodyDigest), 'acknowledged');
    assert.equal(await context.payments.acknowledgeDelivery('credit', held.messageId, held.bodyDigest), 'duplicate');
  } finally { await context.payments.drain(); await f.close(); }
});

test('historical exact-version contradictions survive restart, acknowledgement and newer watermarks', async () => {
  const f = await databaseFixture(), context = runtime(f.store);
  try {
    const checkout = success(await context.payments.startPurchase({ buyerId: 'buyer', offerId: 'monthly', requestKey: 'history' }));
    await context.payments.registerConsumer('audit');
    await observe(context.payments, receipt(transaction(checkout.transactionRef, 'history-paid')));
    await observe(context.payments, receipt(subscription('sub-a', 'sub-v1')));
    const v2 = '2026-01-02T00:00:00Z';
    await observe(context.payments, receipt({ ...subscription('sub-a', 'sub-v2'), version: v2 }));
    const adjustment: AdjustmentObservation = { kind: 'adjustment', adjustmentRef: 'history-refund', transactionRef: checkout.transactionRef, version: at, action: 'refund', status: 'pending_approval', amount: money('USD', '100'), allocations: [{ providerLineRef: `line-${checkout.transactionRef}`, amount: money('USD', '100') }], source: { ...subscription('sub-a', 'adjustment-v1').source } };
    await observe(context.payments, receipt(adjustment, { adverseTransactionRef: checkout.transactionRef }));
    await observe(context.payments, receipt({ ...adjustment, version: v2, status: 'approved', source: { ...adjustment.source, receiptId: 'adjustment-v2' } }, { adverseTransactionRef: checkout.transactionRef }));
    for (const message of await context.payments.readDeliveries('audit', 100)) await context.payments.acknowledgeDelivery('audit', message.messageId, message.bodyDigest);
    const restarted = runtime(await createPostgresPaymentStore({ pool: f.pool, schema: f.schema, scope }));
    await observe(restarted.payments, receipt({ ...subscription('sub-a', 'conflicting-old-sub'), version: '2026-01-01T00:00:00.000001000+00:00', status: known('canceled') }));
    await observe(restarted.payments, receipt({ ...adjustment, amount: money('USD', '90'), allocations: [{ providerLineRef: `line-${checkout.transactionRef}`, amount: money('USD', '90') }], source: { ...adjustment.source, receiptId: 'conflicting-old-adjustment' } }, { adverseTransactionRef: checkout.transactionRef }));
    const purchase = await restarted.payments.readPurchase('buyer', checkout.intentId); assert.ok(purchase?.intent.subscriptionBasisId);
    const sub = await restarted.payments.readObservedSubscription('buyer', purchase.intent.subscriptionBasisId);
    assert.equal(sub?.observations[0]?.current?.version, v2);
    assert.ok(sub?.observations[0]?.flags.includes('conflict'));
    assert.equal(purchase.transactions[0]?.adjustments['history-refund']?.version, v2);
    assert.ok(purchase.transactions[0]?.flags.includes('conflict'));
    const messages = await restarted.payments.readDeliveries('audit', 100);
    assert.ok(messages.some(message => message.kind === 'subscription_complete' && message.flags.includes('conflict')));
    assert.ok(messages.some(message => message.kind === 'complete' && message.flags.includes('conflict')));
    const versions = await f.pool.query(`SELECT body FROM "${f.schema}".records WHERE kind = 'versionEvidence'`);
    assert.equal(versions.rows.length, 5, 'equivalent timestamp spelling uses the original exact-version identity');
    // Producer namespace is a durable identity, not a way to erase acknowledged history.
    const loaded = await f.store.loadPublicationInput(scope, { type: 'transaction', id: checkout.transactionRef }); assert.ok(loaded);
    const aggregate = loaded.state.transactions[checkout.transactionRef]; assert.ok(aggregate); aggregate.publicationRequired = true;
    publishEvidence(loaded.state, scope, 'different-namespace', 65536);
    assert.deepEqual(await f.store.commitReduction(scope, { inputId: loaded.inputId, expected: loaded.expected, state: loaded.state }), { kind: 'conflict' });
    assert.equal((await f.pool.query(`SELECT body FROM "${f.schema}".records WHERE kind = 'ownerIdentity' AND id = 'producerNamespace'`)).rows[0]?.body, 'database-fixture');
  } finally { await context.payments.drain(); await f.close(); }
});
