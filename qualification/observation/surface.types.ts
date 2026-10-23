import type { ListenerError, ReadonlyStore, Snapshot } from '@get-modular/observation';
import type { Resources } from '@get-modular/resources';
import type { PurchaseProjection, PurchaseProjectionRecord, PurchaseProjectionState, PurchaseQuery, PurchaseReadPort } from '@agent-teams/payments-get-modular/observation';

const voidHandler = (_next: Snapshot<PurchaseProjectionRecord, 'state'>): void => {};

/** Strict compiler probes only: never invoke this function at run time. */
export function observationSurface(
  projection: PurchaseProjection,
  reader: PurchaseReadPort,
  resources: Resources,
  reportError: (report: ListenerError) => undefined,
): void {
  const view: ReadonlyStore<PurchaseProjectionRecord> = projection.view;
  const snapshot = view.read(['state']);
  view.watch(snapshot, { resources, name: 'surface/state', onChange: ({ values }) => { void values.state.status; } });
  projection.commands.select({ buyerId: 'buyer', intentId: 'intent' });
  projection.commands.refresh();
  const clearedQuery: PurchaseQuery | undefined = undefined;
  projection.commands.select(clearedQuery);
  void reader.readPurchase('buyer', 'intent');
  // @ts-expect-error Only observation creates branded callback error reports.
  reportError({ source: 'source', subscription: 'subscriber', revision: 0, cause: 'failure' });

  // @ts-expect-error A subscriber cannot become the store's writer.
  void ('set' satisfies keyof typeof view);
  // @ts-expect-error A subscriber has no source lifetime control.
  void ('close' satisfies keyof typeof view);
  // @ts-expect-error Read-only composition cannot dispatch a checkout.
  void ('startPurchase' satisfies keyof PurchaseReadPort);
  // @ts-expect-error A projection has no durable financial acknowledgement authority.
  void ('acknowledgeDelivery' satisfies keyof PurchaseProjection['commands']);
  // @ts-expect-error Observation handlers must synchronously return undefined, never a promise.
  view.watch(snapshot, { resources, name: 'surface/async', onChange: async () => {} });
  // @ts-expect-error A void-returning callback is not the explicit undefined-return contract.
  view.watch(snapshot, { resources, name: 'surface/void', onChange: voidHandler });
  // @ts-expect-error Snapshots must come from the real facet, not a hand-built record.
  view.watch({ revision: 0, values: { state: { status: 'idle' } } }, { resources, name: 'surface/forged', onChange: () => {} });
  // @ts-expect-error The readonly store value brand prevents an unrelated slice.
  const unrelated: ReadonlyStore<{ readonly buyerId: string }> = view;
  void unrelated;

  if (snapshot.values.state.status === 'ready' && snapshot.values.state.purchase !== undefined) {
    // @ts-expect-error Projected read values are deeply readonly copies.
    snapshot.values.state.purchase.intent.buyerId = 'other';
    // @ts-expect-error A readonly purchase cannot acquire additional transactions.
    void ('push' satisfies keyof typeof snapshot.values.state.purchase.transactions);
  }
  if (snapshot.values.state.status === 'ready') {
    view.watch(snapshot, {
      resources, name: 'surface/future-union',
      onChange: ({ values }) => {
        const state: PurchaseProjectionState = values.state;
        // @ts-expect-error A ready starting snapshot does not make future values ready.
        const ready: Extract<PurchaseProjectionState, { status: 'ready' }> = values.state;
        void state; void ready;
      },
    });
  }
}

/** Reader implementations preserve the broad query contract under strict function variance. */
export function purchaseReaderVariance(reader: PurchaseReadPort): void {
  const stronger = (buyerId: 'single-buyer', intentId: string) => reader.readPurchase(buyerId, intentId);
  // @ts-expect-error a replacement read port may not strengthen buyer preconditions
  const incompatible: PurchaseReadPort = { readPurchase: stronger };
  void incompatible;
}
