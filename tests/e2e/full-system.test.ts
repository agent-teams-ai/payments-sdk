import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import test from 'node:test';
import { Pool } from 'pg';
import { MockAgent, getGlobalDispatcher, install, setGlobalDispatcher } from 'undici';
import { createPaddleProvider } from '@agent-teams/payments-paddle';
import { createPostgresPaymentStore, migratePaymentSchema } from '@agent-teams/payments-postgres';
import type { CheckoutReady, EvidenceMessage, OfferSnapshot, OperationResult, PaymentRuntimeOptions } from '@agent-teams/payments-core';
import { createNodeHttpHost } from '../../examples/node-http.ts';
import { createFetchModularHost } from '../../examples/fetch-modular.ts';
import type { HostedPayments } from '../../examples/node-http.ts';
import { AccessFixture, CreditFixture, sourceIdentity } from '../fixtures/consumers/index.ts';
import type { Effect } from '../fixtures/consumers/index.ts';
import { adjustmentFixture, eventFixture, paddleIds, responseFixture, subscriptionFixture, transactionFixture } from '../../packages/payments-paddle/test/fixtures.ts';
import { nextPeriod, offer, producerNamespace, scope } from './consumer-support.ts';

const SECRET = 'synthetic-e2e-destination-secret';
const Q = 100n, T = 25n;
function sign(body: string): string { const ts = Math.floor(Date.now() / 1000); return `ts=${ts};h1=${createHmac('sha256', SECRET).update(`${ts}:${body}`).digest('hex')}`; }
function success<T>(result: OperationResult<T>): T { assert.equal(result.kind, 'succeeded', JSON.stringify(result)); if (result.kind !== 'succeeded') throw new Error('Expected success'); return result.value; }
async function deliver(payments: HostedPayments, consumerId: string, consumer: CreditFixture | AccessFixture, ack = true): Promise<readonly EvidenceMessage[]> {
  const messages = await payments.readDeliveries(consumerId, 100);
  for (const message of messages) { const receipt = await consumer.receive(message); assert.equal(receipt.acknowledge, true); if (ack) assert.equal(await payments.acknowledgeDelivery(consumerId, message.messageId, message.bodyDigest), 'acknowledged'); }
  return messages;
}
async function postHttp(url: string, path: string, body: string, headers: Record<string, string>): Promise<Readonly<{ status: number; body: string }>> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(new URL(path, url), { method: 'POST', headers: { 'content-type': 'application/json', ...headers } }, response => { const chunks: Buffer[] = []; response.on('data', chunk => chunks.push(Buffer.from(chunk))); response.on('end', () => resolve({ status: response.statusCode ?? 500, body: Buffer.concat(chunks).toString('utf8') })); });
    request.on('error', reject); request.end(body);
  });
}

function paddleEmulation() {
  const globalNames = ['fetch', 'Headers', 'Response', 'Request', 'FormData', 'WebSocket', 'CloseEvent', 'ErrorEvent', 'MessageEvent', 'EventSource'] as const;
  const saved = globalNames.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const), originalDispatcher = getGlobalDispatcher();
  install(); const agent = new MockAgent(); agent.disableNetConnect(); setGlobalDispatcher(agent);
  return { agent, api: agent.get('https://sandbox-api.paddle.com'), async restore() {
    setGlobalDispatcher(originalDispatcher); await agent.close();
    for (const [name, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); }
  } };
}

