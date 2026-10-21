import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';
import { MockAgent, getGlobalDispatcher, install, setGlobalDispatcher } from 'undici';
import { createPayments } from '@agent-teams/payments-core';
import type { EvidenceMessage, OfferSnapshot, PaymentScope, ProviderResult, VerifiedInput } from '@agent-teams/payments-core';
import { createPaddleProvider } from '@agent-teams/payments-paddle';
import { createNodePostgresPaymentDatabase } from '@agent-teams/payments-postgres/node-postgres';
import { createPostgresPaymentStore, migratePaymentSchema } from '@agent-teams/payments-postgres';
import { AccessFixture } from '../fixtures/consumers/access.ts';
import { eventFixture, paddleIds, responseFixture, subscriptionFixture, transactionFixture } from '../../packages/payments-paddle/test/fixtures.ts';
import type { FixtureObject } from '../../packages/payments-paddle/test/fixtures.ts';

const scope: PaymentScope = { applicationId: 'app-a', provider: 'paddle', paymentAccountId: 'merchant-fixture', environment: 'sandbox' };
const namespace = 'provider-profile-e2e';
const secret = 'synthetic-profile-destination-secret';
const offer: OfferSnapshot = { applicationId: scope.applicationId, offerId: 'monthly', version: '1', policyVersion: '1', profile: 'monthly', currency: 'USD', allowZeroTotal: false, lines: [{ providerPriceRef: paddleIds.price, benefitSlotId: 'included', quantity: 1 }] };
type Acquisition = 'raw' | 'api';
const acquisitions: readonly Acquisition[] = ['raw', 'api'];
const changes: readonly ('quantity_two' | 'manual_collection' | 'missing_quantity')[] = ['quantity_two', 'manual_collection', 'missing_quantity'];
function success<T>(result: ProviderResult<T>): T { assert.equal(result.kind, 'succeeded'); return result.value; }
function sign(body: string): string { const ts = Math.floor(Date.now() / 1000); return `ts=${ts};h1=${createHmac('sha256', secret).update(`${ts}:${body}`).digest('hex')}`; }

function txPath(path: string): boolean { return new URL(path, 'https://sandbox-api.paddle.com').pathname === `/transactions/${paddleIds.transaction}`; }
function subPath(path: string): boolean { return new URL(path, 'https://sandbox-api.paddle.com').pathname === `/subscriptions/${paddleIds.subscription}`; }

/** Independent expected policy: a known paid period and supported active lifecycle permit new
 * actions; any explicit producer hold restricts them, without deleting historical payment facts. */
