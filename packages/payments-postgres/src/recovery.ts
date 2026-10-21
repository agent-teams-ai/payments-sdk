import { canonicalJson, digest } from '@agent-teams/payments-core';
import type { AggregateIdentity, Delivery, EvidenceMessage, PaymentOperation, PaymentScope } from '@agent-teams/payments-core';
import { assertPostgresDurability, withPaymentTransaction } from './database.js';
import type { DatabaseTimeouts, PaymentPostgresDatabase, PaymentSqlTransaction } from './database.js';
import { assertBatchLimit, PaymentRecords } from './records.js';
import type { StoredRecord } from './records.js';

/** Trusted owner administration. Never expose this capability through buyer HTTP handlers. */
export type PaymentRecoveryOptions = Readonly<{ database: PaymentPostgresDatabase; schema: string; scope: PaymentScope; producerNamespace: string; timeouts?: DatabaseTimeouts }>;
export type RecoveryAudit = Readonly<{ actorId: string; auditRef: string; reason: string }>;
export type RecoveryCheckpoint = Readonly<{ messageId: string; aggregate: AggregateIdentity; revision: number; bodyDigest: string }>;
export type RecoveryManifest = Readonly<{
  /** References an immutable export made through the consumer owner's public capability. */
  exportRef: string; ownerAuditRef: string; checkpointCount: number; checkpointDigest: string;
  /** Consumer owns effects which survived its restore, including external publication. */
  externalEffectsReviewRef: string;
}>;
export type PaymentRecoveryAuditRecord = Readonly<{
  sessionId: string; revision: number; action: string; audit: RecoveryAudit; at: string; sessionDigest: string;
  cursorState: Pick<PaymentRecoverySession, 'producerScan' | 'uncertaintyScan' | 'consumers' | 'backfills'>;
}>;
type Cursor = { after: string | null; status: 'pending' | 'complete' | 'blocked'; processed: number; issue?: string };
type ConsumerVerification = Cursor & { manifest: RecoveryManifest; digest: string };
export type PaymentRecoverySession = {
  sessionId: string; revision: number; producerNamespace: string; status: 'fenced' | 'resumed';
  externalFence: Readonly<{ deploymentRef: string; fenceRef: string; appliedAt: string }>;
  restore: Readonly<{ horizon: string; uncertainFrom: string; uncertainThrough: string; reason: string }>;
  requiredConsumerIds: string[]; restoredConsumerIds: string[];
  producerScan: Cursor; uncertaintyScan: Cursor;
  consumers: Record<string, ConsumerVerification>; backfills: Record<string, Cursor>;
  archiveReview?: Readonly<{ auditRef: string; sources: readonly string[]; limitations: string }>;
};
type Lane = { revision: number; unresolvedOperationId?: string; recoveryReviewRequired?: string };
type RecoveryConfiguration = { activeRecoverySessionId?: string; producerNamespace?: string };
export class PaymentRecoveryConflictError extends Error {
  constructor() { super('Payment recovery session changed or is not active'); this.name = 'PaymentRecoveryConflictError'; }
}
export class PaymentRecoveryBlockedError extends Error {
  readonly reasons: readonly string[];
  constructor(reasons: readonly string[]) { super(`Payment recovery remains fenced: ${reasons.join(', ')}`); this.name = 'PaymentRecoveryBlockedError'; this.reasons = reasons; }
}

/** Deterministic ordered manifest checksum; use the same chain for owner exports and page submission. */
export function recoveryCheckpointDigest(checkpoints: readonly RecoveryCheckpoint[], previous: string = digest([])): string {
  return checkpoints.reduce((value, checkpoint) => digest({ previous: value, checkpoint }), previous);
}
const cursor = (): Cursor => ({ after: null, status: 'pending', processed: 0 });
function text(value: string, label: string): void {
  if (typeof value !== 'string' || value.length < 1 || value.length > 512) {throw new TypeError(`Invalid recovery ${label}`);}
}
function auditInput(audit: RecoveryAudit): void { text(audit.actorId, 'actor'); text(audit.auditRef, 'audit reference'); text(audit.reason, 'reason'); }
function laneId(operation: PaymentOperation): string { return (operation.subscriptionBindingId !== undefined && operation.subscriptionBindingId !== '') ? `subscription:${operation.subscriptionBindingId}` : `operation:${operation.operationId}`; }
function validCheckpoint(value: RecoveryCheckpoint): void {
  text(value.messageId, 'message identity'); text(value.aggregate.id, 'aggregate identity');
  if (!['transaction', 'subscription'].includes(value.aggregate.type) || !Number.isSafeInteger(value.revision) || value.revision < 1 || !/^[a-f0-9]{64}$/.test(value.bodyDigest)) {throw new TypeError('Invalid recovery checkpoint');}
}

