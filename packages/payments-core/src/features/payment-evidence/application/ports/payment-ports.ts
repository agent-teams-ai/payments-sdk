import type {
  PaymentScope,
  JsonValue,
  ProviderResult,
  OfferSnapshot,
  TransactionObservation,
  SubscriptionObservation,
  VerifiedInput,
  PaymentOperation,
  AggregateIdentity,
  EvidenceMessage,
  ScanCheckpoint,
} from "../../domain/model.js";
import type {
  CheckoutReady,
  PaymentUpdateReady,
  CancellationOutcome,
  CapabilityProfile,
  ReductionInput,
  ReductionCommit,
  IntentAdmission,
  OperationInput,
  OperationCommit,
  StoredPurchaseRead,
  StoredSubscriptionRead,
  VerifiedInputAdmission,
  StoreCommitResult,
} from "../models/payment-models.js";
export interface Catalog {
  resolveOffer: (scope: PaymentScope, offerId: string) => Promise<OfferSnapshot | undefined>;
}
export interface PaymentProvider {
  readonly scope: PaymentScope;
  readonly capabilities: CapabilityProfile;
  createCheckout: (
    input: Readonly<{
      intentId: string;
      attemptId: string;
      buyerId: string;
      offer: OfferSnapshot;
    }>,
  ) => Promise<ProviderResult<CheckoutReady>>;
  readTransaction: (transactionRef: string) => Promise<ProviderResult<TransactionObservation>>;
  readSubscription: (subscriptionRef: string) => Promise<ProviderResult<SubscriptionObservation>>;
  /** Exact API receipt custody. representationDigest is digest(retainedRepresentation), not a projection digest. */
  readTransactionInput?: (transactionRef: string) => Promise<ProviderResult<VerifiedInput>>;
  readSubscriptionInput?: (subscriptionRef: string) => Promise<ProviderResult<VerifiedInput>>;
  cancelSubscription?: (
    input: Readonly<{
      subscriptionRef: string;
      timing: "now" | "period_end";
      attemptId: string;
    }>,
  ) => Promise<ProviderResult<CancellationOutcome>>;
  openPaymentUpdate?: (
    input: Readonly<{
      subscriptionRef: string;
      intentId: string;
      attemptId: string;
    }>,
  ) => Promise<ProviderResult<PaymentUpdateReady>>;
  createManagementLink?: (
    input: Readonly<{
      customerRef: string;
      subscriptionRefs: readonly string[];
    }>,
  ) => Promise<
    ProviderResult<
      Readonly<{
        url: string;
        expiresAt?: string;
      }>
    >
  >;
}
export interface PaymentStore {
  admitIntent: (
    scope: PaymentScope,
    admission: IntentAdmission,
  ) => Promise<
    | Readonly<{
        kind: "created" | "existing";
        operation: PaymentOperation;
      }>
    | Readonly<{
        kind: "conflict" | "recovery_fenced";
      }>
  >;
  admitOperation: (
    scope: PaymentScope,
    operation: PaymentOperation,
  ) => Promise<
    | Readonly<{
        kind: "created" | "existing";
        operation: PaymentOperation;
      }>
    | Readonly<{
        kind: "conflict" | "recovery_fenced";
      }>
  >;
  findRequest: (
    scope: PaymentScope,
    buyerId: string,
    requestKey: string,
  ) => Promise<PaymentOperation | undefined>;
  loadOperation: (scope: PaymentScope, operationId: string) => Promise<OperationInput | undefined>;
  /** Atomic CAS of operation, immutable command, mutation lane and expectedReadSet. Subscription
   * dispatch requires binding + pinned subscription authority revisions; marker precedes SDK call. */
  beginExternalDispatch: (
    scope: PaymentScope,
    commit: OperationCommit,
  ) => Promise<StoreCommitResult>;
  /** Append immutable late evidence even when the original attempt no longer owns the lane. */
  recordAttemptObservation: (
    scope: PaymentScope,
    operationId: string,
    attemptId: string,
    result: ProviderResult<JsonValue>,
  ) => Promise<void>;
  finishAttempt: (scope: PaymentScope, commit: OperationCommit) => Promise<StoreCommitResult>;
  /** Owned audited resolution uses the same revision/lane CAS, never a direct record edit. */
  commitOperation: (scope: PaymentScope, commit: OperationCommit) => Promise<StoreCommitResult>;
  admitVerifiedInputs: (
    scope: PaymentScope,
    inputs: readonly VerifiedInput[],
  ) => Promise<readonly VerifiedInputAdmission[]>;
  loadReductionInput: (scope: PaymentScope, inputId: string) => Promise<ReductionInput | undefined>;
  commitReduction: (scope: PaymentScope, commit: ReductionCommit) => Promise<StoreCommitResult>;
  loadPublicationInput: (
    scope: PaymentScope,
    aggregate: AggregateIdentity,
  ) => Promise<ReductionInput | undefined>;
  /** Atomically mark at most limit transaction aggregates structurally bound to the obligation's
   * originating intent for publication, then advance its transactionRef cursor. Compare the durable
   * obligation decisionRevision with the current binding; concurrent decision/membership changes
   * cannot be lost. New/changed dependents always classify using a current binding read set.
   * This performs storage traversal only: all commercial classification stays in core reduction. */
  processReclassification: (
    scope: PaymentScope,
    bindingId: string,
    limit: number,
  ) => Promise<StoreCommitResult>;
  readPurchase: (
    scope: PaymentScope,
    buyerId: string,
    intentId: string,
  ) => Promise<StoredPurchaseRead | undefined>;
  readSubscription: (
    scope: PaymentScope,
    buyerId: string,
    bindingId: string,
  ) => Promise<StoredSubscriptionRead | undefined>;
  listWork: (
    scope: PaymentScope,
    kind: "inbox" | "publication" | "reclassification" | "prepared" | "unknown",
    limit: number,
  ) => Promise<readonly string[]>;
  registerConsumer: (scope: PaymentScope, consumerId: string, backfill: boolean) => Promise<void>;
  listDeliveries: (
    scope: PaymentScope,
    consumerId: string,
    limit: number,
  ) => Promise<readonly EvidenceMessage[]>;
  acknowledgeDelivery: (
    scope: PaymentScope,
    consumerId: string,
    messageId: string,
    bodyDigest: string,
  ) => Promise<"acknowledged" | "duplicate" | "conflict">;
  setRecoveryFence: (scope: PaymentScope, fenced: boolean, auditRef: string) => Promise<void>;
  readCheckpoint: (scope: PaymentScope, scanId: string) => Promise<ScanCheckpoint | undefined>;
  commitScanPage: (
    scope: PaymentScope,
    expected: ScanCheckpoint | undefined,
    next: ScanCheckpoint,
    inputs: readonly VerifiedInput[],
  ) => Promise<StoreCommitResult>;
}
