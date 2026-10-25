import type {
  PaymentOperation,
  ProviderResult,
  JsonValue,
  PurchaseIntent,
  SubscriptionBinding,
  TransactionAggregate,
  SubscriptionAggregate,
} from "../domain/model.js";
import type { StoredPurchaseRead, StoredSubscriptionRead } from "./models/payment-models.js";
import type {
  OperationObservation,
  PaymentOperationRead,
  PurchaseIntentRead,
  SubscriptionBindingRead,
  PurchaseTransactionRead,
  SubscriptionObservationRead,
  PurchaseRead,
  ObservedSubscriptionRead,
} from "./models/read-models.js";
function outcomeSnapshot(result: ProviderResult<JsonValue>): OperationObservation {
  switch (result.kind) {
    case "succeeded":
      return { kind: result.kind, value: result.value };
    case "rejected":
      return { kind: result.kind, code: result.code };
    case "outcome_unknown":
      return { kind: result.kind };
    case "unsupported":
      return { kind: result.kind, capability: result.capability };
  }
}
export function operationSnapshot(operation: PaymentOperation): PaymentOperationRead {
  return structuredClone({
    operationId: operation.operationId,
    kind: operation.kind,
    buyerId: operation.buyerId,
    requestKey: operation.requestKey,
    fingerprint: operation.fingerprint,
    ...(operation.intentId === undefined ? {} : { intentId: operation.intentId }),
    ...(operation.subscriptionBindingId === undefined
      ? {}
      : { subscriptionBindingId: operation.subscriptionBindingId }),
    ...(operation.providerSubscriptionRef === undefined
      ? {}
      : { providerSubscriptionRef: operation.providerSubscriptionRef }),
    ...(operation.timing === undefined ? {} : { timing: operation.timing }),
    revision: operation.revision,
    state: operation.state,
    attempts: operation.attempts.map((attempt) => ({
      attemptId: attempt.attemptId,
      fingerprint: attempt.fingerprint,
      dispatchedAt: attempt.dispatchedAt,
      ...(attempt.providerSubscriptionRef === undefined
        ? {}
        : { providerSubscriptionRef: attempt.providerSubscriptionRef }),
      observations: attempt.observations.map(outcomeSnapshot),
    })),
    ...(operation.result === undefined ? {} : { result: outcomeSnapshot(operation.result) }),
    audits: operation.audits,
  });
}
function intentSnapshot(intent: PurchaseIntent): PurchaseIntentRead {
  return {
    intentId: intent.intentId,
    buyerId: intent.buyerId,
    requestKey: intent.requestKey,
    offer: intent.offer,
    operationId: intent.operationId,
    ...(intent.subscriptionBasisId === undefined
      ? {}
      : { subscriptionBasisId: intent.subscriptionBasisId }),
    transactionRefs: intent.transactionRefs,
    createdAt: intent.createdAt,
  };
}
export function bindingSnapshot(binding: SubscriptionBinding): SubscriptionBindingRead {
  return structuredClone({
    bindingId: binding.bindingId,
    buyerId: binding.buyerId,
    originatingIntentId: binding.originatingIntentId,
    offer: binding.offer,
    providerSubscriptionRefs: binding.providerSubscriptionRefs,
    ...(binding.selectedSubscriptionRef === undefined
      ? {}
      : { selectedSubscriptionRef: binding.selectedSubscriptionRef }),
    ...(binding.streamSelection === undefined ? {} : { streamSelection: binding.streamSelection }),
    customerRef: binding.customerRef,
  });
}
function transactionSnapshot(transaction: TransactionAggregate): PurchaseTransactionRead {
  return {
    transactionRef: transaction.transactionRef,
    revision: transaction.revision,
    evidenceRevision: transaction.evidenceRevision,
    observations: transaction.observations,
    adjustments: transaction.adjustments,
    pendingAdverse: transaction.pendingAdverse,
    flags: transaction.flags,
    ...(transaction.currentProfileFlags === undefined
      ? {}
      : { currentProfileFlags: transaction.currentProfileFlags }),
    ...(transaction.retainedFlags === undefined
      ? {}
      : { retainedFlags: transaction.retainedFlags }),
    ...(transaction.completion === undefined ? {} : { completion: transaction.completion }),
    ...(transaction.current === undefined ? {} : { current: transaction.current }),
  };
}
export function purchaseSnapshot(purchase: StoredPurchaseRead): PurchaseRead {
  return structuredClone({
    intent: intentSnapshot(purchase.intent),
    transactions: purchase.transactions.map(transactionSnapshot),
  });
}
function observationSnapshot(subscription: SubscriptionAggregate): SubscriptionObservationRead {
  return {
    subscriptionRef: subscription.subscriptionRef,
    revision: subscription.revision,
    evidenceRevision: subscription.evidenceRevision,
    ...(subscription.current === undefined ? {} : { current: subscription.current }),
    ...(subscription.lastKnown === undefined ? {} : { lastKnown: subscription.lastKnown }),
    flags: subscription.flags,
    ...(subscription.currentProfileFlags === undefined
      ? {}
      : { currentProfileFlags: subscription.currentProfileFlags }),
    ...(subscription.retainedFlags === undefined
      ? {}
      : { retainedFlags: subscription.retainedFlags }),
  };
}
export function subscriptionSnapshot(
  subscription: StoredSubscriptionRead,
): ObservedSubscriptionRead {
  return structuredClone({
    binding: bindingSnapshot(subscription.binding),
    observations: subscription.observations.map(observationSnapshot),
  });
}
