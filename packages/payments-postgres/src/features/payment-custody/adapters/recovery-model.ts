import { digest } from "@agent-teams/payments-core";
import type { AggregateIdentity, PaymentScope } from "@agent-teams/payments-core";
import type { DatabaseTimeouts, PaymentPostgresDatabase } from "./database.js";

/** Trusted owner administration. Never expose this capability through buyer HTTP handlers. */
export type PaymentRecoveryOptions = Readonly<{
  database: PaymentPostgresDatabase;
  schema: string;
  scope: PaymentScope;
  producerNamespace: string;
  timeouts?: DatabaseTimeouts;
}>;
export type RecoveryAudit = Readonly<{ actorId: string; auditRef: string; reason: string }>;
export type RecoveryCheckpoint = Readonly<{
  messageId: string;
  aggregate: AggregateIdentity;
  revision: number;
  bodyDigest: string;
}>;
export type RecoveryManifest = Readonly<{
  /** References an immutable export made through the consumer owner's public capability. */
  exportRef: string;
  ownerAuditRef: string;
  checkpointCount: number;
  checkpointDigest: string;
  /** Consumer owns effects which survived its restore, including external publication. */
  externalEffectsReviewRef: string;
}>;
export type PaymentRecoveryAuditRecord = Readonly<{
  sessionId: string;
  revision: number;
  action: string;
  audit: RecoveryAudit;
  at: string;
  sessionDigest: string;
  cursorState: Pick<
    PaymentRecoverySession,
    "producerScan" | "uncertaintyScan" | "consumers" | "backfills"
  >;
}>;
type Cursor = {
  after: string | null;
  status: "pending" | "complete" | "blocked";
  processed: number;
  issue?: string;
};
type ConsumerVerification = Cursor & { manifest: RecoveryManifest; digest: string };
export type PaymentRecoverySession = {
  sessionId: string;
  revision: number;
  producerNamespace: string;
  status: "fenced" | "resumed";
  externalFence: Readonly<{ deploymentRef: string; fenceRef: string; appliedAt: string }>;
  restore: Readonly<{
    horizon: string;
    uncertainFrom: string;
    uncertainThrough: string;
    reason: string;
  }>;
  requiredConsumerIds: string[];
  restoredConsumerIds: string[];
  producerScan: Cursor;
  uncertaintyScan: Cursor;
  consumers: Record<string, ConsumerVerification>;
  backfills: Record<string, Cursor>;
  archiveReview?: Readonly<{ auditRef: string; sources: readonly string[]; limitations: string }>;
};

export class PaymentRecoveryConflictError extends Error {
  constructor() {
    super("Payment recovery session changed or is not active");
    this.name = "PaymentRecoveryConflictError";
  }
}
export class PaymentRecoveryBlockedError extends Error {
  readonly reasons: readonly string[];
  constructor(reasons: readonly string[]) {
    super(`Payment recovery remains fenced: ${reasons.join(", ")}`);
    this.name = "PaymentRecoveryBlockedError";
    this.reasons = reasons;
  }
}

/** Deterministic ordered manifest checksum; use the same chain for owner exports and page submission. */
export function recoveryCheckpointDigest(
  checkpoints: readonly RecoveryCheckpoint[],
  previous: string = digest([]),
): string {
  return checkpoints.reduce(
    (value, checkpoint) => digest({ previous: value, checkpoint }),
    previous,
  );
}
