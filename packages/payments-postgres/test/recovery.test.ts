import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { canonicalJson, digest } from '@agent-teams/payments-core';
import type { EvidenceMessage, PaymentOperation, PurchaseIntent, SubscriptionBinding } from '@agent-teams/payments-core';
import {
  createPostgresPaymentRecovery, PaymentRecoveryBlockedError, PaymentRecoveryConflictError, recoveryCheckpointDigest,
} from '../dist/index.js';
import type { PaymentRecoverySession, RecoveryCheckpoint, RecoveryManifest } from '../dist/index.js';
import { CreditFixture } from '../../../tests/fixtures/consumers/credit.ts';
import type { Effect } from '../../../tests/fixtures/consumers/owner.ts';
import { databaseFixture, offer, runtime, scope } from './helpers.ts';

const producerNamespace = 'database-fixture';
const audit = { actorId: 'trusted-operator', auditRef: 'incident-restore-2026-001', reason: 'Reconcile independently restored owners before resuming' };
const restore = { horizon: '2026-01-01T00:00:00Z', uncertainFrom: '2025-12-31T23:00:00Z', uncertainThrough: '2026-01-01T01:00:00Z', reason: 'Logical owner rollback qualification fixture' };
const externalFence = { deploymentRef: 'fixture-host', fenceRef: 'host-stopped-before-restore', appliedAt: '2025-12-31T22:00:00Z' };
function message(revision: number, transactionRef = 'restored-transaction'): EvidenceMessage {
  const aggregate = { type: 'transaction' as const, id: transactionRef };
  const body = { envelopeVersion: 1 as const, schemaVersion: 1 as const, producerNamespace, scope, aggregate, revision,
    messageId: digest([producerNamespace, scope, aggregate, revision]), kind: 'complete' as const,
    completion: { factId: `fact:${transactionRef}`, scope, transactionRef, buyerId: 'buyer', intentId: `intent:${transactionRef}`, classification: 'one_time' as const,
      offer: { ...offer, profile: 'one_time' as const }, total: { currency: 'USD', minorUnits: '1000' },
      lines: [{ providerLineRef: 'line', benefitSlotId: 'purchased', amount: { currency: 'USD', minorUnits: '1000' }, quantity: 1 as const }],
      source: { kind: 'authenticated_api' as const, receiptId: 'fixture-source', representationDigest: digest('source'), decoderVersion: 'fixture/1', apiProfile: 'fixture/1' } },
    adjustments: [], flags: [] };
  return { ...body, bodyDigest: digest(body) };
}
function manifest(checkpoints: readonly RecoveryCheckpoint[]): RecoveryManifest {
  return { exportRef: 'consumer-public-checkpoint-export', ownerAuditRef: 'consumer-owner-reviewed', checkpointCount: checkpoints.length, checkpointDigest: recoveryCheckpointDigest(checkpoints), externalEffectsReviewRef: 'consumer-publication-and-effects-reconciled' };
}
async function seed(f: Awaited<ReturnType<typeof databaseFixture>>, messages: readonly EvidenceMessage[]): Promise<void> {
  // Fixture-only owner-unit restore/import. Production recovery never reads or writes consumer SQL.
  for (const item of messages) {
    await f.pool.query(`INSERT INTO "${f.schema}".records(kind,id,revision,body) VALUES('evidence',$1,1,$2)
      ON CONFLICT(kind,id) DO UPDATE SET body=EXCLUDED.body`, [item.messageId, JSON.stringify(item)]);
    await f.pool.query(`INSERT INTO "${f.schema}".records(kind,id,revision,body) VALUES('transactions',$1,1,$2)
      ON CONFLICT(kind,id) DO UPDATE SET body=EXCLUDED.body`, [item.aggregate.id, JSON.stringify({ transactionRef: item.aggregate.id, revision: item.revision, evidenceRevision: item.revision, publicationRequired: false, observations: [], adjustments: {}, pendingAdverse: [], flags: [] })]);
  }
}
async function consumer(f: Awaited<ReturnType<typeof databaseFixture>>) {
  const schema = `recovery_credit_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
  const credit = new CreditFixture({ pool: f.pool, schema, trust: { producerNamespace, scope } });
  await credit.migrate();
  return { credit, async close() { await f.pool.query(`DROP SCHEMA "${schema}" CASCADE`); } };
}
async function consumerCheckpoints(credit: CreditFixture): Promise<RecoveryCheckpoint[]> {
  // Use only the consumer owner's public inspection/export capability, never cross-owner SQL.
  const receipts = await credit.owner.inspect<{ message_id: string; revision: string; digest: string }>('receipts');
  const sources = await credit.owner.inspect<{ body: EvidenceMessage }>('evidence_projection');
  return receipts.map(row => {
    const source = sources.find(value => value.body.aggregate.id === 'restored-transaction'); assert.ok(source);
    return { messageId: row.message_id, revision: Number(row.revision), bodyDigest: row.digest, aggregate: source.body.aggregate };
  }).sort((a, b) => a.messageId < b.messageId ? -1 : 1);
}
async function requiredScans(admin: Awaited<ReturnType<typeof createPostgresPaymentRecovery>>, initial: PaymentRecoverySession): Promise<PaymentRecoverySession> {
  let session = initial;
  while (session.producerScan.status !== 'complete') session = await admin.scanProducerHistory(session.sessionId, session.revision, 100, audit);
  while (session.uncertaintyScan.status !== 'complete') session = await admin.scanUncertainOperations(session.sessionId, session.revision, 100, audit);
  return admin.reviewArchives(session.sessionId, session.revision, { auditRef: 'archive-review', sources: ['fixture-owner-unit-export'], limitations: 'Logical rollback only; no physical backup, WAL replay or HA promotion qualification' }, audit);
}

test('logical producer-only restore stays fenced below the consumer revision 10 until original immutable history and counters match', async () => {
  const f = await databaseFixture(), c = await consumer(f), context = runtime(f.store);
  try {
    await f.store.registerConsumer(scope, 'credit', false);
    const history = Array.from({ length: 10 }, (_, index) => message(index + 1)); await seed(f, history);
    for (const item of history) assert.equal((await c.credit.receive(item)).acknowledge, true);
    const checkpoints = await consumerCheckpoints(c.credit); assert.equal(checkpoints.length, 10);
    assert.equal((await c.credit.owner.inspect<{ revision: string }>('evidence_projection'))[0]?.revision, '10');
    // Roll back only producer-owned rows; consumer correctness records remain at revision 10.
    await f.pool.query(`DELETE FROM "${f.schema}".records WHERE kind IN ('evidence','transactions')`); await seed(f, history.slice(0, 3));
    const admin = await createPostgresPaymentRecovery({ pool: f.pool, schema: f.schema, scope, producerNamespace });
    let session = await admin.begin({ sessionId: 'producer-only', externalFence, restore, restoredConsumerIds: [], audit });
    session = await requiredScans(admin, session);
    await assert.rejects(admin.resume(session.sessionId, session.revision, audit), error => error instanceof PaymentRecoveryBlockedError && error.reasons.includes('unverified_consumer:credit'));
    session = await admin.startConsumerVerification(session.sessionId, session.revision, 'credit', manifest(checkpoints), audit);
    session = await admin.verifyConsumerPage(session.sessionId, session.revision, 'credit', checkpoints, audit);
    assert.equal(session.consumers['credit']?.status, 'blocked'); assert.equal(session.consumers['credit']?.issue, 'missing_immutable_message');
    await assert.rejects(admin.resume(session.sessionId, session.revision, audit), PaymentRecoveryBlockedError);
    await assert.rejects(f.store.setRecoveryFence(scope, false, 'attempt-bypass'), /active recovery session/i);
    assert.deepEqual(await context.payments.startPurchase({ buyerId: 'buyer', offerId: 'monthly', requestKey: 'while-restored' }), { kind: 'rejected', code: 'unavailable' });
    assert.equal(await context.payments.flushPublication(history[0]!.aggregate), 'recovery_fenced');
    assert.equal(context.calls(), 0); assert.deepEqual(await context.payments.readDeliveries('credit'), []);
    // A same-identity body substitution is rejected even if its replacement body is self-consistent.
    const substituted = { ...history[9]!, flags: ['unsupported'] as const }; const { bodyDigest: _oldDigest, ...body } = substituted;
    await seed(f, history); await seed(f, [{ ...body, bodyDigest: digest(body) }]);
    session = await admin.verifyConsumerPage(session.sessionId, session.revision, 'credit', checkpoints, audit);
    assert.equal(session.consumers['credit']?.issue, 'immutable_checkpoint_mismatch');
    await seed(f, history);
    await f.pool.query(`UPDATE "${f.schema}".records SET body=jsonb_set(body,'{evidenceRevision}','3') WHERE kind='transactions'`);
    session = await admin.verifyConsumerPage(session.sessionId, session.revision, 'credit', checkpoints, audit);
    assert.equal(session.consumers['credit']?.issue, 'producer_counter_regressed');
    await seed(f, history);
    session = await admin.restartChecks(session.sessionId, session.revision, audit);
    session = await requiredScans(admin, session);
    session = await admin.startConsumerVerification(session.sessionId, session.revision, 'credit', manifest(checkpoints), audit);
    session = await admin.verifyConsumerPage(session.sessionId, session.revision, 'credit', checkpoints, audit);
    assert.equal(session.consumers['credit']?.status, 'complete');
    session = await admin.resume(session.sessionId, session.revision, audit); assert.equal(session.status, 'resumed');
    assert.deepEqual((await admin.exportCheckpoints({ limit: 100 })).checkpoints, checkpoints);
    assert.deepEqual(await admin.readEvidence(history[9]!.messageId), history[9]);
  } finally { await context.payments.drain(); await c.close(); await f.close(); }
});

test('logical consumer-only restore explicitly reopens sender ACKs with original message and effect identities', async () => {
  const f = await databaseFixture(), before = await consumer(f), restored = await consumer(f);
  try {
    await f.store.registerConsumer(scope, 'credit', false);
    const original = message(1); await seed(f, [original]);
    // Sender's pre-restore history has an acknowledged original delivery.
    await f.store.registerConsumer(scope, 'credit', true);
    assert.equal((await before.credit.receive(original)).acknowledge, true);
    const originalEffects = await before.credit.owner.inspect<{ body: Effect }>('effects'); assert.equal(originalEffects.length, 1);
    assert.equal(await f.store.acknowledgeDelivery(scope, 'credit', original.messageId, original.bodyDigest), 'acknowledged');
    assert.deepEqual(await f.store.listDeliveries(scope, 'credit', 100), []);
    // The isolated empty schema represents the whole consumer unit restored before its receipt/effect.
    const checkpoints = await consumerCheckpoints(restored.credit); assert.deepEqual(checkpoints, []);
    const admin = await createPostgresPaymentRecovery({ pool: f.pool, schema: f.schema, scope, producerNamespace });
    let session = await admin.begin({ sessionId: 'consumer-only', externalFence, restore, restoredConsumerIds: ['credit'], audit });
    session = await requiredScans(admin, session);
    session = await admin.startConsumerVerification(session.sessionId, session.revision, 'credit', manifest(checkpoints), audit);
    await assert.rejects(admin.resume(session.sessionId, session.revision, audit), error => error instanceof PaymentRecoveryBlockedError && error.reasons.includes('unfinished_backfill:credit'));
    session = await admin.backfillRestoredConsumer(session.sessionId, session.revision, 'credit', 100, audit);
    assert.equal(session.backfills['credit']?.processed, 1);
    assert.equal(await f.store.acknowledgeDelivery(scope, 'credit', original.messageId, original.bodyDigest), 'conflict', 'late acknowledgement cannot erase reopened delivery while fenced');
    assert.deepEqual(await f.store.listDeliveries(scope, 'credit', 100), []);
    await admin.resume(session.sessionId, session.revision, audit);
    const deliveries = await f.store.listDeliveries(scope, 'credit', 100); assert.deepEqual(deliveries, [original]);
    assert.equal((await restored.credit.receive(deliveries[0])).acknowledge, true);
    assert.deepEqual(await restored.credit.owner.inspect<{ body: Effect }>('effects'), originalEffects, 'original financial effect identity survives consumer replay');
    assert.equal((await restored.credit.receive(original)).outcome, 'duplicate');
    assert.equal((await restored.credit.owner.inspect('effects')).length, 1);
    assert.equal(await f.store.acknowledgeDelivery(scope, 'credit', original.messageId, original.bodyDigest), 'acknowledged');
    assert.deepEqual(await f.store.listDeliveries(scope, 'credit', 100), []);
  } finally { await before.close(); await restored.close(); await f.close(); }
});

test('restore through a dispatch gap quarantines every prepared command including old intents; lane hold survives late settlement', async () => {
  const f = await databaseFixture(), context = runtime(f.store);
  try {
    const binding: SubscriptionBinding = { bindingId: 'pinned-lane', buyerId: 'buyer', originatingIntentId: 'old-intent', offer, providerSubscriptionRefs: [], customerRef: null };
    const operation: PaymentOperation = { operationId: 'old-prepared', kind: 'purchase', buyerId: 'buyer', requestKey: 'old', fingerprint: 'old-fingerprint', intentId: 'old-intent', subscriptionBindingId: binding.bindingId, revision: 1, state: 'prepared', attempts: [], audits: [] };
    const intent: PurchaseIntent = { intentId: 'old-intent', buyerId: 'buyer', requestKey: 'old', fingerprint: operation.fingerprint, offer, operationId: operation.operationId, subscriptionBasisId: binding.bindingId, transactionRefs: [], createdAt: '2010-01-01T00:00:00Z' };
    assert.equal((await f.store.admitIntent(scope, { intent, operation, subscriptionBinding: binding })).kind, 'created');
    const admin = await createPostgresPaymentRecovery({ pool: f.pool, schema: f.schema, scope, producerNamespace });
    let session = await admin.begin({ sessionId: 'dispatch-gap', externalFence, restore, restoredConsumerIds: [], audit });
    session = await admin.scanProducerHistory(session.sessionId, session.revision, 100, audit);
    session = await admin.reviewArchives(session.sessionId, session.revision, { auditRef: 'manual-review', sources: ['restored-owner-unit'], limitations: 'Provider mutation outcome is unknown; lane must remain held' }, audit);
    await assert.rejects(admin.resume(session.sessionId, session.revision, audit), error => error instanceof PaymentRecoveryBlockedError && error.reasons.includes('unfinished_uncertainty_scan'));
    session = await admin.scanUncertainOperations(session.sessionId, session.revision, 100, audit);
    const restored = await f.store.loadOperation(scope, operation.operationId); assert.ok(restored);
    assert.equal(restored.operation.state, 'outcome_unknown'); assert.equal(restored.operation.audits.at(-1)?.action, 'keep_unknown');
    await admin.resume(session.sessionId, session.revision, audit);
    await context.payments.executeOperation(operation.operationId); await context.payments.repair(); assert.equal(context.calls(), 0);
    const held = await f.store.loadOperation(scope, operation.operationId); assert.ok(held);
    await assert.rejects(admin.releaseReviewedLane(session.sessionId, operation.operationId, held.laneRevision, audit), PaymentRecoveryBlockedError);
    // A late terminal observation may settle its own operation but cannot silently erase the review hold.
    const terminal = { ...held.operation, revision: held.operation.revision + 1, state: 'succeeded' as const };
    assert.equal((await f.store.finishAttempt(scope, { expectedRevision: held.operation.revision, expectedLaneRevision: held.laneRevision, operation: terminal })).kind, 'committed');
    const current = await f.store.loadOperation(scope, operation.operationId); assert.ok(current);
    const newcomer = { ...operation, operationId: 'new-prepared', requestKey: 'new', intentId: 'new-intent' };
    assert.equal((await f.store.admitIntent(scope, { operation: newcomer, intent: { ...intent, intentId: 'new-intent', operationId: newcomer.operationId, requestKey: 'new' } })).kind, 'recovery_fenced');
    await admin.releaseReviewedLane(session.sessionId, operation.operationId, current.laneRevision, audit);
    assert.equal((await f.store.admitIntent(scope, { operation: newcomer, intent: { ...intent, intentId: 'new-intent', operationId: newcomer.operationId, requestKey: 'new' } })).kind, 'created');
    assert.equal(context.calls(), 0);
  } finally { await context.payments.drain(); await f.close(); }
});

test('administrative CAS, immutable audit records and 100-record recovery pages survive restart without skipped work', async () => {
  const f = await databaseFixture();
  try {
    const history = Array.from({ length: 205 }, (_, index) => message(1, `transaction-${String(index).padStart(3, '0')}`)); await seed(f, history);
    for (let index = 0; index < 205; index++) {
      const operation: PaymentOperation = { operationId: `restored-${String(index).padStart(3, '0')}`, kind: 'purchase', buyerId: 'buyer', requestKey: `restored-${index}`, fingerprint: 'fixture', revision: 1, state: 'prepared', attempts: [], audits: [] };
      await f.pool.query(`INSERT INTO "${f.schema}".records(kind,id,revision,body) VALUES('operations',$1,1,$2)`, [operation.operationId, JSON.stringify(operation)]);
    }
    await f.store.registerConsumer(scope, 'credit', false);
    let admin = await createPostgresPaymentRecovery({ pool: f.pool, schema: f.schema, scope, producerNamespace });
    let session = await admin.begin({ sessionId: 'bounded-recovery', externalFence, restore, restoredConsumerIds: ['credit'], audit });
    await assert.rejects(admin.exportCheckpoints({ limit: 101 }), RangeError);
    await assert.rejects(admin.scanUncertainOperations(session.sessionId, session.revision, 101, audit), RangeError);
    const first = await admin.exportCheckpoints({ limit: 100 }); assert.equal(first.checkpoints.length, 100); assert.equal(first.complete, false);
    const second = await admin.exportCheckpoints({ limit: 100, after: first.after! }); assert.equal(second.checkpoints.length, 100);
    const third = await admin.exportCheckpoints({ limit: 100, after: second.after! }); assert.equal(third.checkpoints.length, 5); assert.equal(third.complete, true);
    const checkpoints = [...first.checkpoints, ...second.checkpoints, ...third.checkpoints]; assert.equal(new Set(checkpoints.map(value => value.messageId)).size, 205);
    const stale = session.revision;
    session = await admin.scanProducerHistory(session.sessionId, session.revision, 100, audit); assert.equal(session.producerScan.processed, 100);
    await assert.rejects(admin.scanProducerHistory(session.sessionId, stale, 100, audit), PaymentRecoveryConflictError);
    admin = await createPostgresPaymentRecovery({ pool: f.pool, schema: f.schema, scope, producerNamespace });
    session = (await admin.read(session.sessionId))!; assert.equal(session.producerScan.processed, 100);
    session = await admin.scanUncertainOperations(session.sessionId, session.revision, 100, audit);
    assert.equal(session.uncertaintyScan.processed, 100); assert.equal(session.uncertaintyScan.status, 'pending');
    assert.equal((await f.pool.query(`SELECT 1 FROM "${f.schema}".records WHERE kind='operations' AND body->>'state'='prepared'`)).rowCount, 105);
    session = await requiredScans(admin, session);
    assert.equal(session.uncertaintyScan.processed, 205);
    assert.equal((await f.pool.query(`SELECT 1 FROM "${f.schema}".records WHERE kind='operations' AND body->>'state'='outcome_unknown'`)).rowCount, 205);
    session = await admin.startConsumerVerification(session.sessionId, session.revision, 'credit', manifest(checkpoints), audit);
    for (let offset = 0; offset < checkpoints.length; offset += 100) session = await admin.verifyConsumerPage(session.sessionId, session.revision, 'credit', checkpoints.slice(offset, offset + 100), audit);
    for (let page = 0; page < 3; page++) {
      session = await admin.backfillRestoredConsumer(session.sessionId, session.revision, 'credit', 100, audit);
      assert.equal(session.backfills['credit']?.processed, Math.min((page + 1) * 100, 205));
    }
    const audits = await admin.readAudits(session.sessionId, 0, 100);
    assert.equal(audits.length, session.revision); assert.deepEqual(audits.map(value => value.revision), Array.from({ length: session.revision }, (_, index) => index + 1));
    assert.equal(audits.at(-1)?.sessionDigest, digest(session));
    assert.deepEqual(audits.at(-1)?.cursorState.backfills['credit'], session.backfills['credit']);
    assert.equal(audits.find(value => value.action === 'scan_uncertain_operations')?.cursorState.uncertaintyScan.processed, 100);
    assert.equal(audits.filter(value => value.action === 'scan_producer_history').length, 3, 'stale CAS did not append an audit or advance a cursor');
    await admin.resume(session.sessionId, session.revision, audit);
    assert.equal((await f.store.listDeliveries(scope, 'credit', 100)).length, 100);
    assert.equal((await f.pool.query(`SELECT 1 FROM "${f.schema}".records WHERE kind='deliveries' AND body->>'acknowledged'='false'`)).rowCount, 205);
    assert.equal(canonicalJson((await admin.read(session.sessionId))?.producerScan), canonicalJson({ after: third.after, status: 'complete', processed: 205 }));
  } finally { await f.close(); }
});
