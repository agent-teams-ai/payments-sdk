import type { JsonValue, ProviderResult, PaymentOperation, SubscriptionBinding } from '../domain/model.js';
import type { OperationResult, CheckoutReady, StartPurchase } from './models/payment-models.js';
import { validateOffer } from '../domain/reducer.js';
import { assertIdentifier, digest } from '../domain/values.js';
import type { PaymentRuntimeContext } from './runtime-context.js';
import { unavailable } from './runtime-context.js';
import { subscriptionAuthority } from './authority.js';
import { jsonResult, toResult, operationCommit, resultState, successfulOutcomeChanges } from './outcomes.js';

export async function settleAttempt(ctx: PaymentRuntimeContext, operationId: string, attemptId: string, result: ProviderResult<JsonValue>): Promise<void> {
  const { store, scope } = ctx;
    await store.recordAttemptObservation(scope, operationId, attemptId, result);
    for (let retry = 0; retry < 4; retry += 1) {
      const input = await store.loadOperation(scope, operationId); if (!input) {throw new Error('Operation disappeared');}
      const operation = structuredClone(input.operation), attempt = operation.attempts.find(item => item.attemptId === attemptId);
      if (!attempt) {throw new Error('Attempt disappeared');}
      const currentAttempt = operation.attempts.at(-1)?.attemptId === attemptId;
      const mayFinish = currentAttempt && (['dispatch_started', 'outcome_unknown'].includes(operation.state) || (operation.state === 'prepared' && result.kind === 'succeeded'));
      const changes = result.kind === 'succeeded' ? successfulOutcomeChanges(input, result.value) : {};
      if (mayFinish) { operation.state = resultState(result); operation.result = result; }
      operation.revision += 1;
      const committed = await store.finishAttempt(scope, { ...operationCommit(input, operation), ...changes });
      if (committed.kind === 'committed' || committed.kind === 'recovery_fenced') {return;}
    }
    throw new Error('Attempt settlement CAS contention; observation remains durable');
  }

export async function markUnknown(ctx: PaymentRuntimeContext, operationId: string, attemptId: string): Promise<void> {
  const { store, scope } = ctx;
    for (let retry = 0; retry < 4; retry += 1) {
      const input = await store.loadOperation(scope, operationId); if (!input) {return;}
      if (input.operation.attempts.at(-1)?.attemptId !== attemptId || input.operation.state !== 'dispatch_started') {return;}
      const operation = structuredClone(input.operation); operation.state = 'outcome_unknown'; operation.revision += 1;
      const result = await store.finishAttempt(scope, operationCommit(input, operation));
      if (result.kind !== 'conflict') {return;}
    }
  }

