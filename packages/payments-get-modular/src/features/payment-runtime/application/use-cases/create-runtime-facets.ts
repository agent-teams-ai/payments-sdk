import type { Payments } from '@agent-teams/payments-core';
import type { PaymentsModule } from '../ports/runtime-facets.js';

function createCallTracker(signal: AbortSignal, active: Set<Promise<unknown>>) {
  return function track<A extends readonly unknown[], R>(call: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
    return (...args) => {
      if (signal.aborted) {return Promise.reject(signal.reason);}
      const task = call(...args);
      active.add(task);
      void task.finally(() => active.delete(task)).catch(() => {});
      return task;
    };
  };
}

export function createRuntimeFacets(runtime: Payments, signal: AbortSignal): Readonly<{ instance: PaymentsModule; close: () => Promise<void> }> {
  const active = new Set<Promise<unknown>>();
  const track = createCallTracker(signal, active);
  const checkout = Object.freeze({ startPurchase: track(runtime.startPurchase) });
  const read = Object.freeze({
    readOperation: track(runtime.readOperation),
    readPurchase: track(runtime.readPurchase),
    readObservedSubscription: track(runtime.readObservedSubscription),
    readSubscriptionSelection: track(runtime.readSubscriptionSelection),
  });
  const management = Object.freeze({
    requestCancellation: track(runtime.requestCancellation),
    openPaymentUpdate: track(runtime.openPaymentUpdate),
    createManagementLink: track(runtime.createManagementLink),
  });
  const processing = Object.freeze({
    ingestVerifiedInput: track(runtime.ingestVerifiedInput),
    processInbox: track(runtime.processInbox),
    processReclassification: track(runtime.processReclassification),
    flushPublication: track(runtime.flushPublication),
    executeOperation: track(runtime.executeOperation),
    refreshPurchase: track(runtime.refreshPurchase),
    refreshSubscription: track(runtime.refreshSubscription),
    resolveUnknownOperation: track(runtime.resolveUnknownOperation),
    selectSubscriptionStream: track(runtime.selectSubscriptionStream),
    repair: track(runtime.repair),
  });
  const delivery = Object.freeze({
    registerConsumer: track(runtime.registerConsumer),
    readDeliveries: track(runtime.readDeliveries),
    acknowledgeDelivery: track(runtime.acknowledgeDelivery),
  });
  const instance: PaymentsModule = Object.freeze({
    scope: runtime.scope, checkout, read, management, processing, delivery, lifecycle: runtime.lifecycle,
  });
  return {
    instance,
    close: async () => {
      runtime.stop();
      // Reads admitted before shutdown can still be holding borrowed catalog/store dependencies.
      await Promise.allSettled(active);
      // A caller deadline or abort does not terminate physical provider work or its settlement.
      await runtime.drain();
    },
  };
}
