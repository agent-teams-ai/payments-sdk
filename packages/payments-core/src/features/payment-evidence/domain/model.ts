export type PaymentScope = Readonly<{
  applicationId: string;
  provider: string;
  paymentAccountId: string;
  environment: "sandbox" | "production";
}>;
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | {
      readonly [key: string]: JsonValue;
    };
export type Money = Readonly<{
  currency: string;
  minorUnits: string;
}>;
export type ExactTime = Readonly<{
  original: string;
  seconds: string;
  fraction: string;
}>;
export type Period = Readonly<{
  startsAt: string;
  endsAt: string;
}>;
export type ErrorCode =
  | "validation"
  | "unauthorized_configuration"
  | "permission_denied"
  | "conflict"
  | "rate_limited"
  | "unavailable"
  | "ownership_mismatch"
  | "catalog_mismatch"
  | "unclassified_external_state";
export type ProviderResult<T> =
  | Readonly<{
      kind: "succeeded";
      value: T;
    }>
  | Readonly<{
      kind: "rejected";
      code: ErrorCode;
      diagnostic?: Readonly<{
        requestId?: string;
        providerCode?: string;
      }>;
    }>
  | Readonly<{
      kind: "outcome_unknown";
      diagnostic?: Readonly<{
        requestId?: string;
        providerCode?: string;
      }>;
    }>
  | Readonly<{
      kind: "unsupported";
      capability: string;
    }>;
export type OfferLine = Readonly<{
  providerPriceRef: string;
  benefitSlotId: string;
  quantity: 1;
}>;
export type OfferSnapshot = Readonly<{
  applicationId: string;
  offerId: string;
  version: string;
  policyVersion: string;
  profile: "one_time" | "monthly";
  currency: string;
  allowZeroTotal: boolean;
  lines: readonly OfferLine[];
}>;
export type Field<T> =
  | Readonly<{
      presence: "known";
      value: T;
      provenance?: "observed" | "schema_assumed_null";
    }>
  | Readonly<{
      presence: "unknown";
    }>;
export type EvidenceSource = Readonly<{
  kind: "verified_webhook" | "authenticated_api";
  receiptId: string;
  representationDigest: string;
  decoderVersion: string;
  sdkVersion?: string;
  apiProfile: string;
  eventId?: string;
  eventType?: string;
  occurredAt?: string;
  stableEnvelopeDigest?: string;
  verification?: Readonly<{
    verifiedAt: string;
    endpointId: string;
    rawBodyDigest: string;
  }>;
  query?: JsonValue;
}>;
export type BillingCycle = Readonly<{
  interval: string;
  frequency: number;
}>;
/** Observation origin, subscription status/scheduled action and adjustment action/status use the
 * core-owned canonical vocabulary exported by vocabulary.ts. Adapters translate supported vendor
 * values before admission. Canonical token strings are reserved for deliberate mapping: an
 * unrecognized wire value must not become known canonical evidence through a string fallback.
 * Use Field unknown for an uninterpreted field and retain the exact raw value in the receipt.
 * Open string fields may retain unsupported values only when they cannot collide with a token.
 * Canonical token spellings and observation DTO shapes are part of the durable replay protocol. */
/** Closed adapter interpretation; the original status remains evidence, never a fallback classifier. */
export type TransactionStatusMeaning =
  | Readonly<{
      kind: "completed";
    }>
  | Readonly<{
      kind: "not_completed";
    }>
  | Readonly<{
      kind: "unsupported";
    }>;
export type CollectionMethod =
  | Readonly<{
      kind: "automatic";
    }>
  | Readonly<{
      kind: "invoice";
    }>
  | Readonly<{
      kind: "unsupported";
      value: string;
    }>;
