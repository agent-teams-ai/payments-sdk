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
  // setup() owns cleanup before its promise resolves. Assembly itself never disposes returned products.
  const runtime = await resources.setup({
    name: 'runtime',
    setup: () => createPayments(configuration),
    cleanup: async (payments) => {
      payments.stop();
      // A caller deadline/abort does not terminate a provider promise or its durable settlement.
      await payments.drain();
    },
  });
  const checkout = Object.freeze({ startPurchase: runtime.startPurchase });
  const read = Object.freeze({ readOperation: runtime.readOperation, readPurchase: runtime.readPurchase, readObservedSubscription: runtime.readObservedSubscription });
  const management = Object.freeze({ requestCancellation: runtime.requestCancellation, openPaymentUpdate: runtime.openPaymentUpdate, createManagementLink: runtime.createManagementLink });
  const processing = Object.freeze({ ingestVerifiedInput: runtime.ingestVerifiedInput, processInbox: runtime.processInbox, flushPublication: runtime.flushPublication, executeOperation: runtime.executeOperation, refreshPurchase: runtime.refreshPurchase, refreshSubscription: runtime.refreshSubscription, resolveUnknownOperation: runtime.resolveUnknownOperation, repair: runtime.repair });
  const delivery = Object.freeze({ registerConsumer: runtime.registerConsumer, readDeliveries: runtime.readDeliveries, acknowledgeDelivery: runtime.acknowledgeDelivery });
  const instance: PaymentsModule = Object.freeze({ scope: runtime.scope, checkout, read, management, processing, delivery, lifecycle: runtime.lifecycle });
  return { instance, capabilities: { [Checkout.id]: checkout, [Read.id]: read, [Management.id]: management, [Processing.id]: processing, [Delivery.id]: delivery } };
}, scoped);

export const paymentsGroup = group('payments', [paymentsModule]);
