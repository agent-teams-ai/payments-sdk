import type { PaymentScope, JsonValue, ErrorCode, ProviderResult, PaymentOperation, PurchaseIntent, TransactionBinding, SubscriptionBinding, TransactionAggregate, SubscriptionAggregate, PaymentState } from '../../domain/model.js';
import type { Catalog, PaymentProvider, PaymentStore } from '../ports/payment-ports.js';
export type OperationResult<T> = Readonly<{
    kind: 'succeeded';
    value: T;
}> | Readonly<{
    kind: 'pending';
    operationId: string;
}> | Readonly<{
    /** Durable command remains prepared; no dispatch marker or provider call was made. */
    kind: 'deferred';
    operationId: string;
    reason: 'mutation_capacity';
}> | Readonly<{
    kind: 'outcome_unknown';
    operationId: string;
}> | Readonly<{
    kind: 'rejected';
    code: ErrorCode;
    /** Absolute provider retry advice, not permission to redispatch an uncertain operation. */
    retryAt?: string;
}> | Readonly<{
    kind: 'unsupported';
    capability: string;
}>;
export type CheckoutReady = Readonly<{
    intentId: string;
    transactionRef: string;
    checkout: Readonly<{
        url?: string;
        token?: string;
    }>;
}>;
export type PaymentUpdateReady = CheckoutReady & Readonly<{
    purpose: 'payment_method' | 'recovery';
}>;
export type CancellationOutcome = Readonly<{
    kind: 'scheduled';
    effectiveAt: string;
}> | Readonly<{
    kind: 'applied';
    observedStatus: string;
}>;
export type CapabilityProfile = Readonly<{
    checkout: true;
    transactionRead: true;
    subscriptionRead: true;
    cancellation: readonly ('now' | 'period_end')[];
    paymentUpdate: boolean;
    customerManagement: boolean;
}>;
export type PaymentReadVersion = Readonly<{
    table: 'intents' | 'operations' | 'bindings' | 'subscriptionBindings' | 'reclassifications' | 'transactions' | 'subscriptions' | 'inbox' | 'configuration' | 'guards' | 'versionEvidence';
    id: string;
    revision: number | null;
}>;
export type ReductionInput = Readonly<{
    inputId: string;
    state: PaymentState;
    expected: readonly PaymentReadVersion[];
    incompleteReason?: string;
}>;
export type ReductionCommit = Readonly<{
    inputId: string;
    heldReason?: string;
    expected: readonly PaymentReadVersion[];
    state: PaymentState;
}>;
export type IntentAdmission = Readonly<{
    intent: PurchaseIntent;
    operation: PaymentOperation;
    subscriptionBinding?: SubscriptionBinding;
}>;
export type OperationInput = Readonly<{
    operation: PaymentOperation;
    intent?: PurchaseIntent;
    subscriptionBinding?: SubscriptionBinding;
    transactionBinding?: TransactionBinding;
    laneRevision: number;
}>;
export type OperationCommit = Readonly<{
    expectedReadSet?: readonly PaymentReadVersion[];
    expectedRevision: number;
    expectedLaneRevision: number;
    operation: PaymentOperation;
    binding?: TransactionBinding;
    subscriptionBinding?: SubscriptionBinding;
    intent?: PurchaseIntent;
}>;
export type StoredPurchaseRead = Readonly<{
    intent: PurchaseIntent;
    transactions: readonly TransactionAggregate[];
}>;
export type StoredSubscriptionRead = Readonly<{
    binding: SubscriptionBinding;
    observations: readonly SubscriptionAggregate[];
}>;
export type VerifiedInputAdmission = Readonly<{
    inputId: string;
    kind: 'admitted' | 'duplicate' | 'conflict';
}>;
export type StoreCommitResult = Readonly<{
    kind: 'committed';
}> | Readonly<{
    kind: 'conflict';
}> | Readonly<{
    kind: 'recovery_fenced';
}>;
/**
 * Consumer-shaped storage protocol. Every successful mutation is a confirmed durable commit.
 * No external I/O runs inside a store transaction. Implementations lock only the relevant rows in
 * one stable order. T1 admission locks the transaction placeholder and increments its revision for
 * adverse inputs; T2 validates the complete bounded read set, persists observations/facts/evidence/
 * targets and marks its inbox record processed atomically. Incomplete working sets must be explicit
 * and can publish only held control. Missing/overflow data is never interpreted as absent.
 * A lost COMMIT reply rejects; it cannot authorize dispatch. No cross-owner SQL or UoW escapes.
 */
export type StartPurchase = Readonly<{
    buyerId: string;
    offerId: string;
    requestKey: string;
}>;
export type ResolveUnknown = Readonly<{
    operationId: string;
    expectedRevision: number;
    actorId: string;
    auditRef: string;
    reason: string;
    action: 'keep_unknown' | 'retry' | 'bind_outcome';
    acceptedDuplicateRisk?: boolean;
    outcome?: ProviderResult<JsonValue>;
}>;
export type PaymentRuntimeOptions = Readonly<{
    scope: PaymentScope;
    producerNamespace: string;
    provider: PaymentProvider;
    store: PaymentStore;
    catalog: Catalog;
    now?: () => string;
    newId?: () => string;
    maxEvidenceBytes?: number;
    operationTimeoutMs?: number;
    /** Per-runtime bound, held through physical provider settlement, not just caller timeout. */
    maxConcurrentMutations?: number;
}>;
