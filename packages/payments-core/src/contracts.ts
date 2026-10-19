/** Core-owned contracts. No provider, driver, framework or product entitlement DTOs. */
export type PaymentScope = Readonly<{ applicationId: string; provider: string; paymentAccountId: string; environment: 'sandbox' | 'production' }>;
export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };
export type Money = Readonly<{ currency: string; minorUnits: string }>;
export type ExactTime = Readonly<{ original: string; seconds: string; fraction: string }>;
export type Period = Readonly<{ startsAt: string; endsAt: string }>;
export type ErrorCode = 'validation' | 'unauthorized_configuration' | 'permission_denied' | 'conflict' | 'rate_limited' | 'unavailable' | 'ownership_mismatch' | 'catalog_mismatch' | 'unclassified_external_state';
export type OperationResult<T> = Readonly<{ kind: 'succeeded'; value: T }> | Readonly<{ kind: 'pending'; operationId: string }> | Readonly<{ kind: 'outcome_unknown'; operationId: string }> | Readonly<{ kind: 'rejected'; code: ErrorCode }> | Readonly<{ kind: 'unsupported'; capability: string }>;
export type ProviderResult<T> = Readonly<{ kind: 'succeeded'; value: T }> | Readonly<{ kind: 'rejected'; code: ErrorCode; diagnostic?: Readonly<{ requestId?: string; providerCode?: string }> }> | Readonly<{ kind: 'outcome_unknown'; diagnostic?: Readonly<{ requestId?: string; providerCode?: string }> }> | Readonly<{ kind: 'unsupported'; capability: string }>;
export type OfferLine = Readonly<{ providerPriceRef: string; benefitSlotId: string; quantity: 1 }>;
export type OfferSnapshot = Readonly<{ applicationId: string; offerId: string; version: string; policyVersion: string; profile: 'one_time' | 'monthly'; currency: string; allowZeroTotal: boolean; lines: readonly OfferLine[] }>;
export interface Catalog { resolveOffer(scope: PaymentScope, offerId: string): Promise<OfferSnapshot | undefined> }
export type Field<T> = Readonly<{ presence: 'known'; value: T; provenance?: 'observed' | 'schema_assumed_null' }> | Readonly<{ presence: 'unknown' }>;
export type EvidenceSource = Readonly<{ kind: 'verified_webhook' | 'authenticated_api'; receiptId: string; representationDigest: string; decoderVersion: string; sdkVersion?: string; apiProfile: string; eventId?: string; eventType?: string; occurredAt?: string; stableEnvelopeDigest?: string; verification?: Readonly<{ verifiedAt: string; endpointId: string; rawBodyDigest: string }>; query?: JsonValue }>;
export type ProviderLine = Readonly<{ providerLineRef: string; providerPriceRef: string; quantity: number; amount: Money; billingCycle: Field<Readonly<{ interval: string; frequency: number }> | null>; trial: Field<boolean>; proration: Field<boolean>; period: Field<Period | null> }>;
export type TransactionObservation = Readonly<{ kind: 'transaction'; transactionRef: string; version: string; status: string; origin: Field<string>; customerRef: Field<string | null>; subscriptionRef: Field<string | null>; intentCorrelation: Field<string | null>; currency: Field<string>; total: Field<Money>; lines: Field<readonly ProviderLine[]>; source: EvidenceSource }>;
export type SubscriptionObservation = Readonly<{ kind: 'subscription'; subscriptionRef: string; version: string; status: Field<string>; customerRef: Field<string | null>; scheduledChange: Field<Readonly<{ action: string; effectiveAt: string }> | null>; currentPeriod: Field<Period | null>; priceRefs: Field<readonly string[]>; source: EvidenceSource }>;
export type AdjustmentObservation = Readonly<{ kind: 'adjustment'; adjustmentRef: string; transactionRef: string; version: string; action: string; status: string; amount: Money; allocations: readonly Readonly<{ providerLineRef: string; amount: Money }>[]; source: EvidenceSource }>;
export type UnsupportedObservation = Readonly<{ kind: 'unsupported'; reason: string; transactionRef?: string; subscriptionRef?: string; source: EvidenceSource }>;
export type Observation = TransactionObservation | SubscriptionObservation | AdjustmentObservation | UnsupportedObservation;
/** The adapter assigns scope from trusted endpoint/connection configuration, never from event custom data. */
export type VerifiedInput = Readonly<{ scope: PaymentScope; inputId: string; source: EvidenceSource; observation: Observation; retainedRepresentation: JsonValue; adverseTransactionRef?: string }>;
export type CheckoutReady = Readonly<{ intentId: string; transactionRef: string; checkout: Readonly<{ url?: string; token?: string }> }>;
export type CancellationOutcome = Readonly<{ kind: 'scheduled'; effectiveAt: string }> | Readonly<{ kind: 'applied'; observedStatus: string }>;
export type CapabilityProfile = Readonly<{ checkout: true; transactionRead: true; subscriptionRead: true; cancellation: readonly ('now' | 'period_end')[]; paymentUpdate: boolean; customerManagement: boolean }>;
export interface PaymentProvider {
  readonly scope: PaymentScope;
  readonly capabilities: CapabilityProfile;
  createCheckout(input: Readonly<{ intentId: string; attemptId: string; buyerId: string; offer: OfferSnapshot }>): Promise<ProviderResult<CheckoutReady>>;
  readTransaction(transactionRef: string): Promise<ProviderResult<TransactionObservation>>;
  readSubscription(subscriptionRef: string): Promise<ProviderResult<SubscriptionObservation>>;
  cancelSubscription?(input: Readonly<{ subscriptionRef: string; timing: 'now' | 'period_end'; attemptId: string }>): Promise<ProviderResult<CancellationOutcome>>;
  openPaymentUpdate?(input: Readonly<{ subscriptionRef: string; attemptId: string }>): Promise<ProviderResult<CheckoutReady>>;
  createManagementLink?(input: Readonly<{ customerRef: string; subscriptionRefs: readonly string[] }>): Promise<ProviderResult<Readonly<{ url: string; expiresAt?: string }>>>;
}
export type OperationKind = 'purchase' | 'cancellation' | 'payment_update';
export type OperationState = 'prepared' | 'dispatch_started' | 'succeeded' | 'rejected' | 'outcome_unknown';
export type Attempt = { attemptId: string; fingerprint: string; dispatchedAt: string; observations: ProviderResult<JsonValue>[] };
export type ResolutionAudit = Readonly<{ actorId: string; auditRef: string; reason: string; acceptedDuplicateRisk: boolean; at: string; action: 'keep_unknown' | 'retry' | 'bind_outcome' }>;
export type PaymentOperation = { operationId: string; kind: OperationKind; buyerId: string; requestKey: string; fingerprint: string; intentId?: string; subscriptionBindingId?: string; timing?: 'now' | 'period_end'; revision: number; state: OperationState; attempts: Attempt[]; result?: ProviderResult<JsonValue>; audits: ResolutionAudit[] };
export type PurchaseIntent = { intentId: string; buyerId: string; requestKey: string; fingerprint: string; offer: OfferSnapshot; operationId: string; subscriptionBasisId?: string; transactionRefs: string[]; createdAt: string };
export type TransactionBinding = { transactionRef: string; intentId: string; buyerId: string; purpose: 'commercial' | 'payment_method' | 'recovery'; customerRef: string | null };
export type SubscriptionBinding = { bindingId: string; buyerId: string; originatingIntentId: string; offer: OfferSnapshot; providerSubscriptionRefs: string[]; selectedSubscriptionRef?: string; customerRef: string | null };
export type CommercialClassification = 'one_time' | 'initial' | 'renewal' | 'recovery' | 'management' | 'held';
export type CompletionFact = Readonly<{ factId: string; scope: PaymentScope; transactionRef: string; intentId: string; buyerId: string; subscriptionBasisId?: string; providerSubscriptionRef?: string; classification: CommercialClassification; offer: OfferSnapshot; total: Money; lines: readonly Readonly<{ providerLineRef: string; benefitSlotId: string; amount: Money; quantity: 1; period?: Period }>[]; source: EvidenceSource }>;
export type EvidenceFlag = 'pending_adverse' | 'conflict' | 'unsupported' | 'incomplete' | 'unresolved_binding' | 'duplicate_initial_purchase' | 'duplicate_payment' | 'catalog_mismatch' | 'ownership_mismatch';
export type AggregateIdentity = Readonly<{ type: 'transaction' | 'subscription'; id: string }>;
export type EvidenceEnvelope = Readonly<{ envelopeVersion: 1; schemaVersion: 1; producerNamespace: string; scope: PaymentScope; aggregate: AggregateIdentity; revision: number; messageId: string; bodyDigest: string }>;
export type PaymentEvidenceChanged = EvidenceEnvelope & (Readonly<{ kind: 'complete'; aggregate: Readonly<{ type: 'transaction'; id: string }>; completion?: CompletionFact; adjustments: readonly AdjustmentObservation[]; flags: readonly EvidenceFlag[] }> | Readonly<{ kind: 'held'; reason: string; resolutionRef: string }>);
export type ObservedSubscriptionEvidenceChanged = EvidenceEnvelope & (Readonly<{ kind: 'subscription_complete'; aggregate: Readonly<{ type: 'subscription'; id: string }>; binding: SubscriptionBinding; observation: SubscriptionObservation; flags: readonly EvidenceFlag[] }> | Readonly<{ kind: 'held'; reason: string; resolutionRef: string }>);
export type EvidenceMessage = PaymentEvidenceChanged | ObservedSubscriptionEvidenceChanged;
export type TransactionAggregate = { transactionRef: string; revision: number; evidenceRevision: number; observations: TransactionObservation[]; adjustments: Record<string, AdjustmentObservation>; pendingAdverse: string[]; flags: EvidenceFlag[]; completion?: CompletionFact; current?: TransactionObservation; publicationRequired: boolean };
export type SubscriptionAggregate = { subscriptionRef: string; revision: number; evidenceRevision: number; current?: SubscriptionObservation; lastKnown?: SubscriptionObservation; flags: EvidenceFlag[]; publicationRequired: boolean };
export type InboxRecord = { input: VerifiedInput; state: 'pending' | 'processed' | 'quarantined'; conflict: boolean; attempts: number; issue?: string };
export type Delivery = { consumerId: string; messageId: string; acknowledged: boolean; attempts: number };
export type ScanCheckpoint = { scanId: string; epoch: string; queryFingerprint: string; after?: string; status: 'running' | 'complete' | 'gap'; issue?: string };
/** Payment-owner state. Drafts cannot escape atomic(); stores must isolate readers and rollback on exceptions. */
export type PaymentState = { revision: number; recoveryFenced: boolean; intents: Record<string, PurchaseIntent>; operations: Record<string, PaymentOperation>; requestKeys: Record<string, string>; bindings: Record<string, TransactionBinding>; subscriptionBindings: Record<string, SubscriptionBinding>; transactions: Record<string, TransactionAggregate>; subscriptions: Record<string, SubscriptionAggregate>; inbox: Record<string, InboxRecord>; evidence: Record<string, EvidenceMessage>; deliveries: Record<string, Delivery>; consumers: string[]; scans: Record<string, ScanCheckpoint>; issues: string[] };
/**
 * Atomic owner-local protocol. Implementations serialize all mutations for a scope and durably commit
 * the resulting state before resolving. The callback is synchronous, deterministic and performs no I/O.
 * A throw rolls back all changes. Return values and snapshots are detached. A lost commit response must
 * reject (unknown commit), never report rollback or authorize external dispatch. No cross-owner UoW.
 */
export interface PaymentStore {
  atomic<T>(scope: PaymentScope, mutation: (draft: PaymentState) => T): Promise<T>;
  read(scope: PaymentScope): Promise<PaymentState>;
}
export type StartPurchase = Readonly<{ buyerId: string; offerId: string; requestKey: string }>;
export type ResolveUnknown = Readonly<{ operationId: string; expectedRevision: number; actorId: string; auditRef: string; reason: string; action: 'keep_unknown' | 'retry' | 'bind_outcome'; acceptedDuplicateRisk?: boolean; outcome?: ProviderResult<JsonValue> }>;
export type PaymentRuntimeOptions = Readonly<{ scope: PaymentScope; producerNamespace: string; provider: PaymentProvider; store: PaymentStore; catalog: Catalog; now?: () => string; newId?: () => string; maxEvidenceBytes?: number }>;
