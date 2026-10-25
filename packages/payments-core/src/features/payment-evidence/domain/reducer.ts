import type {
  AggregateIdentity,
  PaymentScope,
  Observation,
  VerifiedInput,
  EvidenceMessage,
  PaymentState,
} from "./model.js";
import { canonicalJson, digest, objectVersionKey } from "./values.js";
import {
  inputRoutes,
  objectVersionDependentRoutes,
  eventIdentityEvidence,
  compareEventIdentity,
  certifyObjectVersion,
} from "./event-identity.js";
import { flag, transactionAggregate, subscriptionAggregate } from "./evidence-state.js";
import { subscriptionOwnershipMismatch, reduceSubscription } from "./subscription-reduction.js";
import { reduceTransaction, reduceAdjustment } from "./transaction-reduction.js";
export { classifyCompletion, validateOffer } from "./completion.js";
export type { Classification } from "./completion.js";
export {
  compareEventIdentity,
  eventIdentityEvidence,
  inputRoutes,
  mergeEventIdentityEvidence,
  objectVersionDependentRoutes,
} from "./event-identity.js";
export { transactionAggregate, subscriptionAggregate } from "./evidence-state.js";
export { requireSubscriptionReclassification } from "./subscription-reduction.js";

export function reduceObservation(
  state: PaymentState,
  scope: PaymentScope,
  observation: Observation,
): "applied" | "conflict" | "held" {
  if (observation.kind !== "unsupported") {
    const certified = certifyObjectVersion(state, observation);
    if (certified.kind !== "certified") {
      for (const route of objectVersionDependentRoutes(
        observation,
        state.versionEvidence[objectVersionKey(observation) ?? ""],
      )) {
        const aggregate =
          route.type === "subscription"
            ? subscriptionAggregate(state, route.id)
            : transactionAggregate(state, route.id);
        flag(aggregate, certified.kind === "held" ? "incomplete_history" : "conflict");
        if (
          observation.kind === "subscription" &&
          subscriptionOwnershipMismatch(state, observation)
        ) {
          flag(aggregate, "ownership_mismatch");
        }
        aggregate.revision += 1;
        aggregate.publicationRequired = true;
      }
      return certified.kind;
    }
    observation = certified.observation;
  }
  switch (observation.kind) {
    case "transaction":
      reduceTransaction(state, scope, observation);
      break;
    case "subscription":
      reduceSubscription(state, observation);
      break;
    case "adjustment":
      reduceAdjustment(state, observation);
      break;
    case "unsupported": {
      if (typeof observation.transactionRef === "string" && observation.transactionRef.length > 0) {
        const target = transactionAggregate(state, observation.transactionRef);
        flag(target, "unsupported");
        target.revision += 1;
        target.publicationRequired = true;
      } else if (
        typeof observation.subscriptionRef === "string" &&
        observation.subscriptionRef.length > 0
      ) {
        const target = subscriptionAggregate(state, observation.subscriptionRef);
        flag(target, "unsupported");
        target.revision += 1;
        target.publicationRequired = true;
      } else {
        state.issues.push(`unresolved-routing:${observation.source.receiptId}`);
      }
    }
  }
  return "applied";
}

function adverseTransactionRefs(state: PaymentState, input: VerifiedInput): readonly string[] {
  const direct =
    input.adverseTransactionRef ??
    (input.observation.kind === "adjustment" ? input.observation.transactionRef : undefined);
  const refs = new Set(typeof direct === "string" && direct.length > 0 ? [direct] : []);
  if (input.observation.kind === "adjustment") {
    let key: string | undefined;
    try {
      key = objectVersionKey(input.observation);
    } catch {
      return [...refs];
    }
    for (const route of objectVersionDependentRoutes(
      input.observation,
      key === undefined ? undefined : state.versionEvidence[key],
    )) {
      if (route.type === "transaction") {
        refs.add(route.id);
      }
    }
  }
  return [...refs];
}

function flagInputConflict(
  state: PaymentState,
  input: Pick<VerifiedInput, "observation" | "adverseTransactionRef">,
): void {
  for (const route of inputRoutes(input)) {
    const aggregate =
      route.type === "transaction"
        ? transactionAggregate(state, route.id)
        : subscriptionAggregate(state, route.id);
    flag(aggregate, "conflict");
    aggregate.revision += 1;
    aggregate.publicationRequired = true;
  }
}

function retainReplayCustody(state: PaymentState, input: VerifiedInput): void {
  for (const ref of adverseTransactionRefs(state, input)) {
    const aggregate = transactionAggregate(state, ref);
    if (!aggregate.pendingAdverse.includes(input.inputId)) {
      aggregate.pendingAdverse.push(input.inputId);
      aggregate.revision += 1;
      aggregate.publicationRequired = true;
    }
  }
}