export async function executeOperation(ctx: PaymentRuntimeContext, operationId: string): Promise<OperationResult<JsonValue>> {
  const { provider, store, scope, now, newId, timeoutMs, active, platform } = ctx;
    if (!ctx.accepting) {return unavailable;}
    const input = await store.loadOperation(scope, operationId);
    if (!input) {return { kind: 'rejected', code: 'ownership_mismatch' };}
    if (input.operation.state !== 'prepared') {return toResult(input.operation);}
    const authority = input.operation.kind === 'purchase' ? undefined : await subscriptionAuthority(ctx, input.operation);
    if (authority && authority.kind !== 'succeeded') {return authority;}
    const operation = structuredClone(input.operation), attemptId = newId();
    operation.state = 'dispatch_started'; operation.revision += 1;
    operation.attempts.push({ attemptId, fingerprint: operation.fingerprint, dispatchedAt: now(), ...((typeof operation.providerSubscriptionRef === 'string' && operation.providerSubscriptionRef.length > 0) ? { providerSubscriptionRef: operation.providerSubscriptionRef } : {}), observations: [] });
    const marked = await store.beginExternalDispatch(scope, { ...operationCommit(input, operation), ...(authority?.kind === 'succeeded' ? { expectedReadSet: authority.value } : {}) });
    if (marked.kind !== 'committed') {return marked.kind === 'recovery_fenced' ? unavailable : { kind: 'pending', operationId };}
    // This is the only mutation dispatch site. No retry catches surround provider calls.
    const invoke = async (): Promise<ProviderResult<JsonValue>> => {
      try {
        if (operation.kind === 'purchase' && input.intent) {return jsonResult(await provider.createCheckout({ intentId: input.intent.intentId, attemptId, buyerId: operation.buyerId, offer: input.intent.offer }));}
        const subscriptionRef = operation.providerSubscriptionRef;
        if (!(typeof subscriptionRef === 'string' && subscriptionRef.length > 0)) {return { kind: 'rejected', code: 'ownership_mismatch' };}
        if (operation.kind === 'cancellation' && operation.timing && provider.cancelSubscription) {return jsonResult(await provider.cancelSubscription({ subscriptionRef, timing: operation.timing, attemptId }));}
        if (operation.kind === 'payment_update' && provider.openPaymentUpdate) {return jsonResult(await provider.openPaymentUpdate({ subscriptionRef, intentId: input.subscriptionBinding?.originatingIntentId ?? '', attemptId }));}
        return { kind: 'unsupported', capability: operation.kind };
      } catch { return { kind: 'outcome_unknown' }; }
    };
    const task = invoke().then(async result => { await settleAttempt(ctx, operationId, attemptId, result); return result; });
    active.add(task); void task.finally(() => active.delete(task)).catch(() => {});
    let cancelDeadline: (() => void) | undefined;
    const deadline = new Promise<'deadline'>(resolve => { cancelDeadline = platform.schedule(timeoutMs, () => { resolve('deadline'); }); });
    try {
      const completed = await Promise.race([task, deadline]);
      if (completed === 'deadline') { await markUnknown(ctx, operationId, attemptId); return { kind: 'outcome_unknown', operationId }; }
      const latest = await store.loadOperation(scope, operationId);
      return latest ? toResult(latest.operation) : { kind: 'outcome_unknown', operationId };
    } catch {
      // Provider may have acted; failed local settlement must never authorize another dispatch.
      await markUnknown(ctx, operationId, attemptId).catch(() => {});
      return { kind: 'outcome_unknown', operationId };
    } finally { cancelDeadline?.(); }
  }

export async function startPurchase(ctx: PaymentRuntimeContext, command: StartPurchase): Promise<OperationResult<CheckoutReady>> {
  const { store, catalog, scope, now, newId } = ctx;
    if (!ctx.accepting) {return unavailable;}
    for (const id of [command.buyerId, command.offerId, command.requestKey]) {assertIdentifier(id);}
    const fingerprint = digest(['purchase', command.buyerId, command.offerId]);
    const existing = await store.findRequest(scope, command.buyerId, command.requestKey);
    if (existing) {return existing.fingerprint === fingerprint ? toResult(existing) : { kind: 'rejected', code: 'conflict' };}
    const offer = await catalog.resolveOffer(scope, command.offerId);
    if (!offer) {return { kind: 'rejected', code: 'catalog_mismatch' };}
    try { validateOffer(offer, scope); } catch { return { kind: 'rejected', code: 'catalog_mismatch' }; }
    const intentId = newId(), operationId = newId(), basisId = offer.profile === 'monthly' ? newId() : undefined;
    const operation: PaymentOperation = { operationId, kind: 'purchase', buyerId: command.buyerId, requestKey: command.requestKey, fingerprint, intentId, ...((typeof basisId === 'string' && basisId.length > 0) ? { subscriptionBindingId: basisId } : {}), revision: 1, state: 'prepared', attempts: [], audits: [] };
    const intent = { intentId, buyerId: command.buyerId, requestKey: command.requestKey, fingerprint, offer: structuredClone(offer), operationId, ...((typeof basisId === 'string' && basisId.length > 0) ? { subscriptionBasisId: basisId } : {}), transactionRefs: [], createdAt: now() };
    const subscriptionBinding: SubscriptionBinding | undefined = (typeof basisId === 'string' && basisId.length > 0) ? { bindingId: basisId, buyerId: command.buyerId, originatingIntentId: intentId, offer: structuredClone(offer), providerSubscriptionRefs: [], customerRef: null } : undefined;
    const admission = await store.admitIntent(scope, { intent, operation, ...(subscriptionBinding ? { subscriptionBinding } : {}) });
    if (admission.kind === 'conflict') {return { kind: 'rejected', code: 'conflict' };}
    if (admission.kind === 'recovery_fenced') {return unavailable;}
    if (admission.kind === 'existing') {return toResult(admission.operation);}
    return await executeOperation(ctx, operationId) as OperationResult<CheckoutReady>;
  }
