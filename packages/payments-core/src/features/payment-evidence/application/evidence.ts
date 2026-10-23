import type { ProviderResult, VerifiedInput, AggregateIdentity } from '../domain/model.js';
import type { OperationResult } from './models/payment-models.js';
import { processInput, publishEvidence, reduceObservation, publishHeldEvidence } from '../domain/reducer.js';
import { assertIdentifier, canonicalJson, digest, sameScope } from '../domain/values.js';
import type { PaymentRuntimeContext } from './runtime-context.js';
import { unavailable } from './runtime-context.js';

export async function ingestVerifiedInput(ctx: PaymentRuntimeContext, input: VerifiedInput) {
  const { store, scope } = ctx;
    if (!ctx.accepting) {return unavailable;}
    if (!sameScope(input.scope, scope)) {return { kind: 'rejected', code: 'ownership_mismatch' } as const;}
    assertIdentifier(input.inputId); assertIdentifier(input.source.receiptId);
    if (input.source.receiptId !== input.observation.source.receiptId || input.source.representationDigest !== input.observation.source.representationDigest || (input.source.kind === 'verified_webhook' && !input.source.verification)) {return { kind: 'rejected', code: 'validation' } as const;}
    return { kind: 'succeeded', value: (await store.admitVerifiedInputs(scope, [input]))[0] } as const;
  }

export async function processInbox(ctx: PaymentRuntimeContext, inputId: string): Promise<'processed' | 'duplicate' | 'quarantined' | 'conflict' | 'recovery_fenced' | 'missing'> {
  const { store, producerNamespace, scope, maxBytes } = ctx;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const loaded = await store.loadReductionInput(scope, inputId); if (!loaded) {return 'missing';}
      const state = loaded.state;
      if (state.recoveryFenced) {return 'recovery_fenced';}
      let outcome: 'processed' | 'duplicate' | 'quarantined';
      if ((typeof loaded.incompleteReason === 'string' && loaded.incompleteReason.length > 0)) {
        const record = state.inbox[inputId]; if (record) { record.state = 'quarantined'; record.issue = loaded.incompleteReason; }
        publishHeldEvidence(state, scope, producerNamespace, loaded.incompleteReason, maxBytes); outcome = 'quarantined';
      } else { outcome = processInput(state, scope, inputId); publishEvidence(state, scope, producerNamespace, maxBytes); }
      const committed = await store.commitReduction(scope, { inputId, expected: loaded.expected, state, ...((typeof loaded.incompleteReason === 'string' && loaded.incompleteReason.length > 0) ? { heldReason: loaded.incompleteReason } : {}) });
      if (committed.kind === 'committed') {return outcome;}
      if (committed.kind === 'recovery_fenced') {return 'recovery_fenced';}
    }
    return 'conflict';
  }

export async function flushPublication(ctx: PaymentRuntimeContext, aggregate: AggregateIdentity): Promise<'committed' | 'conflict' | 'recovery_fenced' | 'missing'> {
  const { store, producerNamespace, scope, maxBytes } = ctx;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const loaded = await store.loadPublicationInput(scope, aggregate); if (!loaded) {return 'missing';}
      if ((typeof loaded.incompleteReason === 'string' && loaded.incompleteReason.length > 0)) {publishHeldEvidence(loaded.state, scope, producerNamespace, loaded.incompleteReason, maxBytes);}
      else {
        // A trusted binding may arrive after a completed webhook was already processed unresolved.
        // The durable publication obligation reclassifies saved observations without a new provider event.
        if (aggregate.type === 'transaction') {for (const observation of loaded.state.transactions[aggregate.id]?.observations ?? []) {reduceObservation(loaded.state, scope, observation);}}
        else { const observation = loaded.state.subscriptions[aggregate.id]?.current; if (observation) {reduceObservation(loaded.state, scope, observation);} }
        publishEvidence(loaded.state, scope, producerNamespace, maxBytes);
      }
      const committed = await store.commitReduction(scope, { inputId: loaded.inputId, expected: loaded.expected, state: loaded.state, ...((typeof loaded.incompleteReason === 'string' && loaded.incompleteReason.length > 0) ? { heldReason: loaded.incompleteReason } : {}) });
      if (committed.kind !== 'conflict') {return committed.kind;}
    }
    return 'conflict';
  }

