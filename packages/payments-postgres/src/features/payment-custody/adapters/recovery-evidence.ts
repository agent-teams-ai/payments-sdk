import { canonicalJson, digest } from "@agent-teams/payments-core";
import type { EvidenceMessage, PaymentScope } from "@agent-teams/payments-core";
import type { Delivery } from "@agent-teams/payments-core/store";
import type { PaymentSqlTransaction } from "./database.js";
import type { PaymentRecords, StoredRecord } from "./records.js";
import {
  PaymentRecoveryConflictError,
  PaymentRecoveryBlockedError,
  recoveryCheckpointDigest,
  validCheckpoint,
} from "./recovery-model.js";
import type {
  PaymentRecoveryOptions,
  PaymentRecoveryAuditRecord,
  RecoveryCheckpoint,
  PaymentRecoverySession,
} from "./recovery-model.js";

export async function readRecoveryAudits(
  tx: PaymentSqlTransaction,
  {
    sessionId,
    afterRevision,
    limit,
  }: Readonly<{ sessionId: string; afterRevision: number; limit: number }>,
  records: () => PaymentRecords,
  options: () => PaymentRecoveryOptions,
): Promise<readonly PaymentRecoveryAuditRecord[]> {
  await records().configuration(tx, options().scope);
  const rows = await tx.query<{ body: PaymentRecoveryAuditRecord }>(
    `SELECT body FROM ${records().sql}.records WHERE kind='recoveryAudits' AND body->>'sessionId'=$1
        AND (body->>'revision')::bigint > $2 ORDER BY id LIMIT $3`,
    [sessionId, afterRevision, limit],
  );
  return rows.rows.map((row) => row.body);
}

export async function exportRecoveryCheckpoints(
  tx: PaymentSqlTransaction,
  input: Readonly<{ after?: string; limit: number }>,
  records: () => PaymentRecords,
  options: () => PaymentRecoveryOptions,
): Promise<
  Readonly<{ checkpoints: readonly RecoveryCheckpoint[]; after: string | null; complete: boolean }>
> {
  await records().configuration(tx, options().scope);
  const rows = await tx.query<{
    id: string;
    checkpoint: RecoveryCheckpoint;
    namespace: string;
    scope: PaymentScope;
  }>(
    `SELECT id,
        jsonb_build_object('messageId', body->'messageId', 'aggregate', body->'aggregate', 'revision', body->'revision', 'bodyDigest', body->'bodyDigest') AS checkpoint,
        body->>'producerNamespace' AS namespace, body->'scope' AS scope
        FROM ${records().sql}.records WHERE kind = 'evidence' AND ($1::text IS NULL OR id > $1) ORDER BY id LIMIT $2`,
    [input.after ?? null, input.limit],
  );
  for (const row of rows.rows) {
    validCheckpoint(row.checkpoint);
    if (
      row.id !== row.checkpoint.messageId ||
      row.namespace !== options().producerNamespace ||
      canonicalJson(row.scope) !== canonicalJson(options().scope)
    ) {
      throw new PaymentRecoveryBlockedError(["producer_identity_mismatch"]);
    }
  }
  return {
    checkpoints: rows.rows.map((row) => row.checkpoint),
    after: rows.rows.at(-1)?.id ?? input.after ?? null,
    complete: rows.rows.length < input.limit,
  };
}

export async function readRecoveryEvidence(
  tx: PaymentSqlTransaction,
  messageId: string,
  records: () => PaymentRecords,
  options: () => PaymentRecoveryOptions,
): Promise<EvidenceMessage | undefined> {
  const result = await tx.query<{ body: EvidenceMessage | null }>(
    `SELECT CASE WHEN octet_length(body::text) <= 2097152 THEN body ELSE NULL END AS body FROM ${records().sql}.records WHERE kind = 'evidence' AND id = $1`,
    [messageId],
  );
  const row = result.rows[0];
  if (!row) {
    return undefined;
  }
  if (!row.body) {
    throw new PaymentRecoveryBlockedError(["immutable_message_exceeds_export_bound"]);
  }
  const { bodyDigest, ...body } = row.body;
  try {
    validCheckpoint(row.body);
  } catch {
    throw new PaymentRecoveryBlockedError(["invalid_immutable_checkpoint"]);
  }
  if (
    body.messageId !== messageId ||
    body.messageId !==
      digest([body.producerNamespace, body.scope, body.aggregate, body.revision]) ||
    body.producerNamespace !== options().producerNamespace ||
    canonicalJson(body.scope) !== canonicalJson(options().scope) ||
    digest(body) !== bodyDigest
  ) {
    throw new PaymentRecoveryBlockedError(["immutable_message_body_mismatch"]);
  }
  return row.body;
}