export type SubscriptionItem = Readonly<{
  providerPriceRef: string;
  quantity: Field<number>;
  billingCycle: Field<BillingCycle | null>;
  trial: Field<boolean>;
}>;
export type ProviderLine = Readonly<{
  providerLineRef: string;
  providerPriceRef: string;
  quantity: number;
  amount: Money;
  billingCycle: Field<BillingCycle | null>;
  trial: Field<boolean>;
  proration: Field<boolean>;
  period: Field<Period | null>;
}>;
export type TransactionObservation = Readonly<{
  kind: "transaction";
  transactionRef: string;
  version: string;
  status: string;
  statusMeaning: TransactionStatusMeaning;
  origin: Field<string>;
  customerRef: Field<string | null>;
  subscriptionRef: Field<string | null>;
  intentCorrelation: Field<string | null>;
  currency: Field<string>;
  total: Field<Money>;
  lines: Field<readonly ProviderLine[]>;
  source: EvidenceSource;
}>;
export type SubscriptionObservation = Readonly<{
  kind: "subscription";
  subscriptionRef: string;
  version: string;
  status: Field<string>;
  customerRef: Field<string | null>;
  scheduledChange: Field<Readonly<{
    action: string;
    effectiveAt: string;
  }> | null>;
  currentPeriod: Field<Period | null>;
  collection: Field<CollectionMethod>;
  items: Field<readonly SubscriptionItem[]>;
  source: EvidenceSource;
}>;
export type AdjustmentObservation = Readonly<{
  kind: "adjustment";
  adjustmentRef: string;
  transactionRef: string;
  version: string;
  action: string;
  status: string;
  type?: string;
  amount: Money;
  allocations: readonly Readonly<{
    providerLineRef: string;
    amount: Money;
    providerAllocationRef?: string;
    type?: string;
    requestedAmount?: Money | null;
  }>[];
  source: EvidenceSource;
}>;
export type UnsupportedObservation = Readonly<{
  kind: "unsupported";
  reason: string;
  transactionRef?: string;
  subscriptionRef?: string;
  source: EvidenceSource;
}>;
export type Observation =
  | TransactionObservation
  | SubscriptionObservation
  | AdjustmentObservation
  | UnsupportedObservation;
/** The adapter assigns scope from trusted endpoint/connection configuration, never from event custom data. */
export type VerifiedInput = Readonly<{
  scope: PaymentScope;
  inputId: string;
  source: EvidenceSource;
  observation: Observation;
  retainedRepresentation: JsonValue;
  adverseTransactionRef?: string;
}>;
export type ObservationProjection =
  | Omit<TransactionObservation, "source">
  | Omit<SubscriptionObservation, "source">
  | Omit<AdjustmentObservation, "source">
  | Omit<UnsupportedObservation, "source">;
export type VersionedObservationProjection = Exclude<
  ObservationProjection,
  {
    kind: "unsupported";
  }
>;
export type ObjectVersionEvidence = Readonly<{
  entityKind: "transaction" | "subscription" | "adjustment";
  entityRef: string;
  seconds: string;
  fraction: string;
}> &
  (
    | Readonly<{
        kind: "certified";
        projection: VersionedObservationProjection;
        conflict: boolean;
      }>
    | Readonly<{
        kind: "held";
        reason: "version_evidence_size_limit";
      }>
  );
/** Certified event identity without retained body/SDK diagnostics; suitable for a bounded identity index. */
export type EventIdentityEvidence = Readonly<{
  provider: string;
  paymentAccountId: string;
  environment: PaymentScope["environment"];
  eventId?: string;
  eventType?: string;
  occurredAt?: string;
  rawStableEnvelopeDigest?: string;
  projection: ObservationProjection;
  routes: readonly AggregateIdentity[];
}>;
export type OperationKind = "purchase" | "cancellation" | "payment_update";
export type OperationState =
  | "prepared"
  | "dispatch_started"
  | "succeeded"
  | "rejected"
  | "outcome_unknown";
