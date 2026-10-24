import type { AggregateIdentity, EvidenceMessage, JsonValue, PaymentScope, VerifiedInput } from '../domain/model.js';
import type { CancellationOutcome, CheckoutReady, OperationResult, PaymentUpdateReady, ResolveUnknown, StartPurchase, VerifiedInputAdmission } from './models/payment-models.js';
import type { PaymentOperationRead, PurchaseRead, ObservedSubscriptionRead, SubscriptionBindingRead } from './models/read-models.js';
export type RequestCancellation = Readonly<{
    buyerId: string;
    bindingId: string;
    requestKey: string;
    timing: 'now' | 'period_end';
}>;
export type OpenPaymentUpdate = Readonly<{
    buyerId: string;
    bindingId: string;
    requestKey: string;
}>;
export type CreateManagementLink = Readonly<{
    buyerId: string;
    bindingId: string;
    customerAuthority: Readonly<{
        customerRef: string;
        authorizationRef: string;
    }>;
}>;
export type ManagementLink = Readonly<{
    url: string;
    expiresAt?: string;
}>;
export type SubscriptionSelection = Readonly<{
    binding: SubscriptionBindingRead;
    providerSubscriptionRef: string;
    /** Opaque optimistic version, not authority to select a stream. */
    version: string;
}>;
export type SelectSubscriptionStream = Readonly<{
    buyerId: string;
    bindingId: string;
    providerSubscriptionRef: string;
    /** Opaque optimistic version, not authority to select a stream. */
    version: string;
    actorId: string;
    auditRef: string;
    reason: string;
}>;
export type VerifiedInputResult = Readonly<{
    kind: 'succeeded';
    value: VerifiedInputAdmission | undefined;
}> | Readonly<{
    kind: 'rejected';
    code: 'unavailable' | 'ownership_mismatch' | 'validation';
}>;
export type PaymentRepairResult = Readonly<{
    inbox: number;
    reclassifications: number;
    publications: number;
    prepared: number;
    unknown: number;
}>;
export type PaymentStopReport = Readonly<{
    unresolvedExternalCalls: number;
    pendingWork: number;
}>;
export type PaymentLifecycle = {
    accepting: boolean;
    mutationCapacity: number;
    admittedMutations: number;
    unresolvedExternalCalls: number;
    pendingWork: number;
};
/** Provider-neutral inbound application ports. Implementations are checked against these values. */
export type PaymentsCheckout = {
    startPurchase: (command: StartPurchase) => Promise<OperationResult<CheckoutReady>>;
};
export type ReadOperation = Readonly<{ operationId: string; buyerId: string }>;
export type PaymentsRead = {
    readOperation: (query: ReadOperation) => Promise<PaymentOperationRead | undefined>;
    readPurchase: (buyerId: string, intentId: string) => Promise<PurchaseRead | undefined>;
    readObservedSubscription: (buyerId: string, bindingId: string) => Promise<ObservedSubscriptionRead | undefined>;
    readSubscriptionSelection: (buyerId: string, bindingId: string, providerSubscriptionRef?: string) => Promise<SubscriptionSelection | undefined>;
};
export type PaymentsManagement = {
    requestCancellation: (command: RequestCancellation) => Promise<OperationResult<CancellationOutcome>>;
    openPaymentUpdate: (command: OpenPaymentUpdate) => Promise<OperationResult<PaymentUpdateReady>>;
    createManagementLink: (command: CreateManagementLink) => Promise<OperationResult<ManagementLink>>;
};
export type PaymentsProcessing = {
    /** Privileged operator/worker inspection. Never expose through the buyer read facet. */
    inspectOperation: (operationId: string) => Promise<PaymentOperationRead | undefined>;
    ingestVerifiedInput: (input: VerifiedInput) => Promise<VerifiedInputResult>;
    processInbox: (inputId: string) => Promise<'processed' | 'duplicate' | 'quarantined' | 'conflict' | 'recovery_fenced' | 'missing'>;
    processReclassification: (bindingId: string, limit?: number) => Promise<'committed' | 'conflict' | 'recovery_fenced'>;
    flushPublication: (aggregate: AggregateIdentity) => Promise<'committed' | 'conflict' | 'recovery_fenced' | 'missing'>;
    executeOperation: (operationId: string) => Promise<OperationResult<JsonValue>>;
    refreshPurchase: (buyerId: string, intentId: string) => Promise<OperationResult<number>>;
    refreshSubscription: (buyerId: string, bindingId: string) => Promise<OperationResult<number>>;
    resolveUnknownOperation: (command: ResolveUnknown) => Promise<OperationResult<PaymentOperationRead>>;
    selectSubscriptionStream: (command: SelectSubscriptionStream) => Promise<OperationResult<SubscriptionBindingRead>>;
    repair: (limit?: number) => Promise<PaymentRepairResult>;
};
export type PaymentsDelivery = {
    registerConsumer: (consumerId: string, backfill?: boolean) => Promise<void>;
    readDeliveries: (consumerId: string, limit?: number) => Promise<readonly EvidenceMessage[]>;
    acknowledgeDelivery: (consumerId: string, messageId: string, bodyDigest: string) => Promise<'acknowledged' | 'duplicate' | 'conflict'>;
};
/** The plain runtime combines the same role ports and retains Host-owned lifetime control. */
export type Payments = PaymentsCheckout & PaymentsRead & PaymentsManagement & PaymentsProcessing & PaymentsDelivery & {
    scope: PaymentScope;
    stop: () => PaymentStopReport;
    drain: () => Promise<void>;
    lifecycle: () => PaymentLifecycle;
};
