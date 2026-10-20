import assert from 'node:assert/strict';
import test from 'node:test';
import { createScope } from '@get-modular/resources';
import { createStore } from '@get-modular/observation';
import type { ListenerError } from '@get-modular/observation';
import { delivered, liveSubscriptions } from '@get-modular/observation/testing';

test('installed observation catches read/watch gaps, coalesces, attributes callback failure and detaches both scope lifetimes', async () => {
  const root = createScope({ name: 'observation-lifecycle' });
  const owner = root.resources.child({ name: 'owner' });
  const subscriber = root.resources.child({ name: 'subscriber' });
  const reports: ListenerError[] = [];
  const source = createStore<{ readonly state: number }>({ state: 0 }, { resources: owner.resources, name: 'payments-qualification-source', reportError: report => { reports.push(report); } });
  const view = source.readonly();
  const caughtUp: number[] = [];
  const cause = new Error('fixture screen failed');
  try {
    const before = view.read(['state']);
    source.set({ state: 1 }); // The snapshot predates registration, as during async construction.
    view.watch(before, { resources: subscriber.resources, name: 'fixture/catch-up', onChange: next => { caughtUp.push(next.values.state); } });
    assert.deepEqual(caughtUp, [], 'watch never calls synchronously');
    await delivered({ stores: [view] });
    assert.deepEqual(caughtUp, [1]);
    view.watch(view.read(['state']), { resources: subscriber.resources, name: 'fixture/throwing-screen', onChange: () => { throw cause; } });
    const revisions = [source.set({ state: 2 }), source.set({ state: 3 })];
    await delivered({ stores: [view] });
    assert.equal(caughtUp.at(-1), 3);
    assert.ok(caughtUp.slice(1).every(value => value >= 2 && value <= 3));
    assert.equal(reports.length, 1);
    assert.equal(reports[0]?.source, 'payments-qualification-source');
    assert.equal(reports[0]?.subscription, 'fixture/throwing-screen');
    assert.equal(reports[0]?.revision, revisions[1]);
    assert.equal(reports[0]?.cause, cause);
    assert.equal(reports[0]?.path, undefined, 'this retained Resources0.2 artifact does not expose Resources.path');
    source.set({ state: 4 });
    await delivered({ stores: [view] });
    assert.equal(caughtUp.at(-1), 4, 'one throwing screen does not stop the other or future delivery');
    assert.equal(reports.length, 2);
    assert.equal(liveSubscriptions(view), 2);
    assert.equal((await subscriber.control.close()).complete, true);
    assert.equal(liveSubscriptions(view), 0);

    const second = root.resources.child({ name: 'second-subscriber' });
    view.watch(view.read(['state']), { resources: second.resources, name: 'fixture/source-close', onChange: () => undefined });
    assert.equal(liveSubscriptions(view), 1);
    assert.equal((await owner.control.close()).complete, true);
    assert.equal(liveSubscriptions(view), 0);
    const closed = reports.at(-1);
    assert.equal(closed?.source, 'payments-qualification-source');
    assert.equal(closed?.subscription, 'fixture/source-close');
    assert.equal(closed?.revision, 4);
    assert.ok(closed?.cause instanceof Error && 'code' in closed.cause && closed.cause.code === 'observation.source.closed');
    assert.equal((await second.control.close()).complete, true);
    assert.throws(() => view.read(['state']), error => error instanceof Error && 'code' in error && error.code === 'observation.store.closed');
  } finally {
    assert.equal((await root.control.close()).complete, true);
    assert.equal(liveSubscriptions(view), 0);
  }
});
