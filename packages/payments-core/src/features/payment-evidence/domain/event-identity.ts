import type {
  Observation,
  VerifiedInput,
  ObjectVersionEvidence,
  EventIdentityEvidence,
  AggregateIdentity,
  PaymentState,
} from "./model.js";
import {
  compareTime,
  exactTime,
  objectVersionKey,
  canonicalJson,
  MAX_OBJECT_VERSION_EVIDENCE_BYTES,
} from "./values.js";
import { semantic, compatible, mergeFields } from "./observation-fields.js";

export function inputRoutes(
  input: Pick<VerifiedInput, "observation" | "adverseTransactionRef">,
): readonly AggregateIdentity[] {
  const routes: AggregateIdentity[] = [],
    observation = input.observation;
  const transactionRef =
    input.adverseTransactionRef ??
    ("transactionRef" in observation ? observation.transactionRef : undefined);
  if (typeof transactionRef === "string" && transactionRef.length > 0) {
    routes.push({ type: "transaction", id: transactionRef });
  }
  if (
    "transactionRef" in observation &&
    observation.transactionRef &&
    observation.transactionRef !== transactionRef
  ) {
    routes.push({ type: "transaction", id: observation.transactionRef });
  }
  if (
    "subscriptionRef" in observation &&
    typeof observation.subscriptionRef === "string" &&
    observation.subscriptionRef
  ) {
    routes.push({ type: "subscription", id: observation.subscriptionRef });
  }
  return routes;
}

export function objectVersionDependentRoutes(
  observation: Observation,
  evidence: ObjectVersionEvidence | undefined,
): readonly AggregateIdentity[] {
  const routes = [...inputRoutes({ observation })];
  if (
    observation.kind === "adjustment" &&
    evidence?.kind === "certified" &&
    evidence.projection.kind === "adjustment"
  ) {
    const parent = evidence.projection.transactionRef;
    if (!routes.some((route) => route.type === "transaction" && route.id === parent)) {
      routes.push({ type: "transaction", id: parent });
    }
  }
  return routes;
}

export function eventIdentityEvidence(input: VerifiedInput): EventIdentityEvidence {
  const { source: ignored, ...projection } = input.observation;
  void ignored;
  const source = input.source;
  return {
    provider: input.scope.provider,
    paymentAccountId: input.scope.paymentAccountId,
    environment: input.scope.environment,
    ...(source.eventId === undefined ? {} : { eventId: source.eventId }),
    ...(source.eventType === undefined ? {} : { eventType: source.eventType }),
    ...(source.occurredAt === undefined ? {} : { occurredAt: source.occurredAt }),
    ...(source.kind === "verified_webhook" && source.stableEnvelopeDigest !== undefined
      ? { rawStableEnvelopeDigest: source.stableEnvelopeDigest }
      : {}),
    projection,
    routes: inputRoutes(input),
  };
}

function eventSubject(
  evidence: EventIdentityEvidence,
): Readonly<{ kind: string; id: string }> | undefined {
  const projection = evidence.projection;
  if (projection.kind === "transaction") {
    return { kind: projection.kind, id: projection.transactionRef };
  }
  if (projection.kind === "subscription") {
    return { kind: projection.kind, id: projection.subscriptionRef };
  }
  if (projection.kind === "adjustment") {
    return { kind: projection.kind, id: projection.adjustmentRef };
  }
  if (
    evidence.eventType?.startsWith("transaction.") === true &&
    typeof projection.transactionRef === "string" &&
    projection.transactionRef.length > 0
  ) {
    return { kind: "transaction", id: projection.transactionRef };
  }
  if (
    evidence.eventType?.startsWith("subscription.") === true &&
    typeof projection.subscriptionRef === "string" &&
    projection.subscriptionRef.length > 0
  ) {
    return { kind: "subscription", id: projection.subscriptionRef };
  }
  return;
}

function eventParent(evidence: EventIdentityEvidence): string | undefined {
  const projection = evidence.projection;
  return projection.kind === "adjustment" ||
    (projection.kind === "unsupported" && evidence.eventType?.startsWith("adjustment.") === true)
    ? projection.transactionRef
    : undefined;
}

function sameEventIdentity(a: EventIdentityEvidence, b: EventIdentityEvidence): boolean {
  return (
    typeof a.eventId === "string" &&
    a.eventId.length > 0 &&
    a.eventId === b.eventId &&
    a.provider === b.provider &&
    a.paymentAccountId === b.paymentAccountId &&
    a.environment === b.environment
  );
}