test('full public payments system: real Paddle SDK, durable PostgreSQL and two independent host environments', { timeout: 60_000 }, async t => {
  const emulation = paddleEmulation(), { agent, api } = emulation;
  try {
    for (const kind of ['node-http-factory', 'fetch-static-gm'] as const) {
      await t.test(kind, async () => {
        const connectionString = process.env['DATABASE_URL']; if (!connectionString) throw new Error('DATABASE_URL is required for the mandatory full-system suite');
        const pool = new Pool({ connectionString, max: 12, connectionTimeoutMillis: 1000 });
        const prefix = `system_${randomUUID().replaceAll('-', '').slice(0, 16)}`, schema = `${prefix}_payments`;
        const trust = { producerNamespace, scope };
        const credit = new CreditFixture({ pool, schema: `${prefix}_credit`, trust });
        let now = '2026-10-15T00:00:00Z';
        const access = new AccessFixture({ pool, schema: `${prefix}_access`, trust, now: () => now });
        const provider = createPaddleProvider({ scope, apiKey: 'synthetic-never-valid-key', apiVersion: 1, webhook: { endpointId: 'e2e-destination', secret: SECRET, apiVersion: 1 } });
        let id = 0;
        await migratePaymentSchema({ pool, schema, scope }); await credit.migrate(); await access.migrate();
        const store = await createPostgresPaymentStore({ pool, schema, scope });
        const topup: OfferSnapshot = { ...offer, offerId: 'topup', profile: 'one_time', lines: [{ providerPriceRef: paddleIds.price, benefitSlotId: 'purchased', quantity: 1 }] };
        const zero: OfferSnapshot = { ...topup, offerId: 'free', allowZeroTotal: true };
        const runtimeOptions: PaymentRuntimeOptions = { scope, producerNamespace, provider, store, catalog: { resolveOffer: async (_scope, offerId) => ({ monthly: offer, topup, free: zero } as Record<string, OfferSnapshot>)[offerId] }, now: () => now, newId: () => `host-${++id}` };
        const authenticate = async (request: Request): Promise<string | undefined> => request.headers.get('x-fixture-auth') === 'buyer-a-token' ? 'buyer-a' : undefined;
        const verify = provider.verifyWebhook.bind(provider);
        const host = kind === 'node-http-factory' ? await createNodeHttpHost(runtimeOptions, verify, authenticate) : await createFetchModularHost(runtimeOptions, verify, authenticate);
        const payments = host.payments;
        const post = async (path: string, body: string, headers: Record<string, string> = {}) => {
          if ('url' in host) return postHttp(host.url, path, body, headers);
          const response = await host.handle(new Request(`https://fixture.test${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body }));
          return { status: response.status, body: await response.text() };
        };
        let eventSequence = 10;
        const ingress = async (type: string, data: Record<string, unknown>, invalidSignature = false) => {
          const body = JSON.stringify(eventFixture(type, data, `evt_${String(++eventSequence).padStart(26, '0')}`));
          return post('/webhooks/paddle', body, { 'paddle-signature': invalidSignature ? 'ts=0;h1=invalid' : sign(body) });
        };
        const flush = async () => { await payments.repair(100); await deliver(payments, 'credit', credit); await deliver(payments, 'access', access); };
        try {
          await payments.registerConsumer('credit'); await payments.registerConsumer('access');
          // Exact early event arrives before the intent and checkout binding exist.
          const early = transactionFixture({ intentId: 'host-1' });
          assert.equal((await ingress('transaction.completed', early, true)).status, 401);
          assert.equal((await ingress('transaction.completed', early)).status, 200);
          await flush(); assert.equal((await credit.decisions()).length, 0);
          let createCalls = 0;
          api.intercept({ path: /^\/transactions\??$/u, method: 'POST', headers: { 'paddle-version': '1' } }).reply(201, options => {
            createCalls += 1; const body = JSON.parse(String(options.body)) as { custom_data: { payments: { intentId: string } } };
            assert.equal(body.custom_data.payments.intentId, 'host-1'); return responseFixture(transactionFixture({ intentId: 'host-1', status: 'ready', customerRef: null }));
          });
          assert.equal((await post('/purchases', JSON.stringify({ offerId: 'monthly', requestKey: 'initial' }))).status, 401);
          const responses = await Promise.all(Array.from({ length: 8 }, () => post('/purchases', JSON.stringify({ offerId: 'monthly', requestKey: 'initial', buyerId: 'victim-ignored' }), { 'x-fixture-auth': 'buyer-a-token' })));
          const values = responses.map(response => JSON.parse(response.body) as OperationResult<CheckoutReady>);
          assert.ok(values.every(value => ['succeeded', 'pending'].includes(value.kind)), JSON.stringify(values));
          await payments.repair(100);
          const repeated = await post('/purchases', JSON.stringify({ offerId: 'monthly', requestKey: 'initial' }), { 'x-fixture-auth': 'buyer-a-token' });
          const checkout = success(JSON.parse(repeated.body) as OperationResult<CheckoutReady>); assert.equal(createCalls, 1);
          assert.equal(checkout.transactionRef, paddleIds.transaction);
          assert.equal(await payments.flushPublication({ type: 'transaction', id: paddleIds.transaction }), 'committed');
          await payments.repair(100);
          const beforeAck = await deliver(payments, 'credit', credit, false);
          assert.ok(beforeAck.some(body => body.kind === 'complete' && body.completion));
          assert.equal((await credit.decisions())[0]?.body.eligible, Q.toString());
          assert.ok((await payments.readDeliveries('credit', 100)).length > 0, 'sender still owns target after T3 commit and lost ACK');
          const restartedCredit = new CreditFixture({ pool, schema: credit.owner.options.schema, trust });
          for (const body of beforeAck) assert.equal((await restartedCredit.receive(body)).outcome, 'duplicate');
          await deliver(payments, 'credit', restartedCredit);
          assert.ok((await payments.readDeliveries('access', 100)).length > 0, 'credit ACK cannot satisfy access target');
          assert.equal((await ingress('subscription.activated', subscriptionFixture())).status, 200); await flush();
          assert.equal((await access.decisions())[0]?.body.newAction, true);
          const purchase = await payments.readPurchase('buyer-a', checkout.intentId); assert.ok(purchase);
          const basisId = purchase.intent.subscriptionBasisId; assert.ok(basisId);
          assert.equal((await payments.readPurchase('victim-ignored', checkout.intentId)), undefined);

          // Failed renewal does not create Q; recovery pays the ORIGINAL exact November period.
          const renewalRef = paddleIds.secondTransaction;
          const renewal = transactionFixture({ id: renewalRef, intentId: checkout.intentId, origin: 'subscription_recurring', status: 'past_due', version: '2026-11-01T00:00:00.000001Z' });
          renewal['billing_period'] = { starts_at: nextPeriod.startsAt, ends_at: nextPeriod.endsAt };
          assert.equal((await ingress('transaction.payment_failed', renewal)).status, 200); await flush();
          assert.equal((await credit.decisions()).reduce((sum, row) => sum + BigInt(row.body.eligible), 0n), Q);
          const pastDue = subscriptionFixture({ status: 'past_due', version: '2026-11-01T00:00:00.000002Z' });
          assert.equal((await ingress('subscription.past_due', pastDue)).status, 200); now = '2026-11-01T00:00:01Z'; await flush();
          assert.equal((await access.decisions())[0]?.body.newAction, false);
          const recovered = { ...renewal, status: 'completed', updated_at: '2026-11-01T00:00:02.000001Z' };
          assert.equal((await ingress('transaction.completed', recovered)).status, 200);
          const active = subscriptionFixture({ version: '2026-11-01T00:00:02.000002Z' }); active['current_billing_period'] = renewal['billing_period'];
          assert.equal((await ingress('subscription.activated', active)).status, 200); await flush();
          assert.equal((await credit.decisions()).reduce((sum, row) => sum + BigInt(row.body.eligible), 0n), 2n * Q);
          assert.equal((await access.decisions())[0]?.body.newAction, true);

          // API-only top-up and permitted zero commercial completion recover absent webhooks.
          for (const [index, offerId, total] of [[3, 'topup', '1000'], [4, 'free', '0']] as const) {
            const ref = `txn_${String(index).padStart(26, '0')}`; let intent = '';
            api.intercept({ path: /^\/transactions\??$/u, method: 'POST' }).reply(201, options => { const body = JSON.parse(String(options.body)) as { custom_data: { payments: { intentId: string } } }; intent = body.custom_data.payments.intentId; return responseFixture(transactionFixture({ id: ref, intentId: intent, monthly: false, status: 'ready', customerRef: null })); });
            const result = await post('/purchases', JSON.stringify({ offerId, requestKey: offerId }), { 'x-fixture-auth': 'buyer-a-token' }); const ready = success(JSON.parse(result.body) as OperationResult<CheckoutReady>);
            api.intercept({ path: path => path.split('?')[0] === `/transactions/${ref}`, method: 'GET' }).reply(200, responseFixture(transactionFixture({ id: ref, intentId: intent, monthly: false, total })));
            assert.equal(success(await payments.refreshPurchase('buyer-a', ready.intentId)), 1); await flush();
          }
          assert.equal((await credit.decisions()).filter(row => row.body.bucket === 'purchased').reduce((sum, row) => sum + BigInt(row.body.eligible), 0n), 2n * T);

          // A second intentional monthly intent is recovered entirely through the SDK events API.
          // No webhook/raw representation has ever supplied either of these commercial facts.
          const apiInitialRef = 'txn_00000000000000000000000005', apiRenewalRef = 'txn_00000000000000000000000006', apiSubscriptionRef = 'sub_00000000000000000000000005';
          let apiIntent = '';
          api.intercept({ path: /^\/transactions\??$/u, method: 'POST' }).reply(201, options => { const body = JSON.parse(String(options.body)) as { custom_data: { payments: { intentId: string } } }; apiIntent = body.custom_data.payments.intentId; return responseFixture(transactionFixture({ id: apiInitialRef, intentId: apiIntent, status: 'ready', customerRef: null, subscriptionRef: null })); });
          const apiCreated = await post('/purchases', JSON.stringify({ offerId: 'monthly', requestKey: 'api-only-monthly' }), { 'x-fixture-auth': 'buyer-a-token' });
          const apiCheckout = success(JSON.parse(apiCreated.body) as OperationResult<CheckoutReady>);
          const apiInitial = transactionFixture({ id: apiInitialRef, intentId: apiIntent, subscriptionRef: apiSubscriptionRef });
          const apiRenewal = transactionFixture({ id: apiRenewalRef, intentId: apiIntent, subscriptionRef: apiSubscriptionRef, origin: 'subscription_recurring', version: '2026-11-01T00:00:00.000009Z' });
          apiRenewal['billing_period'] = { starts_at: nextPeriod.startsAt, ends_at: nextPeriod.endsAt };
          api.intercept({ path: path => path.startsWith('/events?'), method: 'GET' }).reply(200, responseFixture([
            eventFixture('transaction.completed', apiInitial, 'evt_02000000000000000000000001'), eventFixture('transaction.completed', apiRenewal, 'evt_02000000000000000000000002'),
          ]));
          const page = await provider.readEventPage({ from: '2026-09-01T00:00:00Z', to: '2026-12-01T00:00:00Z', epoch: 'e2e-api-catchup', queryVersion: 'e2e/1' });
          if (page.kind !== 'page') throw new Error(page.reason);
          assert.equal(page.inputs.length, 2);
          for (const input of page.inputs) { assert.equal(input.source.kind, 'authenticated_api'); assert.equal(input.source.verification, undefined); success(await payments.ingestVerifiedInput(input)); assert.equal(await payments.processInbox(input.inputId), 'processed'); }
          await flush();
          const apiPurchase = await payments.readPurchase('buyer-a', apiCheckout.intentId); assert.ok(apiPurchase);
          assert.equal(apiPurchase.transactions.filter(transaction => transaction.completion?.classification === 'initial').length, 1);
          assert.equal(apiPurchase.transactions.filter(transaction => transaction.completion?.classification === 'renewal').length, 1);
          assert.equal((await credit.decisions()).filter(row => row.body.bucket === 'included').reduce((sum, row) => sum + BigInt(row.body.eligible), 0n), 4n * Q, 'positive API-only initial and renewal fulfillment is mandatory');

          // Method-change zero is an explicit management operation, distinct from the approved
          // zero commercial purchase above; the completed management checkout cannot grant T/Q.
          const methodRef = 'txn_00000000000000000000000007';
          const method = transactionFixture({ id: methodRef, intentId: checkout.intentId, origin: 'subscription_payment_method_change', total: '0' });
          api.intercept({ path: path => path.split('?')[0] === `/subscriptions/${paddleIds.subscription}`, method: 'GET' }).reply(200, responseFixture(active));
          api.intercept({ path: `/subscriptions/${paddleIds.subscription}/update-payment-method-transaction`, method: 'GET' }).reply(200, responseFixture(method));
          assert.equal(success(await payments.openPaymentUpdate({ buyerId: 'buyer-a', bindingId: basisId, requestKey: 'method-update' })).transactionRef, methodRef);
          assert.equal((await ingress('transaction.completed', method)).status, 200); await flush();
          assert.equal((await credit.decisions()).reduce((sum, row) => sum + BigInt(row.body.eligible), 0n), 4n * Q + 2n * T);

          const scheduled = subscriptionFixture({ scheduled: true, version: '2026-11-02T00:00:00.000001Z' });
          scheduled['scheduled_change'] = { action: 'cancel', effective_at: nextPeriod.endsAt, resume_at: null }; scheduled['current_billing_period'] = { starts_at: nextPeriod.startsAt, ends_at: nextPeriod.endsAt };
          api.intercept({ path: path => path.split('?')[0] === `/subscriptions/${paddleIds.subscription}`, method: 'GET' }).reply(200, responseFixture(active));
          api.intercept({ path: `/subscriptions/${paddleIds.subscription}/cancel`, method: 'POST', body: JSON.stringify({ effective_from: 'next_billing_period' }) }).reply(200, responseFixture(scheduled));
          assert.deepEqual(success(await payments.requestCancellation({ buyerId: 'buyer-a', bindingId: basisId, requestKey: 'cancel-period-end', timing: 'period_end' })), { kind: 'scheduled', effectiveAt: nextPeriod.endsAt });
          assert.equal((await ingress('subscription.updated', scheduled)).status, 200); await flush();
          assert.equal((await access.decisions()).find(row => row.body.bindingId === basisId)?.body.newAction, true);
          assert.deepEqual((await access.decisions()).find(row => row.body.bindingId === basisId)?.body.scheduledChange, { action: 'cancel', effectiveAt: nextPeriod.endsAt });

          // Pending→full approved refund after ACK is a new evidence revision and one correction.
          assert.equal((await ingress('adjustment.created', adjustmentFixture({ status: 'pending_approval' }))).status, 200); await flush();
          let initialDecision = (await credit.decisions()).find(row => row.body.initialGuardKey?.includes(`"${checkout.intentId}"`))!.body;
          assert.equal(initialDecision.eligible, '0'); assert.equal(initialDecision.held, Q.toString());
          assert.equal((await ingress('adjustment.updated', adjustmentFixture({ version: '2026-11-02T00:00:00.000001Z' }))).status, 200); await flush();
          initialDecision = (await credit.decisions()).find(row => row.body.initialGuardKey?.includes(`"${checkout.intentId}"`))!.body;
          assert.equal(initialDecision.eligible, '0'); assert.equal(initialDecision.allocated, '0');
          const originalGrant = initialDecision.originalGrant;
          assert.equal((await ingress('adjustment.updated', adjustmentFixture({ version: '2026-11-02T00:00:00.000001Z' }))).status, 200); await flush();
          const effects = await credit.owner.inspect<{ body: Effect }>('effects'); assert.equal(effects.filter(row => row.body.kind === 'correction' && row.body.causeEffectKey === originalGrant).length, 1);
          const history = await payments.readPurchase('buyer-a', checkout.intentId); assert.ok(history?.transactions.some(transaction => transaction.completion && Object.keys(transaction.adjustments).length > 0));

          // A subscription-only cancellation travels independently while access is offline.
          assert.equal((await ingress('subscription.canceled', subscriptionFixture({ status: 'canceled', version: '2026-11-03T00:00:00.000001Z' }))).status, 200);
          await payments.repair(100); const offlineMessages = await payments.readDeliveries('access', 100); assert.ok(offlineMessages.some(body => body.aggregate.type === 'subscription'));
          await deliver(payments, 'credit', credit);
          const restartedAccess = new AccessFixture({ pool, schema: access.owner.options.schema, trust, now: () => now });
          await deliver(payments, 'access', restartedAccess);
          const accessDecision = (await restartedAccess.decisions())[0]!.body;
          assert.equal(accessDecision.status, 'canceled'); assert.equal(accessDecision.newAction, false); assert.deepEqual([accessDecision.read, accessDecision.export, accessDecision.cancel], [true, true, true]);
          assert.equal(accessDecision.knownLastPeriod?.endsAt, nextPeriod.endsAt);
          assert.equal((await payments.createManagementLink({ buyerId: 'buyer-a', bindingId: basisId, customerAuthority: { customerRef: paddleIds.customer, authorizationRef: 'not-account-wide' } })).kind, 'unsupported');
          assert.equal((await payments.readDeliveries('credit', 100)).length, 0); assert.equal((await payments.readDeliveries('access', 100)).length, 0);
          // Public SDK remains the actual adapter; no production fetch seam or credentials exist.
          await assert.rejects(fetch('https://sandbox-api.paddle.com/unmatched-network-probe'), /fetch failed/u);
          agent.assertNoPendingInterceptors();
        } finally { await host.close(); await pool.query(`DROP SCHEMA "${schema}" CASCADE; DROP SCHEMA ${credit.owner.sql} CASCADE; DROP SCHEMA ${access.owner.sql} CASCADE`); await pool.end(); }
      });
    }
  } finally { await emulation.restore(); }
});

test('both public hosts hold distinct initial and renewal transactions for equivalent RFC3339 paid periods in either delivery order', { timeout: 60_000 }, async t => {
  const emulation = paddleEmulation(), { agent, api } = emulation;
  try {
    for (const kind of ['node-http-factory', 'fetch-static-gm'] as const) for (const initialFirst of [true, false]) {
      await t.test(`${kind}, ${initialFirst ? 'initial first' : 'renewal first'}`, async () => {
        const connectionString = process.env['DATABASE_URL']; if (!connectionString) throw new Error('DATABASE_URL is required');
        const pool = new Pool({ connectionString, max: 12, connectionTimeoutMillis: 1000 });
        const prefix = `period_${randomUUID().replaceAll('-', '').slice(0, 16)}`, schema = `${prefix}_payments`;
        const trust = { producerNamespace, scope }, credit = new CreditFixture({ pool, schema: `${prefix}_credit`, trust });
        await migratePaymentSchema({ pool, schema, scope }); await credit.migrate();
        const store = await createPostgresPaymentStore({ pool, schema, scope });
        const provider = createPaddleProvider({ scope, apiKey: 'synthetic-never-valid-key', apiVersion: 1, webhook: { endpointId: 'period-destination', secret: SECRET, apiVersion: 1 } });
        const runtimeOptions: PaymentRuntimeOptions = { scope, producerNamespace, provider, store, catalog: { resolveOffer: async () => offer } };
        const verify = provider.verifyWebhook.bind(provider), authenticate = async (): Promise<string> => 'buyer-a';
        const host = kind === 'node-http-factory' ? await createNodeHttpHost(runtimeOptions, verify, authenticate) : await createFetchModularHost(runtimeOptions, verify, authenticate);
        const payments = host.payments;
        const post = async (path: string, body: string, headers: Record<string, string> = {}) => {
          if ('url' in host) return postHttp(host.url, path, body, headers);
          const response = await host.handle(new Request(`https://fixture.test${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body }));
          return { status: response.status, body: await response.text() };
        };
        let sequence = 100;
        const ingress = async (data: Record<string, unknown>) => {
          const body = JSON.stringify(eventFixture('transaction.completed', data, `evt_${String(++sequence).padStart(26, '0')}`));
          assert.equal((await post('/webhooks/paddle', body, { 'paddle-signature': sign(body) })).status, 200);
          await payments.repair(100);
        };
        try {
          await payments.registerConsumer('credit'); let intentId = '';
          api.intercept({ path: /^\/transactions\??$/u, method: 'POST' }).reply(201, options => {
            const body = JSON.parse(String(options.body)) as { custom_data: { payments: { intentId: string } } }; intentId = body.custom_data.payments.intentId;
            return responseFixture(transactionFixture({ intentId, status: 'ready', customerRef: null }));
          });
          const response = await post('/purchases', JSON.stringify({ offerId: 'monthly', requestKey: 'same-period' }));
          const checkout = success(JSON.parse(response.body) as OperationResult<CheckoutReady>);
          await ingress(transactionFixture({ intentId }));
          const samePeriodRef = 'txn_00000000000000000000000008';
          const aliasedPeriod = transactionFixture({ id: samePeriodRef, intentId, origin: 'subscription_recurring', version: '2026-10-15T00:00:00.000001Z' });
          aliasedPeriod['billing_period'] = { starts_at: '2026-10-01T00:00:00.123456000+00:00', ends_at: '2026-11-01T00:00:00.123456000+00:00' };
          await ingress(aliasedPeriod);
          const snapshots = await payments.readDeliveries('credit', 100);
          const initial = snapshots.find(body => body.kind === 'complete' && body.completion?.classification === 'initial');
          const renewal = snapshots.find(body => body.kind === 'complete' && body.completion?.classification === 'renewal');
          assert.ok(initial); assert.ok(renewal);
          const history = await payments.readPurchase('buyer-a', checkout.intentId); assert.ok(history);
          const financialFacts = history.transactions.filter(transaction => transaction.completion);
          assert.equal(financialFacts.length, 2); assert.ok(financialFacts.every(transaction => transaction.flags.length === 0));
          assert.ok(financialFacts.some(transaction => transaction.completion?.lines[0]?.period?.startsAt === '2026-10-01T00:00:00.123456Z'));
          assert.ok(financialFacts.some(transaction => transaction.completion?.lines[0]?.period?.startsAt === '2026-10-01T00:00:00.123456000+00:00'), 'equivalent spelling is retained in the distinct immutable fact');
          await credit.receive(initialFirst ? initial : renewal);
          const restarted = new CreditFixture({ pool, schema: credit.owner.options.schema, trust });
          await restarted.receive(initialFirst ? renewal : initial);
          let decisions = await restarted.decisions(); assert.equal(decisions.length, 1);
          let row = decisions[0]!; assert.equal(row.body.status, 'held'); assert.equal(row.body.eligible, '0');
          const before = await restarted.owner.inspect<{ body: Effect }>('effects');
          const original = before.find(effect => effect.body.kind === 'grant')?.body;
          assert.equal(before.filter(effect => effect.body.kind === 'grant').length, initialFirst ? 1 : 0);
          assert.ok((await restarted.owner.inspect<{ state: string }>('obligations')).some(obligation => obligation.state === 'pending'));
          for (const input of [renewal, initial]) assert.equal((await restarted.receive(input)).outcome, 'duplicate');
          const resolution = { basisKey: row.basis_key, expectedDecisionRevision: Number(row.revision), expectedReadSet: row.body.readSet, selectedSource: sourceIdentity(initial), actorId: 'authorized-period-owner', approvalRef: `period-review-${kind}-${initialFirst}`, policyVersion: 'fixture-credit-policy-v1' };
          assert.equal(await restarted.resolveHeldDecision(resolution), 'resolved'); assert.equal(await restarted.resolveHeldDecision(resolution), 'duplicate');
          row = (await restarted.decisions())[0]!; assert.equal(BigInt(row.body.eligible), Q);
          const selectedHistory = await restarted.owner.inspect<{ body: Effect }>('effects');
          assert.equal(selectedHistory.filter(effect => effect.body.kind === 'grant').length, 1);
          assert.equal(row.body.originalGrant, original?.effectKey ?? selectedHistory.find(effect => effect.body.kind === 'grant')?.body.effectKey);
          const next = transactionFixture({ id: 'txn_00000000000000000000000009', intentId, origin: 'subscription_recurring', version: '2026-11-01T00:00:00.000001Z' });
          next['billing_period'] = { starts_at: nextPeriod.startsAt, ends_at: nextPeriod.endsAt };
          await ingress(next); await deliver(payments, 'credit', restarted);
          decisions = await restarted.decisions(); assert.equal(decisions.length, 2);
          assert.equal(decisions.reduce((sum, decision) => sum + BigInt(decision.body.eligible), 0n), 2n * Q);
          assert.equal((await restarted.owner.inspect<{ body: Effect }>('effects')).filter(effect => effect.body.kind === 'grant').length, 2);
          assert.equal((await payments.readPurchase('buyer-a', checkout.intentId))?.transactions.filter(transaction => transaction.completion).length, 3);
          agent.assertNoPendingInterceptors();
        } finally { await host.close(); await pool.query(`DROP SCHEMA "${schema}" CASCADE; DROP SCHEMA ${credit.owner.sql} CASCADE`); await pool.end(); }
      });
    }
  } finally { await emulation.restore(); }
});

