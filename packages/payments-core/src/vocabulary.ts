/**
 * Core-owned canonical observation tokens. Their historical spellings are stable serialized
 * protocol values, not a requirement that a provider use the same vocabulary on its wire.
 * Adapters translate known provider values; unrecognized strings remain opaque evidence.
 */
export const transactionOrigins = Object.freeze({
  checkoutWeb: 'web',
  checkoutApi: 'api',
  checkoutAutomatic: 'automatic',
  initialSubscription: 'subscription_create',
  recurringSubscription: 'subscription_recurring',
  paymentMethodChange: 'subscription_payment_method_change',
  subscriptionChange: 'subscription_update',
  subscriptionCharge: 'subscription_charge',
  manualSubscriptionRenewal: 'subscription_recurring_manual',
  subscriptionTrial: 'subscription_trial',
} as const);
export type CanonicalTransactionOrigin = typeof transactionOrigins[keyof typeof transactionOrigins];
export type TransactionOriginMeaning = 'checkout' | 'initial_subscription' | 'recurring_subscription' | 'payment_method' | 'unsupported_profile' | 'unrecognized';

/** Interpret exact protocol tokens; the adapter owns deliberate mapping from its wire values. */
export function transactionOriginMeaning(origin: string): TransactionOriginMeaning {
  switch (origin) {
    case transactionOrigins.checkoutWeb:
    case transactionOrigins.checkoutApi:
    case transactionOrigins.checkoutAutomatic: return 'checkout';
    case transactionOrigins.initialSubscription: return 'initial_subscription';
    case transactionOrigins.recurringSubscription: return 'recurring_subscription';
    case transactionOrigins.paymentMethodChange: return 'payment_method';
    case transactionOrigins.subscriptionChange:
    case transactionOrigins.subscriptionCharge:
    case transactionOrigins.manualSubscriptionRenewal:
    case transactionOrigins.subscriptionTrial: return 'unsupported_profile';
    default: return 'unrecognized';
  }
}

// These existing interpreted values also belong to core. Unknown strings remain retained and
// unsupported; introducing or renaming a canonical value is a protocol change, not SDK mapping.
export const subscriptionStatuses = Object.freeze({ active: 'active', pastDue: 'past_due', canceled: 'canceled' } as const);
export const supportedSubscriptionStatuses = Object.freeze(Object.values(subscriptionStatuses));
export const supportedScheduledChangeAction = 'cancel';
export const supportedAdjustmentActions = Object.freeze(['refund', 'credit', 'chargeback', 'chargeback_reverse', 'chargeback_warning', 'chargeback_warning_reverse', 'credit_reverse'] as const);
export const supportedAdjustmentStatuses = Object.freeze(['pending_approval', 'approved', 'rejected', 'reversed'] as const);
export type CanonicalSubscriptionStatus = typeof supportedSubscriptionStatuses[number];
export type CanonicalAdjustmentAction = typeof supportedAdjustmentActions[number];
export type CanonicalAdjustmentStatus = typeof supportedAdjustmentStatuses[number];

export function isSupportedSubscriptionStatus(value: string): value is CanonicalSubscriptionStatus {
  return (supportedSubscriptionStatuses as readonly string[]).includes(value);
}
export function isSupportedAdjustmentAction(value: string): value is CanonicalAdjustmentAction {
  return (supportedAdjustmentActions as readonly string[]).includes(value);
}
export function isSupportedAdjustmentStatus(value: string): value is CanonicalAdjustmentStatus {
  return (supportedAdjustmentStatuses as readonly string[]).includes(value);
}
