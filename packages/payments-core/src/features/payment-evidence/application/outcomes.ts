import type { JsonValue, ProviderResult, PaymentOperation } from "../domain/model.js";
import type { OperationResult, OperationInput, OperationCommit } from "./models/payment-models.js";
import { assertIdentifier, exactTime } from "../domain/values.js";

export const jsonResult = <T>(result: ProviderResult<T>): ProviderResult<JsonValue> =>
  structuredClone(result) as ProviderResult<JsonValue>;
export function toResult<T>(operation: PaymentOperation): OperationResult<T> {
  if (operation.state === "succeeded" && operation.result?.kind === "succeeded") {
    return { kind: "succeeded", value: operation.result.value as T };
  }
  if (operation.state === "rejected" && operation.result?.kind === "rejected") {
    return { kind: "rejected", code: operation.result.code };
  }
  if (operation.result?.kind === "unsupported") {
    return { kind: "unsupported", capability: operation.result.capability };
  }
  if (operation.state === "outcome_unknown") {
    return { kind: "outcome_unknown", operationId: operation.operationId };
  }
  return { kind: "pending", operationId: operation.operationId };
}

export function operationCommit(
  input: OperationInput,
  operation: PaymentOperation,
): OperationCommit {
  return {
    expectedRevision: input.operation.revision,
    expectedLaneRevision: input.laneRevision,
    operation,
  };
}

export function resultState(result: ProviderResult<JsonValue>): PaymentOperation["state"] {
  return result.kind === "succeeded"
    ? "succeeded"
    : result.kind === "outcome_unknown"
      ? "outcome_unknown"
      : "rejected";
}

function validateCancellation(operation: PaymentOperation, value: object): void {
  if (operation.timing === "period_end") {
    if (
      !("kind" in value) ||
      value.kind !== "scheduled" ||
      !("effectiveAt" in value) ||
      typeof value.effectiveAt !== "string"
    ) {
      throw new TypeError("Invalid cancellation outcome");
    }
    exactTime(value.effectiveAt);
    return;
  }
  if (operation.timing === "now") {
    if (
      !("kind" in value) ||
      value.kind !== "applied" ||
      !("observedStatus" in value) ||
      typeof value.observedStatus !== "string"
    ) {
      throw new TypeError("Invalid cancellation outcome");
    }
    assertIdentifier(value.observedStatus);
    return;
  }
  throw new TypeError("Invalid cancellation outcome");
}

function checkoutOutcome(value: object): Readonly<{ transactionRef: string; intentId: unknown }> {
  if (!("transactionRef" in value) || !("intentId" in value) || !("checkout" in value)) {
    throw new TypeError("Invalid checkout outcome");
  }
  assertIdentifier(value.transactionRef);
  const instructions = value.checkout;
  if (instructions === null || typeof instructions !== "object" || Array.isArray(instructions)) {
    throw new TypeError("Invalid checkout instructions");
  }
  for (const instruction of [
    "url" in instructions ? instructions.url : undefined,
    "token" in instructions ? instructions.token : undefined,
  ]) {
    if (
      instruction !== undefined &&
      (typeof instruction !== "string" || instruction.length === 0 || instruction.length > 8192)
    ) {
      throw new TypeError("Invalid checkout instruction");
    }
  }
  return { transactionRef: value.transactionRef, intentId: value.intentId };
}

function purchaseChanges(
  input: OperationInput,
  value: Readonly<{ transactionRef: string; intentId: unknown }>,
): Pick<OperationCommit, "binding" | "intent"> {
  const intent = input.intent ? structuredClone(input.intent) : undefined;
  if (!intent || intent.buyerId !== input.operation.buyerId || value.intentId !== intent.intentId) {
    throw new TypeError("Checkout intent mismatch");
  }
  if (!intent.transactionRefs.includes(value.transactionRef)) {
    intent.transactionRefs.push(value.transactionRef);
  }
  return {
    intent,
    binding: {
      transactionRef: value.transactionRef,
      intentId: intent.intentId,
      buyerId: intent.buyerId,
      purpose: "commercial",
      customerRef: null,
    },
  };
}

function paymentUpdateChanges(
  input: OperationInput,
  checkout: Readonly<{ transactionRef: string; intentId: unknown }>,
  value: object,
): Pick<OperationCommit, "binding" | "intent"> {
  const binding = input.subscriptionBinding;
  const ref = input.operation.providerSubscriptionRef;
  if (
    !binding ||
    binding.buyerId !== input.operation.buyerId ||
    !(typeof ref === "string" && ref.length > 0) ||
    !binding.providerSubscriptionRefs.includes(ref) ||
    checkout.intentId !== binding.originatingIntentId ||
    input.operation.intentId !== binding.originatingIntentId ||
    !("purpose" in value) ||
    (value.purpose !== "payment_method" && value.purpose !== "recovery")
  ) {
    throw new TypeError("Invalid payment update outcome");
  }
  return {
    binding: {
      transactionRef: checkout.transactionRef,
      intentId: binding.originatingIntentId,
      buyerId: input.operation.buyerId,
      purpose: value.purpose,
      customerRef: binding.customerRef,
    },
  };
}

export function successfulOutcomeChanges(
  input: OperationInput,
  value: unknown,
): Pick<OperationCommit, "binding" | "intent"> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Invalid successful outcome");
  }
  if (input.operation.kind === "cancellation") {
    validateCancellation(input.operation, value);
    return {};
  }
  const checkout = checkoutOutcome(value);
  return input.operation.kind === "purchase"
    ? purchaseChanges(input, checkout)
    : paymentUpdateChanges(input, checkout, value);
}
