import { createPayments } from '@agent-teams/payments-core';
import { declareModule, group, implement, input } from '@get-modular/assembly';
import { scoped } from '@get-modular/resources';
import { Checkout, Delivery, Management, PaymentsConfiguration, Processing, Read, type PaymentsCapabilities, type PaymentsModule } from './contracts.js';

export const paymentsConfigurationDeclaration = declareModule({
  moduleId: 'agent-teams/payments/configuration',
  implementationId: 'agent-teams/payments/configuration/host',
  owner: { authority: 'agent-teams', path: ['payments'] },
  provides: [PaymentsConfiguration.provide()],
  slots: [],
});
/** Static declaration; every run supplies its own configuration instead of closing over globals. */
export const paymentsConfiguration = input<PaymentsCapabilities>()(paymentsConfigurationDeclaration);

export const paymentsDeclaration = declareModule({
  moduleId: 'agent-teams/payments/runtime',
  implementationId: 'agent-teams/payments/runtime/default',
  owner: { authority: 'agent-teams', path: ['payments'] },
  provides: [Checkout.provide(), Read.provide(), Management.provide(), Processing.provide(), Delivery.provide()],
  slots: [PaymentsConfiguration.slot('configuration', { kind: 'required' })],
});

/** Inert definition: imports and preparation acquire no resources and perform no provider calls. */
export const paymentsModule = implement<PaymentsCapabilities>()(paymentsDeclaration, async ({ configuration }, { resources }) => {
  const active = new Set<Promise<unknown>>();
  function track<A extends readonly unknown[], R>(call: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
    return (...args) => {
      if (resources.signal.aborted) {return Promise.reject(resources.signal.reason);}
      const task = call(...args);
      active.add(task);
      void task.finally(() => active.delete(task)).catch(() => undefined);
      return task;
    };
  }
  // setup() owns cleanup before its promise resolves. Assembly itself never disposes returned products.
  const runtime = await resources.setup({
    name: 'runtime',
    setup: () => createPayments(configuration),
    cleanup: async (payments) => {
      payments.stop();
      // Facet calls may still be awaiting catalog/storage reads before reaching a provider.
      // Stop new calls, retain their borrowed dependencies, and let every admitted call settle.
      await Promise.allSettled(active);
      // A caller deadline/abort does not terminate a provider promise or its durable settlement.
      await payments.drain();
    },
  });
  const checkout = Object.freeze({ startPurchase: track(runtime.startPurchase) });
  const read = Object.freeze({ readOperation: track(runtime.readOperation), readPurchase: track(runtime.readPurchase), readObservedSubscription: track(runtime.readObservedSubscription), readSubscriptionSelection: track(runtime.readSubscriptionSelection) });
  const management = Object.freeze({ requestCancellation: track(runtime.requestCancellation), openPaymentUpdate: track(runtime.openPaymentUpdate), createManagementLink: track(runtime.createManagementLink) });
  const processing = Object.freeze({ ingestVerifiedInput: track(runtime.ingestVerifiedInput), processInbox: track(runtime.processInbox), processReclassification: track(runtime.processReclassification), flushPublication: track(runtime.flushPublication), executeOperation: track(runtime.executeOperation), refreshPurchase: track(runtime.refreshPurchase), refreshSubscription: track(runtime.refreshSubscription), resolveUnknownOperation: track(runtime.resolveUnknownOperation), selectSubscriptionStream: track(runtime.selectSubscriptionStream), repair: track(runtime.repair) });
  const delivery = Object.freeze({ registerConsumer: track(runtime.registerConsumer), readDeliveries: track(runtime.readDeliveries), acknowledgeDelivery: track(runtime.acknowledgeDelivery) });
  const instance: PaymentsModule = Object.freeze({ scope: runtime.scope, checkout, read, management, processing, delivery, lifecycle: runtime.lifecycle });
  return { instance, capabilities: { [Checkout.id]: checkout, [Read.id]: read, [Management.id]: management, [Processing.id]: processing, [Delivery.id]: delivery } };
}, scoped);

export const paymentsGroup = group('payments', [paymentsModule]);
