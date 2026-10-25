import { canonicalJson } from "@agent-teams/payments-core";
import type { EvidenceMessage } from "@agent-teams/payments-core";
import type { PaymentOperation } from "@agent-teams/payments-core/store";
import { assertPostgresDurability, withPaymentTransaction } from "./database.js";
import type { PaymentSqlTransaction } from "./database.js";
import { assertBatchLimit, PaymentRecords } from "./records.js";
import type { StoredRecord } from "./records.js";
import {
  PaymentRecoveryConflictError,
  PaymentRecoveryBlockedError,
  text,
  auditInput,
  laneId,
  validateBegin,
  validateRecoveryCheckpoints,
  createRecoverySession,
  validateConsumerManifest,
  initializeConsumerVerification,
  validateArchiveReview,
  resumeReasons,
  validateRecoveryAuditCursor,
  restartRecoveryChecks,
  assertRecoveryResume,
  assertReviewedRecoveryLane,
  assertRecoveryNamespace,
  recoveryAuditRecord,
  recoveryOperationKeys,
  assertActiveRecoverySession,
  recordRecoveryOperationUncertainty,
  markRecoveryLane,
  assertResumedRecoveryOperation,
} from "./recovery-model.js";
import type {
  PaymentRecoveryOptions,
  RecoveryAudit,
  RecoveryCheckpoint,
  RecoveryManifest,
  PaymentRecoveryAuditRecord,
  PaymentRecoverySession,
  Lane,
  RecoveryConfiguration,
} from "./recovery-model.js";
import {
  readRecoveryAudits,
  exportRecoveryCheckpoints,
  readRecoveryEvidence,
  recoveryCheckpointIssue,
  scanRecoveryProducerHistory,
  verifyRecoveryConsumerPage,
  backfillRecoveryConsumer,
} from "./recovery-evidence.js";
export type {
  PaymentRecoveryOptions,
  RecoveryAudit,
  RecoveryCheckpoint,
  RecoveryManifest,
  PaymentRecoveryAuditRecord,
  PaymentRecoverySession,
} from "./recovery-model.js";
export {
  PaymentRecoveryConflictError,
  PaymentRecoveryBlockedError,
  recoveryCheckpointDigest,
} from "./recovery-model.js";

export async function createPostgresPaymentRecovery(
  options: PaymentRecoveryOptions,
): Promise<PostgresPaymentRecovery> {
  text(options.producerNamespace, "producer namespace");
  await assertPostgresDurability(options.database, options.schema);
  const recovery = new PostgresPaymentRecovery(options);
  await recovery.qualify();
  return recovery;
}

/** Each method owns one short owner-local transaction; no consumer SQL or provider I/O occurs here. */
export class PostgresPaymentRecovery {
  private readonly records: PaymentRecords;
  private readonly options: PaymentRecoveryOptions;
  constructor(options: PaymentRecoveryOptions) {
    this.options = options;
    this.records = new PaymentRecords(options.schema);
  }
  private tx<T>(work: (tx: PaymentSqlTransaction) => Promise<T>): Promise<T> {
    return withPaymentTransaction(this.options.database, work, this.options.timeouts);
  }
  async qualify(): Promise<void> {
    await this.tx(async (tx) => {
      await this.records.configuration(tx, this.options.scope);
    });
  }

  async begin(
    input: Readonly<{
      sessionId: string;
      externalFence: PaymentRecoverySession["externalFence"];
      restore: PaymentRecoverySession["restore"];
      restoredConsumerIds: readonly string[];
      audit: RecoveryAudit;
    }>,
  ): Promise<PaymentRecoverySession> {
    validateBegin(input);
    return this.tx(async (tx) => {
      const config = await this.records.configuration(tx, this.options.scope, true),
        body = config.body as typeof config.body & RecoveryConfiguration;
      if (
        (body.activeRecoverySessionId !== undefined && body.activeRecoverySessionId !== "") ||
        (await this.records.read(tx, "recoverySessions", input.sessionId))
      ) {
        throw new PaymentRecoveryConflictError();
      }
      assertRecoveryNamespace(
        () => body.producerNamespace,
        () => this.options.producerNamespace,
      );
      const namespace = (
        await (this.records.read(tx, "ownerIdentity", "producerNamespace") as Promise<
          StoredRecord<string> | undefined
        >)
      )?.body;
      assertRecoveryNamespace(
        () => namespace,
        () => this.options.producerNamespace,
      );
      if (!(namespace !== undefined && namespace !== "")) {
        await this.records.write(
          tx,
          "ownerIdentity",
          "producerNamespace",
          this.options.producerNamespace,
        );
      }
      const session = createRecoverySession(
        input,
        () => body.consumers,
        () => this.options.producerNamespace,
      );
      body.activeRecoverySessionId = session.sessionId;
      body.recoveryFenced = true;
      body.fenceAudits.push({
        fenced: true,
        auditRef: input.audit.auditRef,
        at: new Date().toISOString(),
      });
      await this.records.writeConfiguration(tx, body);
      await this.save(tx, session, input.audit, "begin");
      return session;
    });
  }