export async function createPostgresPaymentRecovery(options: PaymentRecoveryOptions): Promise<PostgresPaymentRecovery> {
  text(options.producerNamespace, 'producer namespace');
  await assertPostgresDurability(options.database, options.schema);
  const recovery = new PostgresPaymentRecovery(options);
  await recovery.qualify();
  return recovery;
}

/** Each method owns one short owner-local transaction; no consumer SQL or provider I/O occurs here. */
export class PostgresPaymentRecovery {
  private readonly records: PaymentRecords;
  private readonly options: PaymentRecoveryOptions;
  constructor(options: PaymentRecoveryOptions) { this.options = options; this.records = new PaymentRecords(options.schema); }
  private tx<T>(work: (tx: PaymentSqlTransaction) => Promise<T>): Promise<T> { return withPaymentTransaction(this.options.database, work, this.options.timeouts); }
  async qualify(): Promise<void> { await this.tx(async tx => { await this.records.configuration(tx, this.options.scope); }); }

  async begin(input: Readonly<{
    sessionId: string; externalFence: PaymentRecoverySession['externalFence']; restore: PaymentRecoverySession['restore'];
    restoredConsumerIds: readonly string[]; audit: RecoveryAudit;
  }>): Promise<PaymentRecoverySession> {
    text(input.sessionId, 'session identity'); auditInput(input.audit);
    for (const value of Object.values(input.externalFence)) {text(value, 'external fence');}
    for (const value of Object.values(input.restore)) {text(value, 'restore interval');}
    for (const value of [input.externalFence.appliedAt, input.restore.horizon, input.restore.uncertainFrom, input.restore.uncertainThrough]) {
      if (!Number.isFinite(Date.parse(value))) {throw new TypeError('Invalid recovery timestamp');}
    }
    if (Date.parse(input.restore.uncertainFrom) > Date.parse(input.restore.uncertainThrough)) {throw new TypeError('Invalid recovery uncertainty interval');}
    return this.tx(async tx => {
      const config = await this.records.configuration(tx, this.options.scope, true), body = config.body as typeof config.body & RecoveryConfiguration;
      if ((body.activeRecoverySessionId !== undefined && body.activeRecoverySessionId !== '') || await this.records.read(tx, 'recoverySessions', input.sessionId)) {throw new PaymentRecoveryConflictError();}
      if ((body.producerNamespace !== undefined && body.producerNamespace !== '') && body.producerNamespace !== this.options.producerNamespace) {throw new PaymentRecoveryBlockedError(['producer_namespace_mismatch']);}
      const namespace = (await (this.records.read(tx, 'ownerIdentity', 'producerNamespace') as Promise<StoredRecord<string> | undefined>))?.body;
      if ((namespace !== undefined && namespace !== '') && namespace !== this.options.producerNamespace) {throw new PaymentRecoveryBlockedError(['producer_namespace_mismatch']);}
      if (!(namespace !== undefined && namespace !== '')) {await this.records.write(tx, 'ownerIdentity', 'producerNamespace', this.options.producerNamespace);}
      const restoredConsumerIds = [...new Set(input.restoredConsumerIds)].toSorted();
      if (restoredConsumerIds.some(id => !body.consumers.includes(id))) {throw new TypeError('Restored consumer is not registered');}
      const session: PaymentRecoverySession = {
        sessionId: input.sessionId, revision: 1, producerNamespace: this.options.producerNamespace, status: 'fenced',
        externalFence: input.externalFence, restore: input.restore, requiredConsumerIds: body.consumers.toSorted(), restoredConsumerIds,
        producerScan: cursor(), uncertaintyScan: cursor(), consumers: {}, backfills: Object.fromEntries(restoredConsumerIds.map(id => [id, cursor()])),
      };
      body.activeRecoverySessionId = session.sessionId; body.recoveryFenced = true;
      body.fenceAudits.push({ fenced: true, auditRef: input.audit.auditRef, at: new Date().toISOString() });
      await this.records.writeConfiguration(tx, body);
      await this.save(tx, session, input.audit, 'begin');
      return session;
    });
  }

