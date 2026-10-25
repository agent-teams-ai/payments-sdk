import { canonicalJson, digest } from "@agent-teams/payments-core";

import type { PaymentOperation } from "@agent-teams/payments-core/store";

import { assertBatchLimit } from "./records.js";
import type { OwnerConfiguration, RecordKey } from "./records.js";
import type { PostgresPaymentRecovery } from "./recovery.js";
import {
  PaymentRecoveryConflictError,
  PaymentRecoveryBlockedError,
  recoveryCheckpointDigest,
} from "./recovery-model.js";
import type {
  RecoveryAudit,
  RecoveryCheckpoint,
  RecoveryManifest,
  PaymentRecoveryAuditRecord,
  PaymentRecoverySession,
} from "./recovery-model.js";
type Cursor = PaymentRecoverySession["producerScan"];

export type Lane = {
  revision: number;
  unresolvedOperationId?: string;
  recoveryReviewRequired?: string;
};

export type RecoveryConfiguration = {
  activeRecoverySessionId?: string;
  producerNamespace?: string;
};

export const cursor = (): Cursor => ({ after: null, status: "pending", processed: 0 });

export function text(value: string, label: string): void {
  if (typeof value !== "string" || value.length < 1 || value.length > 512) {
    throw new TypeError(`Invalid recovery ${label}`);
  }
}

export function auditInput(audit: RecoveryAudit): void {
  text(audit.actorId, "actor");
  text(audit.auditRef, "audit reference");
  text(audit.reason, "reason");
}

export function laneId(operation: PaymentOperation): string {
  return operation.subscriptionBindingId !== undefined && operation.subscriptionBindingId !== ""
    ? `subscription:${operation.subscriptionBindingId}`
    : `operation:${operation.operationId}`;
}

export function validCheckpoint(value: RecoveryCheckpoint): void {
  text(value.messageId, "message identity");
  text(value.aggregate.id, "aggregate identity");
  if (
    !["transaction", "subscription"].includes(value.aggregate.type) ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 1 ||
    !/^[a-f0-9]{64}$/.test(value.bodyDigest)
  ) {
    throw new TypeError("Invalid recovery checkpoint");
  }
}

export function validateBegin(input: Parameters<PostgresPaymentRecovery["begin"]>[0]): void {
  text(input.sessionId, "session identity");
  auditInput(input.audit);
  for (const value of Object.values(input.externalFence)) {
    text(value, "external fence");
  }
  for (const value of Object.values(input.restore)) {
    text(value, "restore interval");
  }
  for (const value of [
    input.externalFence.appliedAt,
    input.restore.horizon,
    input.restore.uncertainFrom,
    input.restore.uncertainThrough,
  ]) {
    if (!Number.isFinite(Date.parse(value))) {
      throw new TypeError("Invalid recovery timestamp");
    }
  }
  if (Date.parse(input.restore.uncertainFrom) > Date.parse(input.restore.uncertainThrough)) {
    throw new TypeError("Invalid recovery uncertainty interval");
  }
}

export function createRecoverySession(
  input: Parameters<PostgresPaymentRecovery["begin"]>[0],
  consumers: () => string[],
  producerNamespace: () => string,
): PaymentRecoverySession {
  const restoredConsumerIds = [...new Set(input.restoredConsumerIds)].toSorted();
  if (restoredConsumerIds.some((id) => !consumers().includes(id))) {
    throw new TypeError("Restored consumer is not registered");
  }
  const session: PaymentRecoverySession = {
    sessionId: input.sessionId,
    revision: 1,
    producerNamespace: producerNamespace(),
    status: "fenced",
    externalFence: input.externalFence,
    restore: input.restore,
    requiredConsumerIds: consumers().toSorted(),
    restoredConsumerIds,
    producerScan: cursor(),
    uncertaintyScan: cursor(),
    consumers: {},
    backfills: Object.fromEntries(restoredConsumerIds.map((id) => [id, cursor()])),
  };
  return session;
}

export function validateConsumerManifest(manifest: RecoveryManifest): void {
  text(manifest.exportRef, "consumer export reference");
  text(manifest.ownerAuditRef, "consumer owner audit");
  text(manifest.externalEffectsReviewRef, "external effects review");
  if (
    !Number.isSafeInteger(manifest.checkpointCount) ||
    manifest.checkpointCount < 0 ||
    !/^[a-f0-9]{64}$/.test(manifest.checkpointDigest)
  ) {
    throw new TypeError("Invalid consumer checkpoint manifest");
  }
  if (
    manifest.checkpointCount === 0 &&
    manifest.checkpointDigest !== recoveryCheckpointDigest([])
  ) {
    throw new TypeError("Invalid empty consumer manifest");
  }
}

export function initializeConsumerVerification(
  session: PaymentRecoverySession,
  consumerId: string,
  manifest: RecoveryManifest,
): void {
  if (!session.requiredConsumerIds.includes(consumerId)) {
    throw new TypeError("Consumer is not required by this recovery session");
  }
  session.consumers[consumerId] = {
    ...cursor(),
    status: manifest.checkpointCount === 0 ? "complete" : "pending",
    manifest,
    digest: recoveryCheckpointDigest([]),
  };
}

export function validateArchiveReview(
  review: NonNullable<PaymentRecoverySession["archiveReview"]>,
): void {
  text(review.auditRef, "archive audit");
  text(review.limitations, "archive limitations");
  assertBatchLimit(review.sources.length);
  for (const source of review.sources) {
    text(source, "archive source");
  }
}

