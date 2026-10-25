import type {
  TransactionBinding,
  JsonValue,
  ProviderResult,
  PaymentOperation,
  PaymentState,
} from "../domain/model.js";
import type {
  IntentAdmission,
  OperationInput,
  OperationCommit,
  StoreCommitResult,
} from "../application/models/payment-models.js";
import type { PaymentStore } from "../application/ports/payment-ports.js";
import { transactionAggregate } from "../domain/reducer.js";
import { canonicalJson, digest, sameOperationCommand } from "../domain/values.js";

function hasDispatchAuthority(commit: OperationCommit): boolean {
  if (commit.operation.kind === "purchase") {
    return true;
  }
  const ref = commit.operation.providerSubscriptionRef,
    expected = commit.expectedReadSet ?? [];
  return (
    typeof ref === "string" &&
    ref.length > 0 &&
    expected.some(
      (item) =>
        item.table === "subscriptionBindings" && item.id === commit.operation.subscriptionBindingId,
    ) &&
    expected.some((item) => item.table === "subscriptions" && item.id === ref)
  );
}

function operationRevisionMatches(
  current: PaymentOperation | undefined,
  commit: OperationCommit,
): boolean {
  return current
    ? sameOperationCommand(current, commit.operation) &&
        current.revision === commit.expectedRevision
    : commit.expectedRevision === 0;
}

function dispatchLaneAvailable(state: PaymentState, operation: PaymentOperation): boolean {
  return !Object.values(state.operations).some(
    (candidate) =>
      candidate.operationId !== operation.operationId &&
      typeof candidate.subscriptionBindingId === "string" &&
      candidate.subscriptionBindingId.length > 0 &&
      candidate.subscriptionBindingId === operation.subscriptionBindingId &&
      ["dispatch_started", "outcome_unknown"].includes(candidate.state),
  );
}

function startsPreparedOperation(
  current: PaymentOperation | undefined,
  operation: PaymentOperation,
): boolean {
  return current?.state === "prepared" && operation.state === "dispatch_started";
}

function applyTransactionBinding(state: PaymentState, binding: TransactionBinding): boolean {
  const existing = state.bindings[binding.transactionRef];
  if (
    existing &&
    (existing.intentId !== binding.intentId ||
      existing.buyerId !== binding.buyerId ||
      (existing.purpose !== binding.purpose &&
        !(existing.purpose === "commercial" && binding.purpose === "recovery")))
  ) {
    return false;
  }
  state.bindings[binding.transactionRef] =
    existing?.customerRef !== null && existing?.customerRef !== undefined
      ? { ...binding, customerRef: existing.customerRef }
      : binding;
  const aggregate = transactionAggregate(state, binding.transactionRef);
  aggregate.revision += 1;
  aggregate.publicationRequired = true;
  return true;
}

export function admitMemoryIntent(
  state: PaymentState,
  admission: IntentAdmission,
): Awaited<ReturnType<PaymentStore["admitIntent"]>> {
  if (state.recoveryFenced) {
    return { kind: "recovery_fenced" } as const;
  }
  const key = canonicalJson([admission.operation.buyerId, admission.operation.requestKey]),
    id = state.requestKeys[key],
    previous = typeof id === "string" && id.length > 0 ? state.operations[id] : undefined;
  if (previous) {
    return previous.fingerprint === admission.operation.fingerprint
      ? ({ kind: "existing", operation: previous } as const)
      : ({ kind: "conflict" } as const);
  }
  state.requestKeys[key] = admission.operation.operationId;
  state.operations[admission.operation.operationId] = admission.operation;
  state.intents[admission.intent.intentId] = admission.intent;
  if (admission.subscriptionBinding) {
    state.subscriptionBindings[admission.subscriptionBinding.bindingId] =
      admission.subscriptionBinding;
  }
  return { kind: "created", operation: admission.operation } as const;
}

export function admitMemoryOperation(
  state: PaymentState,
  operation: PaymentOperation,
): Awaited<ReturnType<PaymentStore["admitOperation"]>> {
  if (state.recoveryFenced) {
    return { kind: "recovery_fenced" } as const;
  }
  const key = canonicalJson([operation.buyerId, operation.requestKey]),
    id = state.requestKeys[key],
    previous = typeof id === "string" && id.length > 0 ? state.operations[id] : undefined;
  if (previous) {
    return previous.fingerprint === operation.fingerprint
      ? ({ kind: "existing", operation: previous } as const)
      : ({ kind: "conflict" } as const);
  }
  const binding =
    typeof operation.subscriptionBindingId === "string" &&
    operation.subscriptionBindingId.length > 0
      ? state.subscriptionBindings[operation.subscriptionBindingId]
      : undefined;
  if (!binding || binding.buyerId !== operation.buyerId) {
    return { kind: "conflict" } as const;
  }
  state.requestKeys[key] = operation.operationId;
  state.operations[operation.operationId] = operation;
  return { kind: "created", operation } as const;
}