export function admitInput(
  state: PaymentState,
  input: VerifiedInput,
): "admitted" | "duplicate" | "conflict" {
  const existing = state.inbox[input.inputId];
  if (existing) {
    const identityConflict =
      compareEventIdentity(eventIdentityEvidence(existing.input), eventIdentityEvidence(input)) ===
      "conflict";
    if (
      existing.input.source.representationDigest === input.source.representationDigest &&
      !identityConflict
    ) {
      if (existing.state !== "processed") {
        existing.state = "pending";
        // Certification may have appeared since the first admission. Replays retain custody
        // on any newly known route without reopening markers already completed by T2.
        retainReplayCustody(state, input);
      }
      return "duplicate";
    }
    existing.conflict = true;
    state.issues.push(`input-identity-conflict:${input.inputId}`);
    flagInputConflict(state, existing.input);
    flagInputConflict(state, input);
    return "conflict";
  }
  let conflict = false;
  const incomingIdentity = eventIdentityEvidence(input);
  if (typeof input.source.eventId === "string" && input.source.eventId.length > 0) {
    for (const receipt of Object.values(state.inbox)) {
      if (
        compareEventIdentity(eventIdentityEvidence(receipt.input), incomingIdentity) === "conflict"
      ) {
        conflict = true;
        flagInputConflict(state, receipt.input);
      }
    }
  }
  state.inbox[input.inputId] = { input, state: "pending", conflict, attempts: 0 };
  for (const adverse of adverseTransactionRefs(state, input)) {
    const aggregate = transactionAggregate(state, adverse);
    if (!aggregate.pendingAdverse.includes(input.inputId)) {
      aggregate.pendingAdverse.push(input.inputId);
    }
    aggregate.revision += 1;
    aggregate.publicationRequired = true;
  }
  if (conflict) {
    flagInputConflict(state, input);
  }
  return conflict ? "conflict" : "admitted";
}

function storeMessage(
  state: PaymentState,
  publication: Readonly<{ scope: PaymentScope; producerNamespace: string; maxBytes: number }>,
  aggregate: AggregateIdentity,
  revision: number,
  payload: object,
): EvidenceMessage {
  const { scope, producerNamespace, maxBytes } = publication;
  const messageId = digest([producerNamespace, scope, aggregate, revision]);
  const base = {
    envelopeVersion: 1,
    schemaVersion: 1,
    producerNamespace,
    scope,
    aggregate,
    revision,
    messageId,
  };
  let body: Record<string, unknown> = { ...base, ...payload };
  if (Buffer.byteLength(canonicalJson(body)) + 80 > maxBytes) {
    body = { ...base, kind: "held", reason: "evidence_size_limit", resolutionRef: messageId };
  }
  const message = { ...body, bodyDigest: digest(body) } as EvidenceMessage;
  if (Buffer.byteLength(canonicalJson(message)) > maxBytes) {
    throw new RangeError("Evidence control envelope exceeds configured limit");
  }
  const existing = state.evidence[messageId];
  if (existing && existing.bodyDigest !== message.bodyDigest) {
    throw new Error("Evidence revision identity reused");
  }
  state.evidence[messageId] = message;
  for (const consumerId of state.consumers) {
    state.deliveries[canonicalJson([messageId, consumerId])] ??= {
      consumerId,
      messageId,
      acknowledged: false,
      attempts: 0,
    };
  }
  return message;
}

export function publishEvidence(
  state: PaymentState,
  scope: PaymentScope,
  producerNamespace: string,
  maxBytes: number,
): EvidenceMessage[] {
  const messages = [],
    publication = { scope, producerNamespace, maxBytes };
  for (const aggregate of Object.values(state.transactions)) {
    if (aggregate.publicationRequired) {
      const flags = [...aggregate.flags];
      if (aggregate.pendingAdverse.length > 0 && !flags.includes("pending_adverse")) {
        flags.push("pending_adverse");
      }
      aggregate.evidenceRevision += 1;
      const payload = flags.includes("incomplete_history")
        ? {
            kind: "held",
            reason: "object_version_history_incomplete",
            resolutionRef: aggregate.transactionRef,
          }
        : {
            kind: "complete",
            ...(aggregate.completion ? { completion: aggregate.completion } : {}),
            adjustments: Object.values(aggregate.adjustments).toSorted((a, b) =>
              a.adjustmentRef.localeCompare(b.adjustmentRef),
            ),
            flags,
          };
      messages.push(
        storeMessage(
          state,
          publication,
          { type: "transaction", id: aggregate.transactionRef },
          aggregate.evidenceRevision,
          payload,
        ),
      );
      aggregate.publicationRequired = false;
    }
  }
  for (const aggregate of Object.values(state.subscriptions)) {
    if (aggregate.publicationRequired) {
      aggregate.evidenceRevision += 1;
      const bindings = Object.values(state.subscriptionBindings).filter((binding) =>
        binding.providerSubscriptionRefs.includes(aggregate.subscriptionRef),
      );
      const binding = bindings[0];
      const payload =
        !aggregate.flags.includes("incomplete_history") &&
        bindings.length === 1 &&
        binding &&
        aggregate.current
          ? {
              kind: "subscription_complete",
              binding,
              observation: aggregate.current,
              flags: aggregate.flags,
            }
          : {
              kind: "held",
              reason: aggregate.flags.includes("incomplete_history")
                ? "object_version_history_incomplete"
                : "unresolved_binding",
              resolutionRef: aggregate.subscriptionRef,
            };
      messages.push(
        storeMessage(
          state,
          publication,
          { type: "subscription", id: aggregate.subscriptionRef },
          aggregate.evidenceRevision,
          payload,
        ),
      );
      aggregate.publicationRequired = false;
    }
  }
  return messages;
}

