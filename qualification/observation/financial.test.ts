import assert from 'node:assert/strict';
import test from 'node:test';
import { assemblyFor } from '@get-modular/assembly';
import { createScope } from '@get-modular/resources';
import { smoke } from '@get-modular/conformance';
import type { ListenerError } from '@get-modular/observation';
import { delivered, liveSubscriptions, settled } from '@get-modular/observation/testing';
import { CreditFixture } from '../../tests/fixtures/consumers/index.ts';
import { fixturePeriod, paddleIds, responseFixture, subscriptionFixture, transactionFixture } from '../../packages/payments-paddle/test/fixtures.ts';
import { deliver, durableWorld, emulatePaddle, producerNamespace, scope, success } from './test-support.ts';
import { PurchaseReader, ProjectionConfiguration, ProjectionRenderer, purchaseObservationGroup, purchaseProjectionModule, purchaseProjectionDisplayModule, purchaseProjectionDisplayDeclaration, purchaseReadInput, projectionConfigurationInput, projectionRendererInput } from '@agent-teams/payments-get-modular/observation';
import type { PurchaseObservationCapabilities } from '@agent-teams/payments-get-modular/observation';
import type { PurchaseProjectionState, PurchaseReadPort } from '@agent-teams/payments-get-modular/observation';

test('packed payments and installed observation: absent, failing and closed screens preserve real T1/T2/T3 delivery and Q100/T25 effects', { timeout: 60_000 }, async t => {
  const transport = emulatePaddle();
  t.after(() => transport.close());
  const world = await durableWorld();
  const owner = createScope({ name: 'borrowed-payment-host' });
  const reports: ListenerError[] = [];
  const thrown = new Error('optional screen is broken');
  const screensA: PurchaseProjectionState[] = [], screensB: PurchaseProjectionState[] = [];
  const borrowedReads = new Map<string, Awaited<ReturnType<PurchaseReadPort['readPurchase']>>>();
  let createCalls = 0;
  try {
    await world.payments.registerConsumer('credits');
    await world.payments.registerConsumer('access');
    transport.api.intercept({ path: /^\/transactions\??$/u, method: 'POST', headers: { 'paddle-version': '1' } }).reply(201, options => {
      createCalls += 1;
      const body = JSON.parse(String(options.body)) as { custom_data: { payments: { intentId: string } } };
      return responseFixture(transactionFixture({ intentId: body.custom_data.payments.intentId, status: 'ready', customerRef: null, subscriptionRef: null }));
    });
    const initial = success(await world.payments.startPurchase({ buyerId: 'buyer-a', offerId: 'monthly', requestKey: 'initial' }));
    assert.equal(createCalls, 1);
    assert.equal((await world.credit.decisions()).length, 0, 'preparing checkout grants no symbolic credits');
    // No hook exists for first T1 admission, T2 classification/publication or T3 owner commit.
    await world.ingest('transaction.completed', transactionFixture({ intentId: initial.intentId }));
    await world.ingest('subscription.activated', subscriptionFixture());
    const unacknowledged = await deliver(world.payments, 'credits', world.credit, false);
    assert.ok(unacknowledged.some(message => message.kind === 'complete' && message.completion?.transactionRef === initial.transactionRef));
    const firstDecision = (await world.credit.decisions())[0];
    assert.ok(firstDecision);
    assert.deepEqual([firstDecision.body.bucket, firstDecision.body.allocated, firstDecision.body.eligible, firstDecision.body.held], ['included', '100', '100', '0']);
    assert.ok((await world.payments.readDeliveries('credits', 100)).length > 0, 'T3 custody survives a lost producer ACK');
    const restartedCredit = new CreditFixture({ pool: world.pool, schema: world.credit.owner.options.schema, trust: { producerNamespace, scope } });
    for (const message of unacknowledged) {assert.equal((await restartedCredit.receive(message)).outcome, 'duplicate');}
    await deliver(world.payments, 'credits', restartedCredit);
    await deliver(world.payments, 'access', world.access);
    assert.deepEqual(await world.payments.readDeliveries('credits', 100), []);
    assert.deepEqual(await world.payments.readDeliveries('access', 100), []);
    assert.equal((await world.access.decisions())[0]?.body.newAction, true);

    const compose = (api = assemblyFor<PurchaseObservationCapabilities>()) => api.prepare({
      profileId: 'qualification/payments-observation', modules: [purchaseObservationGroup],
      inputs: { read: purchaseReadInput, configuration: projectionConfigurationInput, renderer: projectionRendererInput },
      roots: { projection: purchaseProjectionModule, display: purchaseProjectionDisplayModule },
    });
    const prepared = await compose();
    assert.equal(prepared.status, 'prepared');
    if (prepared.status !== 'prepared') {throw new Error('Expected a prepared actual Assembly template');}
    const a = owner.resources.child({ name: 'screen-a' }), b = owner.resources.child({ name: 'screen-b' });
    const originalQuery = { buyerId: 'buyer-a', intentId: initial.intentId };
    const input = (query: { buyerId: string; intentId: string }, render: (state: PurchaseProjectionState) => undefined) => ({
      read: { [PurchaseReader.id]: { async readPurchase(buyerId: string, intentId: string) {
        const purchase = await world.payments.readPurchase(buyerId, intentId);
        borrowedReads.set(buyerId, purchase);
        return purchase;
      } } },
      configuration: { [ProjectionConfiguration.id]: { initialQuery: query, reportError: (report: ListenerError): undefined => { reports.push(report); } } },
      renderer: { [ProjectionRenderer.id]: { render } },
    });
    const construction = await smoke({ api: assemblyFor<PurchaseObservationCapabilities>(), compose,
      inputs: input(originalQuery, () => undefined), at: [purchaseProjectionDisplayDeclaration.implementationId] });
    assert.deepEqual(construction.map(step => step.outcome), ['succeeded', 'failed', 'cancelled']);
    for (const step of construction) { assert.equal(step.problem, undefined); assert.equal(step.report.complete, true); }
    assert.equal(createCalls, 1, 'normal, failed and cancelled projection construction cannot dispatch a provider mutation');
    const [runA, runB] = await Promise.all([
      prepared.prepared.run({ scope: a.resources, inputs: input(originalQuery, state => { screensA.push(state); }) }),
      prepared.prepared.run({ scope: b.resources, inputs: input({ buyerId: 'other-buyer', intentId: initial.intentId }, state => { screensB.push(state); }) }),
    ]);
    assert.equal(runA.status, 'succeeded'); assert.equal(runB.status, 'succeeded');
    if (runA.status !== 'succeeded' || runB.status !== 'succeeded') {throw new Error('Expected two independent actual Assembly runs');}
    const first = runA.roots.projection, second = runB.roots.projection;
    assert.notEqual(first, second);
    await settled();
    const readyA = runA.roots.display.current(), readyB = runB.roots.display.current();
    assert.equal(readyA.status, 'ready'); assert.equal(readyB.status, 'ready');
    if (readyA.status !== 'ready' || readyB.status !== 'ready') {throw new Error('Expected settled read projections');}
    assert.equal(readyA.purchase?.intent.intentId, initial.intentId);
    assert.equal(readyA.purchase?.transactions.find(item => item.transactionRef === initial.transactionRef)?.completion?.total.minorUnits, '1000');
    assert.equal(readyB.purchase, undefined, 'the other buyer does not see the first root purchase');
    const borrowed = borrowedReads.get('buyer-a');
    assert.ok(borrowed); assert.ok(readyA.purchase);
    assert.equal(Object.isFrozen(originalQuery), false);
    assert.equal(Object.isFrozen(borrowed.intent), false, 'the projection never takes ownership of the borrowed public read result');
    assert.equal(Object.isFrozen(readyA.purchase.intent), true);
    assert.equal(Object.isFrozen(readyA.purchase.transactions), true);
    originalQuery.intentId = 'caller-mutation-after-selection';
    borrowed.intent.buyerId = 'caller-mutation-after-read';
    assert.equal(readyA.query.intentId, initial.intentId, 'selection keeps its own copied query');
    assert.equal(readyA.purchase.intent.buyerId, 'buyer-a', 'the frozen view owns a detached copy of the borrowed result');
    assert.ok(screensA.some(state => state.status === 'ready'));
    assert.ok(screensB.some(state => state.status === 'ready' && state.purchase === undefined));
    assert.equal(createCalls, 1, 'loading read projections dispatches no provider mutation');
    first.view.watch(first.view.read(['state']), { resources: a.resources, name: 'fixture/broken-screen', onChange: () => { throw thrown; } });
    first.commands.refresh();
    await settled();
    assert.ok(reports.some(report => report.subscription === 'fixture/broken-screen' && report.cause === thrown));

    let topupIntent = '';
    transport.api.intercept({ path: /^\/transactions\??$/u, method: 'POST' }).reply(201, options => {
      createCalls += 1;
      const body = JSON.parse(String(options.body)) as { custom_data: { payments: { intentId: string } } };
      topupIntent = body.custom_data.payments.intentId;
      return responseFixture(transactionFixture({ id: paddleIds.secondTransaction, intentId: topupIntent, monthly: false, status: 'ready', customerRef: null }));
    });
    const topup = success(await world.payments.startPurchase({ buyerId: 'buyer-a', offerId: 'topup', requestKey: 'intentional-topup' }));
    await world.ingest('transaction.completed', transactionFixture({ id: topup.transactionRef, intentId: topup.intentId, monthly: false }));
    await deliver(world.payments, 'credits', restartedCredit);
    await deliver(world.payments, 'access', world.access);
    assert.deepEqual((await restartedCredit.decisions()).map(row => [row.body.bucket, row.body.eligible, row.body.held]).sort(), [['included', '100', '0'], ['purchased', '25', '0']]);
    assert.equal(createCalls, 2, 'one initial and one intentional top-up, despite repeated projection reads and callback failures');
    first.commands.select({ buyerId: 'buyer-a', intentId: topup.intentId });
    const invalidated = first.view.read(['state']).values.state;
    assert.equal(invalidated.status, 'loading', 'selection synchronously invalidates the previous buyer/intent view');
    await settled();
    const refreshed = first.view.read(['state']).values.state;
    assert.equal(refreshed.status, 'ready');
    if (refreshed.status !== 'ready') {throw new Error('Expected explicitly refreshed completed top-up');}
    const completedTopup = refreshed.purchase?.transactions.find(item => item.transactionRef === paddleIds.secondTransaction);
    assert.deepEqual({ intentId: refreshed.purchase?.intent.intentId, buyerId: refreshed.purchase?.intent.buyerId,
      transactionRef: completedTopup?.transactionRef, classification: completedTopup?.completion?.classification, total: completedTopup?.completion?.total },
    { intentId: topup.intentId, buyerId: 'buyer-a', transactionRef: paddleIds.secondTransaction, classification: 'one_time', total: { currency: 'USD', minorUnits: '1000' } });
    const durableTopup = await world.payments.readPurchase('buyer-a', topup.intentId);
    assert.equal(completedTopup?.completion?.factId, durableTopup?.transactions.find(item => item.transactionRef === paddleIds.secondTransaction)?.completion?.factId, 'the explicit refresh projects the actual completed durable fact');
    assert.equal((await world.payments.readDeliveries('credits', 100)).length, 0);

    assert.equal((await a.control.close()).complete, true);
    assert.equal(liveSubscriptions(first.view), 0);
    assert.equal((await world.pool.query<{ alive: number }>('SELECT 1 AS alive')).rows[0]?.alive, 1, 'closing a projection does not close the borrowed host pool');
    assert.equal(second.view.read(['state']).values.state.status, 'ready', 'sibling scope remains usable');
    second.commands.refresh();
    await settled();
    assert.equal(second.view.read(['state']).values.state.status, 'ready');
    assert.equal((await b.control.close()).complete, true);
    assert.equal(liveSubscriptions(second.view), 0);

    // After every projection closes, payment-owner T1/T2 and independent-owner T3 still run.
    const renewal = transactionFixture({ id: 'txn_00000000000000000000000003', intentId: initial.intentId, origin: 'subscription_recurring', version: '2026-11-01T00:00:01Z' });
    renewal['billing_period'] = { starts_at: fixturePeriod.ends_at, ends_at: '2026-12-01T00:00:00.123456Z' };
    await world.ingest('transaction.completed', renewal);
    await deliver(world.payments, 'credits', restartedCredit);
    await deliver(world.payments, 'access', world.access);
    const final = await restartedCredit.decisions();
    assert.equal(final.filter(row => row.body.bucket === 'included').reduce((total, row) => total + BigInt(row.body.eligible), 0n), 200n);
    assert.equal(final.filter(row => row.body.bucket === 'purchased').reduce((total, row) => total + BigInt(row.body.eligible), 0n), 25n);
    assert.ok(final.every(row => row.body.held === '0'));
    const effects = (await restartedCredit.owner.inspect<{ body: { kind: string; amount: string } }>('effects')).map(row => row.body);
    assert.equal(effects.filter(effect => effect.kind === 'grant').length, 3);
    assert.equal(effects.reduce((total, effect) => total + BigInt(effect.amount), 0n), 225n);
    const renewedAccess = (await world.access.decisions())[0]?.body;
    assert.equal(renewedAccess?.newAction, true);
    assert.equal(renewedAccess?.paidUntil, '2026-12-01T00:00:00.123456Z', 'renewal extends access after every projection has closed');
    assert.equal(renewedAccess?.knownLastPeriod?.endsAt, '2026-12-01T00:00:00.123456Z', 'the access owner persists the newly paid period');
    assert.equal(success(await world.payments.startPurchase({ buyerId: 'buyer-a', offerId: 'monthly', requestKey: 'initial' })).intentId, initial.intentId);
    assert.equal(createCalls, 2, 'closed optional observation never retries or dispatches financial work');
    assert.deepEqual(await world.payments.readDeliveries('credits', 100), []);
    assert.deepEqual(await world.payments.readDeliveries('access', 100), []);
    transport.agent.assertNoPendingInterceptors();
    await delivered();
  } finally {
    assert.equal((await owner.control.close()).complete, true);
    await world.close();
  }
});
