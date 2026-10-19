import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import test from 'node:test';
import { MockAgent, getGlobalDispatcher, setGlobalDispatcher, install, fetch as undiciFetch } from 'undici';
import { createPaddleProvider, PADDLE_API_PROFILE } from '../dist/index.js';
import { digest, inputRoutes } from '@agent-teams/payments-core';
import type { PaddleEventScanQuery } from '../dist/index.js';
import type { Field, OfferSnapshot, PaymentScope, ProviderResult, VerifiedInput } from '@agent-teams/payments-core';
import { adjustmentFixture, eventFixture, fixturePeriod, fixtureTime, paddleIds, responseFixture, subscriptionFixture, transactionFixture } from './fixtures.ts';

const scope: PaymentScope = { applicationId: 'app-a', provider: 'paddle', paymentAccountId: 'merchant-fixture', environment: 'sandbox' };
const secret = 'synthetic-destination-secret';
const offer: OfferSnapshot = { applicationId: 'app-a', offerId: 'monthly', version: '1', policyVersion: '1', profile: 'monthly', currency: 'USD', allowZeroTotal: false, lines: [{ providerPriceRef: paddleIds.price, benefitSlotId: 'included', quantity: 1 }] };
const options = { scope, apiKey: 'synthetic-noncredential', apiVersion: 1 as const, webhook: { endpointId: 'fixture-destination', secret, apiVersion: 1 as const } };
function sign(body: string, timestamp = Math.floor(Date.now() / 1000)): string { return `ts=${timestamp};h1=${createHmac('sha256', secret).update(`${timestamp}:${body}`).digest('hex')}`; }
function succeeded<T>(result: ProviderResult<T>): T { assert.equal(result.kind, 'succeeded'); if (result.kind !== 'succeeded') throw new Error('Expected success'); return result.value; }
function value<T>(field: Field<T>): T { assert.equal(field.presence, 'known'); if (field.presence !== 'known') throw new Error('Expected known field'); return field.value; }
function query(): PaddleEventScanQuery { return { from: '2026-09-30T00:00:00Z', to: '2026-10-03T00:00:00Z', epoch: 'epoch-1', queryVersion: 'events/1', perPage: 2 }; }