export function processInput(
  state: PaymentState,
  scope: PaymentScope,
  inputId: string,
): "processed" | "duplicate" | "quarantined" {
  let record = state.inbox[inputId];
  if (!record) {
    throw new Error("Unknown inbox input");
  }
  if (record.state === "processed") {
    return "duplicate";
  }
  record.attempts += 1;
  if (record.conflict) {
    record.state = "quarantined";
    record.issue = "conflicting_input";
    return "quarantined";
  }
  try {
    const staged = structuredClone(state);
    const reduction = reduceObservation(staged, scope, record.input.observation);
    Object.assign(state, staged);
    const updatedRecord = state.inbox[inputId];
    if (!updatedRecord) {
      throw new Error("Inbox disappeared during reduction");
    }
    record = updatedRecord;
    if (reduction === "held") {
      record.state = "quarantined";
      record.issue = "version_evidence_size_limit";
      return "quarantined";
    }
  } catch (error) {
    record.state = "quarantined";
    record.issue = error instanceof Error ? error.name : "decoder_failure";
    const ref =
      record.input.adverseTransactionRef ??
      ("transactionRef" in record.input.observation
        ? record.input.observation.transactionRef
        : undefined);
    if (typeof ref === "string" && ref.length > 0) {
      const aggregate = transactionAggregate(state, ref);
      flag(aggregate, "incomplete");
      aggregate.publicationRequired = true;
    } else if (
      "subscriptionRef" in record.input.observation &&
      typeof record.input.observation.subscriptionRef === "string" &&
      record.input.observation.subscriptionRef
    ) {
      const aggregate = subscriptionAggregate(state, record.input.observation.subscriptionRef);
      flag(aggregate, "incomplete");
      aggregate.publicationRequired = true;
    } else {
      state.issues.push(`quarantine-unresolved:${inputId}`);
    }
    return "quarantined";
  }
  const adverse = adverseTransactionRefs(state, record.input);
  if (adverse.length > 0 && record.input.observation.kind === "unsupported") {
    record.state = "quarantined";
    record.issue = record.input.observation.reason;
    return "quarantined";
  }
  for (const ref of adverse) {
    const aggregate = transactionAggregate(state, ref);
    aggregate.pendingAdverse = aggregate.pendingAdverse.filter((id) => id !== inputId);
    aggregate.revision += 1;
    aggregate.publicationRequired = true;
  }
  record.state = "processed";
  return "processed";
}

export function publishHeldEvidence(
  state: PaymentState,
  scope: PaymentScope,
  producerNamespace: string,
  reason: string,
  maxBytes: number,
): EvidenceMessage[] {
  const messages = [],
    publication = { scope, producerNamespace, maxBytes };
  for (const aggregate of Object.values(state.transactions)) {
    aggregate.evidenceRevision += 1;
    aggregate.revision += 1;
    aggregate.publicationRequired = false;
    const message = storeMessage(
      state,
      publication,
      { type: "transaction", id: aggregate.transactionRef },
      aggregate.evidenceRevision,
      { kind: "held", reason, resolutionRef: aggregate.transactionRef },
    );
    messages.push(message);
  }
  for (const aggregate of Object.values(state.subscriptions)) {
    aggregate.evidenceRevision += 1;
    aggregate.revision += 1;
    aggregate.publicationRequired = false;
    messages.push(
      storeMessage(
        state,
        publication,
        { type: "subscription", id: aggregate.subscriptionRef },
        aggregate.evidenceRevision,
        { kind: "held", reason, resolutionRef: aggregate.subscriptionRef },
      ),
    );
  }
  return messages;
}