  async read(sessionId: string): Promise<PaymentRecoverySession | undefined> {
    text(sessionId, 'session identity');
    return this.tx(async tx => { await this.records.configuration(tx, this.options.scope); return (await (this.records.read(tx, 'recoverySessions', sessionId) as Promise<StoredRecord<PaymentRecoverySession> | undefined>))?.body; });
  }

  async readAudits(sessionId: string, afterRevision: number, limit: number): Promise<readonly PaymentRecoveryAuditRecord[]> {
    text(sessionId, 'session identity'); assertBatchLimit(limit);
    if (!Number.isSafeInteger(afterRevision) || afterRevision < 0) {throw new TypeError('Invalid recovery audit cursor');}
    return this.tx(async tx => {
      await this.records.configuration(tx, this.options.scope);
      const rows = await tx.query<{ body: PaymentRecoveryAuditRecord }>(`SELECT body FROM ${this.records.sql}.records WHERE kind='recoveryAudits' AND body->>'sessionId'=$1
        AND (body->>'revision')::bigint > $2 ORDER BY id LIMIT $3`, [sessionId, afterRevision, limit]);
      return rows.rows.map(row => row.body);
    });
  }

  /** Call after any additional owner archive import; an old completed scan cannot qualify new rows. */
  async restartChecks(sessionId: string, expectedRevision: number, audit: RecoveryAudit): Promise<PaymentRecoverySession> {
    return this.change(sessionId, expectedRevision, audit, 'restart_checks_after_archive_import', async (_tx, session) => {
      session.producerScan = cursor(); session.uncertaintyScan = cursor(); session.consumers = {};
      session.backfills = Object.fromEntries(session.restoredConsumerIds.map(id => [id, cursor()]));
      delete session.archiveReview;
    });
  }

  async exportCheckpoints(input: Readonly<{ after?: string; limit: number }>): Promise<Readonly<{ checkpoints: readonly RecoveryCheckpoint[]; after: string | null; complete: boolean }>> {
    assertBatchLimit(input.limit);
    return this.tx(async tx => {
      await this.records.configuration(tx, this.options.scope);
      const rows = await tx.query<{ id: string; checkpoint: RecoveryCheckpoint; namespace: string; scope: PaymentScope }>(`SELECT id,
        jsonb_build_object('messageId', body->'messageId', 'aggregate', body->'aggregate', 'revision', body->'revision', 'bodyDigest', body->'bodyDigest') AS checkpoint,
        body->>'producerNamespace' AS namespace, body->'scope' AS scope
        FROM ${this.records.sql}.records WHERE kind = 'evidence' AND ($1::text IS NULL OR id > $1) ORDER BY id LIMIT $2`, [input.after ?? null, input.limit]);
      for (const row of rows.rows) {
        validCheckpoint(row.checkpoint);
        if (row.id !== row.checkpoint.messageId || row.namespace !== this.options.producerNamespace || canonicalJson(row.scope) !== canonicalJson(this.options.scope)) {throw new PaymentRecoveryBlockedError(['producer_identity_mismatch']);}
      }
      return { checkpoints: rows.rows.map(row => row.checkpoint), after: rows.rows.at(-1)?.id ?? input.after ?? null, complete: rows.rows.length < input.limit };
    });
  }