  async read(sessionId: string): Promise<PaymentRecoverySession | undefined> {
    text(sessionId, "session identity");
    return this.tx(async (tx) => {
      await this.records.configuration(tx, this.options.scope);
      return (
        await (this.records.read(tx, "recoverySessions", sessionId) as Promise<
          StoredRecord<PaymentRecoverySession> | undefined
        >)
      )?.body;
    });
  }

  async readAudits(
    sessionId: string,
    afterRevision: number,
    limit: number,
  ): Promise<readonly PaymentRecoveryAuditRecord[]> {
    validateRecoveryAuditCursor(sessionId, afterRevision, limit);
    return this.tx(async (tx) =>
      readRecoveryAudits(
        tx,
        { sessionId, afterRevision, limit },
        () => this.records,
        () => this.options,
      ),
    );
  }

  /** Call after any additional owner archive import; an old completed scan cannot qualify new rows. */
  async restartChecks(
    sessionId: string,
    expectedRevision: number,
    audit: RecoveryAudit,
  ): Promise<PaymentRecoverySession> {
    return this.change(
      sessionId,
      expectedRevision,
      audit,
      "restart_checks_after_archive_import",
      async (_tx, session) => {
        restartRecoveryChecks(session);
      },
    );
  }

  async exportCheckpoints(input: Readonly<{ after?: string; limit: number }>): Promise<
    Readonly<{
      checkpoints: readonly RecoveryCheckpoint[];
      after: string | null;
      complete: boolean;
    }>
  > {
    assertBatchLimit(input.limit);
    return this.tx(async (tx) =>
      exportRecoveryCheckpoints(
        tx,
        input,
        () => this.records,
        () => this.options,
      ),
    );
  }

  async readEvidence(messageId: string): Promise<EvidenceMessage | undefined> {
    text(messageId, "message identity");
    return this.tx(async (tx) => {
      await this.records.configuration(tx, this.options.scope);
      return this.evidence(tx, messageId);
    });
  }
  private async evidence(
    tx: PaymentSqlTransaction,
    messageId: string,
  ): Promise<EvidenceMessage | undefined> {
    return readRecoveryEvidence(
      tx,
      messageId,
      () => this.records,
      () => this.options,
    );
  }
  private async checkpointIssue(
    tx: PaymentSqlTransaction,
    checkpoint: RecoveryCheckpoint,
  ): Promise<string | undefined> {
    return recoveryCheckpointIssue(
      tx,
      checkpoint,
      () => this.records,
      (readTx, messageId) => this.evidence(readTx, messageId),
    );
  }

  async scanProducerHistory(
    sessionId: string,
    expectedRevision: number,
    limit: number,
    audit: RecoveryAudit,
  ): Promise<PaymentRecoverySession> {
    assertBatchLimit(limit);
    return this.change(
      sessionId,
      expectedRevision,
      audit,
      "scan_producer_history",
      async (tx, session) =>
        scanRecoveryProducerHistory(
          tx,
          { session, limit },
          () => this.records,
          (readTx, messageId) => this.evidence(readTx, messageId),
          (readTx, checkpoint) => this.checkpointIssue(readTx, checkpoint),
        ),
    );
  }

  async startConsumerVerification(
    sessionId: string,
    expectedRevision: number,
    consumerId: string,
    manifest: RecoveryManifest,
    audit: RecoveryAudit,
  ): Promise<PaymentRecoverySession> {
    validateConsumerManifest(manifest);
    return this.change(
      sessionId,
      expectedRevision,
      audit,
      "start_consumer_verification",
      async (_tx, session) => {
        initializeConsumerVerification(session, consumerId, manifest);
      },
    );
  }

