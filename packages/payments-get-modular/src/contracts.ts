import type { PaymentRuntimeOptions, Payments } from '@agent-teams/payments-core';
import { defineContract, type CapabilitiesOf } from '@get-modular/assembly';

/** Per-run, trusted Host configuration. Provider, store and pool ownership stays with the Host. */
export const PaymentsConfiguration = defineContract<PaymentRuntimeOptions>()({ id: 'agent-teams/payments/configuration', revision: 1 });
export type PaymentsCheckout = Pick<Payments, 'startPurchase'>;
export type PaymentsRead = Pick<Payments, 'readOperation' | 'readPurchase' | 'readObservedSubscription' | 'readSubscriptionSelection'>;
export type PaymentsManagement = Pick<Payments, 'requestCancellation' | 'openPaymentUpdate' | 'createManagementLink'>;
export type PaymentsProcessing = Pick<Payments, 'ingestVerifiedInput' | 'processInbox' | 'flushPublication' | 'executeOperation' | 'refreshPurchase' | 'refreshSubscription' | 'resolveUnknownOperation' | 'selectSubscriptionStream' | 'repair'>;
export type PaymentsDelivery = Pick<Payments, 'registerConsumer' | 'readDeliveries' | 'acknowledgeDelivery'>;

export const Checkout = defineContract<PaymentsCheckout>()({ id: 'agent-teams/payments/checkout', revision: 1 });
export const Read = defineContract<PaymentsRead>()({ id: 'agent-teams/payments/read', revision: 1 });
export const Management = defineContract<PaymentsManagement>()({ id: 'agent-teams/payments/management', revision: 1 });
export const Processing = defineContract<PaymentsProcessing>()({ id: 'agent-teams/payments/processing', revision: 1 });
export const Delivery = defineContract<PaymentsDelivery>()({ id: 'agent-teams/payments/delivery', revision: 1 });
export interface PaymentsCapabilities extends CapabilitiesOf<typeof PaymentsConfiguration | typeof Checkout | typeof Read | typeof Management | typeof Processing | typeof Delivery> {}

/** A root contains role-specific facets. Lifetime control is held by the Host's resource scope. */
export type PaymentsModule = Readonly<{
  scope: Payments['scope'];
  checkout: PaymentsCheckout;
  read: PaymentsRead;
  management: PaymentsManagement;
  processing: PaymentsProcessing;
  delivery: PaymentsDelivery;
  lifecycle: Payments['lifecycle'];
}>;
