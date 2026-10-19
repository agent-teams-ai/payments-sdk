import type { AggregateIdentity, EvidenceMessage, IntentAdmission, JsonValue, OperationCommit, OperationInput, PaymentOperation, PaymentReadVersion, PaymentScope, PaymentState, PaymentStore, ProviderResult, ReductionCommit, ReductionInput, ScanCheckpoint, StoreCommitResult, VerifiedInput } from './contracts.js';
import { admitInput, transactionAggregate } from './reducer.js';
import { canonicalJson, createEmptyPaymentState, digest, scopeKey } from './values.js';

type VersionTable = PaymentReadVersion['table'];
const mutableTables = ['intents', 'operations', 'bindings', 'subscriptionBindings', 'transactions', 'subscriptions', 'inbox'] as const;
/** Test-only implementation of the same record/CAS protocol as the durable adapter. */
export class MemoryPaymentStore implements PaymentStore {
  private readonly states = new Map<string, PaymentState>();
  private readonly versions = new Map<string, Map<string, number>>();
  private readonly tails = new Map<string, Promise<unknown>>();
  private revision(scope: PaymentScope, table: VersionTable, id: string): number | null { return this.versions.get(scopeKey(scope))?.get(canonicalJson([table, id])) ?? null; }
  private bump(scope: PaymentScope, table: VersionTable, id: string): void {
    const key = scopeKey(scope), versions = this.versions.get(key) ?? new Map<string, number>();
    versions.set(canonicalJson([table, id]), (versions.get(canonicalJson([table, id])) ?? 0) + 1); this.versions.set(key, versions);
  }
  private async atomic<T>(scope: PaymentScope, mutation: (draft: PaymentState) => T): Promise<T> {
    const key = scopeKey(scope), previous = this.tails.get(key) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(() => {
      const before = this.states.get(key) ?? createEmptyPaymentState(), draft = structuredClone(before);
      const result = mutation(draft);
      if (typeof result === 'object' && result !== null && 'then' in result) throw new TypeError('Store mutation must be synchronous');
      for (const table of mutableTables) for (const id of new Set([...Object.keys(before[table]), ...Object.keys(draft[table])])) if (canonicalJson(before[table][id] ?? null) !== canonicalJson(draft[table][id] ?? null)) this.bump(scope, table, id);
      for (const ref of new Set([...Object.keys(before.transactions), ...Object.keys(draft.transactions)])) if (canonicalJson(before.transactions[ref] ?? null) !== canonicalJson(draft.transactions[ref] ?? null)) {
        const intent = draft.bindings[ref]?.intentId ?? before.bindings[ref]?.intentId; if (intent) this.bump(scope, 'guards', `intent:${intent}`);
      }
      for (const id of new Set([...Object.keys(before.subscriptionBindings), ...Object.keys(draft.subscriptionBindings)])) if (canonicalJson(before.subscriptionBindings[id] ?? null) !== canonicalJson(draft.subscriptionBindings[id] ?? null)) for (const ref of new Set([...(before.subscriptionBindings[id]?.providerSubscriptionRefs ?? []), ...(draft.subscriptionBindings[id]?.providerSubscriptionRefs ?? [])])) this.bump(scope, 'guards', `subscription:${ref}`);
      if (canonicalJson(before.consumers) !== canonicalJson(draft.consumers) || before.recoveryFenced !== draft.recoveryFenced) this.bump(scope, 'configuration', 'scope');
      draft.revision += 1; this.states.set(key, structuredClone(draft)); return structuredClone(result);
    });
    this.tails.set(key, current);
    try { return await current; } finally { if (this.tails.get(key) === current) this.tails.delete(key); }
  }
  private async view<T>(scope: PaymentScope, read: (state: PaymentState) => T): Promise<T> {
    const key = scopeKey(scope); await this.tails.get(key)?.catch(() => undefined);
    return structuredClone(read(this.states.get(key) ?? createEmptyPaymentState()));
  }
  async admitIntent(scope: PaymentScope, admission: IntentAdmission): ReturnType<PaymentStore['admitIntent']> {
    return this.atomic(scope, state => {
      if (state.recoveryFenced) return { kind: 'recovery_fenced' } as const;
      const key = canonicalJson([admission.operation.buyerId, admission.operation.requestKey]), id = state.requestKeys[key], previous = id ? state.operations[id] : undefined;
      if (previous) return previous.fingerprint === admission.operation.fingerprint ? { kind: 'existing', operation: previous } as const : { kind: 'conflict' } as const;
      state.requestKeys[key] = admission.operation.operationId; state.operations[admission.operation.operationId] = admission.operation;
      state.intents[admission.intent.intentId] = admission.intent;
      if (admission.subscriptionBinding) state.subscriptionBindings[admission.subscriptionBinding.bindingId] = admission.subscriptionBinding;
      return { kind: 'created', operation: admission.operation } as const;
    });
  }
  async admitOperation(scope: PaymentScope, operation: PaymentOperation): ReturnType<PaymentStore['admitOperation']> {
    return this.atomic(scope, state => {
      if (state.recoveryFenced) return { kind: 'recovery_fenced' } as const;
      const key = canonicalJson([operation.buyerId, operation.requestKey]), id = state.requestKeys[key], previous = id ? state.operations[id] : undefined;
      if (previous) return previous.fingerprint === operation.fingerprint ? { kind: 'existing', operation: previous } as const : { kind: 'conflict' } as const;
      const binding = operation.subscriptionBindingId ? state.subscriptionBindings[operation.subscriptionBindingId] : undefined;
      if (!binding || binding.buyerId !== operation.buyerId) return { kind: 'conflict' } as const;
      state.requestKeys[key] = operation.operationId; state.operations[operation.operationId] = operation;
      return { kind: 'created', operation } as const;
    });
  }
  async findRequest(scope: PaymentScope, buyerId: string, requestKey: string): Promise<PaymentOperation | undefined> {
    return this.view(scope, state => { const id = state.requestKeys[canonicalJson([buyerId, requestKey])]; return id ? state.operations[id] : undefined; });
  }
  async loadOperation(scope: PaymentScope, operationId: string): Promise<OperationInput | undefined> {
    return this.view(scope, state => {
      const operation = state.operations[operationId]; if (!operation) return undefined;
      const intent = operation.intentId ? state.intents[operation.intentId] : undefined;
      const subscriptionBinding = operation.subscriptionBindingId ? state.subscriptionBindings[operation.subscriptionBindingId] : intent?.subscriptionBasisId ? state.subscriptionBindings[intent.subscriptionBasisId] : undefined;
      return { operation, ...(intent ? { intent } : {}), ...(subscriptionBinding ? { subscriptionBinding } : {}), laneRevision: this.laneRevision(state, operation) };
    });
  }
  private laneRevision(state: PaymentState, operation: PaymentOperation): number {
    return Object.values(state.operations).filter(candidate => candidate.subscriptionBindingId && candidate.subscriptionBindingId === operation.subscriptionBindingId).reduce((sum, candidate) => sum + candidate.revision, 0);
  }
  private async operationCommit(scope: PaymentScope, commit: OperationCommit, dispatch: boolean): Promise<StoreCommitResult> {
    return this.atomic(scope, state => {
      if (state.recoveryFenced) return { kind: 'recovery_fenced' } as const;
      const current = state.operations[commit.operation.operationId];
      if (current && current.revision !== commit.expectedRevision) return { kind: 'conflict' } as const;
      if (!current && commit.expectedRevision !== 0) return { kind: 'conflict' } as const;
      if (this.laneRevision(state, current ?? commit.operation) !== commit.expectedLaneRevision) return { kind: 'conflict' } as const;
      if (dispatch && Object.values(state.operations).some(candidate => candidate.operationId !== commit.operation.operationId && candidate.subscriptionBindingId && candidate.subscriptionBindingId === commit.operation.subscriptionBindingId && ['dispatch_started', 'outcome_unknown'].includes(candidate.state))) return { kind: 'conflict' } as const;
      if (dispatch && (current?.state !== 'prepared' || commit.operation.state !== 'dispatch_started')) return { kind: 'conflict' } as const;
      const key = canonicalJson([commit.operation.buyerId, commit.operation.requestKey]), existingId = state.requestKeys[key];
      if (existingId && existingId !== commit.operation.operationId) return { kind: 'conflict' } as const;
      if (commit.binding) {
        const existing = state.bindings[commit.binding.transactionRef];
        if (existing && (existing.intentId !== commit.binding.intentId || existing.buyerId !== commit.binding.buyerId || existing.purpose !== commit.binding.purpose)) return { kind: 'conflict' } as const;
        state.bindings[commit.binding.transactionRef] = commit.binding;
        const aggregate = transactionAggregate(state, commit.binding.transactionRef); aggregate.revision += 1; aggregate.publicationRequired = true;
      }
      state.operations[commit.operation.operationId] = commit.operation; state.requestKeys[key] = commit.operation.operationId;
      if (commit.intent) state.intents[commit.intent.intentId] = commit.intent;
      if (commit.subscriptionBinding) state.subscriptionBindings[commit.subscriptionBinding.bindingId] = commit.subscriptionBinding;
      return { kind: 'committed' } as const;
    });
  }
  beginExternalDispatch(scope: PaymentScope, commit: OperationCommit): Promise<StoreCommitResult> { return this.operationCommit(scope, commit, true); }
  finishAttempt(scope: PaymentScope, commit: OperationCommit): Promise<StoreCommitResult> { return this.operationCommit(scope, commit, false); }
  commitOperation(scope: PaymentScope, commit: OperationCommit): Promise<StoreCommitResult> { return this.operationCommit(scope, commit, false); }
  async recordAttemptObservation(scope: PaymentScope, operationId: string, attemptId: string, result: ProviderResult<JsonValue>): Promise<void> {
    await this.atomic(scope, state => {
      const operation = state.operations[operationId], attempt = operation?.attempts.find(item => item.attemptId === attemptId);
      if (!attempt || !operation) throw new Error('Unknown operation attempt');
      if (!attempt.observations.some(item => digest(item) === digest(result))) { attempt.observations.push(result); operation.revision += 1; }
    });
  }
  async admitVerifiedInputs(scope: PaymentScope, inputs: readonly VerifiedInput[]): ReturnType<PaymentStore['admitVerifiedInputs']> {
    if (inputs.length > 100) throw new RangeError('Admission batch too large');
    return this.atomic(scope, state => inputs.map(input => ({ inputId: input.inputId, kind: admitInput(state, input) })));
  }
  private workingSet(scope: PaymentScope, state: PaymentState, inputId: string, aggregate?: AggregateIdentity): ReductionInput | undefined {
    const slice = createEmptyPaymentState(), expected: PaymentReadVersion[] = [];
    slice.recoveryFenced = state.recoveryFenced; slice.consumers = [...state.consumers];
    expected.push({ table: 'configuration', id: 'scope', revision: this.revision(scope, 'configuration', 'scope') });
    let incomplete = false;
    const guard = (id: string): void => { if (!expected.some(item => item.table === 'guards' && item.id === id)) expected.push({ table: 'guards', id, revision: this.revision(scope, 'guards', id) }); };
    const add = (table: typeof mutableTables[number], id: string): void => {
      if (expected.some(item => item.table === table && item.id === id)) return;
      if (expected.length >= 128) { incomplete = true; return; }
      expected.push({ table, id, revision: this.revision(scope, table, id) });
      const record: unknown = state[table][id];
      if (record !== undefined) (slice[table] as Record<string, unknown>)[id] = structuredClone(record);
    };
    const includeIntent = (intentId: string): void => {
      guard(`intent:${intentId}`); add('intents', intentId); const intent = state.intents[intentId]; if (!intent) return;
      if (intent.subscriptionBasisId) add('subscriptionBindings', intent.subscriptionBasisId);
      for (const candidate of Object.values(state.transactions)) if (candidate.completion?.intentId === intentId && candidate.completion.classification === 'initial') add('transactions', candidate.transactionRef);
    };
    let transactionRef: string | undefined, subscriptionRef: string | undefined;
    if (aggregate) { if (aggregate.type === 'transaction') transactionRef = aggregate.id; else subscriptionRef = aggregate.id; }
    else {
      const record = state.inbox[inputId]; if (!record) return undefined; add('inbox', inputId);
      const observation = record.input.observation;
      transactionRef = record.input.adverseTransactionRef ?? ('transactionRef' in observation ? observation.transactionRef : undefined);
      subscriptionRef = 'subscriptionRef' in observation && typeof observation.subscriptionRef === 'string' ? observation.subscriptionRef : observation.kind === 'transaction' && observation.subscriptionRef.presence === 'known' ? observation.subscriptionRef.value ?? undefined : undefined;
    }
    if (transactionRef) {
      add('transactions', transactionRef); add('bindings', transactionRef);
      const binding = state.bindings[transactionRef]; if (binding) includeIntent(binding.intentId);
      const current = state.transactions[transactionRef]?.current;
      if (!subscriptionRef && current?.subscriptionRef.presence === 'known') subscriptionRef = current.subscriptionRef.value ?? undefined;
    }
    if (subscriptionRef) {
      guard(`subscription:${subscriptionRef}`); add('subscriptions', subscriptionRef);
      for (const binding of Object.values(state.subscriptionBindings)) if (binding.providerSubscriptionRefs.includes(subscriptionRef)) { add('subscriptionBindings', binding.bindingId); includeIntent(binding.originatingIntentId); }
    }
    if (incomplete) return { inputId, state: slice, expected, incompleteReason: 'working_set_limit' };
    return { inputId, state: slice, expected };
  }
  async loadReductionInput(scope: PaymentScope, inputId: string): Promise<ReductionInput | undefined> { return this.view(scope, state => this.workingSet(scope, state, inputId)); }
  async loadPublicationInput(scope: PaymentScope, aggregate: AggregateIdentity): Promise<ReductionInput | undefined> { return this.view(scope, state => this.workingSet(scope, state, '', aggregate)); }
  async commitReduction(scope: PaymentScope, commit: ReductionCommit): Promise<StoreCommitResult> {
    return this.atomic(scope, state => {
      if (state.recoveryFenced) return { kind: 'recovery_fenced' } as const;
      if (commit.expected.some(item => this.revision(scope, item.table, item.id) !== item.revision)) return { kind: 'conflict' } as const;
      for (const table of mutableTables) Object.assign(state[table], commit.state[table]);
      for (const [id, message] of Object.entries(commit.state.evidence)) {
        if (state.evidence[id] && state.evidence[id].bodyDigest !== message.bodyDigest) return { kind: 'conflict' } as const;
        state.evidence[id] = message;
      }
      Object.assign(state.deliveries, commit.state.deliveries); state.issues.push(...commit.state.issues);
      return { kind: 'committed' } as const;
    });
  }
  async readPurchase(scope: PaymentScope, buyerId: string, intentId: string): ReturnType<PaymentStore['readPurchase']> {
    return this.view(scope, state => { const intent = state.intents[intentId]; if (!intent || intent.buyerId !== buyerId) return undefined; return { intent, transactions: Object.values(state.transactions).filter(item => state.bindings[item.transactionRef]?.intentId === intentId) }; });
  }
  async readSubscription(scope: PaymentScope, buyerId: string, bindingId: string): ReturnType<PaymentStore['readSubscription']> {
    return this.view(scope, state => { const binding = state.subscriptionBindings[bindingId]; if (!binding || binding.buyerId !== buyerId) return undefined; return { binding, observations: binding.providerSubscriptionRefs.flatMap(ref => state.subscriptions[ref] ? [state.subscriptions[ref]] : []) }; });
  }
  async listWork(scope: PaymentScope, kind: 'inbox' | 'publication' | 'prepared' | 'unknown', limit: number): Promise<readonly string[]> {
    this.limit(limit);
    return this.view(scope, state => {
      if (kind === 'inbox') return Object.entries(state.inbox).filter(([, item]) => item.state === 'pending').map(([id]) => id).slice(0, limit);
      if (kind === 'publication') return [...Object.values(state.transactions).filter(item => item.publicationRequired).map(item => canonicalJson({ type: 'transaction', id: item.transactionRef })), ...Object.values(state.subscriptions).filter(item => item.publicationRequired).map(item => canonicalJson({ type: 'subscription', id: item.subscriptionRef }))].slice(0, limit);
      return Object.values(state.operations).filter(item => kind === 'prepared' ? item.state === 'prepared' : ['dispatch_started', 'outcome_unknown'].includes(item.state)).map(item => item.operationId).slice(0, limit);
    });
  }
  private limit(limit: number): void { if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new RangeError('Invalid bounded batch limit'); }
  async registerConsumer(scope: PaymentScope, consumerId: string, backfill: boolean): Promise<void> {
    await this.atomic(scope, state => {
      if (!state.consumers.includes(consumerId)) { if (state.consumers.length >= 32) throw new RangeError('Consumer limit'); state.consumers.push(consumerId); }
      if (backfill) for (const messageId of Object.keys(state.evidence)) state.deliveries[canonicalJson([messageId, consumerId])] ??= { consumerId, messageId, acknowledged: false, attempts: 0 };
    });
  }
  async listDeliveries(scope: PaymentScope, consumerId: string, limit: number): Promise<readonly EvidenceMessage[]> {
    this.limit(limit); return this.view(scope, state => Object.values(state.deliveries).filter(item => item.consumerId === consumerId && !item.acknowledged).slice(0, limit).flatMap(item => state.evidence[item.messageId] ? [state.evidence[item.messageId]] : []));
  }
  async acknowledgeDelivery(scope: PaymentScope, consumerId: string, messageId: string, bodyDigest: string): Promise<'acknowledged' | 'duplicate' | 'conflict'> {
    return this.atomic(scope, state => { const delivery = state.deliveries[canonicalJson([messageId, consumerId])], message = state.evidence[messageId]; if (!delivery || !message || message.bodyDigest !== bodyDigest) return 'conflict'; if (delivery.acknowledged) return 'duplicate'; delivery.acknowledged = true; return 'acknowledged'; });
  }
  async setRecoveryFence(scope: PaymentScope, fenced: boolean, auditRef: string): Promise<void> { await this.atomic(scope, state => { state.recoveryFenced = fenced; state.issues.push(`recovery-fence:${fenced}:${auditRef}`); }); }
  async readCheckpoint(scope: PaymentScope, scanId: string): Promise<ScanCheckpoint | undefined> { return this.view(scope, state => state.scans[scanId]); }
  async commitScanPage(scope: PaymentScope, expected: ScanCheckpoint | undefined, next: ScanCheckpoint, inputs: readonly VerifiedInput[]): Promise<StoreCommitResult> {
    return this.atomic(scope, state => {
      if (state.recoveryFenced) return { kind: 'recovery_fenced' } as const;
      if (canonicalJson(state.scans[next.scanId] ?? null) !== canonicalJson(expected ?? null)) return { kind: 'conflict' } as const;
      for (const input of inputs) admitInput(state, input);
      state.scans[next.scanId] = next; return { kind: 'committed' } as const;
    });
  }
}
