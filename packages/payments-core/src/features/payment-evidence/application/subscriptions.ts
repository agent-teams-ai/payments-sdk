import type { JsonValue, PaymentOperation } from "../domain/model.js";
import type {
  OperationResult,
  PaymentUpdateReady,
  CancellationOutcome,
} from "./models/payment-models.js";
import { assertIdentifier, digest } from "../domain/values.js";
import type { PaymentRuntimeContext } from "./runtime-context.js";
import { unavailable } from "./runtime-context.js";
import { executeOperation } from "./operations.js";
import { toResult } from "./outcomes.js";
import type { PaymentProvider } from "./ports/payment-ports.js";
type SubscriptionCommand = Readonly<{
  buyerId: string;
  bindingId: string;
  requestKey: string;
  kind: "cancellation" | "payment_update";
  timing?: "now" | "period_end";
}>;

function unsupportedCommand(
  provider: PaymentProvider,
  command: SubscriptionCommand,
): Extract<OperationResult<never>, { kind: "unsupported" }> | undefined {
  if (
    command.kind === "cancellation" &&
    (!command.timing ||
      !provider.capabilities.cancellation.includes(command.timing) ||
      !provider.cancelSubscription)
  ) {
    return { kind: "unsupported", capability: `cancellation:${command.timing ?? "missing"}` };
  }
  if (
    command.kind === "payment_update" &&
    (!provider.capabilities.paymentUpdate || !provider.openPaymentUpdate)
  ) {
    return { kind: "unsupported", capability: "payment_update" };
  }
  return;
}

export async function admitSubscriptionCommand(
  ctx: PaymentRuntimeContext,
  command: Readonly<{
    buyerId: string;
    bindingId: string;
    requestKey: string;
    kind: "cancellation" | "payment_update";
    timing?: "now" | "period_end";
  }>,
): Promise<OperationResult<JsonValue>> {
  const { provider, store, scope, newId } = ctx;
  if (!ctx.accepting) {
    return unavailable;
  }
  for (const id of [command.buyerId, command.bindingId, command.requestKey]) {
    assertIdentifier(id);
  }
  const unsupported = unsupportedCommand(provider, command);
  if (unsupported) {
    return unsupported;
  }
  const existing = await store.findRequest(scope, command.buyerId, command.requestKey);
  if (existing) {
    return existing.kind === command.kind &&
      existing.subscriptionBindingId === command.bindingId &&
      existing.timing === command.timing
      ? toResult(existing)
      : { kind: "rejected", code: "conflict" };
  }
  const subscription = await store.readSubscription(scope, command.buyerId, command.bindingId);
  const providerSubscriptionRef = subscription?.binding.selectedSubscriptionRef;
  if (
    !subscription ||
    !(typeof providerSubscriptionRef === "string" && providerSubscriptionRef.length > 0)
  ) {
    return { kind: "rejected", code: "ownership_mismatch" };
  }
  const fingerprint = digest([
    command.kind,
    command.buyerId,
    command.bindingId,
    providerSubscriptionRef,
    command.timing ?? null,
  ]);
  const operation: PaymentOperation = {
    operationId: newId(),
    kind: command.kind,
    buyerId: command.buyerId,
    requestKey: command.requestKey,
    fingerprint,
    subscriptionBindingId: command.bindingId,
    providerSubscriptionRef,
    intentId: subscription.binding.originatingIntentId,
    ...(command.timing ? { timing: command.timing } : {}),
    revision: 1,
    state: "prepared",
    attempts: [],
    audits: [],
  };
  const admitted = await store.admitOperation(scope, operation);
  if (admitted.kind === "conflict") {
    return { kind: "rejected", code: "conflict" };
  }
  if (admitted.kind === "recovery_fenced") {
    return unavailable;
  }
  return admitted.kind === "created"
    ? executeOperation(ctx, operation.operationId)
    : "operation" in admitted
      ? toResult(admitted.operation)
      : { kind: "rejected", code: "conflict" };
}

export async function requestCancellation(
  ctx: PaymentRuntimeContext,
  command: Readonly<{
    buyerId: string;
    bindingId: string;
    requestKey: string;
    timing: "now" | "period_end";
  }>,
): Promise<OperationResult<CancellationOutcome>> {
  return (await admitSubscriptionCommand(ctx, {
    ...command,
    kind: "cancellation",
  })) as OperationResult<CancellationOutcome>;
}

export async function openPaymentUpdate(
  ctx: PaymentRuntimeContext,
  command: Readonly<{ buyerId: string; bindingId: string; requestKey: string }>,
): Promise<OperationResult<PaymentUpdateReady>> {
  return (await admitSubscriptionCommand(ctx, {
    ...command,
    kind: "payment_update",
  })) as OperationResult<PaymentUpdateReady>;
}

export async function createManagementLink(
  ctx: PaymentRuntimeContext,
  command: Readonly<{
    buyerId: string;
    bindingId: string;
    customerAuthority: Readonly<{ customerRef: string; authorizationRef: string }>;
  }>,
): Promise<OperationResult<Readonly<{ url: string; expiresAt?: string }>>> {
  const { provider, store, scope } = ctx;
  if (!ctx.accepting) {
    return unavailable;
  }
  if (!provider.capabilities.customerManagement || !provider.createManagementLink) {
    return { kind: "unsupported", capability: "customer_management" };
  }
  assertIdentifier(command.customerAuthority.authorizationRef);
  const subscription = await store.readSubscription(scope, command.buyerId, command.bindingId);
  if (
    !subscription ||
    !(
      typeof subscription.binding.customerRef === "string" &&
      subscription.binding.customerRef.length > 0
    ) ||
    subscription.binding.customerRef !== command.customerAuthority.customerRef
  ) {
    return { kind: "rejected", code: "ownership_mismatch" };
  }
  const result = await provider.createManagementLink({
    customerRef: subscription.binding.customerRef,
    subscriptionRefs: subscription.binding.providerSubscriptionRefs,
  });
  if (result.kind === "outcome_unknown") {
    return { kind: "rejected", code: "unavailable" };
  }
  return result.kind === "rejected" ? { kind: "rejected", code: result.code } : result;
}