void test('provider profile end to end: actual public SDK, signed raw ingress, PostgreSQL and independent access owner', { timeout: 60_000 }, async t => {
  const connectionString = process.env['DATABASE_URL']; assert.ok((connectionString !== undefined && connectionString !== ''), 'DATABASE_URL is required');
  const names = ['fetch', 'Headers', 'Response', 'Request', 'FormData', 'WebSocket', 'CloseEvent', 'ErrorEvent', 'MessageEvent', 'EventSource'] as const;
  const globals = names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const), previousDispatcher = getGlobalDispatcher();
  install(); const agent = new MockAgent(); agent.disableNetConnect(); setGlobalDispatcher(agent);
  const api = agent.get('https://sandbox-api.paddle.com');
  const pool = new Pool({ connectionString, max: 6, connectionTimeoutMillis: 1000 });
  const database = createNodePostgresPaymentDatabase(pool);
  const provider = createPaddleProvider({ scope, apiKey: 'synthetic-noncredential', apiVersion: 1, webhook: { endpointId: 'profile-destination', secret, apiVersion: 1 } });
  let eventNumber = 0;
  async function rawInput(type: string, data: FixtureObject): Promise<VerifiedInput> {
    const eventId = `evt_${String(++eventNumber).padStart(26, '0')}`;
    const body = JSON.stringify(eventFixture(type, data, eventId));
    const input = success(await provider.verifyWebhook(Buffer.from(body), sign(body)));
    assert.deepEqual(input.retainedRepresentation, { rawBody: body });
    return input;
  }
  async function fixture(run: (context: { payments: ReturnType<typeof createPayments>; basis: string; access: AccessFixture; intentId: string; deliver: () => Promise<readonly EvidenceMessage[]>; admit: (input: VerifiedInput) => Promise<void> }) => Promise<void>) {
    const schema = `profile_${randomUUID().replaceAll('-', '').slice(0, 16)}`, accessSchema = `${schema}_access`;
    let payments: ReturnType<typeof createPayments> | undefined;
    try {
      await migratePaymentSchema({ database, schema, scope });
      const store = await createPostgresPaymentStore({ database, schema, scope });
      const ids = ['intent-fixture', 'operation-fixture', 'basis-fixture', 'attempt-fixture'];
      payments = createPayments({ scope, producerNamespace: namespace, provider, store, catalog: { resolveOffer: async () => offer }, newId: () => ids.shift() ?? randomUUID() });
      const activePayments = payments;
      const access = new AccessFixture({ pool, schema: accessSchema, trust: { producerNamespace: namespace, scope }, now: () => '2026-10-15T00:00:00Z' });
      await access.migrate(); await payments.registerConsumer('independent-access');
      async function deliver(): Promise<readonly EvidenceMessage[]> {
        const messages = await activePayments.readDeliveries('independent-access', 100);
        for (const message of messages) { assert.equal((await access.receive(message)).acknowledge, true); assert.equal(await activePayments.acknowledgeDelivery('independent-access', message.messageId, message.bodyDigest), 'acknowledged'); }
        return messages;
      }
      async function admit(input: VerifiedInput): Promise<void> { assert.equal((await activePayments.ingestVerifiedInput(input)).kind, 'succeeded'); assert.equal(await activePayments.processInbox(input.inputId), 'processed'); }
      api.intercept({ path: /^\/transactions\??$/u, method: 'POST' }).reply(201, responseFixture(transactionFixture({ status: 'ready', customerRef: null, maximumQuantity: 100 })));
      const checkout = await payments.startPurchase({ buyerId: 'buyer-fixture', offerId: offer.offerId, requestKey: 'request-fixture' });
      assert.equal(checkout.kind, 'succeeded');
      api.intercept({ path: txPath, method: 'GET' }).reply(200, responseFixture(transactionFixture({ maximumQuantity: 100 })));
      assert.deepEqual(await payments.refreshPurchase('buyer-fixture', checkout.value.intentId), { kind: 'succeeded', value: 1 });
      const purchase = await payments.readPurchase('buyer-fixture', checkout.value.intentId); assert.ok(purchase?.transactions[0]?.completion); assert.deepEqual(purchase.transactions[0].flags, []);
      const basis = purchase.intent.subscriptionBasisId; assert.ok((basis !== undefined && basis !== ''));
      api.intercept({ path: subPath, method: 'GET' }).reply(200, responseFixture(subscriptionFixture({ maximumQuantity: 100 })));
      assert.deepEqual(await payments.refreshSubscription('buyer-fixture', basis), { kind: 'succeeded', value: 1 });
      await deliver(); assert.equal((await access.decisions())[0]?.body.newAction, true);
      await run({ payments, basis, access, intentId: checkout.value.intentId, deliver, admit });
    } finally { payments?.stop(); await payments?.drain(); await pool.query(`DROP SCHEMA IF EXISTS "${accessSchema}" CASCADE`); await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); }
  }
  try {
    for (const mode of acquisitions) {
      await t.test(`${mode}: future transaction status holds current evidence, preserves completion and recovers only at a newer supported version`, async () => fixture(async ({ payments, intentId, access, deliver, admit }) => {
        const originalCompletion = (await payments.readPurchase('buyer-fixture', intentId))?.transactions[0]?.completion;
        async function observe(status: string, version: string): Promise<void> {
          const data = transactionFixture({ status, version, maximumQuantity: 100 });
          if (mode === 'raw') {await admit(await rawInput('transaction.updated', data));}
          else { api.intercept({ path: txPath, method: 'GET' }).reply(200, responseFixture(data)); assert.deepEqual(await payments.refreshPurchase('buyer-fixture', intentId), { kind: 'succeeded', value: 1 }); }
        }
        await observe('future_provider_status', '2026-10-02T00:00:00Z');
        let current = (await payments.readPurchase('buyer-fixture', intentId))?.transactions[0]; assert.ok(current);
        assert.equal(current.current?.status, 'future_provider_status'); assert.deepEqual(current.completion, originalCompletion); assert.ok(current.flags.includes('unsupported'));
        const held = await deliver(); assert.ok(held.some(message => message.kind === 'complete' && message.flags.includes('unsupported')));
        assert.equal((await access.decisions())[0]?.body.newAction, false);
        await observe('completed', '2026-10-01T00:00:01Z'); await deliver();
        current = (await payments.readPurchase('buyer-fixture', intentId))?.transactions[0]; assert.equal(current?.current?.status, 'future_provider_status'); assert.ok(current.flags.includes('unsupported')); assert.equal((await access.decisions())[0]?.body.newAction, false);
        await observe('completed', '2026-10-03T00:00:00Z'); await deliver();
        current = (await payments.readPurchase('buyer-fixture', intentId))?.transactions[0]; assert.deepEqual(current?.flags, []); assert.deepEqual(current.completion, originalCompletion); assert.equal((await access.decisions())[0]?.body.newAction, true);
        // A separate unsupported event is a retained historical control, even when the current
        // profile hold has the same flag. A new supported snapshot may resolve only that profile.
        await observe('another_future_status', '2026-10-04T00:00:00Z');
        await admit(await rawInput('transaction.future', transactionFixture({ version: '2026-10-04T00:00:01Z' })));
        await observe('completed', '2026-10-05T00:00:00Z'); await deliver();
        current = (await payments.readPurchase('buyer-fixture', intentId))?.transactions[0]; assert.equal(current?.current?.status, 'completed'); assert.ok(current.flags.includes('unsupported')); assert.deepEqual(current.completion, originalCompletion); assert.equal((await access.decisions())[0]?.body.newAction, false);
      }));
      for (const change of changes) {await t.test(`${mode}: ${change} subscription publishes a hold and a supported newer lifecycle resolves it`, async () => fixture(async ({ payments, basis, access, intentId, deliver, admit }) => {
        const originalCompletion = (await payments.readPurchase('buyer-fixture', intentId))?.transactions[0]?.completion;
        async function observe(data: FixtureObject): Promise<void> {
          if (mode === 'raw') {await admit(await rawInput('subscription.updated', data));}
          else { api.intercept({ path: subPath, method: 'GET' }).reply(200, responseFixture(data)); assert.deepEqual(await payments.refreshSubscription('buyer-fixture', basis), { kind: 'succeeded', value: 1 }); }
        }
        await observe(subscriptionFixture({ version: '2026-10-02T00:00:00Z', maximumQuantity: 100, quantity: change === 'quantity_two' ? 2 : 1, omitQuantity: change === 'missing_quantity', collectionMode: change === 'manual_collection' ? 'manual' : 'automatic' }));
        let current = (await payments.readObservedSubscription('buyer-fixture', basis))?.observations[0]; assert.ok(current?.current);
        assert.ok(current.flags.includes(change === 'missing_quantity' ? 'incomplete' : 'unsupported'));
        if (change === 'missing_quantity') { assert.equal(current.current.items.presence, 'known'); assert.deepEqual(current.current.items.value[0]?.quantity, { presence: 'unknown' }); }
        const held = await deliver(); assert.ok(held.some(message => message.kind === 'subscription_complete' && message.flags.includes(change === 'missing_quantity' ? 'incomplete' : 'unsupported'))); assert.equal((await access.decisions())[0]?.body.newAction, false);
        await observe(subscriptionFixture({ version: '2026-10-01T00:00:01Z', maximumQuantity: 100 })); await deliver();
        current = (await payments.readObservedSubscription('buyer-fixture', basis))?.observations[0]; assert.equal(current?.current?.version, '2026-10-02T00:00:00Z'); assert.equal((await access.decisions())[0]?.body.newAction, false);
        await observe(subscriptionFixture({ version: '2026-10-03T00:00:00Z', maximumQuantity: 100 })); await deliver();
        current = (await payments.readObservedSubscription('buyer-fixture', basis))?.observations[0]; assert.deepEqual(current?.flags, []); assert.equal((await access.decisions())[0]?.body.newAction, true);
        assert.deepEqual((await payments.readPurchase('buyer-fixture', intentId))?.transactions[0]?.completion, originalCompletion);
        // Independent historical controls remain, including when they overlap a current hold.
        await observe(subscriptionFixture({ version: '2026-10-04T00:00:00Z', quantity: 2, maximumQuantity: 100 }));
        await admit(await rawInput('subscription.future', subscriptionFixture({ version: '2026-10-04T00:00:01Z' })));
        await observe(subscriptionFixture({ version: '2026-10-05T00:00:00Z', maximumQuantity: 100 })); await deliver();
        current = (await payments.readObservedSubscription('buyer-fixture', basis))?.observations[0]; assert.ok((current?.flags.includes('unsupported') === true)); assert.equal((await access.decisions())[0]?.body.newAction, false);
      }));}
    }
    await t.test('supported noncompleted statuses preserve paid history, while known lifecycle transitions retain their explicit meaning', async () => fixture(async ({ payments, basis, access, intentId, deliver, admit }) => {
      const originalCompletion = (await payments.readPurchase('buyer-fixture', intentId))?.transactions[0]?.completion;
      let sequence = 0;
      for (const status of ['draft', 'ready', 'billed', 'paid', 'canceled', 'past_due']) {
        api.intercept({ path: txPath, method: 'GET' }).reply(200, responseFixture(transactionFixture({ status, version: `2026-10-02T00:00:0${++sequence}Z` })));
        assert.deepEqual(await payments.refreshPurchase('buyer-fixture', intentId), { kind: 'succeeded', value: 1 });
        const current = (await payments.readPurchase('buyer-fixture', intentId))?.transactions[0]; assert.deepEqual(current?.completion, originalCompletion); assert.deepEqual(current?.flags, []);
        await deliver(); assert.equal((await access.decisions())[0]?.body.newAction, true);
      }
      for (const step of [
        { status: 'past_due', scheduled: false, permitted: false },
        { status: 'active', scheduled: true, permitted: true },
        { status: 'canceled', scheduled: false, permitted: false },
        { status: 'active', scheduled: false, permitted: true },
      ]) {
        await admit(await rawInput('subscription.updated', subscriptionFixture({ status: step.status, scheduled: step.scheduled, version: `2026-10-03T00:00:${String(++sequence).padStart(2, '0')}Z` })));
        const current = (await payments.readObservedSubscription('buyer-fixture', basis))?.observations[0]; assert.deepEqual(current?.flags, []);
        await deliver(); const decision = (await access.decisions())[0]?.body; assert.equal(decision?.status, step.status); assert.equal(decision.newAction, step.permitted);
        assert.deepEqual((await payments.readPurchase('buyer-fixture', intentId))?.transactions[0]?.completion, originalCompletion);
      }
      // Available but unsupported cycle/trial changes use the same profile hold, with no inferred
      // quantity or trial defaults beyond the explicitly qualified SDK nullable assumptions.
      for (const configuration of [{ trial: true }, { monthly: false }]) {
        api.intercept({ path: subPath, method: 'GET' }).reply(200, responseFixture(subscriptionFixture({ ...configuration, version: `2026-10-04T00:00:${String(++sequence).padStart(2, '0')}Z` })));
        assert.deepEqual(await payments.refreshSubscription('buyer-fixture', basis), { kind: 'succeeded', value: 1 }); await deliver();
        assert.ok(((await payments.readObservedSubscription('buyer-fixture', basis))?.observations[0]?.flags.includes('unsupported') === true)); assert.equal((await access.decisions())[0]?.body.newAction, false);
      }
      api.intercept({ path: subPath, method: 'GET' }).reply(200, responseFixture(subscriptionFixture({ version: '2026-10-05T00:00:00Z' })));
      assert.deepEqual(await payments.refreshSubscription('buyer-fixture', basis), { kind: 'succeeded', value: 1 }); await deliver(); assert.equal((await access.decisions())[0]?.body.newAction, true);
    }));

    await t.test('raw/API exact-version profile contradictions remain retained after a newer supported lifecycle', async () => fixture(async ({ payments, basis, access, deliver, admit }) => {
      await admit(await rawInput('subscription.updated', subscriptionFixture({ version: '2026-10-02T00:00:00Z', quantity: 2, maximumQuantity: 100 })));
      api.intercept({ path: subPath, method: 'GET' }).reply(200, responseFixture(subscriptionFixture({ version: '2026-10-03T00:00:00Z', maximumQuantity: 100 })));
      assert.deepEqual(await payments.refreshSubscription('buyer-fixture', basis), { kind: 'succeeded', value: 1 }); await deliver(); assert.equal((await access.decisions())[0]?.body.newAction, true);
      // The authenticated receipt has the same old version and price, but different quantity.
      // It must be distinct input custody and contradict the retained raw certified profile.
      api.intercept({ path: subPath, method: 'GET' }).reply(200, responseFixture(subscriptionFixture({ version: '2026-10-02T00:00:00Z', maximumQuantity: 100 })));
      assert.deepEqual(await payments.refreshSubscription('buyer-fixture', basis), { kind: 'succeeded', value: 1 }); await deliver();
      let current = (await payments.readObservedSubscription('buyer-fixture', basis))?.observations[0]; assert.equal(current?.current?.version, '2026-10-03T00:00:00Z'); assert.ok(current.flags.includes('conflict')); assert.equal((await access.decisions())[0]?.body.newAction, false);
      await admit(await rawInput('subscription.updated', subscriptionFixture({ version: '2026-10-04T00:00:00Z', maximumQuantity: 100 })));
      await deliver(); current = (await payments.readObservedSubscription('buyer-fixture', basis))?.observations[0]; assert.ok((current?.flags.includes('conflict') === true)); assert.ok(!current.flags.includes('unsupported')); assert.equal((await access.decisions())[0]?.body.newAction, false);
    }));
    agent.assertNoPendingInterceptors();
  } finally { await pool.end(); await agent.close(); setGlobalDispatcher(previousDispatcher); for (const [name, descriptor] of globals) { if (descriptor) {Object.defineProperty(globalThis, name, descriptor);} else {Reflect.deleteProperty(globalThis, name);} } }
});