  async readEvidence(messageId: string): Promise<EvidenceMessage | undefined> {
    text(messageId, 'message identity');
    return this.tx(async tx => { await this.records.configuration(tx, this.options.scope); return this.evidence(tx, messageId); });
  }
  private async evidence(tx: PaymentSqlTransaction, messageId: string): Promise<EvidenceMessage | undefined> {
    const result = await tx.query<{ body: EvidenceMessage | null }>(`SELECT CASE WHEN octet_length(body::text) <= 2097152 THEN body ELSE NULL END AS body FROM ${this.records.sql}.records WHERE kind = 'evidence' AND id = $1`, [messageId]);
    const row = result.rows[0];
    if (!row) {return undefined;}
    if (!row.body) {throw new PaymentRecoveryBlockedError(['immutable_message_exceeds_export_bound']);}
    const { bodyDigest, ...body } = row.body;
    try { validCheckpoint(row.body); }
    catch { throw new PaymentRecoveryBlockedError(['invalid_immutable_checkpoint']); }
    if (body.messageId !== messageId || body.messageId !== digest([body.producerNamespace, body.scope, body.aggregate, body.revision]) || body.producerNamespace !== this.options.producerNamespace || canonicalJson(body.scope) !== canonicalJson(this.options.scope) || digest(body) !== bodyDigest) {throw new PaymentRecoveryBlockedError(['immutable_message_body_mismatch']);}
    return row.body;
  }
  private async checkpointIssue(tx: PaymentSqlTransaction, checkpoint: RecoveryCheckpoint): Promise<string | undefined> {
    let message: EvidenceMessage | undefined;
    try { message = await this.evidence(tx, checkpoint.messageId); }
    catch (error) { if (error instanceof PaymentRecoveryBlockedError) {return error.reasons[0];} throw error; }
    if (!message) {return 'missing_immutable_message';}
    if (message.bodyDigest !== checkpoint.bodyDigest || message.revision !== checkpoint.revision || canonicalJson(message.aggregate) !== canonicalJson(checkpoint.aggregate)) {return 'immutable_checkpoint_mismatch';}
    const aggregate = (await (this.records.read(tx, checkpoint.aggregate.type === 'transaction' ? 'transactions' : 'subscriptions', checkpoint.aggregate.id) as Promise<StoredRecord<{ evidenceRevision: number }> | undefined>))?.body;
    if (!aggregate || !Number.isSafeInteger(aggregate.evidenceRevision) || aggregate.evidenceRevision < checkpoint.revision) {return 'producer_counter_regressed';}
    return undefined;
  }

  async scanProducerHistory(sessionId: string, expectedRevision: number, limit: number, audit: RecoveryAudit): Promise<PaymentRecoverySession> {
    assertBatchLimit(limit);
    return this.change(sessionId, expectedRevision, audit, 'scan_producer_history', async (tx, session) => {
      const scan = session.producerScan;
      if (scan.status === 'complete') {return;}
      const rows = await this.records.listKeys(tx, 'evidence', scan.after, limit);
      for (const row of rows) {
        let message: EvidenceMessage | undefined;
        try { message = await this.evidence(tx, row.id); }
        catch (error) {
          if (!(error instanceof PaymentRecoveryBlockedError)) {throw error;}
          scan.status = 'blocked'; scan.issue = error.reasons[0] ?? 'invalid_immutable_message'; return;
        }
        if (!message) {throw new PaymentRecoveryBlockedError(['missing_immutable_message']);}
        const issue = await this.checkpointIssue(tx, message);
        if ((issue !== undefined && issue !== '')) { scan.status = 'blocked'; scan.issue = issue; return; }
      }
      scan.after = rows.at(-1)?.id ?? scan.after; scan.processed += rows.length;
      scan.status = rows.length < limit ? 'complete' : 'pending'; delete scan.issue;
    });
  }