export type Attempt = {
  attemptId: string;
  fingerprint: string;
  dispatchedAt: string;
  providerSubscriptionRef?: string;
  observations: ProviderResult<JsonValue>[];
};
export type ResolutionAudit = Readonly<{
  actorId: string;
  auditRef: string;
  reason: string;
  acceptedDuplicateRisk: boolean;
  at: string;
  action: "keep_unknown" | "retry" | "bind_outcome";
}>;
export type PaymentOperation = {
  operationId: string;
  kind: OperationKind;
  buyerId: string;
  requestKey: string;
  fingerprint: string;
  intentId?: string;
  subscriptionBindingId?: string;
  providerSubscriptionRef?: string;
  timing?: "now" | "period_end";
  revision: number;
  state: OperationState;
  attempts: Attempt[];
  result?: ProviderResult<JsonValue>;
  audits: ResolutionAudit[];
};
export type PurchaseIntent = {
  intentId: string;
  buyerId: string;
  requestKey: string;
  fingerprint: string;
  offer: OfferSnapshot;
  operationId: string;
  subscriptionBasisId?: string;
  transactionRefs: string[];
  createdAt: string;
};
export type TransactionBinding = {
  transactionRef: string;
  intentId: string;
  buyerId: string;
  purpose: "commercial" | "payment_method" | "recovery";
  customerRef: string | null;
};
export type SubscriptionBinding = {
  bindingId: string;
  buyerId: string;
  originatingIntentId: string;
  offer: OfferSnapshot;
  providerSubscriptionRefs: string[];
  selectedSubscriptionRef?: string;
  classificationDecision?: Readonly<{
    revision: number;
    duplicateInitialPurchase: boolean;
  }>;
  streamSelection?: Readonly<{
    actorId: string;
    auditRef: string;
    reason: string;
    at: string;
  }>;
  customerRef: string | null;
};
/** Immutable Published Language leaf. Its serialized v1 event shape is unchanged. */
export type SubscriptionBindingEvidence = Readonly<{
  bindingId: string;
  buyerId: string;
  originatingIntentId: string;
  offer: OfferSnapshot;
  providerSubscriptionRefs: readonly string[];
  selectedSubscriptionRef?: string;
  classificationDecision?: Readonly<{
    revision: number;
    duplicateInitialPurchase: boolean;
  }>;
  streamSelection?: Readonly<{
    actorId: string;
    auditRef: string;
    reason: string;
    at: string;
  }>;
  customerRef: string | null;
}>;
export type CommercialClassification =
  | "one_time"
  | "initial"
  | "renewal"
  | "recovery"
  | "management"
  | "held";
export type CompletionFact = Readonly<{
  factId: string;
  scope: PaymentScope;
  transactionRef: string;
  intentId: string;
  buyerId: string;
  subscriptionBasisId?: string;
  providerSubscriptionRef?: string;
  classification: CommercialClassification;
  offer: OfferSnapshot;
  total: Money;
  lines: readonly Readonly<{
    providerLineRef: string;
    benefitSlotId: string;
    amount: Money;
    quantity: 1;
    period?: Period;
  }>[];
  source: EvidenceSource;
}>;
export type EvidenceFlag =
  | "pending_adverse"
  | "conflict"
  | "unsupported"
  | "incomplete"
  | "unresolved_binding"
  | "duplicate_initial_purchase"
  | "duplicate_payment"
  | "catalog_mismatch"
  | "ownership_mismatch"
  | "incomplete_history";
export type AggregateIdentity = Readonly<{
  type: "transaction" | "subscription";
  id: string;
}>;
export type EvidenceEnvelope = Readonly<{
  envelopeVersion: 1;
  schemaVersion: 1;
  producerNamespace: string;
  scope: PaymentScope;
  aggregate: AggregateIdentity;
  revision: number;
  messageId: string;
  bodyDigest: string;
}>;
export type PaymentEvidenceChanged = EvidenceEnvelope &
  (
    | Readonly<{
        kind: "complete";
        aggregate: Readonly<{
          type: "transaction";
          id: string;
        }>;
        completion?: CompletionFact;
        adjustments: readonly AdjustmentObservation[];
        flags: readonly EvidenceFlag[];
      }>
    | Readonly<{
        kind: "held";
        reason: string;
        resolutionRef: string;
      }>
  );
