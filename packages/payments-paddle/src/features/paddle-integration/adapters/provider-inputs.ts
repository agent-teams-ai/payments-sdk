import { SDK_VERSION } from "@paddle/paddle-node-sdk";
import type { Paddle, IEventName } from "@paddle/paddle-node-sdk";
import {
  assertIdentifier,
  canonicalJson,
  compareTime,
  digest,
  exactTime,
} from "@agent-teams/payments-core";
import type {
  EvidenceSource,
  JsonValue,
  Observation,
  PaymentScope,
  VerifiedInput,
} from "@agent-teams/payments-core";
import type { ProviderResult } from "@agent-teams/payments-core/provider";
import { normalizeObservation } from "./observations.js";
import { translatePaddleError } from "./errors.js";

export const PADDLE_API_PROFILE = "paddle-billing-api-1";
export const PADDLE_DECODER_VERSION = "paddle-supported-profile/2";
export type PaddleEventScanQuery = Readonly<{
  from: string;
  to: string;
  after?: string;
  eventTypes?: readonly string[];
  perPage?: number;
  epoch: string;
  queryVersion: string;
}>;
export type PaddleEventScanResult =
  | Readonly<{
      kind: "page";
      inputs: readonly VerifiedInput[];
      hasMore: boolean;
      lastEventId?: string;
    }>
  | Readonly<{
      kind: "gap";
      reason: string;
      query: PaddleEventScanQuery;
      sdkVersion: string;
      code?: string;
    }>;
export type PaddleAdjustmentPage = Readonly<{
  inputs: readonly VerifiedInput[];
  adjustmentIds: readonly string[];
  hasMore: boolean;
  lastAdjustmentId?: string;
}>;
type ObjectValue = Record<string, unknown>;
export function object(value: unknown): ObjectValue {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Expected object");
  }
  return value as ObjectValue;
}
export function string(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError("Expected string");
  }
  return value;
}
export function providerId(value: unknown, prefix: string): string {
  const result = string(value);
  if (!new RegExp(`^${prefix}_[0-9a-z]{26}$`, "u").test(result)) {
    throw new TypeError("Invalid Paddle identifier");
  }
  return result;
}
export function json(value: unknown): JsonValue {
  return JSON.parse(canonicalJson(value)) as JsonValue;
}
export function placeholderSource(query?: JsonValue): EvidenceSource {
  return {
    kind: "authenticated_api",
    receiptId: "",
    representationDigest: "",
    decoderVersion: PADDLE_DECODER_VERSION,
    sdkVersion: SDK_VERSION,
    apiProfile: PADDLE_API_PROFILE,
    ...(query === undefined ? {} : { query }),
  };
}
export function apiReceipt(
  observation: Observation,
  scope: PaymentScope,
  mappedDiagnostic: unknown,
): VerifiedInput {
  // Only the validated neutral projection is policy input. The diagnostic is explicitly
  // SDK-mapped/lossy JSON, never an SDK class instance or original provider wire body.
  const { source: original, ...projection } = observation;
  const representation = json({
    representationKind: "sdk_mapped_observation",
    sdkVersion: SDK_VERSION,
    decoderVersion: PADDLE_DECODER_VERSION,
    projection,
    diagnostic: mappedDiagnostic,
  });
  const representationDigest = digest(representation);
  const receiptId = digest([
    scope,
    "mapped-api-observation",
    original.eventId ?? null,
    original.query ?? null,
    representationDigest,
    PADDLE_DECODER_VERSION,
  ]);
  const source: EvidenceSource = { ...original, receiptId, representationDigest };
  const normalized = { ...observation, source };
  return {
    scope,
    inputId: receiptId,
    source,
    observation: normalized,
    retainedRepresentation: representation,
    ...(normalized.kind === "adjustment"
      ? { adverseTransactionRef: normalized.transactionRef }
      : {}),
  };
}
/** Validate the durable scan coordinates before translating them into the official SDK query. */
function eventPageParameters(
  query: PaddleEventScanQuery,
):
  | (NonNullable<Parameters<Paddle["events"]["list"]>[0]> & { from: string; to: string })
  | undefined {
  exactTime(query.from);
  exactTime(query.to);
  assertIdentifier(query.epoch);
  assertIdentifier(query.queryVersion);
  if (
    compareTime(query.from, query.to) >= 0 ||
    (query.perPage !== undefined &&
      (!Number.isInteger(query.perPage) || query.perPage < 1 || query.perPage > 200))
  ) {
    return undefined;
  }
  if (query.after !== undefined) {
    providerId(query.after, "evt");
  }
  return {
    from: query.from,
    to: query.to,
    orderBy: "id[ASC]",
    ...(query.after === undefined ? {} : { after: query.after }),
    ...(query.perPage === undefined ? {} : { perPage: query.perPage }),
    ...(query.eventTypes === undefined ? {} : { eventType: [...query.eventTypes] as IEventName[] }),
  };
}

