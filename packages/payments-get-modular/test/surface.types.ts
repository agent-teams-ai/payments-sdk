import type { PaymentsCheckout, PaymentsRead, PaymentsModule } from '../dist/index.js';

/** Compile-time consumer boundary; intentionally never invoked by runtime tests. */
export function readFacetDoesNotCarryCommands(read: PaymentsRead, checkout: PaymentsCheckout, module: PaymentsModule): void {
  void read.readOperation('operation');
  void checkout.startPurchase({ buyerId: 'buyer', offerId: 'offer', requestKey: 'request' });
  // @ts-expect-error read-only consumers cannot create purchases
  void read.startPurchase({ buyerId: 'buyer', offerId: 'offer', requestKey: 'request' });
  // @ts-expect-error the Host retains resource control outside the module
  void module.control.close();
  // @ts-expect-error checkout consumers do not receive processing authority
  void checkout.processInbox('receipt');
}