  async verifyConsumerPage(
    sessionId: string,
    expectedRevision: number,
    consumerId: string,
    checkpoints: readonly RecoveryCheckpoint[],
    audit: RecoveryAudit,
  ): Promise<PaymentRecoverySession> {
    validateRecoveryCheckpoints(checkpoints);
    return this.change(
      sessionId,
      expectedRevision,
      audit,
      "verify_consumer_page",
      async (tx, session) =>
        verifyRecoveryConsumerPage(tx, session, consumerId, checkpoints, (readTx, checkpoint) =>
          this.checkpointIssue(readTx, checkpoint),
        ),
    );
  }

  /** Every restored prepared operation could have lost its marker, regardless of intent creation time. */
  async scanUncertainOperations(
    sessionId: string,
    expectedRevision: number,
    limit: number,
    audit: RecoveryAudit,
  ): Promise<PaymentRecoverySession> {
    assertBatchLimit(limit);
    return this.change(
      sessionId,
      expectedRevision,
      audit,
      "scan_uncertain_operations",
      async (tx, session) => {
        const scan = session.uncertaintyScan;
        if (scan.status === "complete") {
          return;
        }
        const rows = await tx.query<{ id: string; body: PaymentOperation }>(
          `SELECT id, body FROM ${this.records.sql}.records WHERE kind = 'operations' AND ($1::text IS NULL OR id > $1) ORDER BY id LIMIT $2`,
          [scan.after, limit],
        );
        await this.records.lock(tx, recoveryOperationKeys(rows.rows));
        for (const row of rows.rows) {
          // Re-read after the common lock: a late observation may append evidence during the fence.
          const operation = (
            await (this.records.read(tx, "operations", row.id) as Promise<
              StoredRecord<PaymentOperation> | undefined
            >)
          )?.body;
          if (
            !operation ||
            !["prepared", "dispatch_started", "outcome_unknown"].includes(operation.state)
          ) {
            continue;
          }
          recordRecoveryOperationUncertainty(operation, audit);
          const id = laneId(operation),
            lane = (
              await (this.records.read(tx, "lanes", id) as Promise<StoredRecord<Lane> | undefined>)
            )?.body ?? { revision: 0 };
          markRecoveryLane(lane, session, operation);
          await this.records.write(tx, "operations", row.id, operation);
          await this.records.write(tx, "lanes", id, lane);
          await this.records.write(
            tx,
            "recoveryUncertainOperations",
            canonicalJson([session.sessionId, row.id]),
            { sessionId: session.sessionId, operationId: row.id, laneId: id, audit },
          );
          await this.records.obligation(tx, { kind: "prepared", id: row.id }, "complete");
          await this.records.obligation(tx, { kind: "unknown", id: row.id });
        }
        scan.after = rows.rows.at(-1)?.id ?? scan.after;
        scan.processed += rows.rows.length;
        scan.status = rows.rows.length < limit ? "complete" : "pending";
      },
    );
  }

  /** Reopens acknowledgements using the original immutable message and consumer identity. */
  async backfillRestoredConsumer(
    sessionId: string,
    expectedRevision: number,
    consumerId: string,
    limit: number,
    audit: RecoveryAudit,
  ): Promise<PaymentRecoverySession> {
    assertBatchLimit(limit);
    return this.change(
      sessionId,
      expectedRevision,
      audit,
      "backfill_restored_consumer",
      async (tx, session) =>
        backfillRecoveryConsumer(tx, session, consumerId, limit, () => this.records),
    );
  }

  async reviewArchives(
    sessionId: string,
    expectedRevision: number,
    review: NonNullable<PaymentRecoverySession["archiveReview"]>,
    audit: RecoveryAudit,
  ): Promise<PaymentRecoverySession> {
    validateArchiveReview(review);
    return this.change(
      sessionId,
      expectedRevision,
      audit,
      "review_archives",
      async (_tx, session) => {
        session.archiveReview = review;
      },
    );
  }

