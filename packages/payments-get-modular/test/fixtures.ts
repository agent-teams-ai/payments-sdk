import type { PaymentProvider, PaymentRuntimeOptions, PaymentScope } from '@agent-teams/payments-core';
import { MemoryPaymentStore } from '@agent-teams/payments-core/testing';

export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

/** Local consumer-owned provider fixture: real core/store, no provider SDK or database dependency. */
export function fixture(applicationId = 'app-a', store = new MemoryPaymentStore()) {
  const scope: PaymentScope = { applicationId, provider: 'fixture', paymentAccountId: 'merchant', environment: 'sandbox' };
  let calls = 0, ids = 0;
  let checkout: PaymentProvider['createCheckout'] = async command => ({ kind: 'succeeded', value: { intentId: command.intentId, transactionRef: `${applicationId}-transaction-${calls}`, checkout: { token: 'fixture-token' } } });
  const provider: PaymentProvider = {
    scope,
    capabilities: { checkout: true, transactionRead: true, subscriptionRead: true, cancellation: [], paymentUpdate: false, customerManagement: false },
    createCheckout: command => { calls += 1; return checkout(command); },
    readTransaction: async () => ({ kind: 'unsupported', capability: 'fixture-read' }),
    readSubscription: async () => ({ kind: 'unsupported', capability: 'fixture-read' }),
  };
  const options: PaymentRuntimeOptions = {
    scope, producerNamespace: `payments-${applicationId}`, provider, store,
    catalog: { resolveOffer: async () => ({ applicationId, offerId: 'top-up', version: 'v1', policyVersion: 'policy-v1', currency: 'USD', profile: 'one_time', allowZeroTotal: false, lines: [{ providerPriceRef: 'price', benefitSlotId: 'top-up', quantity: 1 }] }) },
    now: () => '2026-01-01T00:00:00Z', newId: () => `${applicationId}-id-${++ids}`, operationTimeoutMs: 20,
  };
  return { options, store, calls: () => calls, replaceCheckout: (next: PaymentProvider['createCheckout']) => { checkout = next; } };
}
export const command = { buyerId: 'buyer', offerId: 'top-up', requestKey: 'request' } as const;
