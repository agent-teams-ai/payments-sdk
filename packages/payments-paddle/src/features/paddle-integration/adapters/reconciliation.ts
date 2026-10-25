import { SDK_VERSION } from "@paddle/paddle-node-sdk";
import type { ReconciliationSource } from "@agent-teams/payments-core";
import type { PaddlePaymentProvider } from "./provider.js";

/** Adapter-private translation only; core retains neutral receipts and durable query parameters. */
export function createPaddleReconciliationSource(
  provider: PaddlePaymentProvider,
): ReconciliationSource {
  return {
    scope: provider.scope,
    async readPage(query, after, epoch) {
      if (query.kind === "events") {
        const result = await provider.readEventPage({
          from: query.from,
          to: query.to,
          epoch,
          queryVersion: query.queryVersion,
          perPage: query.perPage,
          ...(query.eventType === undefined ? {} : { eventTypes: [query.eventType] }),
          ...(after === undefined ? {} : { after }),
        });
        return result.kind === "page"
          ? {
              kind: "page",
              inputs: result.inputs,
              hasMore: result.hasMore,
              ...(result.lastEventId === undefined ? {} : { lastId: result.lastEventId }),
            }
          : {
              kind: "failed",
              reason: result.reason,
              sdkVersion: result.sdkVersion,
              ...(result.code === undefined ? {} : { code: result.code }),
            };
      }
      const result = await provider.readAdjustmentPage(query.transactionRef, after);
      if (result.kind !== "succeeded") {
        return {
          kind: "failed",
          reason: "adjustment_acquisition_failed",
          sdkVersion: SDK_VERSION,
          ...(result.kind === "rejected" ? { code: result.code } : {}),
        };
      }
      return {
        kind: "page",
        inputs: result.value.inputs,
        ids: result.value.adjustmentIds,
        hasMore: result.value.hasMore,
        ...(result.value.lastAdjustmentId === undefined
          ? {}
          : { lastId: result.value.lastAdjustmentId }),
      };
    },
  };
}
