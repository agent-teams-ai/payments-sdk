import type { PaymentsCheckout, PaymentsRead, PaymentsProcessing, PaymentsModule } from '../dist/index.js';

/** Compile-time consumer boundary; intentionally never invoked by runtime tests. */
export function readFacetDoesNotCarryCommands(read: PaymentsRead, checkout: PaymentsCheckout, module: PaymentsModule): void {
  void read.readOperation('operation');
  void checkout.startPurchase({ buyerId: 'buyer', offerId: 'offer', requestKey: 'request' });
  // @ts-expect-error read-only consumers cannot create purchases
  void ('startPurchase' satisfies keyof PaymentsRead);
  // @ts-expect-error the Host retains resource control outside the module
  void ('control' satisfies keyof typeof module);
  // @ts-expect-error checkout consumers do not receive processing authority
  void ('processInbox' satisfies keyof PaymentsCheckout);
}

/** Audited recovery stays on the managed runtime, with read and mutation authority segregated. */
export function subscriptionSelectionSurface(read: PaymentsRead, processing: PaymentsProcessing, command: Parameters<PaymentsProcessing['selectSubscriptionStream']>[0]): void {
  void read.readSubscriptionSelection(command.buyerId, command.bindingId, command.providerSubscriptionRef);
  void processing.selectSubscriptionStream(command);
  // @ts-expect-error read-only consumers cannot authorize a support-stream change
  void ('selectSubscriptionStream' satisfies keyof PaymentsRead);
}