  async startConsumerVerification(sessionId: string, expectedRevision: number, consumerId: string, manifest: RecoveryManifest, audit: RecoveryAudit): Promise<PaymentRecoverySession> {
    text(manifest.exportRef, 'consumer export reference'); text(manifest.ownerAuditRef, 'consumer owner audit'); text(manifest.externalEffectsReviewRef, 'external effects review');
    if (!Number.isSafeInteger(manifest.checkpointCount) || manifest.checkpointCount < 0 || !/^[a-f0-9]{64}$/.test(manifest.checkpointDigest)) {throw new TypeError('Invalid consumer checkpoint manifest');}
    if (manifest.checkpointCount === 0 && manifest.checkpointDigest !== recoveryCheckpointDigest([])) {throw new TypeError('Invalid empty consumer manifest');}
    return this.change(sessionId, expectedRevision, audit, 'start_consumer_verification', async (_tx, session) => {
      if (!session.requiredConsumerIds.includes(consumerId)) {throw new TypeError('Consumer is not required by this recovery session');}
      session.consumers[consumerId] = { ...cursor(), status: manifest.checkpointCount === 0 ? 'complete' : 'pending', manifest, digest: recoveryCheckpointDigest([]) };
    });
  }

  async verifyConsumerPage(sessionId: string, expectedRevision: number, consumerId: string, checkpoints: readonly RecoveryCheckpoint[], audit: RecoveryAudit): Promise<PaymentRecoverySession> {
    assertBatchLimit(checkpoints.length); for (const checkpoint of checkpoints) {validCheckpoint(checkpoint);}
    return this.change(sessionId, expectedRevision, audit, 'verify_consumer_page', async (tx, session) => {
      const verification = session.consumers[consumerId];
      if (!verification || verification.status === 'complete') {throw new PaymentRecoveryConflictError();}
      let after = verification.after;
      for (const checkpoint of checkpoints) {
        if (after !== null && checkpoint.messageId <= after) {throw new TypeError('Consumer checkpoints must be strictly ordered by message identity');}
        after = checkpoint.messageId;
        const issue = await this.checkpointIssue(tx, checkpoint);
        if ((issue !== undefined && issue !== '')) { verification.status = 'blocked'; verification.issue = issue; return; }
      }
      const count = verification.processed + checkpoints.length;
      if (count > verification.manifest.checkpointCount) {throw new TypeError('Consumer checkpoint manifest count exceeded');}
      const checksum = recoveryCheckpointDigest(checkpoints, verification.digest);
      if (count === verification.manifest.checkpointCount && checksum !== verification.manifest.checkpointDigest) {
        verification.status = 'blocked'; verification.issue = 'consumer_manifest_digest_mismatch'; return;
      }
      verification.processed = count; verification.after = after; verification.digest = checksum;
      verification.status = count === verification.manifest.checkpointCount ? 'complete' : 'pending'; delete verification.issue;
    });
  }

  /** Every restored prepared operation could have lost its marker, regardless of intent creation time. */
  async scanUncertainOperations(sessionId: string, expectedRevision: number, limit: number, audit: RecoveryAudit): Promise<PaymentRecoverySession> {
    assertBatchLimit(limit);
    return this.change(sessionId, expectedRevision, audit, 'scan_uncertain_operations', async (tx, session) => {
      const scan = session.uncertaintyScan;
      if (scan.status === 'complete') {return;}
      const rows = await tx.query<{ id: string; body: PaymentOperation }>(`SELECT id, body FROM ${this.records.sql}.records WHERE kind = 'operations' AND ($1::text IS NULL OR id > $1) ORDER BY id LIMIT $2`, [scan.after, limit]);
      await this.records.lock(tx, rows.rows.flatMap(row => [{ kind: 'operations', id: row.id }, { kind: 'lanes', id: laneId(row.body) }, ...((row.body.subscriptionBindingId !== undefined && row.body.subscriptionBindingId !== '') ? [{ kind: 'subscriptionBindings', id: row.body.subscriptionBindingId }] : [])]));
      for (const row of rows.rows) {
        // Re-read after the common lock: a late observation may append evidence during the fence.
        const operation = (await (this.records.read(tx, 'operations', row.id) as Promise<StoredRecord<PaymentOperation> | undefined>))?.body;
        if (!operation || !['prepared', 'dispatch_started', 'outcome_unknown'].includes(operation.state)) {continue;}
        operation.state = 'outcome_unknown'; operation.result = { kind: 'outcome_unknown' }; operation.revision += 1;
        operation.audits.push({ ...audit, action: 'keep_unknown', acceptedDuplicateRisk: false, at: new Date().toISOString() });
        const id = laneId(operation), lane = (await (this.records.read(tx, 'lanes', id) as Promise<StoredRecord<Lane> | undefined>))?.body ?? { revision: 0 };
        lane.revision += 1; lane.recoveryReviewRequired = session.sessionId; lane.unresolvedOperationId ??= operation.operationId;
        await this.records.write(tx, 'operations', row.id, operation); await this.records.write(tx, 'lanes', id, lane);
        await this.records.write(tx, 'recoveryUncertainOperations', canonicalJson([session.sessionId, row.id]), { sessionId: session.sessionId, operationId: row.id, laneId: id, audit });
        await this.records.obligation(tx, { kind: 'prepared', id: row.id }, 'complete');
        await this.records.obligation(tx, { kind: 'unknown', id: row.id });
      }
      scan.after = rows.rows.at(-1)?.id ?? scan.after; scan.processed += rows.rows.length; scan.status = rows.rows.length < limit ? 'complete' : 'pending';
    });
  }

