import type { Payments, PaymentsCheckout, PaymentsRead, PaymentsManagement, PaymentsProcessing, PaymentsDelivery } from '@agent-teams/payments-core';

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
