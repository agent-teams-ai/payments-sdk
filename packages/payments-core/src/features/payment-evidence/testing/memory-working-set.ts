import type { Observation, AggregateIdentity, PaymentState } from "../domain/model.js";
import type { PaymentReadVersion, ReductionInput } from "../application/models/payment-models.js";

import { objectVersionDependentRoutes } from "../domain/reducer.js";
import { createEmptyPaymentState, objectVersionKey } from "../domain/values.js";

export const mutableTables = [
  "intents",
  "operations",
  "bindings",
  "subscriptionBindings",
  "reclassifications",
  "transactions",
  "subscriptions",
  "versionEvidence",
  "inbox",
] as const;

function workingSetSubject(
  state: PaymentState,
  inputId: string,
  aggregate: AggregateIdentity | undefined,
):
  | Readonly<{
      transactionRef: string | undefined;
      subscriptionRef: string | undefined;
      incoming: Observation | undefined;
    }>
  | undefined {
  if (aggregate) {
    return {
      transactionRef: aggregate.type === "transaction" ? aggregate.id : undefined,
      subscriptionRef: aggregate.type === "subscription" ? aggregate.id : undefined,
      incoming: undefined,
    };
  }
  const record = state.inbox[inputId];
  if (!record) {
    return;
  }
  const observation = record.input.observation;
  const transactionRef =
    record.input.adverseTransactionRef ??
    ("transactionRef" in observation ? observation.transactionRef : undefined);
  const subscriptionRef =
    "subscriptionRef" in observation && typeof observation.subscriptionRef === "string"
      ? observation.subscriptionRef
      : observation.kind === "transaction" && observation.subscriptionRef.presence === "known"
        ? (observation.subscriptionRef.value ?? undefined)
        : undefined;
  return { transactionRef, subscriptionRef, incoming: observation };
}

function includeMemoryTransaction(
  state: PaymentState,
  ref: string,
  add: (table: (typeof mutableTables)[number], id: string) => void,
  includeIntent: (id: string) => void,
  subscriptionRefs: Set<string>,
): void {
  add("transactions", ref);
  add("bindings", ref);
  const binding = state.bindings[ref];
  if (binding) {
    includeIntent(binding.intentId);
  }
  const current = state.transactions[ref]?.current;
  if (
    current?.subscriptionRef.presence === "known" &&
    typeof current.subscriptionRef.value === "string" &&
    current.subscriptionRef.value.length > 0
  ) {
    subscriptionRefs.add(current.subscriptionRef.value);
  }
}

export function buildMemoryWorkingSet(
  state: PaymentState,
  inputId: string,
  revision: (table: PaymentReadVersion["table"], id: string) => number | null,
  aggregate?: AggregateIdentity,
): ReductionInput | undefined {
  const slice = createEmptyPaymentState(),
    expected: PaymentReadVersion[] = [];
  slice.recoveryFenced = state.recoveryFenced;
  slice.consumers = [...state.consumers];
  expected.push({
    table: "configuration",
    id: "scope",
    revision: revision("configuration", "scope"),
  });
  const status = { incomplete: false, invalidVersion: false };
  const guard = (id: string): void => {
    if (!expected.some((item) => item.table === "guards" && item.id === id)) {
      expected.push({ table: "guards", id, revision: revision("guards", id) });
    }
  };
  const add = (table: (typeof mutableTables)[number], id: string): void => {
    if (expected.some((item) => item.table === table && item.id === id)) {
      return;
    }
    if (expected.length >= 128) {
      status.incomplete = true;
      return;
    }
    expected.push({ table, id, revision: revision(table, id) });
    const record = state[table][id];
    if (record !== undefined) {
      (slice[table] as Record<string, unknown>)[id] = structuredClone(record);
    }
    if (table === "inbox") {
      const observation = state.inbox[id]?.input.observation;
      if (observation) {
        includeVersion(observation);
      }
    }
    if (table === "subscriptions") {
      const observation = state.subscriptions[id]?.current;
      if (observation) {
        includeVersion(observation);
      }
    }
    if (table === "transactions") {
      for (const observation of state.transactions[id]?.observations ?? []) {
        includeVersion(observation);
      }
      for (const adjustment of Object.values(state.transactions[id]?.adjustments ?? {})) {
        includeVersion(adjustment);
      }
    }
  };
  const includeVersion = (observation: Observation): void => {
    try {
      const key = objectVersionKey(observation);
      if (typeof key === "string" && key.length > 0) {
        add("versionEvidence", key);
      }
    } catch {
      status.invalidVersion = true;
    }
  };
  const includeIntent = (intentId: string): void => {
    guard(`intent:${intentId}`);
    add("intents", intentId);
    const intent = state.intents[intentId];
    if (!intent) {
      return;
    }
    if (typeof intent.subscriptionBasisId === "string" && intent.subscriptionBasisId.length > 0) {
      add("subscriptionBindings", intent.subscriptionBasisId);
      add("reclassifications", intent.subscriptionBasisId);
    }
    for (const candidate of Object.values(state.transactions)) {
      if (
        candidate.completion?.intentId === intentId &&
        ["initial", "one_time"].includes(candidate.completion.classification)
      ) {
        add("transactions", candidate.transactionRef);
      }
    }
  };
  const subject = workingSetSubject(state, inputId, aggregate);
  if (!subject) {
    return;
  }
  if (!aggregate) {
    add("inbox", inputId);
  }
  const { transactionRef, subscriptionRef, incoming } = subject;
  const subscriptionRefs = new Set(
    typeof subscriptionRef === "string" && subscriptionRef.length > 0 ? [subscriptionRef] : [],
  );
  const includeTransaction = (ref: string): void => {
    includeMemoryTransaction(state, ref, add, includeIntent, subscriptionRefs);
  };
  if (typeof transactionRef === "string" && transactionRef.length > 0) {
    includeTransaction(transactionRef);
  }
  const includeIncomingRoutes = (observation: Observation): void => {
    let evidence: PaymentState["versionEvidence"][string] | undefined;
    try {
      const key = objectVersionKey(observation);
      evidence = typeof key === "string" && key.length > 0 ? state.versionEvidence[key] : undefined;
    } catch {
      status.invalidVersion = true;
    }
    for (const route of objectVersionDependentRoutes(observation, evidence)) {
      if (route.type === "transaction") {
        includeTransaction(route.id);
      } else {
        subscriptionRefs.add(route.id);
      }
    }
  };
  if (incoming) {
    includeIncomingRoutes(incoming);
  }
  for (const ref of subscriptionRefs) {
    guard(`subscription:${ref}`);
    add("subscriptions", ref);
    for (const binding of Object.values(state.subscriptionBindings)) {
      if (binding.providerSubscriptionRefs.includes(ref)) {
        add("subscriptionBindings", binding.bindingId);
        add("reclassifications", binding.bindingId);
        includeIntent(binding.originatingIntentId);
      }
    }
  }
  if (status.invalidVersion) {
    return { inputId, state: slice, expected, incompleteReason: "invalid_object_version" };
  }
  if (status.incomplete) {
    return { inputId, state: slice, expected, incompleteReason: "working_set_limit" };
  }
  return { inputId, state: slice, expected };
}