  async resume(
    sessionId: string,
    expectedRevision: number,
    audit: RecoveryAudit,
  ): Promise<PaymentRecoverySession> {
    return this.change(sessionId, expectedRevision, audit, "resume", async (tx, session) => {
      const reasons = resumeReasons(session);
      const config = await this.records.configuration(tx, this.options.scope, true),
        body = config.body as typeof config.body & RecoveryConfiguration;
      assertRecoveryResume(reasons, () => body.consumers, session);
      body.recoveryFenced = false;
      delete body.activeRecoverySessionId;
      body.fenceAudits.push({
        fenced: false,
        auditRef: audit.auditRef,
        at: new Date().toISOString(),
      });
      await this.records.writeConfiguration(tx, body);
      session.status = "resumed";
    });
  }

  /** Release only after owner resolutions have made every operation in the lane terminal. */
  async releaseReviewedLane(
    sessionId: string,
    operationId: string,
    expectedLaneRevision: number,
    audit: RecoveryAudit,
  ): Promise<void> {
    auditInput(audit);
    await this.tx(async (tx) => {
      await this.records.configuration(tx, this.options.scope);
      const session = (
        await (this.records.read(tx, "recoverySessions", sessionId) as Promise<
          StoredRecord<PaymentRecoverySession> | undefined
        >)
      )?.body;
      const operation = (
        await (this.records.read(tx, "operations", operationId) as Promise<
          StoredRecord<PaymentOperation> | undefined
        >)
      )?.body;
      assertResumedRecoveryOperation(session, operation);
      const id = laneId(operation);
      await this.records.lock(tx, [
        { kind: "lanes", id },
        ...(operation.subscriptionBindingId !== undefined && operation.subscriptionBindingId !== ""
          ? [{ kind: "subscriptionBindings", id: operation.subscriptionBindingId }]
          : []),
      ]);
      const lane = (
        await (this.records.read(tx, "lanes", id) as Promise<StoredRecord<Lane> | undefined>)
      )?.body;
      assertReviewedRecoveryLane(lane, expectedLaneRevision, sessionId);
      const unresolved = await tx.query(
        `SELECT 1 FROM ${this.records.sql}.records WHERE kind = 'operations' AND body->>'state' IN ('prepared','dispatch_started','outcome_unknown')
        AND CASE WHEN $1::text IS NULL THEN id = $2 ELSE body->>'subscriptionBindingId' = $1 END LIMIT 1`,
        [operation.subscriptionBindingId ?? null, operationId],
      );
      if (unresolved.rows.length > 0) {
        throw new PaymentRecoveryBlockedError(["lane_has_unresolved_operations"]);
      }
      lane.revision += 1;
      delete lane.recoveryReviewRequired;
      delete lane.unresolvedOperationId;
      await this.records.write(tx, "lanes", id, lane);
      await this.records.write(
        tx,
        "recoveryLaneAudits",
        canonicalJson([sessionId, id, lane.revision]),
        { sessionId, laneId: id, laneRevision: lane.revision, audit, at: new Date().toISOString() },
      );
    });
  }

  private async change(
    sessionId: string,
    expectedRevision: number,
    audit: RecoveryAudit,
    action: string,
    work: (tx: PaymentSqlTransaction, session: PaymentRecoverySession) => Promise<void>,
  ): Promise<PaymentRecoverySession> {
    text(sessionId, "session identity");
    auditInput(audit);
    return this.tx(async (tx) => {
      const config = await this.records.configuration(tx, this.options.scope, true),
        body = config.body as typeof config.body & RecoveryConfiguration;
      const session = (
        await (this.records.read(tx, "recoverySessions", sessionId) as Promise<
          StoredRecord<PaymentRecoverySession> | undefined
        >)
      )?.body;
      assertActiveRecoverySession(
        body,
        session,
        sessionId,
        expectedRevision,
        () => this.options.producerNamespace,
      );
      await work(tx, session);
      session.revision += 1;
      await this.save(tx, session, audit, action);
      return session;
    });
  }
  private async save(
    tx: PaymentSqlTransaction,
    session: PaymentRecoverySession,
    audit: RecoveryAudit,
    action: string,
  ): Promise<void> {
    await this.records.write(tx, "recoverySessions", session.sessionId, session);
    await this.records.write(
      tx,
      "recoveryAudits",
      `${session.sessionId}:${String(session.revision).padStart(16, "0")}`,
      recoveryAuditRecord(session, audit, action),
    );
  }
}