export async function recoveryCheckpointIssue(
  tx: PaymentSqlTransaction,
  checkpoint: RecoveryCheckpoint,
  records: () => PaymentRecords,
  readEvidence: (
    tx: PaymentSqlTransaction,
    messageId: string,
  ) => Promise<EvidenceMessage | undefined>,
): Promise<string | undefined> {
  let message: EvidenceMessage | undefined;
  try {
    message = await readEvidence(tx, checkpoint.messageId);
  } catch (error) {
    if (error instanceof PaymentRecoveryBlockedError) {
      return error.reasons[0];
    }
    throw error;
  }
  if (!message) {
    return "missing_immutable_message";
  }
  if (
    message.bodyDigest !== checkpoint.bodyDigest ||
    message.revision !== checkpoint.revision ||
    canonicalJson(message.aggregate) !== canonicalJson(checkpoint.aggregate)
  ) {
    return "immutable_checkpoint_mismatch";
  }
  const aggregate = (
    await (records().read(
      tx,
      checkpoint.aggregate.type === "transaction" ? "transactions" : "subscriptions",
      checkpoint.aggregate.id,
    ) as Promise<StoredRecord<{ evidenceRevision: number }> | undefined>)
  )?.body;
  if (
    !aggregate ||
    !Number.isSafeInteger(aggregate.evidenceRevision) ||
    aggregate.evidenceRevision < checkpoint.revision
  ) {
    return "producer_counter_regressed";
  }
  return undefined;
}

export async function scanRecoveryProducerHistory(
  tx: PaymentSqlTransaction,
  { session, limit }: Readonly<{ session: PaymentRecoverySession; limit: number }>,
  records: () => PaymentRecords,
  readEvidence: (
    tx: PaymentSqlTransaction,
    messageId: string,
  ) => Promise<EvidenceMessage | undefined>,
  readCheckpointIssue: (
    tx: PaymentSqlTransaction,
    checkpoint: RecoveryCheckpoint,
  ) => Promise<string | undefined>,
): Promise<void> {
  const scan = session.producerScan;
  if (scan.status === "complete") {
    return;
  }
  const rows = await records().listKeys(tx, "evidence", scan.after, limit);
  for (const row of rows) {
    let message: EvidenceMessage | undefined;
    try {
      message = await readEvidence(tx, row.id);
    } catch (error) {
      if (!(error instanceof PaymentRecoveryBlockedError)) {
        throw error;
      }
      scan.status = "blocked";
      scan.issue = error.reasons[0] ?? "invalid_immutable_message";
      return;
    }
    if (!message) {
      throw new PaymentRecoveryBlockedError(["missing_immutable_message"]);
    }
    const issue = await readCheckpointIssue(tx, message);
    if (issue !== undefined && issue !== "") {
      scan.status = "blocked";
      scan.issue = issue;
      return;
    }
  }
  scan.after = rows.at(-1)?.id ?? scan.after;
  scan.processed += rows.length;
  scan.status = rows.length < limit ? "complete" : "pending";
  delete scan.issue;
}

export async function verifyRecoveryConsumerPage(
  tx: PaymentSqlTransaction,
  session: PaymentRecoverySession,
  consumerId: string,
  checkpoints: readonly RecoveryCheckpoint[],
  readCheckpointIssue: (
    tx: PaymentSqlTransaction,
    checkpoint: RecoveryCheckpoint,
  ) => Promise<string | undefined>,
): Promise<void> {
  const verification = session.consumers[consumerId];
  if (!verification || verification.status === "complete") {
    throw new PaymentRecoveryConflictError();
  }
  let after = verification.after;
  for (const checkpoint of checkpoints) {
    if (after !== null && checkpoint.messageId <= after) {
      throw new TypeError("Consumer checkpoints must be strictly ordered by message identity");
    }
    after = checkpoint.messageId;
    const issue = await readCheckpointIssue(tx, checkpoint);
    if (issue !== undefined && issue !== "") {
      verification.status = "blocked";
      verification.issue = issue;
      return;
    }
  }
  const count = verification.processed + checkpoints.length;
  if (count > verification.manifest.checkpointCount) {
    throw new TypeError("Consumer checkpoint manifest count exceeded");
  }
  const checksum = recoveryCheckpointDigest(checkpoints, verification.digest);
  if (
    count === verification.manifest.checkpointCount &&
    checksum !== verification.manifest.checkpointDigest
  ) {
    verification.status = "blocked";
    verification.issue = "consumer_manifest_digest_mismatch";
    return;
  }
  verification.processed = count;
  verification.after = after;
  verification.digest = checksum;
  verification.status = count === verification.manifest.checkpointCount ? "complete" : "pending";
  delete verification.issue;
}

export async function backfillRecoveryConsumer(
  tx: PaymentSqlTransaction,
  session: PaymentRecoverySession,
  consumerId: string,
  limit: number,
  records: () => PaymentRecords,
): Promise<void> {
  const scan = session.backfills[consumerId];
  if (!scan) {
    throw new TypeError("Consumer was not declared restored");
  }
  if (scan.status === "complete") {
    return;
  }
  const rows = await records().listKeys(tx, "evidence", scan.after, limit);
  await records().lock(
    tx,
    rows.map((row) => ({ kind: "deliveries", id: canonicalJson([row.id, consumerId]) })),
  );
  for (const row of rows) {
    const id = canonicalJson([row.id, consumerId]),
      previous = (
        await (records().read(tx, "deliveries", id) as Promise<StoredRecord<Delivery> | undefined>)
      )?.body;
    await records().write(tx, "deliveries", id, {
      consumerId,
      messageId: row.id,
      acknowledged: false,
      attempts: previous?.attempts ?? 0,
    });
    await records().obligation(tx, { kind: "delivery", id });
  }
  scan.after = rows.at(-1)?.id ?? scan.after;
  scan.processed += rows.length;
  scan.status = rows.length < limit ? "complete" : "pending";
}