  /** Reopens acknowledgements using the original immutable message and consumer identity. */
  async backfillRestoredConsumer(sessionId: string, expectedRevision: number, consumerId: string, limit: number, audit: RecoveryAudit): Promise<PaymentRecoverySession> {
    assertBatchLimit(limit);
    return this.change(sessionId, expectedRevision, audit, 'backfill_restored_consumer', async (tx, session) => {
      const scan = session.backfills[consumerId]; if (!scan) {throw new TypeError('Consumer was not declared restored');} if (scan.status === 'complete') {return;}
      const rows = await this.records.listKeys(tx, 'evidence', scan.after, limit);
      await this.records.lock(tx, rows.map(row => ({ kind: 'deliveries', id: canonicalJson([row.id, consumerId]) })));
      for (const row of rows) {
        const id = canonicalJson([row.id, consumerId]), previous = (await (this.records.read(tx, 'deliveries', id) as Promise<StoredRecord<Delivery> | undefined>))?.body;
        await this.records.write(tx, 'deliveries', id, { consumerId, messageId: row.id, acknowledged: false, attempts: previous?.attempts ?? 0 });
        await this.records.obligation(tx, { kind: 'delivery', id });
      }
      scan.after = rows.at(-1)?.id ?? scan.after; scan.processed += rows.length; scan.status = rows.length < limit ? 'complete' : 'pending';
    });
  }

  async reviewArchives(sessionId: string, expectedRevision: number, review: NonNullable<PaymentRecoverySession['archiveReview']>, audit: RecoveryAudit): Promise<PaymentRecoverySession> {
    text(review.auditRef, 'archive audit'); text(review.limitations, 'archive limitations'); assertBatchLimit(review.sources.length); for (const source of review.sources) {text(source, 'archive source');}
    return this.change(sessionId, expectedRevision, audit, 'review_archives', async (_tx, session) => { session.archiveReview = review; });
  }

  async resume(sessionId: string, expectedRevision: number, audit: RecoveryAudit): Promise<PaymentRecoverySession> {
    return this.change(sessionId, expectedRevision, audit, 'resume', async (tx, session) => {
      const reasons: string[] = [];
      if (session.producerScan.status !== 'complete') {reasons.push('unfinished_producer_history_scan');}
      if (session.uncertaintyScan.status !== 'complete') {reasons.push('unfinished_uncertainty_scan');}
      if (!session.archiveReview) {reasons.push('missing_archive_review');}
      for (const id of session.requiredConsumerIds) {if (session.consumers[id]?.status !== 'complete') {reasons.push(`unverified_consumer:${id}`);}}
      for (const id of session.restoredConsumerIds) {if (session.backfills[id]?.status !== 'complete') {reasons.push(`unfinished_backfill:${id}`);}}
      const config = await this.records.configuration(tx, this.options.scope, true), body = config.body as typeof config.body & RecoveryConfiguration;
      if (canonicalJson(body.consumers.toSorted()) !== canonicalJson(session.requiredConsumerIds)) {reasons.push('required_consumers_changed');}
      if (reasons.length > 0) {throw new PaymentRecoveryBlockedError(reasons);}
      body.recoveryFenced = false; delete body.activeRecoverySessionId;
      body.fenceAudits.push({ fenced: false, auditRef: audit.auditRef, at: new Date().toISOString() });
      await this.records.writeConfiguration(tx, body);
      session.status = 'resumed';
    });
  }