export function resumeReasons(session: PaymentRecoverySession): string[] {
  const reasons: string[] = [];
  if (session.producerScan.status !== "complete") {
    reasons.push("unfinished_producer_history_scan");
  }
  if (session.uncertaintyScan.status !== "complete") {
    reasons.push("unfinished_uncertainty_scan");
  }
  if (!session.archiveReview) {
    reasons.push("missing_archive_review");
  }
  for (const id of session.requiredConsumerIds) {
    if (session.consumers[id]?.status !== "complete") {
      reasons.push(`unverified_consumer:${id}`);
    }
  }
  for (const id of session.restoredConsumerIds) {
    if (session.backfills[id]?.status !== "complete") {
      reasons.push(`unfinished_backfill:${id}`);
    }
  }
  return reasons;
}

export function validateRecoveryAuditCursor(
  sessionId: string,
  afterRevision: number,
  limit: number,
): void {
  text(sessionId, "session identity");
  assertBatchLimit(limit);
  if (!Number.isSafeInteger(afterRevision) || afterRevision < 0) {
    throw new TypeError("Invalid recovery audit cursor");
  }
}

export function restartRecoveryChecks(session: PaymentRecoverySession): void {
  session.producerScan = cursor();
  session.uncertaintyScan = cursor();
  session.consumers = {};
  session.backfills = Object.fromEntries(session.restoredConsumerIds.map((id) => [id, cursor()]));
  delete session.archiveReview;
}

export function assertRecoveryResume(
  reasons: string[],
  consumers: () => string[],
  session: PaymentRecoverySession,
): void {
  if (canonicalJson(consumers().toSorted()) !== canonicalJson(session.requiredConsumerIds)) {
    reasons.push("required_consumers_changed");
  }
  if (reasons.length > 0) {
    throw new PaymentRecoveryBlockedError(reasons);
  }
}

export function assertReviewedRecoveryLane(
  lane: Lane | undefined,
  expectedLaneRevision: number,
  sessionId: string,
): asserts lane is Lane {
  if (
    !lane ||
    lane.revision !== expectedLaneRevision ||
    lane.recoveryReviewRequired !== sessionId
  ) {
    throw new PaymentRecoveryConflictError();
  }
}

export function assertRecoveryNamespace(
  namespace: () => string | undefined,
  expectedNamespace: () => string,
): void {
  if (namespace() !== undefined && namespace() !== "" && namespace() !== expectedNamespace()) {
    throw new PaymentRecoveryBlockedError(["producer_namespace_mismatch"]);
  }
}

export function recoveryAuditRecord(
  session: PaymentRecoverySession,
  audit: RecoveryAudit,
  action: string,
): PaymentRecoveryAuditRecord {
  return {
    sessionId: session.sessionId,
    revision: session.revision,
    action,
    audit,
    at: new Date().toISOString(),
    sessionDigest: digest(session),
    cursorState: {
      producerScan: session.producerScan,
      uncertaintyScan: session.uncertaintyScan,
      consumers: session.consumers,
      backfills: session.backfills,
    },
  };
}

export function recoveryOperationKeys(
  rows: readonly { id: string; body: PaymentOperation }[],
): RecordKey[] {
  return rows.flatMap((row) => [
    { kind: "operations", id: row.id },
    { kind: "lanes", id: laneId(row.body) },
    ...(row.body.subscriptionBindingId !== undefined && row.body.subscriptionBindingId !== ""
      ? [{ kind: "subscriptionBindings", id: row.body.subscriptionBindingId }]
      : []),
  ]);
}

export function assertActiveRecoverySession(
  body: OwnerConfiguration & RecoveryConfiguration,
  session: PaymentRecoverySession | undefined,
  sessionId: string,
  expectedRevision: number,
  producerNamespace: () => string,
): asserts session is PaymentRecoverySession {
  if (
    !body.recoveryFenced ||
    body.activeRecoverySessionId !== sessionId ||
    !session ||
    session.status !== "fenced" ||
    session.revision !== expectedRevision ||
    session.producerNamespace !== producerNamespace()
  ) {
    throw new PaymentRecoveryConflictError();
  }
}

export function recordRecoveryOperationUncertainty(
  operation: PaymentOperation,
  audit: RecoveryAudit,
): void {
  operation.state = "outcome_unknown";
  operation.result = { kind: "outcome_unknown" };
  operation.revision += 1;
  operation.audits.push({
    ...audit,
    action: "keep_unknown",
    acceptedDuplicateRisk: false,
    at: new Date().toISOString(),
  });
}

export function markRecoveryLane(
  lane: Lane,
  session: PaymentRecoverySession,
  operation: PaymentOperation,
): void {
  lane.revision += 1;
  lane.recoveryReviewRequired = session.sessionId;
  lane.unresolvedOperationId ??= operation.operationId;
}

export function assertResumedRecoveryOperation(
  session: PaymentRecoverySession | undefined,
  operation: PaymentOperation | undefined,
): asserts operation is PaymentOperation {
  if (!session || session.status !== "resumed" || !operation) {
    throw new PaymentRecoveryConflictError();
  }
}

export function validateRecoveryCheckpoints(checkpoints: readonly RecoveryCheckpoint[]): void {
  assertBatchLimit(checkpoints.length);
  for (const checkpoint of checkpoints) {
    validCheckpoint(checkpoint);
  }
}
