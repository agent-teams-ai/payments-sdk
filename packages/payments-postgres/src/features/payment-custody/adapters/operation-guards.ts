import { canonicalJson } from "@agent-teams/payments-core";
import type {
  PaymentOperation,
  TransactionBinding,
  OperationCommit,
  StoreCommitResult,
} from "@agent-teams/payments-core/store";
import type { Lane } from "./store-context.js";
import { conflict, fenced } from "./store-context.js";

export function hasReference(value: string | undefined): value is string {
  return value !== undefined && value !== "";
}
export function requestIdentity(
  operation: Pick<PaymentOperation, "buyerId" | "requestKey">,
): string {
  return canonicalJson([operation.buyerId, operation.requestKey]);
}
export function laneIdentity(operation: PaymentOperation): string {
  return hasReference(operation.subscriptionBindingId)
    ? `subscription:${operation.subscriptionBindingId}`
    : `operation:${operation.operationId}`;
}
export function unresolved(operation: PaymentOperation): boolean {
  return operation.state === "dispatch_started" || operation.state === "outcome_unknown";
}
export function nextLaneOwner(lane: Lane, operation: PaymentOperation): string | undefined {
  // A late terminal result cannot release another command's unresolved lane.
  if (
    hasReference(lane.unresolvedOperationId) &&
    lane.unresolvedOperationId !== operation.operationId
  ) {
    return lane.unresolvedOperationId;
  }
  return unresolved(operation) ? operation.operationId : undefined;
}
export function compatibleBinding(
  existing: TransactionBinding,
  proposed: TransactionBinding,
): boolean {
  const purpose =
    existing.purpose === proposed.purpose ||
    (existing.purpose === "commercial" && proposed.purpose === "recovery") ||
    (existing.purpose === "recovery" && proposed.purpose === "commercial");
  const customer =
    existing.customerRef === null ||
    proposed.customerRef === null ||
    existing.customerRef === proposed.customerRef;
  return (
    existing.intentId === proposed.intentId &&
    existing.buyerId === proposed.buyerId &&
    purpose &&
    customer
  );
}
function dispatchPrerequisites(current: PaymentOperation, commit: OperationCommit): boolean {
  if (current.kind === "purchase") {
    return true;
  }
  const reads = commit.expectedReadSet ?? [];
  return (
    hasReference(current.providerSubscriptionRef) &&
    hasReference(current.subscriptionBindingId) &&
    reads.some(
      (read) =>
        read.table === "subscriptionBindings" &&
        read.id === current.subscriptionBindingId &&
        read.revision !== null,
    ) &&
    reads.some(
      (read) =>
        read.table === "subscriptions" &&
        read.id === current.providerSubscriptionRef &&
        read.revision !== null,
    )
  );
}
export function dispatchRejection(
  current: PaymentOperation,
  lane: Lane,
  commit: OperationCommit,
): StoreCommitResult | undefined {
  if (!dispatchPrerequisites(current, commit)) {
    return conflict;
  }
  if (hasReference(lane.recoveryReviewRequired)) {
    return fenced;
  }
  const anotherOwner =
    hasReference(lane.unresolvedOperationId) &&
    lane.unresolvedOperationId !== commit.operation.operationId;
  if (
    current.state !== "prepared" ||
    commit.operation.state !== "dispatch_started" ||
    anotherOwner
  ) {
    return conflict;
  }
  return;
}