  /** Release only after owner resolutions have made every operation in the lane terminal. */
  async releaseReviewedLane(sessionId: string, operationId: string, expectedLaneRevision: number, audit: RecoveryAudit): Promise<void> {
    auditInput(audit);
    await this.tx(async tx => {
      await this.records.configuration(tx, this.options.scope);
      const session = (await (this.records.read(tx, 'recoverySessions', sessionId) as Promise<StoredRecord<PaymentRecoverySession> | undefined>))?.body;
      const operation = (await (this.records.read(tx, 'operations', operationId) as Promise<StoredRecord<PaymentOperation> | undefined>))?.body;
      if (!session || session.status !== 'resumed' || !operation) {throw new PaymentRecoveryConflictError();}
      const id = laneId(operation);
      await this.records.lock(tx, [{ kind: 'lanes', id }, ...((operation.subscriptionBindingId !== undefined && operation.subscriptionBindingId !== '') ? [{ kind: 'subscriptionBindings', id: operation.subscriptionBindingId }] : [])]);
      const lane = (await (this.records.read(tx, 'lanes', id) as Promise<StoredRecord<Lane> | undefined>))?.body;
      if (!lane || lane.revision !== expectedLaneRevision || lane.recoveryReviewRequired !== sessionId) {throw new PaymentRecoveryConflictError();}
      const unresolved = await tx.query(`SELECT 1 FROM ${this.records.sql}.records WHERE kind = 'operations' AND body->>'state' IN ('prepared','dispatch_started','outcome_unknown')
        AND CASE WHEN $1::text IS NULL THEN id = $2 ELSE body->>'subscriptionBindingId' = $1 END LIMIT 1`, [operation.subscriptionBindingId ?? null, operationId]);
      if (unresolved.rows.length > 0) {throw new PaymentRecoveryBlockedError(['lane_has_unresolved_operations']);}
      lane.revision += 1; delete lane.recoveryReviewRequired; delete lane.unresolvedOperationId;
      await this.records.write(tx, 'lanes', id, lane);
      await this.records.write(tx, 'recoveryLaneAudits', canonicalJson([sessionId, id, lane.revision]), { sessionId, laneId: id, laneRevision: lane.revision, audit, at: new Date().toISOString() });
    });
  }

  private async change(sessionId: string, expectedRevision: number, audit: RecoveryAudit, action: string, work: (tx: PaymentSqlTransaction, session: PaymentRecoverySession) => Promise<void>): Promise<PaymentRecoverySession> {
    text(sessionId, 'session identity'); auditInput(audit);
    return this.tx(async tx => {
      const config = await this.records.configuration(tx, this.options.scope, true), body = config.body as typeof config.body & RecoveryConfiguration;
      const session = (await (this.records.read(tx, 'recoverySessions', sessionId) as Promise<StoredRecord<PaymentRecoverySession> | undefined>))?.body;
      if (!body.recoveryFenced || body.activeRecoverySessionId !== sessionId || !session || session.status !== 'fenced' || session.revision !== expectedRevision || session.producerNamespace !== this.options.producerNamespace) {throw new PaymentRecoveryConflictError();}
      await work(tx, session); session.revision += 1; await this.save(tx, session, audit, action); return session;
    });
  }
  private async save(tx: PaymentSqlTransaction, session: PaymentRecoverySession, audit: RecoveryAudit, action: string): Promise<void> {
    await this.records.write(tx, 'recoverySessions', session.sessionId, session);
    await this.records.write(tx, 'recoveryAudits', `${session.sessionId}:${String(session.revision).padStart(16, '0')}`, {
      sessionId: session.sessionId, revision: session.revision, action, audit, at: new Date().toISOString(), sessionDigest: digest(session),
      cursorState: { producerScan: session.producerScan, uncertaintyScan: session.uncertaintyScan, consumers: session.consumers, backfills: session.backfills },
    });
  }
}
