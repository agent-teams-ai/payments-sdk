import assert from 'node:assert/strict';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import test from 'node:test';
import { Pool } from 'pg';
import { MockAgent, getGlobalDispatcher, install, setGlobalDispatcher } from 'undici';
import { createPayments } from '@agent-teams/payments-core';
import type { CheckoutReady, EvidenceMessage, OperationResult, PaymentRuntimeOptions, VerifiedInput } from '@agent-teams/payments-core';
import { createPaddleProvider } from '@agent-teams/payments-paddle';
import { createPostgresPaymentStore, migratePaymentSchema } from '@agent-teams/payments-postgres';
import { createNodeHttpHost } from '../../examples/node-http.ts';
import { createFetchModularHost } from '../../examples/fetch-modular.ts';
import { AccessFixture, CreditFixture } from '../fixtures/consumers/index.ts';
import type { Effect } from '../fixtures/consumers/index.ts';
import { eventFixture, fixturePeriod, paddleIds, responseFixture, subscriptionFixture, transactionFixture } from '../fixtures/paddle/fixtures.ts';
import { offer, producerNamespace, scope } from './consumer-support.ts';

const secret = 'synthetic-custody-recovery-secret';
const hosts = ['node-http-factory', 'fetch-static-gm'] as const;
type HostKind = typeof hosts[number];
type Host = Awaited<ReturnType<typeof createNodeHttpHost>> | Awaited<ReturnType<typeof createFetchModularHost>>;

function success<T>(result: OperationResult<T>): T { assert.equal(result.kind, 'succeeded', JSON.stringify(result)); return result.value; }
function sign(body: string): string { const ts = Math.floor(Date.now() / 1000); return `ts=${ts};h1=${createHmac('sha256', secret).update(`${ts}:${body}`).digest('hex')}`; }
function rawDigest(body: string): string { return createHash('sha256').update(body, 'utf8').digest('hex'); }
async function authenticateBuyer(): Promise<string> { return 'buyer-a'; }

/** Only the isolated test process replaces HTTP transport. All provider calls traverse the SDK. */
function emulatePaddle() {
  const names = ['fetch', 'Headers', 'Response', 'Request', 'FormData', 'WebSocket', 'CloseEvent', 'ErrorEvent', 'MessageEvent', 'EventSource'] as const;
  const descriptors = names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const), dispatcher = getGlobalDispatcher();
  install(); const agent = new MockAgent(); agent.disableNetConnect(); setGlobalDispatcher(agent);
  return { agent, api: agent.get('https://sandbox-api.paddle.com'), async close() {
    setGlobalDispatcher(dispatcher); await agent.close();
    for (const [name, descriptor] of descriptors) { if (descriptor) {Object.defineProperty(globalThis, name, descriptor);} else {Reflect.deleteProperty(globalThis, name);} }
  } };
}

