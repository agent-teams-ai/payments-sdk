import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';
import { MockAgent, getGlobalDispatcher, install, setGlobalDispatcher } from 'undici';
import { createPaymentReconciler, createPayments, digest, type OfferSnapshot, type PaymentScope, type ReconciliationQuery, type VerifiedInput } from '@agent-teams/payments-core';
import { createPaddleProvider, createPaddleReconciliationSource } from '@agent-teams/payments-paddle';
import { createPostgresPaymentStore, migratePaymentSchema } from '@agent-teams/payments-postgres';
import { adjustmentFixture, eventFixture, paddleIds, responseFixture, subscriptionFixture, transactionFixture } from '../../packages/payments-paddle/test/fixtures.ts';

const scope: PaymentScope = { applicationId: 'app-a', provider: 'paddle', paymentAccountId: 'merchant-fixture', environment: 'sandbox' };
const query: ReconciliationQuery = { kind: 'events', from: '2026-09-30T00:00:00Z', to: '2026-10-03T00:00:00Z', perPage: 2, queryVersion: 'events/1', purpose: 'catch_up' };
const secret = 'synthetic-reconciliation-secret';
function sign(body: string): string { const ts = Math.floor(Date.now() / 1000); return `ts=${ts};h1=${createHmac('sha256', secret).update(`${ts}:${body}`).digest('hex')}`; }