function eventMetadataConflict(a: EventIdentityEvidence, b: EventIdentityEvidence): boolean {
  if (a.eventType !== undefined && b.eventType !== undefined && a.eventType !== b.eventType) {
    return true;
  }
  if (a.occurredAt !== undefined && b.occurredAt !== undefined) {
    try {
      if (compareTime(a.occurredAt, b.occurredAt) !== 0) {
        return true;
      }
    } catch {
      return true;
    }
  }
  return (
    a.rawStableEnvelopeDigest !== undefined &&
    b.rawStableEnvelopeDigest !== undefined &&
    a.rawStableEnvelopeDigest !== b.rawStableEnvelopeDigest
  );
}

export function compareEventIdentity(
  a: EventIdentityEvidence,
  b: EventIdentityEvidence,
): "unrelated" | "compatible" | "conflict" {
  if (!sameEventIdentity(a, b)) {
    return "unrelated";
  }
  if (eventMetadataConflict(a, b)) {
    return "conflict";
  }
  const aa = eventSubject(a),
    bb = eventSubject(b);
  if (aa && bb && (aa.kind !== bb.kind || aa.id !== bb.id)) {
    return "conflict";
  }
  const ap = eventParent(a),
    bp = eventParent(b);
  if (ap !== undefined && bp !== undefined && ap !== bp) {
    return "conflict";
  }
  if (
    a.projection.kind !== "unsupported" &&
    b.projection.kind !== "unsupported" &&
    !compatible(semantic(a.projection), semantic(b.projection))
  ) {
    return "conflict";
  }
  return "compatible";
}

export function mergeEventIdentityEvidence(
  a: EventIdentityEvidence,
  b: EventIdentityEvidence,
): EventIdentityEvidence {
  if (compareEventIdentity(a, b) !== "compatible") {
    throw new TypeError("Cannot merge conflicting or unrelated event identities");
  }
  const projection =
    a.projection.kind === "unsupported" && b.projection.kind !== "unsupported"
      ? b.projection
      : b.projection.kind === "unsupported" && a.projection.kind !== "unsupported"
        ? a.projection
        : mergeFields(a.projection, b.projection);
  const routes = [...a.routes];
  for (const route of b.routes) {
    if (!routes.some((existing) => existing.type === route.type && existing.id === route.id)) {
      routes.push(route);
    }
  }
  return {
    ...a,
    ...(a.eventType === undefined && b.eventType !== undefined ? { eventType: b.eventType } : {}),
    ...(a.occurredAt === undefined && b.occurredAt !== undefined
      ? { occurredAt: b.occurredAt }
      : {}),
    ...(a.rawStableEnvelopeDigest === undefined && b.rawStableEnvelopeDigest !== undefined
      ? { rawStableEnvelopeDigest: b.rawStableEnvelopeDigest }
      : {}),
    projection,
    routes,
  };
}

type VersionedObservation = Exclude<Observation, { kind: "unsupported" }>;

export function certifyObjectVersion(
  state: PaymentState,
  observation: VersionedObservation,
):
  | Readonly<{ kind: "certified"; observation: VersionedObservation }>
  | Readonly<{ kind: "conflict" | "held" }> {
  const key = objectVersionKey(observation);
  if (!(typeof key === "string" && key.length > 0)) {
    throw new Error("Versioned observation has no identity");
  }
  const time = exactTime(observation.version),
    entityRef =
      observation.kind === "transaction"
        ? observation.transactionRef
        : observation.kind === "subscription"
          ? observation.subscriptionRef
          : observation.adjustmentRef;
  const original = state.versionEvidence[key];
  if (original?.kind === "held") {
    return { kind: "held" };
  }
  const { source, ...incoming } = observation;
  if (
    original &&
    (!compatible(semantic(original.projection), semantic(incoming)) || original.conflict)
  ) {
    state.versionEvidence[key] = { ...original, conflict: true };
    return { kind: "conflict" };
  }
  const projection = original ? mergeFields(original.projection, incoming) : incoming;
  const evidence: ObjectVersionEvidence = {
    kind: "certified",
    entityKind: observation.kind,
    entityRef,
    seconds: time.seconds,
    fraction: time.fraction,
    projection,
    conflict: false,
  };
  if (Buffer.byteLength(canonicalJson(evidence)) > MAX_OBJECT_VERSION_EVIDENCE_BYTES) {
    state.versionEvidence[key] = {
      kind: "held",
      entityKind: observation.kind,
      entityRef,
      seconds: time.seconds,
      fraction: time.fraction,
      reason: "version_evidence_size_limit",
    };
    return { kind: "held" };
  }
  state.versionEvidence[key] = evidence;
  return { kind: "certified", observation: { ...projection, source } };
}