export function findMemoryRequest(
  state: PaymentState,
  buyerId: string,
  requestKey: string,
): PaymentOperation | undefined {
  const id = state.requestKeys[canonicalJson([buyerId, requestKey])];
  return typeof id === "string" && id.length > 0 ? state.operations[id] : undefined;
}

export function loadMemoryOperation(
  state: PaymentState,
  operationId: string,
  laneRevision: (state: PaymentState, operation: PaymentOperation) => number,
): OperationInput | undefined {
  const operation = state.operations[operationId];
  if (!operation) {
    return;
  }
  const intent =
    typeof operation.intentId === "string" && operation.intentId.length > 0
      ? state.intents[operation.intentId]
      : undefined;
  const subscriptionBinding =
    typeof operation.subscriptionBindingId === "string" &&
    operation.subscriptionBindingId.length > 0
      ? state.subscriptionBindings[operation.subscriptionBindingId]
      : typeof intent?.subscriptionBasisId === "string" && intent.subscriptionBasisId.length > 0
        ? state.subscriptionBindings[intent.subscriptionBasisId]
        : undefined;
  return {
    operation,
    ...(intent ? { intent } : {}),
    ...(subscriptionBinding ? { subscriptionBinding } : {}),
    laneRevision: laneRevision(state, operation),
  };
}

export function readMemoryPurchase(
  state: PaymentState,
  buyerId: string,
  intentId: string,
): Awaited<ReturnType<PaymentStore["readPurchase"]>> {
  const intent = state.intents[intentId];
  if (!intent || intent.buyerId !== buyerId) {
    return;
  }
  return {
    intent,
    transactions: Object.values(state.transactions).filter(
      (item) => state.bindings[item.transactionRef]?.intentId === intentId,
    ),
  };
}

export function readMemorySubscription(
  state: PaymentState,
  buyerId: string,
  bindingId: string,
): Awaited<ReturnType<PaymentStore["readSubscription"]>> {
  const binding = state.subscriptionBindings[bindingId];
  if (!binding || binding.buyerId !== buyerId) {
    return;
  }
  return {
    binding,
    observations: binding.providerSubscriptionRefs.flatMap((ref) =>
      state.subscriptions[ref] ? [state.subscriptions[ref]] : [],
    ),
  };
}

export function recordMemoryAttemptObservation(
  state: PaymentState,
  operationId: string,
  attemptId: string,
  result: ProviderResult<JsonValue>,
): void {
  const operation = state.operations[operationId],
    attempt = operation?.attempts.find((item) => item.attemptId === attemptId);
  if (!attempt || !operation) {
    throw new Error("Unknown operation attempt");
  }
  if (!attempt.observations.some((item) => digest(item) === digest(result))) {
    attempt.observations.push(result);
    operation.revision += 1;
  }
}

export function commitMemoryOperation(
  state: PaymentState,
  commit: OperationCommit,
  dispatch: boolean,
  readSetMatches: () => boolean,
  laneRevision: (state: PaymentState, operation: PaymentOperation) => number,
): StoreCommitResult {
  if (state.recoveryFenced) {
    return { kind: "recovery_fenced" };
  }
  const current = state.operations[commit.operation.operationId];
  if (!readSetMatches()) {
    return { kind: "conflict" };
  }
  if (dispatch && !hasDispatchAuthority(commit)) {
    return { kind: "conflict" };
  }
  if (!operationRevisionMatches(current, commit)) {
    return { kind: "conflict" };
  }
  if (laneRevision(state, current ?? commit.operation) !== commit.expectedLaneRevision) {
    return { kind: "conflict" };
  }
  if (dispatch && !dispatchLaneAvailable(state, commit.operation)) {
    return { kind: "conflict" };
  }
  if (dispatch && !startsPreparedOperation(current, commit.operation)) {
    return { kind: "conflict" };
  }
  const key = canonicalJson([commit.operation.buyerId, commit.operation.requestKey]),
    existingId = state.requestKeys[key];
  if (
    typeof existingId === "string" &&
    existingId.length > 0 &&
    existingId !== commit.operation.operationId
  ) {
    return { kind: "conflict" };
  }
  if (commit.binding && !applyTransactionBinding(state, commit.binding)) {
    return { kind: "conflict" };
  }
  state.operations[commit.operation.operationId] = commit.operation;
  state.requestKeys[key] = commit.operation.operationId;
  if (commit.intent) {
    state.intents[commit.intent.intentId] = commit.intent;
  }
  if (commit.subscriptionBinding) {
    state.subscriptionBindings[commit.subscriptionBinding.bindingId] = commit.subscriptionBinding;
  }
  return { kind: "committed" };
}