export type ObservedSubscriptionEvidenceChanged = EvidenceEnvelope &
  (
    | Readonly<{
        kind: "subscription_complete";
        aggregate: Readonly<{
          type: "subscription";
          id: string;
        }>;
        binding: SubscriptionBindingEvidence;
        observation: SubscriptionObservation;
        flags: readonly EvidenceFlag[];
      }>
    | Readonly<{
        kind: "held";
        reason: string;
        resolutionRef: string;
      }>
  );
export type EvidenceMessage = PaymentEvidenceChanged | ObservedSubscriptionEvidenceChanged;
/** Current lifecycle holds are replaceable only by the current certified observation. Retained
 * flags preserve independent historical contradictions, routing and adjustment controls. */
export type ProfileEvidenceHolds = {
  currentProfileFlags?: EvidenceFlag[];
  retainedFlags?: EvidenceFlag[];
};
export type TransactionAggregate = ProfileEvidenceHolds & {
  transactionRef: string;
  revision: number;
  evidenceRevision: number;
  observations: TransactionObservation[];
  adjustments: Record<string, AdjustmentObservation>;
  pendingAdverse: string[];
  flags: EvidenceFlag[];
  completion?: CompletionFact;
  current?: TransactionObservation;
  publicationRequired: boolean;
};
export type SubscriptionAggregate = ProfileEvidenceHolds & {
  subscriptionRef: string;
  revision: number;
  evidenceRevision: number;
  current?: SubscriptionObservation;
  lastKnown?: SubscriptionObservation;
  flags: EvidenceFlag[];
  publicationRequired: boolean;
};
export type InboxRecord = {
  input: VerifiedInput;
  state: "pending" | "processed" | "quarantined";
  conflict: boolean;
  attempts: number;
  issue?: string;
};
export type Delivery = {
  consumerId: string;
  messageId: string;
  acknowledged: boolean;
  attempts: number;
};
/** Fixed event windows are exclusive and must overlap; each required type has its own scan. */
export type ReconciliationQuery =
  | Readonly<{
      kind: "events";
      from: string;
      to: string;
      eventType?: string;
      perPage: number;
      purpose: "catch_up" | "retention_sweep";
      queryVersion: string;
    }>
  | Readonly<{
      kind: "adjustments";
      transactionRef: string;
      queryVersion: string;
    }>;
export type ScanReadFailure = Readonly<{
  at: string;
  reason: string;
  after?: string;
  sdkVersion?: string;
  code?: string;
}>;
/** query is optional only for legacy checkpoints, which cannot be resumed without explicit migration. */
export type ScanCheckpoint = {
  scanId: string;
  epoch: string;
  queryFingerprint: string;
  query?: ReconciliationQuery;
  after?: string;
  status: "running" | "complete" | "gap";
  issue?: string;
  failureCount?: number;
  lastFailure?: ScanReadFailure;
};
/** A core decision changes independently of provider evidence. Cursor processing only wakes bounded
 * structural dependents; their ordinary publication reduction applies the current decision. */
export type SubscriptionReclassification = {
  bindingId: string;
  decisionRevision: number;
  afterTransactionRef?: string;
  complete: boolean;
};
/** Bounded payment-owner working set. Adapters isolate readers and persist only its exact read-set records. */
export type PaymentState = {
  revision: number;
  recoveryFenced: boolean;
  intents: Record<string, PurchaseIntent>;
  operations: Record<string, PaymentOperation>;
  requestKeys: Record<string, string>;
  bindings: Record<string, TransactionBinding>;
  subscriptionBindings: Record<string, SubscriptionBinding>;
  reclassifications: Record<string, SubscriptionReclassification>;
  transactions: Record<string, TransactionAggregate>;
  subscriptions: Record<string, SubscriptionAggregate>;
  versionEvidence: Record<string, ObjectVersionEvidence>;
  inbox: Record<string, InboxRecord>;
  evidence: Record<string, EvidenceMessage>;
  deliveries: Record<string, Delivery>;
  consumers: string[];
  scans: Record<string, ScanCheckpoint>;
  issues: string[];
};
/** A bounded owner-local working set, never a complete scope ledger. Missing rows carry revision null. */
