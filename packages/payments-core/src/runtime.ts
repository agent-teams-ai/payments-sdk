import { randomUUID } from 'node:crypto';
import type { AggregateIdentity, CancellationOutcome, CheckoutReady, EvidenceMessage, JsonValue, OperationCommit, OperationInput, OperationResult, PaymentOperation, PaymentReadVersion, PaymentUpdateReady, PaymentRuntimeOptions, ProviderResult, ResolveUnknown, StartPurchase, SubscriptionBinding, TransactionBinding, VerifiedInput } from './contracts.js';
import { processInput, publishEvidence, reduceObservation, publishHeldEvidence, validateOffer } from './reducer.js';
import { assertIdentifier, assertScope, canonicalJson, digest, sameScope } from './values.js';

const jsonResult = <T>(result: ProviderResult<T>): ProviderResult<JsonValue> => structuredClone(result) as ProviderResult<JsonValue>;
function toResult<T>(operation: PaymentOperation): OperationResult<T> {
  if (operation.state === 'succeeded' && operation.result?.kind === 'succeeded') return { kind: 'succeeded', value: operation.result.value as T };
  if (operation.state === 'rejected' && operation.result?.kind === 'rejected') return { kind: 'rejected', code: operation.result.code };
  if (operation.result?.kind === 'unsupported') return { kind: 'unsupported', capability: operation.result.capability };
  if (operation.state === 'outcome_unknown') return { kind: 'outcome_unknown', operationId: operation.operationId };
  return { kind: 'pending', operationId: operation.operationId };
}
function operationCommit(input: OperationInput, operation: PaymentOperation): OperationCommit {
  return { expectedRevision: input.operation.revision, expectedLaneRevision: input.laneRevision, operation };
}
function resultState(result: ProviderResult<JsonValue>): PaymentOperation['state'] {
  return result.kind === 'succeeded' ? 'succeeded' : result.kind === 'outcome_unknown' ? 'outcome_unknown' : 'rejected';
}
/** Ordinary factory. Host supplies authenticated commands, catalog, connection, storage and lifecycle. */
export function createPayments(options: PaymentRuntimeOptions) {
  const { provider, store, catalog, producerNamespace } = options;
  const scope = Object.freeze(structuredClone(options.scope));
  assertScope(scope); assertIdentifier(producerNamespace);
  if (!sameScope(scope, provider.scope)) throw new TypeError('Provider scope mismatch');
  if (!provider.capabilities.checkout || !provider.capabilities.transactionRead || !provider.capabilities.subscriptionRead) throw new TypeError('Required provider capability missing');
  const now = options.now ?? (() => new Date().toISOString()), newId = options.newId ?? randomUUID;
  const maxBytes = options.maxEvidenceBytes ?? 262_144, timeoutMs = options.operationTimeoutMs ?? 15_000;
  if (!Number.isInteger(maxBytes) || maxBytes < 4096 || maxBytes > 16_777_216) throw new RangeError('Invalid evidence limit');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000) throw new RangeError('Invalid operation deadline');
  const active = new Set<Promise<unknown>>();
  const work = new Set<Promise<unknown>>();
  function tracked<A extends unknown[], R>(run: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
    return (...args) => {
      const promise = run(...args); work.add(promise);
      void promise.finally(() => work.delete(promise)).catch(() => undefined);
      return promise;
    };
  }
  let accepting = true;
  const unavailable = { kind: 'rejected', code: 'unavailable' } as const;

  async function readOperation(operationId: string, buyerId?: string): Promise<PaymentOperation | undefined> {
    const input = await store.loadOperation(scope, operationId);
    return input && (buyerId === undefined || input.operation.buyerId === buyerId) ? input.operation : undefined;
  }
  async function settleAttempt(operationId: string, attemptId: string, result: ProviderResult<JsonValue>): Promise<void> {
    await store.recordAttemptObservation(scope, operationId, attemptId, result);
    for (let retry = 0; retry < 4; retry += 1) {
      const input = await store.loadOperation(scope, operationId); if (!input) throw new Error('Operation disappeared');
      const operation = structuredClone(input.operation), attempt = operation.attempts.find(item => item.attemptId === attemptId);
      if (!attempt) throw new Error('Attempt disappeared');
      const currentAttempt = operation.attempts.at(-1)?.attemptId === attemptId;
      const mayFinish = currentAttempt && (['dispatch_started', 'outcome_unknown'].includes(operation.state) || (operation.state === 'prepared' && result.kind === 'succeeded'));
      let binding: TransactionBinding | undefined;
      const intent = input.intent ? structuredClone(input.intent) : undefined;
      if (result.kind === 'succeeded' && operation.kind === 'purchase') {
        const checkout = result.value as unknown as CheckoutReady;
        assertIdentifier(checkout.transactionRef);
        if (!intent || checkout.intentId !== intent.intentId) throw new Error('Provider checkout intent mismatch');
        binding = { transactionRef: checkout.transactionRef, intentId: intent.intentId, buyerId: intent.buyerId, purpose: 'commercial', customerRef: null };
        if (!intent.transactionRefs.includes(checkout.transactionRef)) intent.transactionRefs.push(checkout.transactionRef);
      } else if (result.kind === 'succeeded' && operation.kind === 'payment_update') {
        const checkout = result.value as unknown as PaymentUpdateReady;
        if (!['payment_method', 'recovery'].includes(checkout.purpose)) throw new Error('Unproven payment update purpose');
        if (input.subscriptionBinding) binding = { transactionRef: checkout.transactionRef, intentId: input.subscriptionBinding.originatingIntentId, buyerId: operation.buyerId, purpose: checkout.purpose, customerRef: input.subscriptionBinding.customerRef };
      }
      if (mayFinish) { operation.state = resultState(result); operation.result = result; }
      operation.revision += 1;
      const committed = await store.finishAttempt(scope, { ...operationCommit(input, operation), ...(binding ? { binding } : {}), ...(intent ? { intent } : {}) });
      if (committed.kind === 'committed' || committed.kind === 'recovery_fenced') return;
    }
    throw new Error('Attempt settlement CAS contention; observation remains durable');
  }
  async function markUnknown(operationId: string, attemptId: string): Promise<void> {
    for (let retry = 0; retry < 4; retry += 1) {
      const input = await store.loadOperation(scope, operationId); if (!input) return;
      if (input.operation.attempts.at(-1)?.attemptId !== attemptId || input.operation.state !== 'dispatch_started') return;
      const operation = structuredClone(input.operation); operation.state = 'outcome_unknown'; operation.revision += 1;
      const result = await store.finishAttempt(scope, operationCommit(input, operation));
      if (result.kind !== 'conflict') return;
    }
  }
  async function subscriptionAuthority(operation: PaymentOperation): Promise<OperationResult<readonly PaymentReadVersion[]>> {
    const ref = operation.providerSubscriptionRef;
    if (!ref || !operation.subscriptionBindingId) return { kind: 'rejected', code: 'unclassified_external_state' };
    const local = await store.loadPublicationInput(scope, { type: 'subscription', id: ref });
    const localBinding = local?.state.subscriptionBindings[operation.subscriptionBindingId];
    if (!localBinding || localBinding.buyerId !== operation.buyerId || !localBinding.providerSubscriptionRefs.includes(ref)) return { kind: 'rejected', code: 'ownership_mismatch' };
    if (local.state.subscriptions[ref]?.flags.includes('ownership_mismatch')) return { kind: 'rejected', code: 'ownership_mismatch' };
    if (!provider.readSubscriptionInput) return { kind: 'unsupported', capability: 'subscription_authority_acquisition' };
    let receipt: ProviderResult<VerifiedInput>;
    try { receipt = await provider.readSubscriptionInput(ref); } catch { return unavailable; }
    if (receipt.kind !== 'succeeded') {
      if (receipt.kind === 'outcome_unknown') return unavailable;
      return receipt.kind === 'rejected' ? { kind: 'rejected', code: receipt.code } : receipt;
    }
    const acquired = await acquireAndProcess(receipt.value, { type: 'subscription', id: ref });
    if (acquired.kind !== 'succeeded') return acquired;
    if (acquired.value !== 1) return { kind: 'rejected', code: 'unclassified_external_state' };
    const authority = await store.loadPublicationInput(scope, { type: 'subscription', id: ref });
    if (!authority || authority.incompleteReason) return { kind: 'rejected', code: 'unclassified_external_state' };
    const binding = authority.state.subscriptionBindings[operation.subscriptionBindingId], aggregate = authority.state.subscriptions[ref];
    if (!binding || binding.buyerId !== operation.buyerId || !binding.providerSubscriptionRefs.includes(ref) || aggregate?.flags.includes('ownership_mismatch')) return { kind: 'rejected', code: 'ownership_mismatch' };
    const customer = aggregate?.current?.customerRef;
    if (!binding.customerRef || customer?.presence !== 'known') return { kind: 'rejected', code: 'unclassified_external_state' };
    if (customer.value !== binding.customerRef) return { kind: 'rejected', code: 'ownership_mismatch' };
    return { kind: 'succeeded', value: authority.expected };
  }
  async function executeOperation(operationId: string): Promise<OperationResult<JsonValue>> {
    if (!accepting) return unavailable;
    const input = await store.loadOperation(scope, operationId);
    if (!input) return { kind: 'rejected', code: 'ownership_mismatch' };
    if (input.operation.state !== 'prepared') return toResult(input.operation);
    const authority = input.operation.kind === 'purchase' ? undefined : await subscriptionAuthority(input.operation);
    if (authority && authority.kind !== 'succeeded') return authority;
    const operation = structuredClone(input.operation), attemptId = newId();
    operation.state = 'dispatch_started'; operation.revision += 1;
    operation.attempts.push({ attemptId, fingerprint: operation.fingerprint, dispatchedAt: now(), ...(operation.providerSubscriptionRef ? { providerSubscriptionRef: operation.providerSubscriptionRef } : {}), observations: [] });
    const marked = await store.beginExternalDispatch(scope, { ...operationCommit(input, operation), ...(authority?.kind === 'succeeded' ? { expectedReadSet: authority.value } : {}) });
    if (marked.kind !== 'committed') return marked.kind === 'recovery_fenced' ? unavailable : { kind: 'pending', operationId };
    // This is the only mutation dispatch site. No retry catches surround provider calls.
    const invoke = async (): Promise<ProviderResult<JsonValue>> => {
      try {
        if (operation.kind === 'purchase' && input.intent) return jsonResult(await provider.createCheckout({ intentId: input.intent.intentId, attemptId, buyerId: operation.buyerId, offer: input.intent.offer }));
        const subscriptionRef = operation.providerSubscriptionRef;
        if (!subscriptionRef) return { kind: 'rejected', code: 'ownership_mismatch' };
        if (operation.kind === 'cancellation' && operation.timing && provider.cancelSubscription) return jsonResult(await provider.cancelSubscription({ subscriptionRef, timing: operation.timing, attemptId }));
        if (operation.kind === 'payment_update' && provider.openPaymentUpdate) return jsonResult(await provider.openPaymentUpdate({ subscriptionRef, intentId: input.subscriptionBinding?.originatingIntentId ?? '', attemptId }));
        return { kind: 'unsupported', capability: operation.kind };
      } catch { return { kind: 'outcome_unknown' }; }
    };
    const task = invoke().then(async result => { await settleAttempt(operationId, attemptId, result); return result; });
    active.add(task); void task.finally(() => active.delete(task)).catch(() => undefined);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<'deadline'>(resolve => { timer = setTimeout(() => resolve('deadline'), timeoutMs); });
    try {
      const completed = await Promise.race([task, deadline]);
      if (completed === 'deadline') { await markUnknown(operationId, attemptId); return { kind: 'outcome_unknown', operationId }; }
      const latest = await store.loadOperation(scope, operationId);
      return latest ? toResult(latest.operation) : { kind: 'outcome_unknown', operationId };
    } catch {
      // Provider may have acted; failed local settlement must never authorize another dispatch.
      await markUnknown(operationId, attemptId).catch(() => undefined);
      return { kind: 'outcome_unknown', operationId };
    } finally { if (timer) clearTimeout(timer); }
  }
  async function startPurchase(command: StartPurchase): Promise<OperationResult<CheckoutReady>> {
    if (!accepting) return unavailable;
    for (const id of [command.buyerId, command.offerId, command.requestKey]) assertIdentifier(id);
    const fingerprint = digest(['purchase', command.buyerId, command.offerId]);
    const existing = await store.findRequest(scope, command.buyerId, command.requestKey);
    if (existing) return existing.fingerprint === fingerprint ? toResult(existing) : { kind: 'rejected', code: 'conflict' };
    const offer = await catalog.resolveOffer(scope, command.offerId);
    if (!offer) return { kind: 'rejected', code: 'catalog_mismatch' };
    try { validateOffer(offer, scope); } catch { return { kind: 'rejected', code: 'catalog_mismatch' }; }
    const intentId = newId(), operationId = newId(), basisId = offer.profile === 'monthly' ? newId() : undefined;
    const operation: PaymentOperation = { operationId, kind: 'purchase', buyerId: command.buyerId, requestKey: command.requestKey, fingerprint, intentId, ...(basisId ? { subscriptionBindingId: basisId } : {}), revision: 1, state: 'prepared', attempts: [], audits: [] };
    const intent = { intentId, buyerId: command.buyerId, requestKey: command.requestKey, fingerprint, offer: structuredClone(offer), operationId, ...(basisId ? { subscriptionBasisId: basisId } : {}), transactionRefs: [], createdAt: now() };
    const subscriptionBinding: SubscriptionBinding | undefined = basisId ? { bindingId: basisId, buyerId: command.buyerId, originatingIntentId: intentId, offer: structuredClone(offer), providerSubscriptionRefs: [], customerRef: null } : undefined;
    const admission = await store.admitIntent(scope, { intent, operation, ...(subscriptionBinding ? { subscriptionBinding } : {}) });
    if (admission.kind === 'conflict') return { kind: 'rejected', code: 'conflict' };
    if (admission.kind === 'recovery_fenced') return unavailable;
    if (admission.kind === 'existing') return toResult(admission.operation);
    return await executeOperation(operationId) as OperationResult<CheckoutReady>;
  }
  async function ingestVerifiedInput(input: VerifiedInput) {
    if (!accepting) return unavailable;
    if (!sameScope(input.scope, scope)) return { kind: 'rejected', code: 'ownership_mismatch' } as const;
    assertIdentifier(input.inputId); assertIdentifier(input.source.receiptId);
    if (input.source.receiptId !== input.observation.source.receiptId || input.source.representationDigest !== input.observation.source.representationDigest || (input.source.kind === 'verified_webhook' && !input.source.verification)) return { kind: 'rejected', code: 'validation' } as const;
    return { kind: 'succeeded', value: (await store.admitVerifiedInputs(scope, [input]))[0] } as const;
  }
  async function processInbox(inputId: string): Promise<'processed' | 'duplicate' | 'quarantined' | 'conflict' | 'recovery_fenced' | 'missing'> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const loaded = await store.loadReductionInput(scope, inputId); if (!loaded) return 'missing';
      const state = loaded.state;
      if (state.recoveryFenced) return 'recovery_fenced';
      let outcome: 'processed' | 'duplicate' | 'quarantined';
      if (loaded.incompleteReason) {
        const record = state.inbox[inputId]; if (record) { record.state = 'quarantined'; record.issue = loaded.incompleteReason; }
        publishHeldEvidence(state, scope, producerNamespace, loaded.incompleteReason, maxBytes); outcome = 'quarantined';
      } else { outcome = processInput(state, scope, inputId); publishEvidence(state, scope, producerNamespace, maxBytes); }
      const committed = await store.commitReduction(scope, { inputId, expected: loaded.expected, state, ...(loaded.incompleteReason ? { heldReason: loaded.incompleteReason } : {}) });
      if (committed.kind === 'committed') return outcome;
      if (committed.kind === 'recovery_fenced') return 'recovery_fenced';
    }
    return 'conflict';
  }
  async function flushPublication(aggregate: AggregateIdentity): Promise<'committed' | 'conflict' | 'recovery_fenced' | 'missing'> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const loaded = await store.loadPublicationInput(scope, aggregate); if (!loaded) return 'missing';
      if (loaded.incompleteReason) publishHeldEvidence(loaded.state, scope, producerNamespace, loaded.incompleteReason, maxBytes);
      else {
        // A trusted binding may arrive after a completed webhook was already processed unresolved.
        // The durable publication obligation reclassifies saved observations without a new provider event.
        if (aggregate.type === 'transaction') for (const observation of loaded.state.transactions[aggregate.id]?.observations ?? []) reduceObservation(loaded.state, scope, observation);
        else { const observation = loaded.state.subscriptions[aggregate.id]?.current; if (observation) reduceObservation(loaded.state, scope, observation); }
        publishEvidence(loaded.state, scope, producerNamespace, maxBytes);
      }
      const committed = await store.commitReduction(scope, { inputId: loaded.inputId, expected: loaded.expected, state: loaded.state, ...(loaded.incompleteReason ? { heldReason: loaded.incompleteReason } : {}) });
      if (committed.kind !== 'conflict') return committed.kind;
    }
    return 'conflict';
  }
  function acquiredInputError(input: VerifiedInput, entity: AggregateIdentity): 'validation' | 'ownership_mismatch' | undefined {
    if (!sameScope(input.scope, scope)) return 'ownership_mismatch';
    const observation = input.observation;
    if ((entity.type === 'transaction' && (observation.kind !== 'transaction' || observation.transactionRef !== entity.id)) || (entity.type === 'subscription' && (observation.kind !== 'subscription' || observation.subscriptionRef !== entity.id))) return 'ownership_mismatch';
    if (input.source.kind !== 'authenticated_api' || canonicalJson(input.source) !== canonicalJson(observation.source) || digest(input.retainedRepresentation) !== input.source.representationDigest) return 'validation';
    try { assertIdentifier(input.inputId); assertIdentifier(input.source.receiptId); } catch { return 'validation'; }
    return undefined;
  }
  async function acquireAndProcess(input: VerifiedInput, entity: AggregateIdentity): Promise<OperationResult<number>> {
    const error = acquiredInputError(input, entity); if (error) return { kind: 'rejected', code: error };
    await store.admitVerifiedInputs(scope, [input]);
    const processed = await processInbox(input.inputId);
    if (processed === 'recovery_fenced') return unavailable;
    return { kind: 'succeeded', value: processed === 'processed' || processed === 'duplicate' ? 1 : 0 };
  }
  function readFault(result: Exclude<ProviderResult<VerifiedInput>, { kind: 'succeeded' }>): OperationResult<number> {
    if (result.kind === 'outcome_unknown') return unavailable;
    return result.kind === 'rejected' ? { kind: 'rejected', code: result.code } : result;
  }
  async function refreshPurchase(buyerId: string, intentId: string): Promise<OperationResult<number>> {
    if (!provider.readTransactionInput) return { kind: 'unsupported', capability: 'transaction_evidence_acquisition' };
    const purchase = await store.readPurchase(scope, buyerId, intentId);
    if (!purchase) return { kind: 'rejected', code: 'ownership_mismatch' };
    let refreshed = 0;
    for (const ref of purchase.intent.transactionRefs) {
      const receipt = await provider.readTransactionInput(ref);
      if (receipt.kind !== 'succeeded') return readFault(receipt);
      const acquired = await acquireAndProcess(receipt.value, { type: 'transaction', id: ref });
      if (acquired.kind !== 'succeeded') return acquired;
      refreshed += acquired.value;
    }
    return { kind: 'succeeded', value: refreshed };
  }
  async function refreshSubscription(buyerId: string, bindingId: string): Promise<OperationResult<number>> {
    if (!provider.readSubscriptionInput) return { kind: 'unsupported', capability: 'subscription_evidence_acquisition' };
    const subscription = await store.readSubscription(scope, buyerId, bindingId);
    if (!subscription) return { kind: 'rejected', code: 'ownership_mismatch' };
    let refreshed = 0;
    for (const ref of subscription.binding.providerSubscriptionRefs) {
      const receipt = await provider.readSubscriptionInput(ref);
      if (receipt.kind !== 'succeeded') return readFault(receipt);
      const acquired = await acquireAndProcess(receipt.value, { type: 'subscription', id: ref });
      if (acquired.kind !== 'succeeded') return acquired;
      refreshed += acquired.value;
    }
    return { kind: 'succeeded', value: refreshed };
  }
  async function admitSubscriptionCommand(command: Readonly<{ buyerId: string; bindingId: string; requestKey: string; kind: 'cancellation' | 'payment_update'; timing?: 'now' | 'period_end' }>): Promise<OperationResult<JsonValue>> {
    if (!accepting) return unavailable;
    for (const id of [command.buyerId, command.bindingId, command.requestKey]) assertIdentifier(id);
    if (command.kind === 'cancellation' && (!command.timing || !provider.capabilities.cancellation.includes(command.timing) || !provider.cancelSubscription)) return { kind: 'unsupported', capability: `cancellation:${command.timing ?? 'missing'}` };
    if (command.kind === 'payment_update' && (!provider.capabilities.paymentUpdate || !provider.openPaymentUpdate)) return { kind: 'unsupported', capability: 'payment_update' };
    const existing = await store.findRequest(scope, command.buyerId, command.requestKey);
    if (existing) return existing.kind === command.kind && existing.subscriptionBindingId === command.bindingId && existing.timing === command.timing ? toResult(existing) : { kind: 'rejected', code: 'conflict' };
    const subscription = await store.readSubscription(scope, command.buyerId, command.bindingId);
    const providerSubscriptionRef = subscription?.binding.selectedSubscriptionRef;
    if (!subscription || !providerSubscriptionRef) return { kind: 'rejected', code: 'ownership_mismatch' };
    const fingerprint = digest([command.kind, command.buyerId, command.bindingId, providerSubscriptionRef, command.timing ?? null]);
    const operation: PaymentOperation = { operationId: newId(), kind: command.kind, buyerId: command.buyerId, requestKey: command.requestKey, fingerprint, subscriptionBindingId: command.bindingId, providerSubscriptionRef, intentId: subscription.binding.originatingIntentId, ...(command.timing ? { timing: command.timing } : {}), revision: 1, state: 'prepared', attempts: [], audits: [] };
    const admitted = await store.admitOperation(scope, operation);
    if (admitted.kind === 'conflict') return { kind: 'rejected', code: 'conflict' };
    if (admitted.kind === 'recovery_fenced') return unavailable;
    return admitted.kind === 'created' ? executeOperation(operation.operationId) : 'operation' in admitted ? toResult(admitted.operation) : { kind: 'rejected', code: 'conflict' };
  }
  async function requestCancellation(command: Readonly<{ buyerId: string; bindingId: string; requestKey: string; timing: 'now' | 'period_end' }>): Promise<OperationResult<CancellationOutcome>> {
    return await admitSubscriptionCommand({ ...command, kind: 'cancellation' }) as OperationResult<CancellationOutcome>;
  }
  async function openPaymentUpdate(command: Readonly<{ buyerId: string; bindingId: string; requestKey: string }>): Promise<OperationResult<PaymentUpdateReady>> {
    return await admitSubscriptionCommand({ ...command, kind: 'payment_update' }) as OperationResult<PaymentUpdateReady>;
  }
  /** Host must authorize customer-wide authority independently; local subscription ownership is insufficient. */
  async function createManagementLink(command: Readonly<{ buyerId: string; bindingId: string; customerAuthority: Readonly<{ customerRef: string; authorizationRef: string }> }>): Promise<OperationResult<Readonly<{ url: string; expiresAt?: string }>>> {
    if (!accepting) return unavailable;
    if (!provider.capabilities.customerManagement || !provider.createManagementLink) return { kind: 'unsupported', capability: 'customer_management' };
    assertIdentifier(command.customerAuthority.authorizationRef);
    const subscription = await store.readSubscription(scope, command.buyerId, command.bindingId);
    if (!subscription || !subscription.binding.customerRef || subscription.binding.customerRef !== command.customerAuthority.customerRef) return { kind: 'rejected', code: 'ownership_mismatch' };
    const result = await provider.createManagementLink({ customerRef: subscription.binding.customerRef, subscriptionRefs: subscription.binding.providerSubscriptionRefs });
    if (result.kind === 'outcome_unknown') return { kind: 'rejected', code: 'unavailable' };
    return result.kind === 'rejected' ? { kind: 'rejected', code: result.code } : result;
  }
  async function resolveUnknownOperation(command: ResolveUnknown): Promise<OperationResult<PaymentOperation>> {
    if (!accepting) return unavailable;
    for (const value of [command.actorId, command.auditRef, command.reason]) assertIdentifier(value);
    const input = await store.loadOperation(scope, command.operationId);
    if (!input) return { kind: 'rejected', code: 'ownership_mismatch' };
    if (input.operation.revision !== command.expectedRevision || !['dispatch_started', 'outcome_unknown'].includes(input.operation.state)) return { kind: 'rejected', code: 'conflict' };
    if (command.action === 'retry' && input.operation.attempts.length >= 100) return { kind: 'rejected', code: 'conflict' };
    if (command.action === 'retry' && command.acceptedDuplicateRisk !== true) return { kind: 'rejected', code: 'validation' };
    if (command.action === 'bind_outcome' && !command.outcome) return { kind: 'rejected', code: 'validation' };
    const operation = structuredClone(input.operation);
    operation.audits.push({ actorId: command.actorId, auditRef: command.auditRef, reason: command.reason, acceptedDuplicateRisk: command.acceptedDuplicateRisk === true, at: now(), action: command.action });
    operation.revision += 1;
    if (command.action === 'retry') { operation.state = 'prepared'; delete operation.result; }
    else if (command.action === 'bind_outcome' && command.outcome) { operation.result = command.outcome; operation.state = resultState(command.outcome); }
    else operation.state = 'outcome_unknown';
    let binding: TransactionBinding | undefined;
    const intent = input.intent ? structuredClone(input.intent) : undefined;
    if (command.action === 'bind_outcome' && command.outcome?.kind === 'succeeded' && operation.kind === 'purchase') {
      const checkout = command.outcome.value as unknown as CheckoutReady;
      if (!intent || checkout.intentId !== intent.intentId || typeof checkout.transactionRef !== 'string') return { kind: 'rejected', code: 'validation' };
      assertIdentifier(checkout.transactionRef);
      binding = { transactionRef: checkout.transactionRef, intentId: intent.intentId, buyerId: intent.buyerId, purpose: 'commercial', customerRef: null };
      if (!intent.transactionRefs.includes(checkout.transactionRef)) intent.transactionRefs.push(checkout.transactionRef);
    }
    const committed = await store.commitOperation(scope, { ...operationCommit(input, operation), ...(binding ? { binding } : {}), ...(intent ? { intent } : {}) });
    return committed.kind === 'committed' ? { kind: 'succeeded', value: operation } : committed.kind === 'recovery_fenced' ? unavailable : { kind: 'rejected', code: 'conflict' };
  }
  async function readSubscriptionSelection(buyerId: string, bindingId: string, providerSubscriptionRef?: string): Promise<Readonly<{ binding: SubscriptionBinding; expectedReadSet: readonly PaymentReadVersion[] }> | undefined> {
    const subscription = await store.readSubscription(scope, buyerId, bindingId);
    const ref = providerSubscriptionRef ?? subscription?.binding.selectedSubscriptionRef ?? subscription?.binding.providerSubscriptionRefs[0];
    if (!subscription || !ref || !subscription.binding.providerSubscriptionRefs.includes(ref)) return undefined;
    const loaded = await store.loadPublicationInput(scope, { type: 'subscription', id: ref });
    if (!loaded || loaded.incompleteReason) return undefined;
    const binding = loaded.state.subscriptionBindings[bindingId];
    return binding && binding.buyerId === buyerId ? { binding, expectedReadSet: loaded.expected } : undefined;
  }
  async function selectSubscriptionStream(command: Readonly<{ buyerId: string; bindingId: string; providerSubscriptionRef: string; expectedReadSet: readonly PaymentReadVersion[]; actorId: string; auditRef: string; reason: string }>): Promise<OperationResult<SubscriptionBinding>> {
    if (!accepting) return unavailable;
    for (const value of [command.buyerId, command.bindingId, command.providerSubscriptionRef, command.actorId, command.auditRef, command.reason]) assertIdentifier(value);
    const loaded = await store.loadPublicationInput(scope, { type: 'subscription', id: command.providerSubscriptionRef });
    if (!loaded || loaded.incompleteReason) return { kind: 'rejected', code: 'conflict' };
    const binding = loaded.state.subscriptionBindings[command.bindingId];
    if (!binding || binding.buyerId !== command.buyerId || !binding.providerSubscriptionRefs.includes(command.providerSubscriptionRef)) return { kind: 'rejected', code: 'ownership_mismatch' };
    if (canonicalJson([...loaded.expected].sort((a, b) => canonicalJson([a.table, a.id]).localeCompare(canonicalJson([b.table, b.id])))) !== canonicalJson([...command.expectedReadSet].sort((a, b) => canonicalJson([a.table, a.id]).localeCompare(canonicalJson([b.table, b.id]))))) return { kind: 'rejected', code: 'conflict' };
    binding.selectedSubscriptionRef = command.providerSubscriptionRef;
    binding.streamSelection = { actorId: command.actorId, auditRef: command.auditRef, reason: command.reason, at: now() };
    const aggregate = loaded.state.subscriptions[command.providerSubscriptionRef] ??= { subscriptionRef: command.providerSubscriptionRef, revision: 0, evidenceRevision: 0, flags: [], publicationRequired: false };
    aggregate.revision += 1; aggregate.publicationRequired = true;
    publishEvidence(loaded.state, scope, producerNamespace, maxBytes);
    const committed = await store.commitReduction(scope, { inputId: loaded.inputId, expected: loaded.expected, state: loaded.state });
    return committed.kind === 'committed' ? { kind: 'succeeded', value: binding } : committed.kind === 'recovery_fenced' ? unavailable : { kind: 'rejected', code: 'conflict' };
  }
  async function repair(limit = 25): Promise<Readonly<{ inbox: number; publications: number; prepared: number; unknown: number }>> {
    if (!accepting) return { inbox: 0, publications: 0, prepared: 0, unknown: 0 };
    let inbox = 0, publications = 0, prepared = 0, unknown = 0;
    for (const id of await store.listWork(scope, 'inbox', limit)) { await processInbox(id); inbox += 1; }
    for (const id of await store.listWork(scope, 'publication', limit)) { await flushPublication(JSON.parse(id) as AggregateIdentity); publications += 1; }
    for (const id of await store.listWork(scope, 'prepared', limit)) { await executeOperation(id); prepared += 1; }
    for (const id of await store.listWork(scope, 'unknown', limit)) {
      const input = await store.loadOperation(scope, id); if (!input) continue;
      const attemptId = input.operation.attempts.at(-1)?.attemptId;
      if (attemptId) await markUnknown(id, attemptId);
      if (input.intent) await refreshPurchase(input.intent.buyerId, input.intent.intentId);
      unknown += 1;
    }
    return { inbox, publications, prepared, unknown };
  }
  function stop(): Readonly<{ unresolvedExternalCalls: number; pendingWork: number }> { accepting = false; return { unresolvedExternalCalls: active.size, pendingWork: work.size }; }
  async function drain(): Promise<void> { while (active.size > 0 || work.size > 0) await Promise.allSettled([...active, ...work]); }
  return {
    scope, startPurchase: tracked(startPurchase), readOperation: tracked(readOperation), executeOperation: tracked(executeOperation), ingestVerifiedInput: tracked(ingestVerifiedInput), processInbox: tracked(processInbox), flushPublication: tracked(flushPublication),
    readPurchase: tracked((buyerId: string, intentId: string) => store.readPurchase(scope, buyerId, intentId)),
    readObservedSubscription: tracked((buyerId: string, bindingId: string) => store.readSubscription(scope, buyerId, bindingId)),
    refreshPurchase: tracked(refreshPurchase), refreshSubscription: tracked(refreshSubscription), requestCancellation: tracked(requestCancellation), openPaymentUpdate: tracked(openPaymentUpdate), createManagementLink: tracked(createManagementLink), resolveUnknownOperation: tracked(resolveUnknownOperation), repair: tracked(repair),
    registerConsumer: tracked((consumerId: string, backfill: boolean = false) => { assertIdentifier(consumerId); return store.registerConsumer(scope, consumerId, backfill); }),
    readDeliveries: tracked((consumerId: string, limit: number = 25): Promise<readonly EvidenceMessage[]> => store.listDeliveries(scope, consumerId, limit)),
    acknowledgeDelivery: tracked((consumerId: string, messageId: string, bodyDigest: string) => store.acknowledgeDelivery(scope, consumerId, messageId, bodyDigest)),
    readSubscriptionSelection: tracked(readSubscriptionSelection), selectSubscriptionStream: tracked(selectSubscriptionStream),
    stop, drain, lifecycle: () => ({ accepting, unresolvedExternalCalls: active.size, pendingWork: work.size }),
  };
}
export type Payments = ReturnType<typeof createPayments>;
