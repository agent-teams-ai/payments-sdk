import { assertIdentifier, type CompletionFact, type EvidenceFlag, type Payments, type PurchaseIntent, type TransactionObservation } from '@agent-teams/payments-core';
import { createStore, type ListenerError, type ReadonlyStore } from '@get-modular/observation';
import type { Resources } from '@get-modular/resources';

/** The projection borrows this query only. It receives no financial command or delivery authority. */
export type PurchaseReadPort = Pick<Payments, 'readPurchase'>;
export type PurchaseQuery = Readonly<{ buyerId: string; intentId: string }>;
export type PurchaseTransactionView = Readonly<{
  transactionRef: string;
  revision: number;
  evidenceRevision: number;
  flags: readonly EvidenceFlag[];
  pendingAdverse: readonly string[];
  currentProfileFlags?: readonly EvidenceFlag[];
  retainedFlags?: readonly EvidenceFlag[];
  completion?: Readonly<Pick<CompletionFact, 'factId' | 'classification' | 'total'>>;
  current?: Readonly<Pick<TransactionObservation, 'version' | 'status' | 'statusMeaning'>>;
}>;
/** A finite display contract. Recursive receipts, provider sources and historical observations stay out. */
export type PurchaseReadValue = Readonly<{
  intent: Readonly<Pick<PurchaseIntent, 'intentId' | 'buyerId' | 'offer' | 'createdAt'>>;
  transactions: readonly PurchaseTransactionView[];
}> | undefined;
export type PurchaseProjectionState =
  | Readonly<{ status: 'idle' }>
  | Readonly<{ status: 'loading'; query: PurchaseQuery }>
  | Readonly<{ status: 'ready'; query: PurchaseQuery; purchase: PurchaseReadValue }>
  | Readonly<{ status: 'failed'; query: PurchaseQuery; error: Readonly<{ code: 'purchase_read_failed' }> }>;
export type PurchaseProjectionRecord = Readonly<{ state: PurchaseProjectionState }>;
export type PurchaseProjectionCommands = Readonly<{
  /** Host-authorized selection. Undefined clears the view without starting a query. */
  select: (query: PurchaseQuery | undefined) => undefined;
  /** Re-read the current selection after a durable commit; refreshing an idle view does nothing. */
  refresh: () => undefined;
}>;
export type PurchaseProjection = Readonly<{
  view: ReadonlyStore<PurchaseProjectionRecord>;
  commands: PurchaseProjectionCommands;
}>;
export type PurchaseProjectionOptions = Readonly<{
  initialQuery: PurchaseQuery | undefined;
  /** Receives real observation callback/source-close reports. The Host's sink must not throw. */
  reportError: (report: ListenerError) => undefined;
}>;
export type PurchaseProjectionConfiguration = PurchaseProjectionOptions & Readonly<{ read: PurchaseReadPort }>;

function copyQuery(query: PurchaseQuery | undefined): PurchaseQuery | undefined {
  if (query === undefined) return undefined;
  assertIdentifier(query.buyerId);
  assertIdentifier(query.intentId);
  return { buyerId: query.buyerId, intentId: query.intentId };
}

function loading(query: PurchaseQuery | undefined): PurchaseProjectionState {
  const selected = copyQuery(query);
  return selected === undefined ? { status: 'idle' } : { status: 'loading', query: selected };
}

function copyPurchase(purchase: Awaited<ReturnType<PurchaseReadPort['readPurchase']>>): PurchaseReadValue {
  if (purchase === undefined) return undefined;
  const view = {
    intent: { intentId: purchase.intent.intentId, buyerId: purchase.intent.buyerId, offer: purchase.intent.offer, createdAt: purchase.intent.createdAt },
    transactions: purchase.transactions.map(transaction => ({
      transactionRef: transaction.transactionRef, revision: transaction.revision, evidenceRevision: transaction.evidenceRevision,
      flags: transaction.flags, pendingAdverse: transaction.pendingAdverse,
      ...(transaction.currentProfileFlags === undefined ? {} : { currentProfileFlags: transaction.currentProfileFlags }),
      ...(transaction.retainedFlags === undefined ? {} : { retainedFlags: transaction.retainedFlags }),
      ...(transaction.completion === undefined ? {} : { completion: {
        factId: transaction.completion.factId, classification: transaction.completion.classification, total: transaction.completion.total,
      } }),
      ...(transaction.current === undefined ? {} : { current: {
        version: transaction.current.version, status: transaction.current.status, statusMeaning: transaction.current.statusMeaning,
      } }),
    })),
  } satisfies Exclude<PurchaseReadValue, undefined>;
  // Clone only the finite consumer shape, including every retained nested array and record. No
  // borrowed core object is frozen, and receipt/source graphs never become observation values.
  return structuredClone(view);
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
  const initial = copyQuery(configuration.initialQuery);
  const requests = createStore<{ readonly request: Readonly<{ query: PurchaseQuery | undefined }> }>(
    { request: { query: initial } },
    { name: 'payments-purchase/requests', resources, reportError: configuration.reportError },
  );
  const output = createStore<PurchaseProjectionRecord>(
    { state: loading(initial) },
    { name: 'payments-purchase/view', resources, reportError: configuration.reportError },
  );

  requests.readonly().load(requests.readonly().read(['request']), {
    resources,
    name: 'payments-purchase/read',
    loader: async ({ values }, { signal }) => {
      signal.throwIfAborted();
      const query = values.request.query;
      if (query === undefined) return undefined;
      // readPurchase has no cancellation contract. Await its physical settlement, including the
      // reader's cleanup, even when superseded. Never race it against the observation signal.
      const purchase = await configuration.read.readPurchase(query.buyerId, query.intentId);
      signal.throwIfAborted();
      // Store.set takes ownership and freezes. A borrowed public read result must remain untouched.
      return copyPurchase(purchase);
    },
    onLoading: ({ values }) => { output.set({ state: loading(values.request.query) }); },
    onResult: (purchase, { values }) => {
      const query = copyQuery(values.request.query);
      output.set({ state: query === undefined ? { status: 'idle' } : { status: 'ready', query, purchase } });
    },
    onError: (_cause, { values }) => {
      const query = copyQuery(values.request.query);
      // Raw database/provider error text and non-plain Error objects never enter the read view.
      output.set({ state: query === undefined ? { status: 'idle' } : { status: 'failed', query, error: { code: 'purchase_read_failed' } } });
    },
  });

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
        const query = requests.read(['request']).values.request.query;
        if (query !== undefined) select(query);
        return undefined;
      },
    }),
  });
}
