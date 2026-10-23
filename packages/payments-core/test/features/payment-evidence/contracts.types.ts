import type { EvidenceMessage, ObservedSubscriptionRead, OperationResult, PaymentOperationRead, PaymentsCheckout, PurchaseRead, StartPurchase, CheckoutReady } from '../../../dist/index.js';
import type { PaymentProvider } from '../../../dist/provider.js';

/** Compile-only rejection witnesses; the runtime deliberately never calls these invalid operations. */
export function rejectMutablePublicReads(operation: PaymentOperationRead, purchase: PurchaseRead, subscription: ObservedSubscriptionRead, evidence: EvidenceMessage): void {
  // @ts-expect-error Public operation snapshots cannot edit lifecycle state.
  operation.state = 'prepared';
  // @ts-expect-error Public attempts are readonly snapshots.
  operation.attempts.push({ attemptId: 'id', fingerprint: 'fingerprint', dispatchedAt: 'time', observations: [] });
  // @ts-expect-error Provider diagnostics belong to provider and store ports.
  void operation.result?.diagnostic;
  // @ts-expect-error Publication control is private aggregate state.
  void purchase.transactions[0]?.publicationRequired;
  // @ts-expect-error Purchase command fingerprints are private custody metadata.
  void purchase.intent.fingerprint;
  // @ts-expect-error Stream classification decisions are private policy metadata.
  void subscription.binding.classificationDecision;
  if (evidence.kind === 'subscription_complete') {
    // @ts-expect-error Published binding evidence cannot expose a mutable stream list.
    evidence.binding.providerSubscriptionRefs.push('another-stream');
  }
}

export function rejectStrongerCheckoutPrecondition(): void {
  const startPurchase = async (_command: StartPurchase & { readonly buyerId: 'single-buyer' }): Promise<OperationResult<CheckoutReady>> => ({ kind: 'rejected', code: 'validation' });
  // @ts-expect-error An application port cannot require one particular buyer.
  const checkout: PaymentsCheckout = { startPurchase };
  void checkout;
}

export function rejectStrongerProviderPrecondition(provider: PaymentProvider): void {
  const createCheckout = (input: Parameters<PaymentProvider['createCheckout']>[0] & { readonly buyerId: 'single-buyer' }) => provider.createCheckout(input);
  // @ts-expect-error Provider replacement cannot strengthen the caller's preconditions.
  const replacement: PaymentProvider = { ...provider, createCheckout };
  void replacement;
}

// @ts-expect-error Mutable aggregates are selected explicitly through the store subpath.
export type RootAggregate = import('../../../dist/index.js').TransactionAggregate;