test('official SDK contract probes with synthetic API1 fixtures and no network', async t => {
  // Official test-only installation keeps fetch and MockAgent on the same Dispatcher
  // API on Node24 (bundled undici7) and Node26 (bundled undici8). No production seam.
  const globalNames = ['fetch', 'Headers', 'Response', 'Request', 'FormData', 'WebSocket', 'CloseEvent', 'ErrorEvent', 'MessageEvent', 'EventSource'] as const;
  const savedGlobals = globalNames.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
  const savedDispatcher = getGlobalDispatcher();
  install();
  const agent = new MockAgent(); agent.disableNetConnect(); setGlobalDispatcher(agent);
  const pool = agent.get('https://sandbox-api.paddle.com');
  const provider = createPaddleProvider(options);
  try {
    await t.test('test-only official fetch installation rejects every unmocked origin without network', { timeout: 1000 }, async () => {
      assert.equal(globalThis.fetch, undiciFetch);
      for (const url of ['https://sandbox-api.paddle.com/unmocked-safety-probe', 'https://unapproved.paddle.invalid/']) {
        await assert.rejects(fetch(url, { signal: AbortSignal.timeout(500) }), error => {
          assert.ok(error instanceof TypeError);
          assert.equal((error.cause as { code: string }).code, 'UND_MOCK_ERR_MOCK_NOT_MATCHED');
          return true;
        });
      }
    });
    await t.test('create serializes server lines/correlation and pins API1; checkout is not payment', async () => {
      pool.intercept({ path: /^\/transactions\??$/u, method: 'POST', headers: { 'paddle-version': '1' }, body: body => {
        const parsed = JSON.parse(String(body)) as Record<string, unknown>;
        assert.deepEqual(parsed['items'], [{ price_id: paddleIds.price, quantity: 1 }]);
        assert.equal(parsed['collection_mode'], 'automatic');
        const custom = parsed['custom_data'] as Record<string, Record<string, unknown>>;
        assert.deepEqual(custom['payments'], { applicationId: 'app-a', paymentAccountId: 'merchant-fixture', environment: 'sandbox', intentId: 'intent-fixture', attemptId: 'attempt-fixture' });
        return true;
      } }).reply(201, responseFixture(transactionFixture({ status: 'ready', customerRef: null })));
      const result = succeeded(await provider.createCheckout({ intentId: 'intent-fixture', attemptId: 'attempt-fixture', buyerId: 'opaque-buyer', offer }));
      assert.equal(result.transactionRef, paddleIds.transaction); assert.equal(result.intentId, 'intent-fixture');
      assert.equal(result.checkout.url, 'https://checkout.paddle.test/fixture');
    });

    await t.test('API-only monthly, renewal, top-up, and zero commercial observations retain exact monetary evidence', async () => {
      for (const configuration of [{}, { origin: 'subscription_recurring' }, { monthly: false }, { monthly: false, total: '0' }, { total: '900719925474099312345' }]) {
        pool.intercept({ path: path => new URL(path, 'https://sandbox-api.paddle.com').pathname === `/transactions/${paddleIds.transaction}`, method: 'GET' }).reply(200, responseFixture(transactionFixture(configuration)));
        const observation = succeeded(await provider.readTransaction(paddleIds.transaction));
        assert.equal(observation.status, 'completed'); assert.equal(observation.version, fixtureTime);
        const [line] = value(observation.lines); assert.ok(line);
        assert.equal(line.providerLineRef, paddleIds.line); assert.equal(line.providerPriceRef, paddleIds.price);
        assert.equal(line.quantity, 1); assert.equal(value(line.trial), false); assert.equal(line.trial.presence === 'known' ? line.trial.provenance : undefined, 'schema_assumed_null');
        assert.equal(value(line.proration), false); assert.equal(line.proration.presence === 'known' ? line.proration.provenance : undefined, 'schema_assumed_null');
        assert.equal(value(observation.total).minorUnits, configuration.total ?? '1000');
        assert.equal(value(line.billingCycle)?.interval ?? null, configuration.monthly === false ? null : 'month');
        assert.equal(observation.source.kind, 'authenticated_api'); assert.equal(observation.source.apiProfile, PADDLE_API_PROFILE);
        assert.equal(observation.source.eventId, undefined); assert.equal(observation.source.verification, undefined);
      }
    });

    await t.test('closed transaction status meanings preserve every documented noncompletion and distinguish unknown values', async () => {
      const statuses = ['draft', 'ready', 'billed', 'paid', 'canceled', 'past_due', 'completed', 'future_provider_status', 'another_future_status'];
      const apiIdentities = new Set<string>();
      for (const status of statuses) {
        const data = transactionFixture({ status });
        const body = JSON.stringify(eventFixture('transaction.updated', data));
        const raw = succeeded(await provider.verifyWebhook(body, sign(body)));
        pool.intercept({ path: path => new URL(path, 'https://sandbox-api.paddle.com').pathname === `/transactions/${paddleIds.transaction}`, method: 'GET' }).reply(200, responseFixture(data));
        const mapped = succeeded(await provider.readTransactionInput(paddleIds.transaction));
        for (const input of [raw, mapped]) {
          assert.equal(input.observation.kind, 'transaction'); if (input.observation.kind !== 'transaction') throw new Error('Expected transaction');
          assert.equal(input.observation.status, status);
          assert.deepEqual(input.observation.statusMeaning, { kind: status === 'completed' ? 'completed' : status.endsWith('future_status') || status === 'future_provider_status' ? 'unsupported' : 'not_completed' });
        }
        assert.ok(!apiIdentities.has(mapped.inputId)); apiIdentities.add(mapped.inputId);
      }
    });

    await t.test('subscription profile preserves required child presence and distinct raw/API source identities', async () => {
      const configurations = [
        {}, { quantity: 2, maximumQuantity: 100 }, { omitQuantity: true }, { collectionMode: 'manual' },
        { collectionMode: 'future_collection_one' }, { collectionMode: 'future_collection_two' }, { trial: true }, { monthly: false },
      ];
      const rawIdentities = new Set<string>(), apiIdentities = new Set<string>();
      for (const configuration of configurations) {
        const data = subscriptionFixture(configuration), body = JSON.stringify(eventFixture('subscription.updated', data));
        const raw = succeeded(await provider.verifyWebhook(body, sign(body)));
        pool.intercept({ path: path => new URL(path, 'https://sandbox-api.paddle.com').pathname === `/subscriptions/${paddleIds.subscription}`, method: 'GET' }).reply(200, responseFixture(data));
        const mapped = succeeded(await provider.readSubscriptionInput(paddleIds.subscription));
        for (const input of [raw, mapped]) {
          assert.equal(input.observation.kind, 'subscription'); if (input.observation.kind !== 'subscription') throw new Error('Expected subscription');
          const item = value(input.observation.items)[0]; assert.ok(item); assert.equal(item.providerPriceRef, paddleIds.price);
          if (configuration.omitQuantity) assert.deepEqual(item.quantity, { presence: 'unknown' });
          else { assert.equal(value(item.quantity), configuration.quantity ?? 1); assert.equal(item.quantity.presence === 'known' ? item.quantity.provenance : undefined, 'observed'); }
          assert.equal(value(item.trial), configuration.trial ?? false);
          assert.equal(value(item.billingCycle)?.interval ?? null, configuration.monthly === false ? null : 'month');
          const mode = configuration.collectionMode ?? 'automatic';
          assert.deepEqual(value(input.observation.collection), mode === 'automatic' ? { kind: 'automatic' } : mode === 'manual' ? { kind: 'invoice' } : { kind: 'unsupported', value: mode });
        }
        assert.ok(!rawIdentities.has(raw.inputId)); rawIdentities.add(raw.inputId);
        assert.ok(!apiIdentities.has(mapped.inputId)); apiIdentities.add(mapped.inputId);
      }
    });

    await t.test('raw field absence stays unknown; mapped selected nulls are explicit assumptions', async () => {
      const raw = transactionFixture({ monthly: false, customerRef: null }), items = raw['items'] as Record<string, unknown>[];
      const price = items[0]?.['price'] as Record<string, unknown>; delete price['billing_cycle'];
      const body = JSON.stringify(eventFixture('transaction.completed', raw));
      const input = succeeded(await provider.verifyWebhook(body, sign(body)));
      assert.equal(input.observation.kind, 'transaction');
      if (input.observation.kind !== 'transaction') throw new Error('Expected transaction');
      assert.deepEqual(input.observation.customerRef, { presence: 'known', value: null, provenance: 'observed' });
      assert.deepEqual(value(input.observation.lines)[0]?.billingCycle, { presence: 'unknown' });
      pool.intercept({ path: path => new URL(path, 'https://sandbox-api.paddle.com').pathname === `/transactions/${paddleIds.transaction}`, method: 'GET' }).reply(200, responseFixture(raw));
      const mapped = succeeded(await provider.readTransaction(paddleIds.transaction));
      assert.deepEqual(mapped.customerRef, { presence: 'unknown' });
      assert.deepEqual(value(mapped.lines)[0]?.billingCycle, { presence: 'known', value: null, provenance: 'schema_assumed_null' });
    });

    await t.test('official signature checks exact body immediately; durable raw replay never rechecks old signature', async () => {
      const body = JSON.stringify(eventFixture()), signature = sign(body);
      const input = succeeded(await provider.verifyWebhook(body, signature));
      assert.deepEqual((await provider.verifyWebhook(`${body} `, signature)).kind, 'rejected');
      assert.deepEqual((await provider.verifyWebhook(body, sign(body, Math.floor(Date.now() / 1000) - 60))).kind, 'rejected');
      assert.deepEqual((await provider.verifyWebhook(body, 'malformed')).kind, 'rejected');
      const historical: VerifiedInput = { ...input, source: { ...input.source, verification: { ...input.source.verification!, verifiedAt: '2020-01-01T00:00:00Z' } } };
      assert.equal(provider.normalizeVerifiedWebhook(historical).source.eventId, paddleIds.event);
      const changed = { ...historical, retainedRepresentation: { rawBody: `${body} ` } };
      assert.throws(() => provider.normalizeVerifiedWebhook(changed), /digest mismatch/u);
      const otherDestination = createPaddleProvider({ ...options, webhook: { ...options.webhook, secret: 'wrong-secret' } });
      assert.equal((await otherDestination.verifyWebhook(body, signature)).kind, 'rejected');
    });

    await t.test('same event with another notification has stable raw envelope identity; unknown retains original key casing', async () => {
      const first = eventFixture('future.event', { AppID: 'A', appid: 'B', nested_field: { OriginalKey: true } });
      const second = { ...first, notification_id: 'ntf_01j00000000000000000000002' };
      const bodyA = JSON.stringify(first), bodyB = JSON.stringify(second);
      const a = succeeded(await provider.verifyWebhook(bodyA, sign(bodyA))), b = succeeded(await provider.verifyWebhook(bodyB, sign(bodyB)));
      assert.equal(a.observation.kind, 'unsupported'); assert.equal(a.source.stableEnvelopeDigest, b.source.stableEnvelopeDigest);
      assert.notEqual(a.source.representationDigest, b.source.representationDigest); assert.notEqual(a.inputId, b.inputId);
      assert.deepEqual(a.retainedRepresentation, { rawBody: bodyA });
      const unknownKnownFamily = JSON.stringify(eventFixture('transaction.future_event'));
      assert.equal(succeeded(await provider.verifyWebhook(unknownKnownFamily, sign(unknownKnownFamily))).observation.kind, 'unsupported');
    });

    await t.test('unsupported raw and actual SDK events retain only validated entity routes and complete custody', async () => {
      const cases = [
        { type: 'transaction.future_event', data: { id: paddleIds.transaction, future_total: 'uninterpreted' }, routes: [{ type: 'transaction', id: paddleIds.transaction }] },
        { type: 'subscription.future_event', data: { id: paddleIds.subscription, transaction_id: paddleIds.transaction, future_total: 'uninterpreted' }, routes: [{ type: 'subscription', id: paddleIds.subscription }] },
        { type: 'adjustment.future_event', data: { id: paddleIds.adjustment, transaction_id: paddleIds.transaction }, routes: [{ type: 'transaction', id: paddleIds.transaction }] },
        { type: 'future.event', data: { id: paddleIds.transaction, transaction_id: paddleIds.transaction }, routes: [] },
        { type: 'transaction.future_event', data: { id: 'txn_short', transaction_id: paddleIds.transaction }, routes: [] },
        { type: 'transaction.future_event', data: { id: paddleIds.subscription }, routes: [] },
        { type: 'subscription.future_event', data: { id: paddleIds.transaction }, routes: [] },
        { type: 'subscription.future_event', data: { id: `${paddleIds.subscription} ` }, routes: [] },
        { type: 'adjustment.future_event', data: { transaction_id: 'txn_short' }, routes: [] },
        { type: 'transaction.updated', data: { ...transactionFixture(), collection_mode: 'manual' }, routes: [{ type: 'transaction', id: paddleIds.transaction }] },
        { type: 'transaction.updated', data: { ...transactionFixture({ id: 'txn_short' }), collection_mode: 'manual' }, routes: [] },
        { type: 'subscription.updated', data: subscriptionFixture({ version: 'invalid' }), routes: [{ type: 'subscription', id: paddleIds.subscription }] },
        { type: 'subscription.updated', data: { ...subscriptionFixture({ version: 'invalid' }), id: 'sub_short' }, routes: [] },
      ];
      for (const item of cases) {
        const body = JSON.stringify(eventFixture(item.type, item.data));
        const raw = succeeded(await provider.verifyWebhook(body, sign(body)));
        assert.deepEqual(inputRoutes(raw), item.routes, `${item.type}: raw route`);
        assert.equal(raw.observation.kind, 'unsupported');
        if (raw.observation.kind !== 'unsupported') throw new Error('Expected unsupported observation');
        assert.equal(raw.observation.reason, item.type.endsWith('.updated') ? 'invalid_or_unsupported_provider_shape' : 'unsupported_event_type');
        assert.deepEqual(raw.retainedRepresentation, { rawBody: body });
        assert.equal(raw.source.representationDigest, createHash('sha256').update(body).digest('hex'));
        assert.deepEqual(provider.normalizeVerifiedWebhook(raw), raw);
        pool.intercept({ path: path => path.startsWith('/events?'), method: 'GET' }).reply(200, responseFixture([eventFixture(item.type, item.data)]));
        const result = await provider.readEventPage(query()); assert.equal(result.kind, 'page');
        if (result.kind !== 'page') throw new Error('Expected page');
        const mapped = result.inputs[0]; assert.ok(mapped);
        assert.deepEqual(inputRoutes(mapped), item.routes, `${item.type}: SDK route`);
        assert.equal(mapped.observation.kind, 'unsupported');
        if (mapped.observation.kind !== 'unsupported') throw new Error('Expected unsupported observation');
        assert.equal(mapped.observation.reason, raw.observation.reason);
        assert.equal(digest(mapped.retainedRepresentation), mapped.source.representationDigest);
        assert.equal(result.hasMore, false); assert.equal(result.lastEventId, paddleIds.event);
        const retained = mapped.retainedRepresentation as Record<string, unknown>;
        assert.equal(retained['representationKind'], 'sdk_mapped_observation');
        const diagnostic = retained['diagnostic'] as Record<string, Record<string, unknown>>;
        if (item.data['future_total'] !== undefined) assert.equal(diagnostic['data']?.['futureTotal'], 'uninterpreted');
      }
    });

    await t.test('same merchant customer does not give another app ownership; environment is trusted endpoint configuration', async () => {
      const body = JSON.stringify(eventFixture()), secondApp = createPaddleProvider({ ...options, scope: { ...scope, applicationId: 'app-b' } });
      const input = succeeded(await secondApp.verifyWebhook(body, sign(body)));
      assert.equal(input.scope.applicationId, 'app-b'); assert.equal(input.observation.kind, 'unsupported');
      const production = createPaddleProvider({ ...options, scope: { ...scope, environment: 'production' } });
      assert.throws(() => production.normalizeVerifiedWebhook(input), /Untrusted durable input/u);
    });

    await t.test('adjustment actions, separate reverse identity, signed exact allocations, and adverse routing survive SDK', async () => {
      const forward = adjustmentFixture({ status: 'reversed' });
      const reverse = adjustmentFixture({ id: paddleIds.reverseAdjustment, action: 'chargeback_reverse', total: '-1000' });
      pool.intercept({ path: path => path.startsWith('/adjustments?'), method: 'GET' }).reply(200, responseFixture([forward, reverse]));
      const result = succeeded(await provider.readAdjustmentPage(paddleIds.transaction));
      assert.equal(result.inputs.length, 2);
      const a = result.inputs[0], b = result.inputs[1]; assert.ok(a); assert.ok(b);
      assert.equal(a.adverseTransactionRef, paddleIds.transaction); assert.equal(a.observation.kind, 'adjustment'); assert.equal(b.observation.kind, 'adjustment');
      if (a.observation.kind !== 'adjustment' || b.observation.kind !== 'adjustment') throw new Error('Expected adjustments');
      assert.equal(a.observation.adjustmentRef, paddleIds.adjustment); assert.equal(a.observation.status, 'reversed');
      assert.equal(b.observation.adjustmentRef, paddleIds.reverseAdjustment); assert.equal(b.observation.action, 'chargeback_reverse');
      assert.equal(b.observation.amount.minorUnits, '-1000'); assert.equal(b.observation.allocations[0]?.amount.minorUnits, '-1000');
      assert.equal(b.observation.allocations[0]?.providerAllocationRef, paddleIds.allocation); assert.equal(b.observation.allocations[0]?.providerLineRef, paddleIds.line);
    });

    await t.test('scheduled cancellation preserves explicit requested timing and exact effective timestamp', async () => {
      pool.intercept({ path: `/subscriptions/${paddleIds.subscription}/cancel`, method: 'POST', body: JSON.stringify({ effective_from: 'next_billing_period' }) }).reply(200, responseFixture(subscriptionFixture({ scheduled: true })));
      assert.deepEqual(succeeded(await provider.cancelSubscription({ subscriptionRef: paddleIds.subscription, timing: 'period_end', attemptId: 'attempt-cancel' })), { kind: 'scheduled', effectiveAt: fixturePeriod.ends_at });
      pool.intercept({ path: path => new URL(path, 'https://sandbox-api.paddle.com').pathname === `/subscriptions/${paddleIds.subscription}`, method: 'GET' }).reply(200, responseFixture(subscriptionFixture({ scheduled: true })));
      const observation = succeeded(await provider.readSubscription(paddleIds.subscription));
      assert.deepEqual(value(observation.scheduledChange), { action: 'cancel', effectiveAt: fixturePeriod.ends_at });
      pool.intercept({ path: `/subscriptions/${paddleIds.subscription}/cancel`, method: 'POST' }).reply(200, responseFixture(subscriptionFixture({ status: 'canceled' })));
      assert.equal((await provider.cancelSubscription({ subscriptionRef: paddleIds.subscription, timing: 'period_end', attemptId: 'attempt-cancel-2' })).kind, 'outcome_unknown');
    });

    await t.test('payment update GET has mutation uncertainty and no automatic retry', async () => {
      pool.intercept({ path: `/subscriptions/${paddleIds.subscription}/update-payment-method-transaction`, method: 'GET' }).replyWithError(new Error('simulated response loss after provider effect'));
      assert.equal((await provider.openPaymentUpdate({ subscriptionRef: paddleIds.subscription, intentId: 'intent-update', attemptId: 'attempt-update' })).kind, 'outcome_unknown');
      pool.intercept({ path: `/subscriptions/${paddleIds.subscription}/update-payment-method-transaction`, method: 'GET' }).reply(200, responseFixture(transactionFixture({ total: '0', origin: 'subscription_payment_method_change' })));
      const ready = succeeded(await provider.openPaymentUpdate({ subscriptionRef: paddleIds.subscription, intentId: 'intent-update', attemptId: 'attempt-update-2' }));
      assert.equal(ready.transactionRef, paddleIds.transaction);
      assert.equal(ready.purpose, 'payment_method');
      assert.equal(ready.intentId, 'intent-update');
    });

    await t.test('network/non-JSON create outcomes remain unknown; known validation rejection stays rejected', async () => {
      const input = { intentId: 'intent-fixture', attemptId: 'attempt-fixture', buyerId: 'opaque', offer };
      pool.intercept({ path: /^\/transactions\??$/u, method: 'POST' }).replyWithError(new Error('provider effect, lost response'));
      assert.equal((await provider.createCheckout(input)).kind, 'outcome_unknown');
      pool.intercept({ path: /^\/transactions\??$/u, method: 'POST' }).reply(503, '<html>not json</html>');
      assert.equal((await provider.createCheckout(input)).kind, 'outcome_unknown');
      pool.intercept({ path: /^\/transactions\??$/u, method: 'POST' }).reply(400, { error: { type: 'request_error', code: 'bad_request', detail: 'Synthetic invalid request', documentation_url: 'https://developer.paddle.com/errors/shared/bad_request', errors: null } });
      assert.deepEqual(await provider.createCheckout(input), { kind: 'rejected', code: 'validation', diagnostic: { providerCode: 'bad_request' } });
    });

    await t.test('portal requires explicit customer-wide authority; subscription IDs are only navigation', async () => {
      assert.deepEqual(await provider.createManagementLink({ customerRef: paddleIds.customer, subscriptionRefs: [paddleIds.subscription] }), { kind: 'unsupported', capability: 'customer_wide_management' });
      const denied = createPaddleProvider({ ...options, authorizeCustomerManagement: async () => false });
      assert.deepEqual(await denied.createManagementLink({ customerRef: paddleIds.customer, subscriptionRefs: [paddleIds.subscription] }), { kind: 'rejected', code: 'permission_denied' });
      const allowed = createPaddleProvider({ ...options, authorizeCustomerManagement: async input => input.scope.applicationId === 'app-a' && input.customerRef === paddleIds.customer });
      pool.intercept({ path: `/customers/${paddleIds.customer}/portal-sessions`, method: 'POST' }).reply(201, responseFixture({ id: 'cpls_01j00000000000000000000001', customer_id: paddleIds.customer, created_at: fixtureTime, urls: { general: { overview: 'https://customer-portal.paddle.test/sensitive-token' }, subscriptions: [] } }));
      assert.equal(succeeded(await allowed.createManagementLink({ customerRef: paddleIds.customer, subscriptionRefs: [paddleIds.subscription] })).url, 'https://customer-portal.paddle.test/sensitive-token');
    });

    await t.test('SDK mapper poison leaves gap and fresh retry uses durable pre-page cursor, never private next link', async () => {
      const malformed = subscriptionFixture(); delete malformed['items'];
      const path = (candidate: string): boolean => {
        const url = new URL(candidate, 'https://sandbox-api.paddle.com');
        assert.equal(url.pathname, '/events'); assert.equal(url.searchParams.get('from'), query().from); assert.equal(url.searchParams.get('to'), query().to);
        assert.equal(url.searchParams.get('order_by'), 'id[ASC]'); assert.equal(url.searchParams.get('after'), paddleIds.event); return true;
      };
      pool.intercept({ path, method: 'GET' }).reply(200, responseFixture([eventFixture('transaction.completed', transactionFixture(), paddleIds.secondEvent), eventFixture('subscription.updated', malformed, paddleIds.thirdEvent)], true));
      const scan = { ...query(), after: paddleIds.event };
      assert.equal((await provider.readEventPage(scan)).kind, 'gap');
      pool.intercept({ path, method: 'GET' }).reply(200, responseFixture([eventFixture('transaction.completed', transactionFixture(), paddleIds.secondEvent)], false));
      const result = await provider.readEventPage(scan); assert.equal(result.kind, 'page');
      if (result.kind !== 'page') throw new Error('Expected page');
      assert.equal(result.lastEventId, paddleIds.secondEvent); assert.equal(result.inputs.length, 1); assert.equal(result.hasMore, false);
    });

    await t.test('empty nonterminal/invalid order pages remain gaps; unknown mapped events are admitted with loss profile', async () => {
      pool.intercept({ path: path => path.startsWith('/events?'), method: 'GET' }).reply(200, responseFixture([], true));
      assert.deepEqual((await provider.readEventPage(query())).kind, 'gap');
      pool.intercept({ path: path => path.startsWith('/events?'), method: 'GET' }).reply(200, responseFixture([eventFixture('future.event', { AppID: 'A', appid: 'B' })]));
      const result = await provider.readEventPage(query()); assert.equal(result.kind, 'page');
      if (result.kind !== 'page') throw new Error('Expected page');
      assert.equal(result.inputs[0]?.observation.kind, 'unsupported'); assert.equal(result.inputs[0]?.source.kind, 'authenticated_api');
      assert.equal(result.inputs[0]?.source.stableEnvelopeDigest, undefined); assert.equal(result.inputs[0]?.source.verification, undefined);
      const retained = result.inputs[0]?.retainedRepresentation as Record<string, unknown>;
      assert.equal(retained['representationKind'], 'sdk_mapped_observation');
      const diagnostic = retained['diagnostic'] as Record<string, Record<string, unknown>>;
      assert.deepEqual(diagnostic['data'], { appid: 'B' });
      pool.intercept({ path: path => path.startsWith('/events?'), method: 'GET' }).reply(200, responseFixture([eventFixture(), eventFixture()]));
      assert.equal((await provider.readEventPage(query())).kind, 'gap');
    });
    agent.assertNoPendingInterceptors();
  } finally {
    await agent.close(); setGlobalDispatcher(savedDispatcher);
    for (const [name, descriptor] of savedGlobals) {
      if (descriptor === undefined) Reflect.deleteProperty(globalThis, name);
      else Object.defineProperty(globalThis, name, descriptor);
    }
  }
});
