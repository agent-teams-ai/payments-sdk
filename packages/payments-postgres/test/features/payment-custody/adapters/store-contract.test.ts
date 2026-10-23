import assert from 'node:assert/strict';
import test from 'node:test';
import type { PaymentOperation, OperationCommit } from '@agent-teams/payments-core/store';
import { at, databaseFixture, offer, scope } from '../../../../dist/testing.js';

void test('every command identity field is independently guarded before an operation CAS can change custody', async () => {
  const f = await databaseFixture();
  const operation: PaymentOperation = {
    operationId: 'guarded-operation', kind: 'purchase', buyerId: 'buyer', requestKey: 'guarded-request',
    fingerprint: 'guarded-fingerprint', intentId: 'guarded-intent', subscriptionBindingId: 'guarded-binding',
    providerSubscriptionRef: 'guarded-subscription', timing: 'now', revision: 1, state: 'prepared', attempts: [], audits: [],
  };
  const changes: readonly Partial<PaymentOperation>[] = [
    { operationId: 'another-operation' }, { kind: 'cancellation' }, { buyerId: 'another-buyer' },
    { requestKey: 'another-request' }, { fingerprint: 'another-fingerprint' }, { intentId: 'another-intent' },
    { subscriptionBindingId: 'another-binding' }, { providerSubscriptionRef: 'another-subscription' }, { timing: 'period_end' },
  ];
  try {
    assert.equal((await f.store.admitIntent(scope, {
      operation,
      intent: { intentId: 'guarded-intent', buyerId: 'buyer', requestKey: 'guarded-request', fingerprint: operation.fingerprint,
        offer, operationId: operation.operationId, transactionRefs: [], createdAt: at },
    })).kind, 'created');
    const before = (await f.pool.query(`SELECT kind, id, revision::text, body FROM "${f.schema}".records ORDER BY kind, id`)).rows;
    for (const changed of changes) {
      const commit: OperationCommit = { operation: { ...operation, ...changed, revision: 2 }, expectedRevision: 1, expectedLaneRevision: 0 };
      assert.deepEqual(await f.store.finishAttempt(scope, commit), { kind: 'conflict' }, `finish: ${Object.keys(changed)[0]}`);
      assert.deepEqual(await f.store.commitOperation(scope, commit), { kind: 'conflict' }, `commit: ${Object.keys(changed)[0]}`);
      assert.deepEqual(await f.store.beginExternalDispatch(scope, { ...commit, operation: { ...commit.operation, state: 'dispatch_started' } }),
        { kind: 'conflict' }, `dispatch: ${Object.keys(changed)[0]}`);
    }
    assert.deepEqual((await f.pool.query(`SELECT kind, id, revision::text, body FROM "${f.schema}".records ORDER BY kind, id`)).rows, before,
      'rejected commands preserve every authoritative record and its revision');
    assert.deepEqual(await f.store.finishAttempt(scope, { operation: { ...operation, revision: 2 }, expectedRevision: 1, expectedLaneRevision: 0 }),
      { kind: 'committed' }, 'the unchanged command can advance its revision through the same CAS');
  } finally { await f.close(); }
});

void test('scope rejection preserves the Promise failure contract across asynchronous store capabilities', async () => {
  const f = await databaseFixture();
  const foreign = { ...scope, applicationId: 'another-application' };
  try {
    const operations = [
      () => f.store.findRequest(foreign, 'buyer', 'request'),
      () => f.store.loadOperation(foreign, 'operation'),
      () => f.store.loadReductionInput(foreign, 'receipt'),
      () => f.store.readPurchase(foreign, 'buyer', 'intent'),
      () => f.store.readCheckpoint(foreign, 'scan'),
      () => f.store.admitVerifiedInputs(foreign, []),
    ];
    for (const operation of operations) {
      let pending: Promise<unknown> | undefined;
      assert.doesNotThrow(() => { pending = operation(); });
      assert.ok(pending instanceof Promise);
      await assert.rejects(pending, /Payment store scope mismatch/u);
    }
    assert.deepEqual((await f.pool.query('SELECT 1 AS healthy')).rows, [{ healthy: 1 }]);
  } finally { await f.close(); }
});