test('durable reconciliation through actual public Paddle SDK and PostgreSQL', { timeout: 60_000 }, async t => {
  const names = ['fetch', 'Headers', 'Response', 'Request', 'FormData', 'WebSocket', 'CloseEvent', 'ErrorEvent', 'MessageEvent', 'EventSource'] as const;
  const saved = names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const), dispatcher = getGlobalDispatcher();
  install(); const agent = new MockAgent(); agent.disableNetConnect(); setGlobalDispatcher(agent);
  const api = agent.get('https://sandbox-api.paddle.com');
  const connectionString = process.env['DATABASE_URL']; if (!connectionString) throw new Error('DATABASE_URL is required for reconciliation integration tests');
  const pool = new Pool({ connectionString, max: 8, connectionTimeoutMillis: 1000 });
  const provider = createPaddleProvider({ scope, apiKey: 'synthetic-noncredential', apiVersion: 1, webhook: { endpointId: 'reconciliation-fixture', secret, apiVersion: 1 } });
  const source = createPaddleReconciliationSource(provider);
  async function isolated(run: (context: { schema: string; store: Awaited<ReturnType<typeof createPostgresPaymentStore>>; reconciler: ReturnType<typeof createPaymentReconciler> }) => Promise<void>) {
    const schema = `reconcile_${randomUUID().replaceAll('-', '').slice(0, 20)}`;
    try {
      await migratePaymentSchema({ pool, schema, scope });
      const store = await createPostgresPaymentStore({ pool, schema, scope });
      await run({ schema, store, reconciler: createPaymentReconciler({ scope, store, source }) });
    } finally { await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); }
  }
  const eventPath = (after?: string, eventType?: string) => (path: string): boolean => {
    const url = new URL(path, 'https://sandbox-api.paddle.com');
    if (url.pathname !== '/events') return false;
    assert.equal(url.searchParams.get('from'), query.from); assert.equal(url.searchParams.get('to'), query.to);
    assert.equal(url.searchParams.get('order_by'), 'id[ASC]'); assert.equal(url.searchParams.get('after'), after ?? null);
    assert.equal(url.searchParams.get('event_type'), eventType ?? null); return true;
  };
  try {
    await t.test('begin creates a durable obligation; failed atomic commit retains cursor and rolls back every input', async () => isolated(async ({ schema, store, reconciler }) => {
      await reconciler.beginScan({ scanId: 'rollback', epoch: 'epoch-1', query });
      const obligation = await pool.query<{ state: string }>(`SELECT state FROM "${schema}".obligations WHERE kind='scan' AND id='rollback'`);
      assert.equal(obligation.rows[0]?.state, 'pending');
      const checkpoint = await store.readCheckpoint(scope, 'rollback'); assert.ok(checkpoint); assert.equal(checkpoint.after, undefined);
      await pool.query(`CREATE FUNCTION "${schema}".reject_scan() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.kind='scans' AND NEW.body ? 'after' THEN RAISE EXCEPTION 'synthetic scan commit failure'; END IF; RETURN NEW; END $$`);
      await pool.query(`CREATE TRIGGER reject_scan BEFORE UPDATE ON "${schema}".records FOR EACH ROW EXECUTE FUNCTION "${schema}".reject_scan()`);
      const page = [eventFixture('future.event', { diagnostic_one: true }), eventFixture('future.event', { diagnostic_two: true }, paddleIds.secondEvent)];
      api.intercept({ path: eventPath(), method: 'GET' }).reply(200, responseFixture(page, true));
      await assert.rejects(reconciler.resumeScan('rollback'), /synthetic scan commit failure/u);
      assert.deepEqual(await store.readCheckpoint(scope, 'rollback'), checkpoint);
      assert.equal((await store.listWork(scope, 'inbox', 100)).length, 0);
      assert.equal(Number((await pool.query<{ count: string }>(`SELECT count(*) FROM "${schema}".records WHERE kind='inbox'`)).rows[0]?.count), 0);
      await pool.query(`DROP TRIGGER reject_scan ON "${schema}".records`);
      api.intercept({ path: eventPath(), method: 'GET' }).reply(200, responseFixture(page, true));
      const restarted = createPaymentReconciler({ scope, store: await createPostgresPaymentStore({ pool, schema, scope }), source });
      assert.equal((await restarted.resumeScan('rollback')).kind, 'saved');
      const accepted = await store.listWork(scope, 'inbox', 100); assert.equal(accepted.length, 2);
      for (const id of accepted) {
        const input = (await store.loadReductionInput(scope, id))?.state.inbox[id]?.input; assert.ok(input);
        assert.equal(digest(input.retainedRepresentation), input.source.representationDigest); assert.equal(input.observation.kind, 'unsupported');
      }
      const last = await store.readCheckpoint(scope, 'rollback'); assert.equal(last?.after, paddleIds.secondEvent);
      const acquire = await store.loadReductionInput(scope, accepted[0]!); assert.ok(acquire);
      const staleInput: VerifiedInput = { ...acquire.state.inbox[accepted[0]!]!.input, inputId: 'stale-cas-input' };
      assert.equal((await store.commitScanPage(scope, checkpoint, { ...last!, status: 'complete' }, [staleInput])).kind, 'conflict');
      assert.equal(await store.loadReductionInput(scope, staleInput.inputId), undefined);
    }));

    await t.test('SDK mapping fails after its internal cursor advance; restart and redrive reread the original durable cursor', async () => isolated(async ({ schema, store, reconciler }) => {
      const subscriptionQuery = { ...query, eventType: 'subscription.updated' };
      await reconciler.beginScan({ scanId: 'mapping', epoch: 'epoch-1', query: subscriptionQuery });
      api.intercept({ path: eventPath(undefined, 'subscription.updated'), method: 'GET' }).reply(200, responseFixture([eventFixture('subscription.updated', subscriptionFixture())], true));
      await reconciler.resumeScan('mapping');
      const malformed = subscriptionFixture(); delete malformed['items'];
      api.intercept({ path: eventPath(paddleIds.event, 'subscription.updated'), method: 'GET' }).reply(200, responseFixture([
        eventFixture('subscription.updated', subscriptionFixture(), paddleIds.secondEvent), eventFixture('subscription.updated', malformed, paddleIds.thirdEvent),
      ], true));
      await reconciler.resumeScan('mapping');
      const failed = await store.readCheckpoint(scope, 'mapping'); assert.equal(failed?.status, 'gap'); assert.equal(failed.after, paddleIds.event);
      assert.equal(failed.lastFailure?.sdkVersion, '3.10.0'); assert.equal(failed.lastFailure?.after, paddleIds.event);
      assert.equal((await store.listWork(scope, 'inbox', 100)).length, 1, 'no partially mapped member was returned or admitted');
      assert.equal((await pool.query<{ state: string }>(`SELECT state FROM "${schema}".obligations WHERE kind='scan' AND id='mapping'`)).rows[0]?.state, 'quarantined');
      const restarted = createPaymentReconciler({ scope, store: await createPostgresPaymentStore({ pool, schema, scope }), source });
      await restarted.retryScan('mapping');
      api.intercept({ path: eventPath(paddleIds.event, 'subscription.updated'), method: 'GET' }).reply(200, responseFixture([
        eventFixture('subscription.updated', subscriptionFixture(), paddleIds.secondEvent), eventFixture('subscription.updated', subscriptionFixture(), paddleIds.thirdEvent),
      ]));
      await restarted.resumeScan('mapping'); assert.equal((await store.readCheckpoint(scope, 'mapping'))?.after, paddleIds.thirdEvent);
      assert.equal((await store.listWork(scope, 'inbox', 100)).length, 3);
      assert.equal((await pool.query<{ state: string }>(`SELECT state FROM "${schema}".obligations WHERE kind='scan' AND id='mapping'`)).rows[0]?.state, 'complete');
    }));

    await t.test('429 and transport failure retain the accepted durable cursor and explicit coverage gap', async () => isolated(async ({ store, reconciler }) => {
      for (const fault of ['rate-limit', 'transport'] as const) {
        await reconciler.beginScan({ scanId: fault, epoch: 'epoch', query });
        api.intercept({ path: eventPath(), method: 'GET' }).reply(200, responseFixture([eventFixture('future.event', {})], true));
        await reconciler.resumeScan(fault);
        const request = api.intercept({ path: eventPath(paddleIds.event), method: 'GET' });
        if (fault === 'rate-limit') request.reply(429, { error: { type: 'request_error', code: 'too_many_requests', detail: 'Synthetic limit', documentation_url: 'https://fixture.invalid/errors', errors: null }, meta: { request_id: 'synthetic-limit' } }, { headers: { 'retry-after': '1' } });
        else request.replyWithError(new Error('Synthetic disconnected transport'));
        await reconciler.resumeScan(fault);
        const checkpoint = await store.readCheckpoint(scope, fault); assert.equal(checkpoint?.after, paddleIds.event); assert.equal(checkpoint.status, 'gap');
        assert.equal(checkpoint.lastFailure?.sdkVersion, '3.10.0'); assert.equal(checkpoint.lastFailure?.code, fault === 'rate-limit' ? 'rate_limited' : 'unavailable');
        assert.equal((await reconciler.coverage({ scanIds: [fault] })).status, 'incomplete');
      }
    }));

    await t.test('compatible raw and mapped events keep complete custody; contradictory identity fences both routes', async () => isolated(async ({ store, reconciler }) => {
      const rawData = transactionFixture({ monthly: false, customerRef: null });
      const body = JSON.stringify(eventFixture('transaction.completed', rawData));
      const raw = await provider.verifyWebhook(body, sign(body)); assert.equal(raw.kind, 'succeeded'); if (raw.kind !== 'succeeded') throw new Error('Expected verified receipt');
      await store.admitVerifiedInputs(scope, [raw.value]);
      await reconciler.beginScan({ scanId: 'compatible', epoch: 'epoch', query: { ...query, eventType: 'transaction.completed' } });
      api.intercept({ path: eventPath(undefined, 'transaction.completed'), method: 'GET' }).reply(200, responseFixture([eventFixture('transaction.completed', rawData)]));
      await reconciler.resumeScan('compatible');
      const pending = await store.listWork(scope, 'inbox', 100); assert.equal(pending.length, 2);
      for (const id of pending) { const loaded = await store.loadReductionInput(scope, id); assert.equal(loaded?.state.inbox[id]?.conflict, false); }
      const mappedId = pending.find(id => id !== raw.value.inputId)!;
      const mapped = (await store.loadReductionInput(scope, mappedId))?.state.inbox[mappedId]?.input; assert.ok(mapped);
      assert.equal(digest(mapped.retainedRepresentation), mapped.source.representationDigest);
      await reconciler.beginScan({ scanId: 'contradictory', epoch: 'epoch', query: { ...query, eventType: 'transaction.updated' } });
      api.intercept({ path: eventPath(undefined, 'transaction.updated'), method: 'GET' }).reply(200, responseFixture([eventFixture('transaction.updated', transactionFixture({ id: paddleIds.secondTransaction, monthly: false }))]));
      await reconciler.resumeScan('contradictory');
      const original = await store.loadReductionInput(scope, raw.value.inputId); assert.ok(original);
      assert.equal(original.state.transactions[paddleIds.transaction]?.flags.includes('conflict'), true);
      const all = await store.listWork(scope, 'inbox', 100);
      const conflictingId = all.find(id => !pending.includes(id)); assert.ok(conflictingId);
      const contradictory = await store.loadReductionInput(scope, conflictingId); assert.equal(contradictory?.state.inbox[conflictingId]?.conflict, true);
      assert.equal(contradictory?.state.transactions[paddleIds.secondTransaction]?.flags.includes('conflict'), true);
    }));

    await t.test('independent completed-transaction adjustment sweep retains financial inputs and bounded terminal cursor', async () => isolated(async ({ store, reconciler }) => {
      await reconciler.beginScan({ scanId: 'adjustments', epoch: 'epoch', query: { kind: 'adjustments', transactionRef: paddleIds.transaction, queryVersion: 'adjustments/1' } });
      api.intercept({ path: path => {
        const url = new URL(path, 'https://sandbox-api.paddle.com');
        assert.equal(url.pathname, '/adjustments'); assert.equal(url.searchParams.get('transaction_id'), paddleIds.transaction); return true;
      }, method: 'GET' }).reply(200, responseFixture([adjustmentFixture()]));
      await reconciler.resumeScan('adjustments');
      const checkpoint = await store.readCheckpoint(scope, 'adjustments'); assert.equal(checkpoint?.status, 'complete'); assert.equal(checkpoint.after, paddleIds.adjustment);
      const [id] = await store.listWork(scope, 'inbox', 100); assert.ok(id);
      const input = (await store.loadReductionInput(scope, id))?.state.inbox[id]?.input; assert.equal(input?.adverseTransactionRef, paddleIds.transaction); assert.equal(input?.observation.kind, 'adjustment');
      assert.equal(digest(input?.retainedRepresentation), input?.source.representationDigest);
    }));

    await t.test('returned unsupported adjustment members retain adverse custody and do not block cursor progress', async () => isolated(async ({ store, reconciler }) => {
      await reconciler.beginScan({ scanId: 'unsupported-adjustment', epoch: 'epoch', query: { kind: 'adjustments', transactionRef: paddleIds.transaction, queryVersion: 'adjustments/1' } });
      const unsupported = adjustmentFixture(); unsupported['currency_code'] = 'BROKEN';
      api.intercept({ path: path => path.startsWith('/adjustments?'), method: 'GET' }).reply(200, responseFixture([unsupported]));
      await reconciler.resumeScan('unsupported-adjustment');
      const checkpoint = await store.readCheckpoint(scope, 'unsupported-adjustment'); assert.equal(checkpoint?.status, 'complete'); assert.equal(checkpoint.after, paddleIds.adjustment);
      const [id] = await store.listWork(scope, 'inbox', 100); assert.ok(id);
      const input = (await store.loadReductionInput(scope, id))?.state.inbox[id]?.input; assert.equal(input?.observation.kind, 'unsupported'); assert.equal(input?.adverseTransactionRef, paddleIds.transaction);
      assert.equal(digest(input?.retainedRepresentation), input?.source.representationDigest);
    }));

    await t.test('public refresh preserves official SDK transaction and subscription receipt bodies and digests', async () => isolated(async ({ store }) => {
      const offer: OfferSnapshot = { applicationId: scope.applicationId, offerId: 'monthly', version: '1', policyVersion: '1', profile: 'monthly', currency: 'USD', allowZeroTotal: false, lines: [{ providerPriceRef: paddleIds.price, benefitSlotId: 'included', quantity: 1 }] };
      const ids = ['intent-fixture', 'operation-fixture', 'basis-fixture', 'attempt-fixture'];
      const runtime = createPayments({ scope, store, provider, producerNamespace: 'reconciliation-fixture', catalog: { resolveOffer: async () => offer }, newId: () => { const id = ids.shift(); if (!id) throw new Error('Exhausted fixture IDs'); return id; } });
      api.intercept({ path: /^\/transactions\??$/u, method: 'POST' }).reply(201, responseFixture(transactionFixture({ status: 'ready', customerRef: null })));
      const checkout = await runtime.startPurchase({ buyerId: 'buyer-fixture', offerId: offer.offerId, requestKey: 'request-fixture' }); assert.equal(checkout.kind, 'succeeded'); if (checkout.kind !== 'succeeded') throw new Error('Expected checkout');
      const transactionPath = (path: string) => new URL(path, 'https://sandbox-api.paddle.com').pathname === `/transactions/${paddleIds.transaction}`;
      api.intercept({ path: transactionPath, method: 'GET' }).reply(200, responseFixture(transactionFixture()));
      const acquired = await provider.readTransactionInput(paddleIds.transaction); assert.equal(acquired.kind, 'succeeded'); if (acquired.kind !== 'succeeded') throw new Error('Expected receipt');
      api.intercept({ path: transactionPath, method: 'GET' }).reply(200, responseFixture(transactionFixture()));
      assert.deepEqual(await runtime.refreshPurchase('buyer-fixture', checkout.value.intentId), { kind: 'succeeded', value: 1 });
      const retained = (await store.loadReductionInput(scope, acquired.value.inputId))?.state.inbox[acquired.value.inputId]?.input;
      assert.deepEqual(retained, acquired.value); assert.equal(digest(retained?.retainedRepresentation), retained?.source.representationDigest);
      const purchase = await runtime.readPurchase('buyer-fixture', checkout.value.intentId); const basis = purchase?.intent.subscriptionBasisId; assert.ok(basis);
      const subscriptionPath = (path: string) => new URL(path, 'https://sandbox-api.paddle.com').pathname === `/subscriptions/${paddleIds.subscription}`;
      api.intercept({ path: subscriptionPath, method: 'GET' }).reply(200, responseFixture(subscriptionFixture()));
      const subscription = await provider.readSubscriptionInput(paddleIds.subscription); assert.equal(subscription.kind, 'succeeded'); if (subscription.kind !== 'succeeded') throw new Error('Expected receipt');
      api.intercept({ path: subscriptionPath, method: 'GET' }).reply(200, responseFixture(subscriptionFixture()));
      assert.deepEqual(await runtime.refreshSubscription('buyer-fixture', basis), { kind: 'succeeded', value: 1 });
      const savedSubscription = (await store.loadReductionInput(scope, subscription.value.inputId))?.state.inbox[subscription.value.inputId]?.input;
      assert.deepEqual(savedSubscription, subscription.value); assert.equal(digest(savedSubscription?.retainedRepresentation), savedSubscription?.source.representationDigest);
    }));
    agent.assertNoPendingInterceptors();
  } finally {
    await pool.end(); await agent.close(); setGlobalDispatcher(dispatcher);
    for (const [name, descriptor] of saved) { if (descriptor === undefined) Reflect.deleteProperty(globalThis, name); else Object.defineProperty(globalThis, name, descriptor); }
  }
});