export async function readEventPage(
  readSdk: () => Paddle,
  readScope: () => PaymentScope,
  query: PaddleEventScanQuery,
): Promise<PaddleEventScanResult> {
  const gap = (reason: string): PaddleEventScanResult => ({
    kind: "gap",
    reason,
    query,
    sdkVersion: SDK_VERSION,
  });
  try {
    const parameters = eventPageParameters(query);
    if (parameters === undefined) {
      return gap("invalid_query");
    }
    // Recreate from the caller's durable pre-page cursor on every call. Never reuse a failed collection.
    const collection = readSdk().events.list(parameters),
      events = await collection.next();
    if (events.length === 0 && collection.hasMore) {
      return gap("empty_nonterminal_page");
    }
    let previous = query.after;
    const inputs: VerifiedInput[] = [];
    for (const event of events) {
      const eventId = providerId(event.eventId, "evt");
      if (previous !== undefined && eventId <= previous) {
        return gap("nonprogressing_event_page");
      }
      previous = eventId;
      exactTime(event.occurredAt);
      const source: EvidenceSource = {
        ...placeholderSource(json(query)),
        eventId,
        eventType: event.eventType,
        occurredAt: event.occurredAt,
      };
      const input = apiReceipt(
        normalizeObservation(event.data, event.eventType, "mapped", source, readScope()),
        readScope(),
        event,
      );
      const adverseRef = event.eventType.startsWith("adjustment.")
        ? object(event.data)["transactionId"]
        : undefined;
      inputs.push({
        ...input,
        ...(typeof adverseRef === "string" && /^txn_[0-9a-z]{26}$/u.test(adverseRef)
          ? { adverseTransactionRef: adverseRef }
          : {}),
      });
    }
    return {
      kind: "page",
      inputs,
      hasMore: collection.hasMore,
      ...(previous === undefined ? {} : { lastEventId: previous }),
    };
  } catch (error) {
    const failure = translatePaddleError(error, false);
    return {
      kind: "gap",
      reason: "sdk_acquisition_or_mapping_failed",
      query,
      sdkVersion: SDK_VERSION,
      ...(failure.kind === "rejected" ? { code: failure.code } : {}),
    };
  }
}

export async function readAdjustmentPage(
  readSdk: () => Paddle,
  readScope: () => PaymentScope,
  transactionRef: string,
  after?: string,
): Promise<ProviderResult<PaddleAdjustmentPage>> {
  try {
    providerId(transactionRef, "txn");
    if (after !== undefined) {
      providerId(after, "adj");
    }
  } catch {
    return { kind: "rejected", code: "validation" };
  }
  try {
    const collection = readSdk().adjustments.list({
        transactionId: [transactionRef],
        orderBy: "id[ASC]",
        ...(after === undefined ? {} : { after }),
      }),
      values = await collection.next();
    if (values.length === 0 && collection.hasMore) {
      return { kind: "rejected", code: "unclassified_external_state" };
    }
    let previous = after;
    const adjustmentIds: string[] = [];
    const inputs = values.map((value) => {
      const ref = providerId(value.id, "adj");
      if ((previous !== undefined && ref <= previous) || value.transactionId !== transactionRef) {
        throw new TypeError("Invalid adjustment page");
      }
      previous = ref;
      adjustmentIds.push(ref);
      return {
        ...apiReceipt(
          normalizeObservation(
            value,
            "adjustment.snapshot",
            "mapped",
            placeholderSource(json({ transactionRef, after: after ?? null })),
            readScope(),
          ),
          readScope(),
          value,
        ),
        adverseTransactionRef: transactionRef,
      };
    });
    return {
      kind: "succeeded",
      value: {
        inputs,
        adjustmentIds,
        hasMore: collection.hasMore,
        ...(previous === undefined ? {} : { lastAdjustmentId: previous }),
      },
    };
  } catch (error) {
    return translatePaddleError(error, false);
  }
}
