import type { PaymentRuntimeOptions, PaymentsCheckout, PaymentsRead, PaymentsManagement, PaymentsProcessing, PaymentsDelivery } from '@agent-teams/payments-core';
import { defineContract, type Contract, type CapabilitiesOf } from '@get-modular/assembly';

/** Per-run, trusted Host configuration. Provider, store and pool ownership stays with the Host. */
export const PaymentsConfiguration: Contract<'agent-teams/payments/configuration', PaymentRuntimeOptions, 1> = defineContract<PaymentRuntimeOptions>()({ id: 'agent-teams/payments/configuration', revision: 1 });
export type { PaymentsCheckout, PaymentsRead, PaymentsManagement, PaymentsProcessing, PaymentsDelivery } from '@agent-teams/payments-core';

export const Checkout = defineContract<PaymentsCheckout>()({ id: 'agent-teams/payments/checkout', revision: 1 });
export const Read = defineContract<PaymentsRead>()({ id: 'agent-teams/payments/read', revision: 2 });
export const Management = defineContract<PaymentsManagement>()({ id: 'agent-teams/payments/management', revision: 1 });
export const Processing = defineContract<PaymentsProcessing>()({ id: 'agent-teams/payments/processing', revision: 2 });
export const Delivery = defineContract<PaymentsDelivery>()({ id: 'agent-teams/payments/delivery', revision: 1 });
export interface PaymentsCapabilities extends CapabilitiesOf<typeof PaymentsConfiguration | typeof Checkout | typeof Read | typeof Management | typeof Processing | typeof Delivery> {}
