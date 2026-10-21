import assert from 'node:assert/strict';
import test from 'node:test';
import { createScope } from '@get-modular/resources';
import type { ListenerError } from '@get-modular/observation';
import { delivered, liveSubscriptions, settled } from '@get-modular/observation/testing';
import { createPurchaseProjection } from '@agent-teams/payments-get-modular/observation';
import type { PurchaseProjectionState, PurchaseQuery } from '@agent-teams/payments-get-modular/observation';
import { durableWorld } from './test-support.ts';

void test('projection supersession and close await actual PostgreSQL reads plus cleanup; obsolete results never publish', { timeout: 30_000 }, async () => {
  const world = await durableWorld();
  const owner = createScope({ name: 'projection-read-lifetime' });
  const physicalRead = Promise.withResolvers<void>(), releaseRead = Promise.withResolvers<void>();
  const cleanupEntered = Promise.withResolvers<void>(), releaseCleanup = Promise.withResolvers<void>();
  const closeRead = Promise.withResolvers<void>(), releaseCloseRead = Promise.withResolvers<void>();
  const closeCleanup = Promise.withResolvers<void>(), releaseCloseCleanup = Promise.withResolvers<void>();
  const stillRunning = Promise.withResolvers<ListenerError>();
  const calls: string[] = [], states: PurchaseProjectionState[] = [], reports: ListenerError[] = [];
  let concurrent = 0, maximumConcurrent = 0;
  let failRecoverableRead = true;
  const projection = createPurchaseProjection({
    initialQuery: { buyerId: 'buyer-a', intentId: 'old' },
    reportError: report => {
      reports.push(report);
      if (report.cause instanceof Error && 'code' in report.cause && report.cause.code === 'observation.load.still-running') {stillRunning.resolve(report);}
    },
    read: { async readPurchase(buyerId, intentId) {
      calls.push(intentId); concurrent += 1; maximumConcurrent = Math.max(maximumConcurrent, concurrent);
      try {
        // A real public read through the packed runtime/store completes before these barriers.
        // The wrapper's Promise includes all temporary cleanup, as required of a borrowed read port.
        const purchase = await world.payments.readPurchase(buyerId, intentId);
        if (intentId === 'recoverable' && failRecoverableRead) {throw new Error('synthetic private connection diagnostic: never expose in the view');}
        if (intentId === 'old') { physicalRead.resolve(); await releaseRead.promise; }
        if (intentId === 'close-held') { closeRead.resolve(); await releaseCloseRead.promise; }
        return purchase;
      } finally {
        if (intentId === 'old') { cleanupEntered.resolve(); await releaseCleanup.promise; }
        if (intentId === 'close-held') { closeCleanup.resolve(); await releaseCloseCleanup.promise; }
        concurrent -= 1;
      }
    } },
  }, { resources: owner.resources });
  projection.view.watch(projection.view.read(['state']), { resources: owner.resources, name: 'fixture/record-read-states', onChange: next => { states.push(next.values.state); } });
  try {
    await physicalRead.promise;
    projection.commands.select({ buyerId: 'buyer-a', intentId: 'middle' });
    projection.commands.select({ buyerId: 'other-buyer', intentId: 'newest' });
    const loading = projection.view.read(['state']).values.state;
    assert.equal(loading.status, 'loading');
    await delivered(); // Deliver supersession without pretending that the physical read settled.
    assert.deepEqual(calls, ['old']);
    releaseRead.resolve();
    await cleanupEntered.promise;
    await delivered();
    assert.deepEqual(calls, ['old'], 'a successor cannot start during obsolete read cleanup');
    assert.equal(concurrent, 1);
    assert.equal(states.some(state => state.status === 'ready'), false, 'neither the old result nor a fabricated replacement is published');
    releaseCleanup.resolve();
    await settled();
    assert.deepEqual(calls, ['old', 'newest'], 'coalescing retains only the newest pending query');
    assert.equal(maximumConcurrent, 1, 'abort is not treated as physical cancellation');
    const ready = projection.view.read(['state']).values.state;
    assert.equal(ready.status, 'ready');

    assert.deepEqual(ready.query, { buyerId: 'other-buyer', intentId: 'newest' });
    assert.equal(ready.purchase, undefined);
    assert.deepEqual(states.flatMap(state => state.status === 'ready' ? [state.query.intentId] : []), ['newest'], 'a newer query committed before old publication suppresses every obsolete ready state');
    const clearedQuery: PurchaseQuery | undefined = undefined;
    projection.commands.select(clearedQuery);
    assert.deepEqual(projection.view.read(['state']).values.state, { status: 'idle' }, 'clearing a selection synchronously removes the prior buyer/intent value');
    await settled();
    assert.deepEqual(calls, ['old', 'newest'], 'an idle projection does not dispatch an invented read');
    projection.commands.select({ buyerId: 'buyer-a', intentId: 'recoverable' });
    await settled();
    assert.deepEqual(projection.view.read(['state']).values.state, { status: 'failed', query: { buyerId: 'buyer-a', intentId: 'recoverable' }, error: { code: 'purchase_read_failed' } });
    failRecoverableRead = false;
    await delivered();
    assert.equal(calls.filter(id => id === 'recoverable').length, 1, 'a failed read has no background retry');
    projection.commands.refresh();
    await settled();
    assert.equal(calls.filter(id => id === 'recoverable').length, 2);
    assert.equal(projection.view.read(['state']).values.state.status, 'ready', 'only explicit refresh recovers the sanitized failed read');

    projection.commands.select({ buyerId: 'buyer-a', intentId: 'close-held' });
    await closeRead.promise;
    let physicallyClosed = false;
    const closing = owner.control.close({ escalate: AbortSignal.abort('projection shutdown deadline') })
      .then(report => { physicallyClosed = true; return report; });
    const notice = await stillRunning.promise;
    assert.equal(notice.source, 'payments-purchase/requests');
    assert.equal(notice.subscription, 'payments-purchase/read');
    const snapshot = await owner.control.close({ abandon: AbortSignal.abort('Host observer deadline') });
    assert.equal(snapshot.complete, false);
    assert.equal(snapshot.settled, false);
    assert.ok(snapshot.debts.some(debt => debt.state === 'pending' && debt.path.slice(-2).join('/') === 'load:payments-purchase/read/drain'));
    assert.equal(physicallyClosed, false, 'escalation reporting and observer abandonment do not finish the borrowed read');
    assert.equal(world.payments.lifecycle().accepting, true);
    assert.equal((await world.pool.query<{ alive: number }>('SELECT 1 AS alive')).rows[0]?.alive, 1);
    releaseCloseRead.resolve();
    await closeCleanup.promise;
    await delivered();
    assert.equal(physicallyClosed, false, 'close also waits for the read port temporary cleanup');
    assert.equal(world.payments.lifecycle().accepting, true);
    assert.equal((await world.pool.query<{ alive: number }>('SELECT 1 AS alive')).rows[0]?.alive, 1, 'the pool remains usable during temporary cleanup');
    releaseCloseCleanup.resolve();
    assert.deepEqual(await closing, { complete: true, settled: true, debts: [] });
    assert.equal(concurrent, 0);
    assert.equal(liveSubscriptions(projection.view), 0);
    assert.equal(states.some(state => state.status === 'ready' && state.query.intentId === 'close-held'), false);
    assert.deepEqual(reports, [notice], 'only escalation of the physically held read emits a lifecycle report');
    assert.equal((await world.pool.query<{ alive: number }>('SELECT 1 AS alive')).rows[0]?.alive, 1, 'projection cleanup never owns the host pool');
    assert.equal(await world.payments.readPurchase('buyer-a', 'newest'), undefined, 'the borrowed payments owner remains accepting reads after projection close');
  } finally {
    releaseRead.resolve(); releaseCleanup.resolve(); releaseCloseRead.resolve(); releaseCloseCleanup.resolve();
    assert.equal((await owner.control.close()).complete, true);
    assert.equal(liveSubscriptions(projection.view), 0);
    await world.close();
  }
});
