import { createStore } from "@get-modular/observation";
import type { Resources } from "@get-modular/resources";
import type {
  PurchaseProjectionRecord,
  PurchaseQuery,
} from "../application/models/projection-models.js";
import { copyQuery } from "../application/use-cases/copy-query.js";
import { copyPurchase } from "../application/use-cases/copy-purchase.js";
import { loading } from "../application/use-cases/loading-state.js";
import type { PurchaseProjection, PurchaseProjectionConfiguration } from "./projection-types.js";

function createProjectionStores(
  configuration: PurchaseProjectionConfiguration,
  resources: Resources,
) {
  const initial = copyQuery(configuration.initialQuery);
  const requests = createStore<{
    readonly request: Readonly<{ query: PurchaseQuery | undefined }>;
  }>(
    { request: { query: initial } },
    { name: "payments-purchase/requests", resources, reportError: configuration.reportError },
  );
  const output = createStore<PurchaseProjectionRecord>(
    { state: loading(initial) },
    { name: "payments-purchase/view", resources, reportError: configuration.reportError },
  );

  requests.readonly().load(requests.readonly().read(["request"]), {
    resources,
    name: "payments-purchase/read",
    loader: async ({ values }, { signal }) => {
      signal.throwIfAborted();
      const query = values.request.query;
      if (query === undefined) {
        return;
      }
      // readPurchase has no cancellation contract. Await its physical settlement, including the
      // reader's cleanup, even when superseded. Never race it against the observation signal.
      const purchase = await configuration.read.readPurchase(query.buyerId, query.intentId);
      signal.throwIfAborted();
      // Store.set takes ownership and freezes. A borrowed public read result must remain untouched.
      return copyPurchase(purchase);
    },
    onLoading: ({ values }) => {
      output.set({ state: loading(values.request.query) });
    },
    onResult: (purchase, { values }) => {
      const query = copyQuery(values.request.query);
      output.set({
        state: query === undefined ? { status: "idle" } : { status: "ready", query, purchase },
      });
    },
    onError: (_cause, { values }) => {
      const query = copyQuery(values.request.query);
      // Raw database/provider error text and non-plain Error objects never enter the read view.
      output.set({
        state:
          query === undefined
            ? { status: "idle" }
            : { status: "failed", query, error: { code: "purchase_read_failed" } },
      });
    },
  });

  return { requests, output };
}

/**
 * Optional read projection over the published Observation API. No financial delivery is installed.
 * One selection and one latest-only load are retained. The Host owns the borrowed reader and must
 * keep its runtime/pool alive until this scope's close report is complete. No polling is installed.
 */
export function createPurchaseProjection(
  configuration: PurchaseProjectionConfiguration,
  { resources }: Readonly<{ resources: Resources }>,
): PurchaseProjection {
  const { requests, output } = createProjectionStores(configuration, resources);
  const select = (query: PurchaseQuery | undefined): undefined => {
    resources.signal.throwIfAborted();
    const selected = copyQuery(query);
    // load.onLoading runs in a later task. Invalidate synchronously too, so a same-turn read after
    // a buyer/intent switch never returns the previous buyer's ready value under the new selection.
    output.set({ state: loading(selected) });
    // A new aggregate means a replaceable refresh request, not a lossless event or durable revision.
    requests.set({ request: { query: selected } });
    return undefined;
  };
  return Object.freeze({
    view: output.readonly(),
    commands: Object.freeze({
      select,
      refresh: (): undefined => {
        resources.signal.throwIfAborted();
        const query = requests.read(["request"]).values.request.query;
        if (query !== undefined) {
          select(query);
        }
        return undefined;
      },
    }),
  });
}