async function post(host: Host, path: string, body: string, headers: Record<string, string> = {}): Promise<Readonly<{ status: number; body: string }>> {
  if (!('url' in host)) {
    const response = await host.handle(new Request(`https://fixture.test${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body }));
    return { status: response.status, body: await response.text() };
  }
  return new Promise((resolve, reject) => {
    const request = httpRequest(new URL(path, host.url), { method: 'POST', headers: { 'content-type': 'application/json', ...headers } }, response => {
      const chunks: Uint8Array[] = [];
      response.on('data', (value: unknown) => {
        if (typeof value === 'string' || value instanceof Uint8Array) {chunks.push(Buffer.from(value));}
        else {reject(new TypeError('Unexpected HTTP response body'));}
      });
      response.on('end', () => { resolve({ status: response.statusCode ?? 500, body: Buffer.concat(chunks).toString('utf8') }); });
    });
    request.on('error', reject); request.end(Buffer.from(body, 'utf8'));
  });
}

async function paymentHost(kind: HostKind) {
  const connectionString = process.env['DATABASE_URL']; assert.ok(connectionString !== undefined && connectionString !== '', 'DATABASE_URL is required');
  const pool = new Pool({ connectionString, max: 10, connectionTimeoutMillis: 1000 });
  const prefix = `custody_${randomUUID().replaceAll('-', '').slice(0, 16)}`, schema = `${prefix}_payments`;
  const trust = { producerNamespace, scope };
  const credit = new CreditFixture({ pool, schema: `${prefix}_credit`, trust });
  const access = new AccessFixture({ pool, schema: `${prefix}_access`, trust, now: () => '2026-10-15T00:00:00Z' });
  let host: Host | undefined, options: PaymentRuntimeOptions | undefined;
  const operators = new Set<ReturnType<typeof createPayments>>();
  async function open(): Promise<void> {
    const provider = createPaddleProvider({ scope, apiKey: 'synthetic-never-valid-key', apiVersion: 1, webhook: { endpointId: 'custody-recovery-destination', secret, apiVersion: 1 } });
    const store = await createPostgresPaymentStore({ pool, schema, scope });
    options = { scope, producerNamespace, provider, store, catalog: { resolveOffer: async () => offer } };
    const verify = provider.verifyWebhook.bind(provider);
    host = kind === 'node-http-factory' ? await createNodeHttpHost(options, verify, authenticateBuyer) : await createFetchModularHost(options, verify, authenticateBuyer);
  }
  try { await migratePaymentSchema({ pool, schema, scope }); await credit.migrate(); await access.migrate(); await open(); }
  catch (error) { await pool.end(); throw error; }
  const current = (): Host => { assert.ok(host); return host; };
  async function deliver(consumerId: string, consumer: CreditFixture | AccessFixture, acknowledge = true): Promise<readonly EvidenceMessage[]> {
    const messages = await current().payments.readDeliveries(consumerId, 100);
    for (const message of messages) {
      assert.equal((await consumer.receive(message)).acknowledge, true);
      if (acknowledge) {assert.equal(await current().payments.acknowledgeDelivery(consumerId, message.messageId, message.bodyDigest), 'acknowledged');}
    }
    return messages;
  }
  return {
    pool, schema, credit, access, trust,
    get payments() { return current().payments; },
    post: (path: string, body: string, headers?: Record<string, string>) => post(current(), path, body, headers),
    async webhook(body: string, signature = sign(body)) { return post(current(), '/webhooks/paddle', body, { 'paddle-signature': signature }); },
    async restart() {
      await current().close(); host = undefined;
      for (const operator of operators) {operator.stop(); await operator.drain();} operators.clear();
      await open();
    },
    operator() { assert.ok(options); const payments = createPayments(options); operators.add(payments); return payments; },
    deliver,
    async flush() { await current().payments.repair(100); await deliver('credit', credit); await deliver('access', access); },
    async inputs(): Promise<readonly VerifiedInput[]> { return (await pool.query<{ input: VerifiedInput }>(`SELECT body->'input' AS input FROM "${schema}".records WHERE kind='inbox' ORDER BY id`)).rows.map(row => row.input); },
    async close() {
      await host?.close();
      for (const operator of operators) {operator.stop(); await operator.drain();}
      await pool.query(`DROP SCHEMA "${schema}" CASCADE; DROP SCHEMA ${credit.owner.sql} CASCADE; DROP SCHEMA ${access.owner.sql} CASCADE`); await pool.end();
    },
  };
}

/** Independent fixture policy: one monthly purchase grants exactly 100 included units. */
async function assertSingleGrant(credit: CreditFixture): Promise<string> {
  const decisions = await credit.decisions(); assert.equal(decisions.length, 1);
  const decision = decisions[0]!.body;
  assert.deepEqual([decision.bucket, decision.status, decision.allocated, decision.eligible, decision.held], ['included', 'issued', '100', '100', '0']);
  assert.ok(decision.originalGrant !== undefined && decision.originalGrant !== '');
  const effects = (await credit.owner.inspect<{ body: Effect }>('effects')).map(row => row.body);
  assert.deepEqual(effects.map(effect => [effect.kind, effect.amount]), [['grant', '100']]);
  assert.equal(effects[0]!.effectKey, decision.originalGrant);
  return decision.originalGrant;
}

/** Active lifecycle plus the unexpired paid period permits new actions. */
async function assertFulfilled(credit: CreditFixture, access: AccessFixture): Promise<string> {
  const originalGrant = await assertSingleGrant(credit);
  const permissions = await access.decisions(); assert.equal(permissions.length, 1);
  const permission = permissions[0]!.body;
  assert.deepEqual([permission.status, permission.newAction, permission.expand, permission.read, permission.export, permission.cancel], ['active', true, true, true, true, true]);
  assert.equal(permission.paidUntil, fixturePeriod.ends_at); assert.deepEqual(permission.restrictions, []);
  return originalGrant;
}

void test('permanently lost Paddle create replies recover through audited binding without redispatch at either public host', { timeout: 60_000 }, async t => {
  const emulation = emulatePaddle(), { api, agent } = emulation;
  let creates = 0;
  const providerCreations = new Map<string, Record<string, unknown>>();
  api.intercept({ path: /^\/transactions\??$/u, method: 'POST', headers: { 'paddle-version': '1' } }).reply(201, request => {
    creates += 1; assert.ok(typeof request.body === 'string');
    const body = JSON.parse(request.body) as { items: readonly unknown[]; custom_data: { payments: { intentId: string } } };
    assert.deepEqual(body.items, [{ price_id: paddleIds.price, quantity: 1 }]);
    // The synthetic provider commits before transport loses the response. No delayed
    // successful SDK promise exists that could repair the local operation later.
    providerCreations.set(body.custom_data.payments.intentId, transactionFixture({ intentId: body.custom_data.payments.intentId }));
    throw new Error('Synthetic provider committed; response permanently disconnected');
  }).persist();
  try {
    for (const kind of hosts) {await t.test(kind, async () => {
      const context = await paymentHost(kind);
      const beforeCreates = creates;
      try {
        await context.payments.registerConsumer('credit'); await context.payments.registerConsumer('access');
        const command = JSON.stringify({ offerId: 'monthly', requestKey: 'permanent-response-loss' });
        const response = await context.post('/purchases', command); assert.equal(response.status, 200);
        const unknown = JSON.parse(response.body) as OperationResult<CheckoutReady>; assert.equal(unknown.kind, 'outcome_unknown');
        assert.equal(creates - beforeCreates, 1);
        const adminBeforeRestart = context.operator(), operation = await adminBeforeRestart.readOperation(unknown.operationId); assert.ok(operation?.intentId !== undefined && operation.intentId !== '');
        const providerCreated = providerCreations.get(operation.intentId); assert.ok(providerCreated);
        assert.equal(operation.state, 'outcome_unknown'); assert.equal(operation.attempts.length, 1);
        assert.deepEqual(operation.attempts[0]!.observations, [{ kind: 'outcome_unknown' }]);
        const purchase = await context.payments.readPurchase('buyer-a', operation.intentId); assert.ok(purchase);
        assert.deepEqual(purchase.intent.transactionRefs, []);

        await context.restart();
        const admin = context.operator();
        assert.deepEqual(JSON.parse((await context.post('/purchases', command)).body), unknown);
        await context.payments.repair(100);
        assert.deepEqual(await admin.executeOperation(operation.operationId), unknown);
        assert.equal(creates - beforeCreates, 1, 'restart, request replay, repair and explicit execute preserve the dispatch marker');
        const completedBody = JSON.stringify(eventFixture('transaction.completed', providerCreated));
        assert.equal((await context.webhook(completedBody)).status, 200); await context.flush();
        const inputs = await context.inputs(); assert.equal(inputs.length, 1);
        const unresolved = (await context.pool.query<{ body: { flags: readonly string[]; completion?: unknown } }>(`SELECT body FROM "${context.schema}".records WHERE kind='transactions' AND id=$1`, [paddleIds.transaction])).rows[0]?.body;
        assert.ok(unresolved?.flags.includes('unresolved_binding') === true); assert.equal(unresolved.completion, undefined);
        assert.equal((await context.credit.decisions()).length, 0); assert.equal((await context.access.decisions()).length, 0);
        const before = await admin.readOperation(operation.operationId); assert.ok(before);
        assert.equal(before.state, 'outcome_unknown'); assert.equal(before.attempts.length, 1);

        // The operator established this exact provider transaction independently. A signed
        // custom_data hint alone never supplies authority to bind or issue the purchase.
        const provedOutcome = { kind: 'succeeded' as const, value: { intentId: operation.intentId, transactionRef: paddleIds.transaction, checkout: {} } };
        const resolution = { operationId: operation.operationId, expectedRevision: before.revision, actorId: 'authorized-recovery-owner', auditRef: 'proved-provider-transaction', reason: 'reviewed provider-created transaction and original intent', action: 'bind_outcome' as const, outcome: provedOutcome };
        const resolved = success(await admin.resolveUnknownOperation(resolution));
        assert.equal(resolved.state, 'succeeded'); assert.equal(resolved.attempts.length, 1);
        assert.deepEqual(resolved.attempts, before.attempts);
        assert.deepEqual(resolved.audits.map(audit => [audit.actorId, audit.auditRef, audit.action, audit.acceptedDuplicateRisk]), [['authorized-recovery-owner', 'proved-provider-transaction', 'bind_outcome', false]]);
        assert.deepEqual(await admin.resolveUnknownOperation(resolution), { kind: 'rejected', code: 'conflict' });
        await context.payments.repair(100);
        assert.equal((await context.webhook(JSON.stringify(eventFixture('subscription.activated', subscriptionFixture(), paddleIds.secondEvent)))).status, 200);
        await context.flush();
        const originalGrant = await assertFulfilled(context.credit, context.access);
        const paid = await context.payments.readPurchase('buyer-a', operation.intentId); assert.ok(paid);
        assert.deepEqual(paid.intent.transactionRefs, [paddleIds.transaction]); assert.equal(paid.transactions.filter(transaction => transaction.completion).length, 1);
        const factId = paid.transactions[0]!.completion!.factId;
        assert.deepEqual(success(JSON.parse((await context.post('/purchases', command)).body) as OperationResult<CheckoutReady>), provedOutcome.value);

        await context.restart();
        const replay = { ...eventFixture('transaction.completed', providerCreated), notification_id: 'ntf_01j00000000000000000000002' };
        assert.equal((await context.webhook(JSON.stringify(replay))).status, 200); await context.flush();
        const restartedCredit = new CreditFixture({ pool: context.pool, schema: context.credit.owner.options.schema, trust: context.trust });
        const restartedAccess = new AccessFixture({ pool: context.pool, schema: context.access.owner.options.schema, trust: context.trust, now: () => '2026-10-15T00:00:00Z' });
        assert.equal(await assertFulfilled(restartedCredit, restartedAccess), originalGrant);
        const replayed = await context.payments.readPurchase('buyer-a', operation.intentId); assert.equal(replayed?.transactions[0]?.completion?.factId, factId);
        assert.equal((await context.operator().readOperation(operation.operationId))?.audits.length, 1);
        assert.equal(creates - beforeCreates, 1, 'recovery and all financial redeliveries never create a second provider transaction');
      } finally { await context.close(); }
    });}
    agent.assertNoPendingInterceptors();
  } finally { await emulation.close(); }
});

void test('both HTTP hosts preserve signed raw bytes and retry failed durable custody without duplicate consumer effects', { timeout: 60_000 }, async t => {
  const emulation = emulatePaddle(), { api, agent } = emulation;
  try {
    for (const kind of hosts) {await t.test(kind, async () => {
      const context = await paymentHost(kind);
      try {
        await context.payments.registerConsumer('credit'); await context.payments.registerConsumer('access');
        let intentId = '';
        api.intercept({ path: /^\/transactions\??$/u, method: 'POST' }).reply(201, request => {
          assert.ok(typeof request.body === 'string'); const body = JSON.parse(request.body) as { custom_data: { payments: { intentId: string } } };
          intentId = body.custom_data.payments.intentId;
          return responseFixture(transactionFixture({ intentId, status: 'ready', customerRef: null }));
        });
        const checkout = success(JSON.parse((await context.post('/purchases', JSON.stringify({ offerId: 'monthly', requestKey: 'exact-body' }))).body) as OperationResult<CheckoutReady>);
        const event = { ...eventFixture('transaction.completed', transactionFixture({ intentId })), diagnostic: { OriginalKey: 'e\u0301 / é / 漢字 / 🧾', escaped: '\\u00e9', nested_key: true } };
        const raw = `\n  ${JSON.stringify(event, null, 2)}\r\n`, signature = sign(raw);
        const equivalent = JSON.stringify(JSON.parse(raw) as unknown);
        assert.notEqual(raw, equivalent);
        assert.equal((await context.webhook(equivalent, signature)).status, 401);
        assert.equal((await context.inputs()).length, 0);
        assert.equal((await context.credit.decisions()).length, 0); assert.equal((await context.access.decisions()).length, 0);
        const beforeRecords = (await context.pool.query(`SELECT kind,id,revision,body FROM "${context.schema}".records ORDER BY kind,id`)).rows;
        const beforeObligations = (await context.pool.query(`SELECT * FROM "${context.schema}".obligations ORDER BY kind,id`)).rows;
        await context.pool.query(`CREATE FUNCTION "${context.schema}".reject_custody() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.kind='inbox' THEN RAISE EXCEPTION 'synthetic custody commit failure'; END IF; RETURN NEW; END $$`);
        await context.pool.query(`CREATE TRIGGER reject_custody BEFORE INSERT OR UPDATE ON "${context.schema}".records FOR EACH ROW EXECUTE FUNCTION "${context.schema}".reject_custody()`);
        assert.equal((await context.webhook(raw)).status, 503);
        assert.deepEqual((await context.pool.query(`SELECT kind,id,revision,body FROM "${context.schema}".records ORDER BY kind,id`)).rows, beforeRecords, 'failed T1 rolls back identity, receipt and aggregate writes');
        assert.deepEqual((await context.pool.query(`SELECT * FROM "${context.schema}".obligations ORDER BY kind,id`)).rows, beforeObligations, 'failed T1 leaves no orphan obligation');
        assert.equal((await context.inputs()).length, 0);
        await context.pool.query(`DROP TRIGGER reject_custody ON "${context.schema}".records`);
        assert.equal((await context.webhook(raw)).status, 200);
        const admitted = await context.inputs(); assert.equal(admitted.length, 1);
        const input = admitted[0]!;
        assert.deepEqual(input.retainedRepresentation, { rawBody: raw });
        assert.equal(input.source.representationDigest, rawDigest(raw));
        assert.equal(input.source.verification?.rawBodyDigest, rawDigest(raw));
        assert.equal((await context.credit.decisions()).length, 0, 'HTTP200 establishes T1 custody before financial processing');
        const active = JSON.stringify(eventFixture('subscription.activated', subscriptionFixture(), paddleIds.secondEvent));
        assert.equal((await context.webhook(active)).status, 200);
        await context.payments.repair(100);
        const creditDelivery = await context.deliver('credit', context.credit, false);
        assert.ok(creditDelivery.some(message => message.kind === 'complete' && message.completion !== undefined));
        assert.ok((await context.payments.readDeliveries('access', 100)).length > 0);
        const restartedCredit = new CreditFixture({ pool: context.pool, schema: context.credit.owner.options.schema, trust: context.trust });
        for (const message of creditDelivery) {assert.equal((await restartedCredit.receive(message)).outcome, 'duplicate');}
        await context.deliver('credit', restartedCredit);
        assert.equal((await context.payments.readDeliveries('credit', 100)).length, 0);
        assert.ok((await context.payments.readDeliveries('access', 100)).length > 0, 'credit ACK does not discharge the access target');
        await context.deliver('access', context.access);
        const originalGrant = await assertFulfilled(restartedCredit, context.access);
        const original = await context.payments.readPurchase('buyer-a', checkout.intentId); assert.ok(original?.transactions[0]?.completion);
        const factId = original.transactions[0].completion.factId;

        await context.restart();
        const notificationReplay = `\n${JSON.stringify({ ...event, notification_id: 'ntf_01j00000000000000000000002' }, null, 4)}\n`;
        assert.equal((await context.webhook(notificationReplay)).status, 200); await context.flush();
        const matching = (await context.inputs()).filter(receipt => receipt.source.eventId === paddleIds.event); assert.equal(matching.length, 2);
        assert.deepEqual(new Set(matching.map(receipt => (receipt.retainedRepresentation as { rawBody: string }).rawBody)), new Set([raw, notificationReplay]));
        assert.equal(new Set(matching.map(receipt => receipt.source.stableEnvelopeDigest)).size, 1);
        assert.equal(new Set(matching.map(receipt => receipt.inputId)).size, 2);
        assert.equal(new Set(matching.map(receipt => receipt.source.representationDigest)).size, 2);
        const replayed = await context.payments.readPurchase('buyer-a', checkout.intentId); assert.equal(replayed?.transactions[0]?.completion?.factId, factId);
        assert.equal(replayed.transactions.filter(transaction => transaction.completion).length, 1);
        assert.equal(await assertFulfilled(restartedCredit, context.access), originalGrant);
        assert.equal((await context.payments.readDeliveries('credit', 100)).length, 0); assert.equal((await context.payments.readDeliveries('access', 100)).length, 0);
      } finally { await context.close(); }
    });}
    agent.assertNoPendingInterceptors();
  } finally { await emulation.close(); }
});

void test('lost Paddle cancellation replies retain the mutation lane while read-only lifecycle recovery restricts access', { timeout: 60_000 }, async t => {
  const emulation = emulatePaddle(), { api, agent } = emulation;
  let cancellations = 0, subscriptionReads = 0, intentId = '';
  let providerSubscription = subscriptionFixture();
  const canceledVersion = '2026-10-02T00:00:00.000001Z';
  api.intercept({ path: path => new URL(path, 'https://sandbox-api.paddle.com').pathname === `/subscriptions/${paddleIds.subscription}`, method: 'GET' }).reply(200, () => {
    subscriptionReads += 1; return responseFixture(providerSubscription);
  }).persist();
  api.intercept({ path: `/subscriptions/${paddleIds.subscription}/cancel`, method: 'POST' }).reply(200, request => {
    cancellations += 1; assert.ok(typeof request.body === 'string');
    assert.deepEqual(JSON.parse(request.body), { effective_from: 'immediately' });
    providerSubscription = subscriptionFixture({ status: 'canceled', version: canceledVersion });
    throw new Error('Synthetic provider canceled subscription; cancellation response permanently disconnected');
  }).persist();
  api.intercept({ path: path => new URL(path, 'https://sandbox-api.paddle.com').pathname === `/transactions/${paddleIds.transaction}`, method: 'GET' }).reply(200, () => responseFixture(transactionFixture({ intentId }))).persist();
  try {
    for (const kind of hosts) {await t.test(kind, async () => {
      const context = await paymentHost(kind), beforeCancellations = cancellations;
      providerSubscription = subscriptionFixture();
      try {
        await context.payments.registerConsumer('credit'); await context.payments.registerConsumer('access');
        api.intercept({ path: /^\/transactions\??$/u, method: 'POST' }).reply(201, request => {
          assert.ok(typeof request.body === 'string'); const body = JSON.parse(request.body) as { custom_data: { payments: { intentId: string } } };
          intentId = body.custom_data.payments.intentId;
          return responseFixture(transactionFixture({ intentId, status: 'ready', customerRef: null }));
        });
        const checkout = success(JSON.parse((await context.post('/purchases', JSON.stringify({ offerId: 'monthly', requestKey: 'cancel-loss-paid' }))).body) as OperationResult<CheckoutReady>);
        const completion = transactionFixture({ intentId });
        assert.equal((await context.webhook(JSON.stringify(eventFixture('transaction.completed', completion)))).status, 200);
        assert.equal((await context.webhook(JSON.stringify(eventFixture('subscription.activated', subscriptionFixture(), paddleIds.secondEvent)))).status, 200);
        await context.flush();
        const originalGrant = await assertFulfilled(context.credit, context.access);
        const paid = await context.payments.readPurchase('buyer-a', checkout.intentId); assert.ok(paid);
        const bindingId = paid.intent.subscriptionBasisId; assert.ok(bindingId !== undefined && bindingId !== '');
        const factId = paid.transactions[0]!.completion!.factId;
        const command = { buyerId: 'buyer-a', bindingId, requestKey: 'cancel-response-lost', timing: 'now' as const };
        const unknown = await context.payments.requestCancellation(command); assert.equal(unknown.kind, 'outcome_unknown');
        assert.equal(cancellations - beforeCancellations, 1);
        const original = await context.operator().readOperation(unknown.operationId); assert.ok(original);
        assert.equal(original.state, 'outcome_unknown'); assert.equal(original.attempts.length, 1);
        assert.deepEqual(original.attempts[0]!.observations, [{ kind: 'outcome_unknown' }]);

        await context.restart();
        const admin = context.operator();
        assert.deepEqual(await context.payments.requestCancellation(command), unknown);
        assert.deepEqual(await admin.executeOperation(unknown.operationId), unknown);
        const beforeReads = subscriptionReads;
        assert.equal(success(await context.payments.refreshSubscription('buyer-a', bindingId)), 1);
        assert.equal(subscriptionReads - beforeReads, 1, 'read-only SDK acquisition continues while cancellation is unknown');
        const observed = await context.payments.readObservedSubscription('buyer-a', bindingId);
        const canceled = observed?.observations.find(observation => observation.subscriptionRef === paddleIds.subscription)?.current;
        assert.deepEqual(canceled?.status, { presence: 'known', value: 'canceled', provenance: 'observed' });
        assert.equal(canceled.version, canceledVersion);
        // Raw custody fills the mapped API's unknown null period. Both sources describe
        // lifecycle state; neither receipt claims to settle the unknown command attempt.
        assert.equal((await context.webhook(JSON.stringify(eventFixture('subscription.canceled', providerSubscription, paddleIds.thirdEvent)))).status, 200);
        await context.flush();
        assert.equal((await admin.readOperation(unknown.operationId))?.state, 'outcome_unknown');
        const restricted = (await context.access.decisions())[0]!.body;
        assert.deepEqual([restricted.status, restricted.newAction, restricted.expand, restricted.read, restricted.export, restricted.cancel], ['canceled', false, false, true, true, true]);
        assert.ok(restricted.restrictions.includes('lifecycle_canceled'));
        assert.equal(restricted.knownLastPeriod?.endsAt, fixturePeriod.ends_at);
        assert.equal(await assertSingleGrant(context.credit), originalGrant, 'cancellation changes access without reversing a completed purchase');

        const blocked = await context.payments.requestCancellation({ ...command, requestKey: 'fresh-key-cannot-bypass-unknown' }); assert.equal(blocked.kind, 'pending');
        assert.notEqual(blocked.operationId, unknown.operationId);
        const blockedOperation = await admin.readOperation(blocked.operationId); assert.ok(blockedOperation);
        assert.equal(blockedOperation.state, 'prepared'); assert.equal(blockedOperation.attempts.length, 0);
        await context.payments.repair(100);
        assert.equal(cancellations - beforeCancellations, 1, 'fresh keys and repair cannot bypass the saved unknown mutation lane');
        const readLane = async () => (await context.pool.query<{ body: { unresolvedOperationId?: string } }>(`SELECT body FROM "${context.schema}".records WHERE kind='lanes' AND id=$1`, [`subscription:${bindingId}`])).rows[0]?.body;
        assert.equal((await readLane())?.unresolvedOperationId, unknown.operationId);
        const historicalReplay = { ...eventFixture('transaction.completed', completion), notification_id: 'ntf_01j00000000000000000000002' };
        assert.equal((await context.webhook(JSON.stringify(historicalReplay))).status, 200); await context.flush();
        assert.equal((await context.access.decisions())[0]!.body.status, 'canceled');
        assert.equal((await context.access.decisions())[0]!.body.newAction, false, 'older paid completion cannot reopen a canceled lifecycle');
        assert.equal(await assertSingleGrant(context.credit), originalGrant);

        const current = await admin.readOperation(unknown.operationId); assert.ok(current);
        const resolution = { operationId: unknown.operationId, expectedRevision: current.revision, actorId: 'authorized-cancellation-owner', auditRef: 'proved-terminal-cancellation', reason: 'verified canceled lifecycle and original cancellation command', action: 'bind_outcome' as const, outcome: { kind: 'succeeded' as const, value: { kind: 'applied' as const, observedStatus: 'canceled' } } };
        const resolved = success(await admin.resolveUnknownOperation(resolution));
        assert.equal(resolved.state, 'succeeded'); assert.deepEqual(resolved.attempts, original.attempts);
        assert.deepEqual(resolved.audits.map(audit => [audit.actorId, audit.action, audit.acceptedDuplicateRisk]), [['authorized-cancellation-owner', 'bind_outcome', false]]);
        assert.equal((await readLane())?.unresolvedOperationId, undefined, 'only audited command resolution releases the mutation lane');
        assert.deepEqual(await context.payments.requestCancellation(command), { kind: 'succeeded', value: { kind: 'applied', observedStatus: 'canceled' } });
        assert.deepEqual(await admin.resolveUnknownOperation(resolution), { kind: 'rejected', code: 'conflict' });
        assert.equal(cancellations - beforeCancellations, 1);
        assert.equal(await assertSingleGrant(context.credit), originalGrant);
        const finalPurchase = await context.payments.readPurchase('buyer-a', checkout.intentId);
        assert.equal(finalPurchase?.transactions[0]?.completion?.factId, factId);
        assert.equal((await context.access.decisions())[0]!.body.newAction, false);
        // The competing command remains prepared. This fixture proves lane release,
        // without dispatching an unnecessary second cancellation of a terminal entity.
        assert.equal((await admin.readOperation(blocked.operationId))?.attempts.length, 0);
      } finally { await context.close(); }
    });}
    agent.assertNoPendingInterceptors();
  } finally { await emulation.close(); }
});
