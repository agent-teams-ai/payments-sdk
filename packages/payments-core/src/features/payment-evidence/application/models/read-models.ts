import type { AdjustmentObservation, CompletionFact, ErrorCode, EvidenceFlag, JsonValue, OfferSnapshot, OperationKind, OperationState, ResolutionAudit, SubscriptionObservation, TransactionObservation } from '../../domain/model.js';
/** Diagnostic values are snapshots. They carry no mutable store or aggregate contract. */
export type OperationObservation = Readonly<{
    kind: 'succeeded';
    value: JsonValue;
}> | Readonly<{
    kind: 'rejected';
    code: ErrorCode;
}> | Readonly<{
    kind: 'outcome_unknown';
}> | Readonly<{
    kind: 'unsupported';
    capability: string;
}>;
export type PaymentAttemptRead = Readonly<{
    attemptId: string;
    fingerprint: string;
    dispatchedAt: string;
    providerSubscriptionRef?: string;
    observations: readonly OperationObservation[];
}>;
export type PaymentOperationRead = Readonly<{
    operationId: string;
    kind: OperationKind;
    buyerId: string;
    requestKey: string;
    fingerprint: string;
    intentId?: string;
    subscriptionBindingId?: string;
    providerSubscriptionRef?: string;
    timing?: 'now' | 'period_end';
    revision: number;
    state: OperationState;
    attempts: readonly PaymentAttemptRead[];
    result?: OperationObservation;
    audits: readonly ResolutionAudit[];
}>;
export type PurchaseIntentRead = Readonly<{
    intentId: string;
    buyerId: string;
    requestKey: string;
    offer: OfferSnapshot;
    operationId: string;
    subscriptionBasisId?: string;
    transactionRefs: readonly string[];
    createdAt: string;
}>;
export type SubscriptionBindingRead = Readonly<{
    bindingId: string;
    buyerId: string;
    originatingIntentId: string;
    offer: OfferSnapshot;
    providerSubscriptionRefs: readonly string[];
    selectedSubscriptionRef?: string;
    streamSelection?: Readonly<{
        actorId: string;
        auditRef: string;
        reason: string;
        at: string;
    }>;
    customerRef: string | null;
}>;
export type PurchaseTransactionRead = Readonly<{
    transactionRef: string;
    revision: number;
    evidenceRevision: number;
    observations: readonly TransactionObservation[];
    adjustments: Readonly<Record<string, AdjustmentObservation>>;
    pendingAdverse: readonly string[];
    flags: readonly EvidenceFlag[];
    currentProfileFlags?: readonly EvidenceFlag[];
    retainedFlags?: readonly EvidenceFlag[];
    completion?: CompletionFact;
    current?: TransactionObservation;
}>;
export type SubscriptionObservationRead = Readonly<{
    subscriptionRef: string;
    revision: number;
    evidenceRevision: number;
    current?: SubscriptionObservation;
    lastKnown?: SubscriptionObservation;
    flags: readonly EvidenceFlag[];
    currentProfileFlags?: readonly EvidenceFlag[];
    retainedFlags?: readonly EvidenceFlag[];
}>;
export type PurchaseRead = Readonly<{
    intent: PurchaseIntentRead;
    transactions: readonly PurchaseTransactionRead[];
}>;
export type ObservedSubscriptionRead = Readonly<{
    binding: SubscriptionBindingRead;
    observations: readonly SubscriptionObservationRead[];
}>;