export function acquiredInputError(ctx: PaymentRuntimeContext, input: VerifiedInput, entity: AggregateIdentity): 'validation' | 'ownership_mismatch' | undefined {
  const { scope } = ctx;
    if (!sameScope(input.scope, scope)) {return 'ownership_mismatch';}
    const observation = input.observation;
    if ((entity.type === 'transaction' && (observation.kind !== 'transaction' || observation.transactionRef !== entity.id)) || (entity.type === 'subscription' && (observation.kind !== 'subscription' || observation.subscriptionRef !== entity.id))) {return 'ownership_mismatch';}
    if (input.source.kind !== 'authenticated_api' || canonicalJson(input.source) !== canonicalJson(observation.source) || digest(input.retainedRepresentation) !== input.source.representationDigest) {return 'validation';}
    try { assertIdentifier(input.inputId); assertIdentifier(input.source.receiptId); } catch { return 'validation'; }
    return;
  }

export async function acquireAndProcess(ctx: PaymentRuntimeContext, input: VerifiedInput, entity: AggregateIdentity): Promise<OperationResult<number>> {
  const { store, scope } = ctx;
    const error = acquiredInputError(ctx, input, entity); if (error) {return { kind: 'rejected', code: error };}
    await store.admitVerifiedInputs(scope, [input]);
    const processed = await processInbox(ctx, input.inputId);
    if (processed === 'recovery_fenced') {return unavailable;}
    return { kind: 'succeeded', value: processed === 'processed' || processed === 'duplicate' ? 1 : 0 };
  }

export function readFault(_ctx: PaymentRuntimeContext, result: Exclude<ProviderResult<VerifiedInput>, { kind: 'succeeded' }>): OperationResult<number> {
    if (result.kind === 'outcome_unknown') {return unavailable;}
    return result.kind === 'rejected' ? { kind: 'rejected', code: result.code } : result;
  }

export async function refreshPurchase(ctx: PaymentRuntimeContext, buyerId: string, intentId: string): Promise<OperationResult<number>> {
  const { provider, store, scope } = ctx;
    if (!provider.readTransactionInput) {return { kind: 'unsupported', capability: 'transaction_evidence_acquisition' };}
    const purchase = await store.readPurchase(scope, buyerId, intentId);
    if (!purchase) {return { kind: 'rejected', code: 'ownership_mismatch' };}
    let refreshed = 0;
    for (const ref of purchase.intent.transactionRefs) {
      const receipt = await provider.readTransactionInput(ref);
      if (receipt.kind !== 'succeeded') {return readFault(ctx, receipt);}
      const acquired = await acquireAndProcess(ctx, receipt.value, { type: 'transaction', id: ref });
      if (acquired.kind !== 'succeeded') {return acquired;}
      refreshed += acquired.value;
    }
    return { kind: 'succeeded', value: refreshed };
  }

export async function refreshSubscription(ctx: PaymentRuntimeContext, buyerId: string, bindingId: string): Promise<OperationResult<number>> {
  const { provider, store, scope } = ctx;
    if (!provider.readSubscriptionInput) {return { kind: 'unsupported', capability: 'subscription_evidence_acquisition' };}
    const subscription = await store.readSubscription(scope, buyerId, bindingId);
    if (!subscription) {return { kind: 'rejected', code: 'ownership_mismatch' };}
    let refreshed = 0;
    for (const ref of subscription.binding.providerSubscriptionRefs) {
      const receipt = await provider.readSubscriptionInput(ref);
      if (receipt.kind !== 'succeeded') {return readFault(ctx, receipt);}
      const acquired = await acquireAndProcess(ctx, receipt.value, { type: 'subscription', id: ref });
      if (acquired.kind !== 'succeeded') {return acquired;}
      refreshed += acquired.value;
    }
    return { kind: 'succeeded', value: refreshed };
  }
