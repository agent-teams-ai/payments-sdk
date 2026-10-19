import {
  admitInput, canonicalJson, compareEventIdentity, createEmptyPaymentState, digest, eventIdentityEvidence,
  inputRoutes, mergeEventIdentityEvidence, objectVersionKey, sameOperationCommand, subscriptionAggregate, transactionAggregate,
} from '@agent-teams/payments-core';
import type {
  AggregateIdentity, Delivery, EventIdentityEvidence, EvidenceMessage, InboxRecord, IntentAdmission, JsonValue,
  Observation, OperationCommit, OperationInput, PaymentOperation, PaymentReadVersion, PaymentScope,
  PaymentStore, ProviderResult, PurchaseIntent, ReductionCommit, ReductionInput,
  ScanCheckpoint, StoreCommitResult, SubscriptionAggregate, SubscriptionBinding,
  TransactionAggregate, TransactionBinding, VerifiedInput,
} from '@agent-teams/payments-core';
import type { Pool } from 'pg';
import type { PgBoss } from 'pg-boss';
import { assertPostgresDurability, withPaymentTransaction } from './database.js';
import type { DatabaseTimeouts, PaymentSqlTransaction } from './database.js';
import { assertBatchLimit, PaymentRecords } from './records.js';
import type { DurableWork, RecordKey } from './records.js';

export type PostgresPaymentStoreOptions = Readonly<{
  pool: Pool;
  schema: string;
  scope: PaymentScope;
  timeouts?: DatabaseTimeouts;
  maxWorkingSetRecords?: number;
  maxWorkingSetBytes?: number;
  /** Optional job transport. Durable obligations remain authoritative when no worker is running. */
  queue?: Readonly<{ boss: PgBoss; name: string }>;
}>;

const mutableTables = ['intents', 'operations', 'bindings', 'subscriptionBindings', 'transactions', 'subscriptions', 'inbox', 'versionEvidence'] as const;
type MutableTable = typeof mutableTables[number];
type Lane = { revision: number; unresolvedOperationId?: string; recoveryReviewRequired?: string };
type StoredEventIdentity = { evidence: EventIdentityEvidence; conflict: boolean };
const committed = { kind: 'committed' } as const;
const conflict = { kind: 'conflict' } as const;
const fenced = { kind: 'recovery_fenced' } as const;

/** Factory performs read-only qualification; bootstrap remains a separate migration-role action. */
export async function createPostgresPaymentStore(options: PostgresPaymentStoreOptions): Promise<PaymentStore> {
  await assertPostgresDurability(options.pool, options.schema);
  const store = new PostgresPaymentStore(options);
  await store.qualify();
  return store;
}

class PostgresPaymentStore implements PaymentStore {
  private readonly options: PostgresPaymentStoreOptions;
  private readonly records: PaymentRecords;

  constructor(options: PostgresPaymentStoreOptions) {
    this.options = options;
    this.records = new PaymentRecords(options.schema);
    const maxRecords = options.maxWorkingSetRecords ?? 128;
    const maxBytes = options.maxWorkingSetBytes ?? 2_097_152;
    if (!Number.isInteger(maxRecords) || maxRecords < 16 || maxRecords > 256 || !Number.isInteger(maxBytes) || maxBytes < 4_096 || maxBytes > 16_777_216) {
      throw new RangeError('Invalid payment working-set bounds');
    }
  }

  async qualify(): Promise<void> {
    await this.tx(this.options.scope, async tx => { await this.records.configuration(tx, this.options.scope); });
  }

  private tx<T>(scope: PaymentScope, action: (tx: PaymentSqlTransaction) => Promise<T>): Promise<T> {
    if (canonicalJson(scope) !== canonicalJson(this.options.scope)) throw new Error('Payment store scope mismatch');
    return withPaymentTransaction(this.options.pool, action, this.options.timeouts);
  }

  private async work(tx: PaymentSqlTransaction, work: DurableWork, state: 'pending' | 'quarantined' | 'complete' = 'pending'): Promise<void> {
    await this.records.obligation(tx, work, state);
    if (state === 'pending' && this.options.queue) {
      await this.options.queue.boss.send(this.options.queue.name, work, {
        db: { executeSql: (text, values) => tx.query(text, values) },
        singletonKey: digest(work), singletonSeconds: 30,
      });
    }
  }

  private requestKey(operation: Pick<PaymentOperation, 'buyerId' | 'requestKey'>): string {
    return canonicalJson([operation.buyerId, operation.requestKey]);
  }

  private laneKey(operation: PaymentOperation): string {
    return operation.subscriptionBindingId ? `subscription:${operation.subscriptionBindingId}` : `operation:${operation.operationId}`;
  }

  async admitIntent(scope: PaymentScope, admission: IntentAdmission): ReturnType<PaymentStore['admitIntent']> {
    return this.admit(scope, admission.operation, admission);
  }

  async admitOperation(scope: PaymentScope, operation: PaymentOperation): ReturnType<PaymentStore['admitOperation']> {
    return this.admit(scope, operation);
  }

  private async admit(scope: PaymentScope, operation: PaymentOperation, admission?: IntentAdmission): ReturnType<PaymentStore['admitIntent']> {
    return this.tx(scope, async tx => {
      if ((await this.records.configuration(tx, scope)).body.recoveryFenced) return fenced;
      const requestKey = this.requestKey(operation);
      const keys: RecordKey[] = [{ kind: 'requestKeys', id: requestKey }, { kind: 'operations', id: operation.operationId }];
      if (admission) keys.push({ kind: 'intents', id: admission.intent.intentId });
      if (operation.subscriptionBindingId) keys.push({ kind: 'subscriptionBindings', id: operation.subscriptionBindingId }, { kind: 'lanes', id: this.laneKey(operation) });
      if (admission?.subscriptionBinding) keys.push({ kind: 'subscriptionBindings', id: admission.subscriptionBinding.bindingId });
      await this.records.lock(tx, keys);
      const existingId = (await this.records.read<string>(tx, 'requestKeys', requestKey))?.body;
      if (existingId) {
        const previous = (await this.records.read<PaymentOperation>(tx, 'operations', existingId))?.body;
        if (!previous) throw new Error('Corrupt request identity');
        return previous.fingerprint === operation.fingerprint ? { kind: 'existing', operation: previous } as const : conflict;
      }
      if (await this.records.read(tx, 'operations', operation.operationId)) return conflict;
      if (!admission) {
        const binding = operation.subscriptionBindingId ? (await this.records.read<SubscriptionBinding>(tx, 'subscriptionBindings', operation.subscriptionBindingId))?.body : undefined;
        if (!binding || binding.buyerId !== operation.buyerId) return conflict;
      }
      if ((await this.records.read<Lane>(tx, 'lanes', this.laneKey(operation)))?.body.recoveryReviewRequired) return fenced;
      await this.records.write(tx, 'requestKeys', requestKey, operation.operationId);
      await this.records.write(tx, 'operations', operation.operationId, operation);
      if (admission) {
        await this.records.write(tx, 'intents', admission.intent.intentId, admission.intent);
        if (admission.subscriptionBinding) await this.records.write(tx, 'subscriptionBindings', admission.subscriptionBinding.bindingId, admission.subscriptionBinding);
      }
      await this.work(tx, { kind: 'prepared', id: operation.operationId });
      return { kind: 'created', operation } as const;
    });
  }

  async findRequest(scope: PaymentScope, buyerId: string, requestKey: string): Promise<PaymentOperation | undefined> {
    return this.tx(scope, async tx => {
      await this.records.configuration(tx, scope);
      const id = (await this.records.read<string>(tx, 'requestKeys', canonicalJson([buyerId, requestKey])))?.body;
      return id ? (await this.records.read<PaymentOperation>(tx, 'operations', id))?.body : undefined;
    });
  }

  async loadOperation(scope: PaymentScope, operationId: string): Promise<OperationInput | undefined> {
    return this.tx(scope, async tx => {
      await this.records.configuration(tx, scope);
      const operation = (await this.records.read<PaymentOperation>(tx, 'operations', operationId))?.body;
      if (!operation) return undefined;
      const intent = operation.intentId ? (await this.records.read<PurchaseIntent>(tx, 'intents', operation.intentId))?.body : undefined;
      const bindingId = operation.subscriptionBindingId ?? intent?.subscriptionBasisId;
      const subscriptionBinding = bindingId ? (await this.records.read<SubscriptionBinding>(tx, 'subscriptionBindings', bindingId))?.body : undefined;
      const lane = (await this.records.read<Lane>(tx, 'lanes', this.laneKey(operation)))?.body;
      return { operation, ...(intent ? { intent } : {}), ...(subscriptionBinding ? { subscriptionBinding } : {}), laneRevision: lane?.revision ?? 0 };
    });
  }

  beginExternalDispatch(scope: PaymentScope, commit: OperationCommit): Promise<StoreCommitResult> { return this.operationCommit(scope, commit, true); }
  finishAttempt(scope: PaymentScope, commit: OperationCommit): Promise<StoreCommitResult> { return this.operationCommit(scope, commit, false); }
  commitOperation(scope: PaymentScope, commit: OperationCommit): Promise<StoreCommitResult> { return this.operationCommit(scope, commit, false); }

  private async operationCommit(scope: PaymentScope, commit: OperationCommit, dispatch: boolean): Promise<StoreCommitResult> {
    return this.tx(scope, async tx => {
      if ((await this.records.configuration(tx, scope)).body.recoveryFenced) return fenced;
      const op = commit.operation;
      const laneId = this.laneKey(op);
      const keys: RecordKey[] = [{ kind: 'operations', id: op.operationId }, { kind: 'lanes', id: laneId }];
      for (const read of commit.expectedReadSet ?? []) {
        if (read.table !== 'configuration') keys.push({ kind: read.table, id: read.id });
      }
      if (commit.intent) keys.push({ kind: 'intents', id: commit.intent.intentId });
      if (commit.binding) keys.push({ kind: 'bindings', id: commit.binding.transactionRef }, { kind: 'transactions', id: commit.binding.transactionRef }, { kind: 'guards', id: `intent:${commit.binding.intentId}` });
      if (commit.subscriptionBinding) {
        keys.push({ kind: 'subscriptionBindings', id: commit.subscriptionBinding.bindingId });
        for (const ref of commit.subscriptionBinding.providerSubscriptionRefs) keys.push({ kind: 'guards', id: `subscription:${ref}` });
      }
      await this.records.lock(tx, keys);
      const current = (await this.records.read<PaymentOperation>(tx, 'operations', op.operationId))?.body;
      const lane = (await this.records.read<Lane>(tx, 'lanes', laneId))?.body ?? { revision: 0 };
      if (!current || current.revision !== commit.expectedRevision || lane.revision !== commit.expectedLaneRevision || !sameOperationCommand(current, op)) return conflict;
      for (const read of commit.expectedReadSet ?? []) {
        if (await this.records.version(tx, read) !== read.revision) return conflict;
      }
      if (dispatch && current.kind !== 'purchase') {
        const reads = commit.expectedReadSet ?? [];
        if (!current.providerSubscriptionRef || !current.subscriptionBindingId ||
            !reads.some(read => read.table === 'subscriptionBindings' && read.id === current.subscriptionBindingId && read.revision !== null) ||
            !reads.some(read => read.table === 'subscriptions' && read.id === current.providerSubscriptionRef && read.revision !== null)) return conflict;
      }
      if (dispatch && lane.recoveryReviewRequired) return fenced;
      if (dispatch && (current.state !== 'prepared' || op.state !== 'dispatch_started' || (lane.unresolvedOperationId && lane.unresolvedOperationId !== op.operationId))) return conflict;
      const unresolved = op.state === 'dispatch_started' || op.state === 'outcome_unknown';
      // A late terminal observation belongs to this operation. It cannot release a different
      // command's unresolved lane, even when it loaded the latest lane revision before settling.
      const owner = lane.unresolvedOperationId && lane.unresolvedOperationId !== op.operationId
        ? lane.unresolvedOperationId : unresolved ? op.operationId : undefined;
      if (unresolved && owner !== op.operationId) return conflict;
      if (commit.binding) {
        const existing = (await this.records.read<TransactionBinding>(tx, 'bindings', commit.binding.transactionRef))?.body;
        const compatiblePurpose = !existing || existing.purpose === commit.binding.purpose || (existing.purpose === 'commercial' && commit.binding.purpose === 'recovery') || (existing.purpose === 'recovery' && commit.binding.purpose === 'commercial');
        if (existing && (existing.intentId !== commit.binding.intentId || existing.buyerId !== commit.binding.buyerId || !compatiblePurpose || (existing.customerRef !== null && commit.binding.customerRef !== null && existing.customerRef !== commit.binding.customerRef))) return conflict;
        const binding: TransactionBinding = { ...commit.binding, purpose: existing?.purpose === 'recovery' ? 'recovery' : commit.binding.purpose, customerRef: existing?.customerRef ?? commit.binding.customerRef };
        await this.records.write(tx, 'bindings', binding.transactionRef, binding);
        const state = createEmptyPaymentState();
        const previous = (await this.records.read<TransactionAggregate>(tx, 'transactions', binding.transactionRef))?.body;
        if (previous) state.transactions[binding.transactionRef] = previous;
        const aggregate = transactionAggregate(state, binding.transactionRef);
        aggregate.revision += 1;
        aggregate.publicationRequired = true;
        await this.records.write(tx, 'transactions', binding.transactionRef, aggregate);
        await this.records.guard(tx, `intent:${binding.intentId}`);
        await this.work(tx, { kind: 'publication', id: canonicalJson({ type: 'transaction', id: binding.transactionRef }) });
      }
      await this.records.write(tx, 'operations', op.operationId, op);
      await this.records.write(tx, 'lanes', laneId, { revision: lane.revision + 1, ...(owner ? { unresolvedOperationId: owner } : {}), ...(lane.recoveryReviewRequired ? { recoveryReviewRequired: lane.recoveryReviewRequired } : {}) });
      if (commit.intent) await this.records.write(tx, 'intents', commit.intent.intentId, commit.intent);
      if (commit.subscriptionBinding) {
        await this.records.write(tx, 'subscriptionBindings', commit.subscriptionBinding.bindingId, commit.subscriptionBinding);
        for (const ref of commit.subscriptionBinding.providerSubscriptionRefs) await this.records.guard(tx, `subscription:${ref}`);
      }
      await this.work(tx, { kind: 'prepared', id: op.operationId }, op.state === 'prepared' ? 'pending' : 'complete');
      await this.work(tx, { kind: 'unknown', id: op.operationId }, unresolved ? 'pending' : 'complete');
      return committed;
    });
  }

  async recordAttemptObservation(scope: PaymentScope, operationId: string, attemptId: string, result: ProviderResult<JsonValue>): Promise<void> {
    await this.tx(scope, async tx => {
      await this.records.configuration(tx, scope);
      await this.records.lock(tx, [{ kind: 'operations', id: operationId }]);
      const operation = (await this.records.read<PaymentOperation>(tx, 'operations', operationId))?.body;
      const attempt = operation?.attempts.find(item => item.attemptId === attemptId);
      if (!attempt || !operation) throw new Error('Unknown payment operation attempt');
      if (attempt.observations.some(item => digest(item) === digest(result))) return;
      attempt.observations.push(result);
      operation.revision += 1;
      await this.records.write(tx, 'operations', operationId, operation);
    });
  }

  async admitVerifiedInputs(scope: PaymentScope, inputs: readonly VerifiedInput[]): ReturnType<PaymentStore['admitVerifiedInputs']> {
    return this.tx(scope, async tx => {
      await this.records.configuration(tx, scope);
      return this.admitInputs(tx, scope, inputs);
    });
  }

  private async admitInputs(tx: PaymentSqlTransaction, scope: PaymentScope, inputs: readonly VerifiedInput[], maximum: 100 | 200 = 100): ReturnType<PaymentStore['admitVerifiedInputs']> {
    if (inputs.length === 0) return [];
    assertBatchLimit(inputs.length, maximum);
    if (Buffer.byteLength(JSON.stringify(inputs)) > 2_097_152) throw new RangeError('Payment receipt batch exceeds custody bound');
    for (const input of inputs) {
      if (canonicalJson(input.scope) !== canonicalJson(scope)) throw new Error('Verified input scope mismatch');
    }
    // Event identity has only T1 writers. Lock it before receipt identities, then aggregate routes
    // in the same order T2 uses. This includes the OLD routes of a contradictory representation.
    const events = new Map<string, StoredEventIdentity>();
    const eventIds = [...new Set(inputs.flatMap(input => input.source.eventId ? [input.source.eventId] : []))];
    await this.records.lock(tx, eventIds.map(id => ({ kind: 'eventIdentity', id })));
    for (const id of eventIds) {
      const value = (await this.records.read<StoredEventIdentity>(tx, 'eventIdentity', id))?.body;
      if (value) events.set(id, value);
    }
    await this.records.lock(tx, inputs.map(input => ({ kind: 'inbox', id: input.inputId })));
    const existingReceipts = new Map<string, InboxRecord>();
    for (const input of inputs) {
      const prior = (await this.records.read<InboxRecord>(tx, 'inbox', input.inputId))?.body;
      if (prior) existingReceipts.set(input.inputId, prior);
    }
    const routes = inputs.flatMap(input => [
      ...inputRoutes(input),
      ...(existingReceipts.has(input.inputId) ? inputRoutes(existingReceipts.get(input.inputId)!.input) : []),
      ...(input.source.eventId ? events.get(input.source.eventId)?.evidence.routes ?? [] : []),
    ]);
    await this.records.lock(tx, routes.map(route => ({ kind: route.type === 'transaction' ? 'transactions' : 'subscriptions', id: route.id })));
    const result: { inputId: string; kind: 'admitted' | 'duplicate' | 'conflict' }[] = [];
    for (const input of inputs) {
      const state = createEmptyPaymentState();
      const existing = (await this.records.read<InboxRecord>(tx, 'inbox', input.inputId))?.body;
      if (existing) state.inbox[input.inputId] = existing;
      const eventId = input.source.eventId;
      const incomingIdentity = eventIdentityEvidence(input);
      const identity = eventId ? events.get(eventId) : undefined;
      const eventConflict = identity !== undefined && (identity.conflict || compareEventIdentity(identity.evidence, incomingIdentity) === 'conflict');
      const affected = [...inputRoutes(input), ...(existing ? inputRoutes(existing.input) : []), ...(identity?.evidence.routes ?? [])];
      for (const route of affected) {
        if (route.type === 'transaction') {
          const aggregate = (await this.records.read<TransactionAggregate>(tx, 'transactions', route.id))?.body;
          if (aggregate) state.transactions[route.id] = aggregate;
        } else {
          const aggregate = (await this.records.read<SubscriptionAggregate>(tx, 'subscriptions', route.id))?.body;
          if (aggregate) state.subscriptions[route.id] = aggregate;
        }
      }
      let kind = admitInput(state, input);
      if (eventConflict) {
        kind = 'conflict';
        const receipt = state.inbox[input.inputId];
        if (receipt) receipt.conflict = true;
        for (const route of affected) {
          const aggregate = route.type === 'transaction' ? transactionAggregate(state, route.id) : subscriptionAggregate(state, route.id);
          if (!aggregate.flags.includes('conflict')) {
            aggregate.flags.push('conflict');
            aggregate.revision += 1;
            aggregate.publicationRequired = true;
          }
        }
      }
      if (eventId) {
        // Keep the merged certified facts: pairwise compatible partial receipts are not transitive.
        // After a contradiction the original summary remains fenced; previously flagged routes
        // need no unbounded replay list. Every new contradictory route is fenced in this T1.
        const next = identity ? { evidence: eventConflict ? identity.evidence : mergeEventIdentityEvidence(identity.evidence, incomingIdentity), conflict: eventConflict } : { evidence: incomingIdentity, conflict: false };
        events.set(eventId, next);
        await this.records.write(tx, 'eventIdentity', eventId, next);
      }
      const receipt = state.inbox[input.inputId];
      if (!receipt) throw new Error('Admission lost its durable receipt');
      await this.records.write(tx, 'inbox', input.inputId, receipt);
      // Conflicting representations are retained separately, without replacing the first receipt.
      if (kind === 'conflict') await this.records.write(tx, 'conflictingInputs', digest([input.inputId, input.source.representationDigest]), input);
      for (const [id, aggregate] of Object.entries(state.transactions)) {
        await this.records.write(tx, 'transactions', id, aggregate);
        if (aggregate.publicationRequired) await this.work(tx, { kind: 'publication', id: canonicalJson({ type: 'transaction', id }) });
      }
      for (const [id, aggregate] of Object.entries(state.subscriptions)) {
        await this.records.write(tx, 'subscriptions', id, aggregate);
        if (aggregate.publicationRequired) await this.work(tx, { kind: 'publication', id: canonicalJson({ type: 'subscription', id }) });
      }
      await this.work(tx, { kind: 'inbox', id: input.inputId }, receipt.state === 'processed' ? 'complete' : 'pending');
      result.push({ inputId: input.inputId, kind });
    }
    return result;
  }

  async loadReductionInput(scope: PaymentScope, inputId: string): Promise<ReductionInput | undefined> {
    return this.tx(scope, tx => this.workingSet(tx, scope, inputId));
  }

  async loadPublicationInput(scope: PaymentScope, aggregate: AggregateIdentity): Promise<ReductionInput | undefined> {
    return this.tx(scope, tx => this.workingSet(tx, scope, '', aggregate));
  }

  private async workingSet(tx: PaymentSqlTransaction, scope: PaymentScope, inputId: string, aggregate?: AggregateIdentity): Promise<ReductionInput | undefined> {
    const configuration = await this.records.configuration(tx, scope);
    const state = createEmptyPaymentState();
    state.consumers = configuration.body.consumers;
    state.recoveryFenced = configuration.body.recoveryFenced;
    const expected: PaymentReadVersion[] = [{ table: 'configuration', id: 'scope', revision: configuration.revision }];
    const maximumRecords = this.options.maxWorkingSetRecords ?? 128;
    let remainingBytes = this.options.maxWorkingSetBytes ?? 2_097_152;
    let incomplete = false;
    let invalidVersion = false;
    const seen = new Set<string>();
    const guard = async (id: string): Promise<void> => {
      if (expected.some(item => item.table === 'guards' && item.id === id)) return;
      expected.push({ table: 'guards', id, revision: (await this.records.read(tx, 'guards', id))?.revision ?? null });
    };
    const add = async (table: MutableTable, id: string): Promise<void> => {
      const key = canonicalJson([table, id]);
      if (seen.has(key)) return;
      seen.add(key);
      if (expected.length >= maximumRecords) { incomplete = true; return; }
      const result = await tx.query<{ revision: string; body: unknown; bytes: number; metadata: { revision?: number; evidenceRevision?: number } }>(
        `SELECT revision, CASE WHEN octet_length(body::text) <= $3 THEN body ELSE NULL END AS body,
        octet_length(body::text) AS bytes,
        jsonb_build_object('revision', body -> 'revision', 'evidenceRevision', body -> 'evidenceRevision') AS metadata
        FROM ${this.records.sql}.records WHERE kind = $1 AND id = $2`, [table, id, Math.max(0, remainingBytes)],
      );
      const row = result.rows[0];
      const revision = row ? Number(row.revision) : null;
      if (revision !== null && !Number.isSafeInteger(revision)) throw new RangeError('Unsupported stored revision');
      expected.push({ table, id, revision });
      if (!row) return;
      if (row.body !== null) {
        remainingBytes -= row.bytes;
        (state[table] as Record<string, unknown>)[id] = row.body;
        return;
      }
      incomplete = true;
      // A held commit updates only these publication counters. Stored history is never replaced.
      if (table === 'transactions') {
        const partial = transactionAggregate(state, id);
        partial.revision = row.metadata.revision ?? 0;
        partial.evidenceRevision = row.metadata.evidenceRevision ?? 0;
        partial.publicationRequired = true;
      } else if (table === 'subscriptions') {
        state.subscriptions[id] = { subscriptionRef: id, revision: row.metadata.revision ?? 0, evidenceRevision: row.metadata.evidenceRevision ?? 0, flags: ['incomplete'], publicationRequired: true };
      }
    };
    const includeVersion = async (observation: Observation): Promise<void> => {
      let key: string | undefined;
      try { key = objectVersionKey(observation); } catch { incomplete = true; invalidVersion = true; return; }
      if (key !== undefined) await add('versionEvidence', key);
    };
    const includeIntent = async (intentId: string): Promise<void> => {
      // Read the membership guard BEFORE its predicate, and validate it in the committing T2.
      await guard(`intent:${intentId}`);
      await add('intents', intentId);
      const intent = state.intents[intentId];
      if (!intent) return;
      if (intent.subscriptionBasisId) await add('subscriptionBindings', intent.subscriptionBasisId);
      const candidates = await tx.query<{ id: string }>(
        `SELECT id FROM ${this.records.sql}.records WHERE kind = 'transactions'
         AND body #>> '{completion,intentId}' = $1
         AND body #>> '{completion,classification}' IN ('initial', 'one_time') ORDER BY id LIMIT $2`, [intentId, maximumRecords + 1],
      );
      if (candidates.rows.length > maximumRecords) incomplete = true;
      for (const row of candidates.rows.slice(0, maximumRecords)) await add('transactions', row.id);
    };
    let transactionRef: string | undefined;
    let subscriptionRef: string | undefined;
    if (aggregate) {
      if (aggregate.type === 'transaction') transactionRef = aggregate.id;
      else subscriptionRef = aggregate.id;
    } else {
      // Input custody is independently capped at admission; routing survives a smaller reducer budget.
      const receipt = await this.records.read<InboxRecord>(tx, 'inbox', inputId);
      if (!receipt) return undefined;
      expected.push({ table: 'inbox', id: inputId, revision: receipt.revision });
      seen.add(canonicalJson(['inbox', inputId]));
      state.inbox[inputId] = receipt.body;
      remainingBytes -= Buffer.byteLength(JSON.stringify(receipt.body));
      if (remainingBytes < 0) incomplete = true;
      const observation = receipt.body.input.observation;
      await includeVersion(observation);
      transactionRef = receipt.body.input.adverseTransactionRef ?? ('transactionRef' in observation ? observation.transactionRef : undefined);
      if (observation.kind === 'transaction' && observation.subscriptionRef.presence === 'known') subscriptionRef = observation.subscriptionRef.value ?? undefined;
      else if ('subscriptionRef' in observation && typeof observation.subscriptionRef === 'string') subscriptionRef = observation.subscriptionRef;
    }
    if (transactionRef) {
      await add('transactions', transactionRef);
      await add('bindings', transactionRef);
      const binding = state.bindings[transactionRef];
      if (binding) await includeIntent(binding.intentId);
      const current = state.transactions[transactionRef]?.current;
      if (!subscriptionRef && current?.subscriptionRef.presence === 'known') subscriptionRef = current.subscriptionRef.value ?? undefined;
    }
    if (subscriptionRef) {
      await guard(`subscription:${subscriptionRef}`);
      await add('subscriptions', subscriptionRef);
      const matches = await tx.query<{ id: string }>(
        `SELECT id FROM ${this.records.sql}.records WHERE kind = 'subscriptionBindings'
         AND body -> 'providerSubscriptionRefs' ? $1 ORDER BY id LIMIT $2`, [subscriptionRef, maximumRecords + 1],
      );
      if (matches.rows.length > maximumRecords) incomplete = true;
      for (const match of matches.rows.slice(0, maximumRecords)) {
        await add('subscriptionBindings', match.id);
        const binding = state.subscriptionBindings[match.id];
        if (binding) await includeIntent(binding.originatingIntentId);
      }
    }
    // Publication can replay observations after late binding. It uses the same exact-version
    // evidence and null-creation CAS as inbox reduction, within the existing record/byte bounds.
    for (const value of Object.values(state.transactions)) {
      for (const observation of value.observations) await includeVersion(observation);
      for (const observation of Object.values(value.adjustments)) await includeVersion(observation);
    }
    for (const value of Object.values(state.subscriptions)) if (value.current) await includeVersion(value.current);
    return { inputId, state, expected, ...(incomplete ? { incompleteReason: invalidVersion ? 'invalid_object_version' : 'working_set_limit' } : {}) };
  }

  async commitReduction(scope: PaymentScope, commit: ReductionCommit): Promise<StoreCommitResult> {
    return this.tx(scope, async tx => {
      if ((await this.records.configuration(tx, scope)).body.recoveryFenced) return fenced;
      const keys: RecordKey[] = commit.expected.filter(item => item.table !== 'configuration').map(item => ({ kind: item.table, id: item.id }));
      for (const table of mutableTables) for (const id of Object.keys(commit.state[table])) keys.push({ kind: table, id });
      for (const binding of Object.values(commit.state.bindings)) keys.push({ kind: 'guards', id: `intent:${binding.intentId}` });
      for (const binding of Object.values(commit.state.subscriptionBindings)) for (const ref of binding.providerSubscriptionRefs) keys.push({ kind: 'guards', id: `subscription:${ref}` });
      for (const [id] of Object.entries(commit.state.evidence)) keys.push({ kind: 'evidence', id });
      await this.records.lock(tx, keys);
      for (const item of commit.expected) if (await this.records.version(tx, item) !== item.revision) return conflict;
      const namespaces = [...new Set(Object.values(commit.state.evidence).map(message => message.producerNamespace))];
      if (namespaces.length > 1) return conflict;
      const namespace = namespaces[0];
      let savedNamespace = (await this.records.read<string>(tx, 'ownerIdentity', 'producerNamespace'))?.body;
      if (namespace !== undefined && savedNamespace === undefined) {
        // Namespace is immutable after first publication. Only its first creation needs a lock;
        // ordinary unrelated aggregate commits keep their existing concurrency.
        await this.records.lock(tx, [{ kind: 'ownerIdentity', id: 'producerNamespace' }]);
        savedNamespace = (await this.records.read<string>(tx, 'ownerIdentity', 'producerNamespace'))?.body;
      }
      if (namespace !== undefined && savedNamespace !== undefined && savedNamespace !== namespace) return conflict;
      // Validate all immutable outputs before changing any row. Conflict is a rejected commit.
      for (const [id, message] of Object.entries(commit.state.evidence)) {
        const { bodyDigest, ...body } = message;
        if (message.messageId !== id || bodyDigest !== digest(body) || canonicalJson(message.scope) !== canonicalJson(scope)) return conflict;
        const existing = await this.records.read<EvidenceMessage>(tx, 'evidence', id);
        if (existing && existing.body.bodyDigest !== message.bodyDigest) return conflict;
      }
      if (namespace !== undefined && savedNamespace === undefined) await this.records.write(tx, 'ownerIdentity', 'producerNamespace', namespace);
      for (const table of mutableTables) {
        for (const [id, value] of Object.entries(commit.state[table])) {
          const previous = await this.records.read<unknown>(tx, table, id);
          if (commit.heldReason) {
            if (table === 'transactions' || table === 'subscriptions') {
              const partial = value as TransactionAggregate | SubscriptionAggregate;
              if (previous) {
                await tx.query(`UPDATE ${this.records.sql}.records SET revision = revision + 1,
                  body = body || $3::jsonb, updated_at = clock_timestamp() WHERE kind = $1 AND id = $2`,
                [table, id, JSON.stringify({ revision: partial.revision, evidenceRevision: partial.evidenceRevision, publicationRequired: false })]);
              }
            } else if (table === 'inbox' && id === commit.inputId) {
              await tx.query(`UPDATE ${this.records.sql}.records SET revision = revision + 1,
                body = body || $2::jsonb, updated_at = clock_timestamp() WHERE kind = 'inbox' AND id = $1`,
              [id, JSON.stringify({ state: 'quarantined', issue: commit.heldReason })]);
            }
            continue;
          }
          if (canonicalJson(previous?.body ?? null) === canonicalJson(value)) continue;
          await this.records.write(tx, table, id, value);
          if (table === 'transactions') {
            const transaction = value as TransactionAggregate;
            const intentId = transaction.completion?.intentId ?? commit.state.bindings[id]?.intentId;
            if (intentId) await this.records.guard(tx, `intent:${intentId}`);
          } else if (table === 'bindings') {
            await this.records.guard(tx, `intent:${(value as TransactionBinding).intentId}`);
          } else if (table === 'subscriptionBindings') {
            for (const ref of (value as SubscriptionBinding).providerSubscriptionRefs) await this.records.guard(tx, `subscription:${ref}`);
          }
        }
      }
      for (const [id, message] of Object.entries(commit.state.evidence)) await this.records.write(tx, 'evidence', id, message);
      for (const [id, delivery] of Object.entries(commit.state.deliveries)) {
        const existing = await this.records.read<Delivery>(tx, 'deliveries', id);
        if (!existing) await this.records.write(tx, 'deliveries', id, delivery);
        await this.work(tx, { kind: 'delivery', id }, existing?.body.acknowledged ? 'complete' : 'pending');
      }
      for (const issue of commit.state.issues) await this.records.write(tx, 'issues', digest(issue), { issue });
      for (const aggregate of Object.values(commit.state.transactions)) await this.work(tx, { kind: 'publication', id: canonicalJson({ type: 'transaction', id: aggregate.transactionRef }) }, aggregate.publicationRequired ? 'pending' : 'complete');
      for (const aggregate of Object.values(commit.state.subscriptions)) await this.work(tx, { kind: 'publication', id: canonicalJson({ type: 'subscription', id: aggregate.subscriptionRef }) }, aggregate.publicationRequired ? 'pending' : 'complete');
      const receipt = commit.state.inbox[commit.inputId];
      if (receipt) await this.work(tx, { kind: 'inbox', id: commit.inputId }, receipt.state === 'pending' ? 'pending' : receipt.state === 'quarantined' ? 'quarantined' : 'complete');
      return committed;
    });
  }

  async readPurchase(scope: PaymentScope, buyerId: string, intentId: string): ReturnType<PaymentStore['readPurchase']> {
    return this.tx(scope, async tx => {
      await this.records.configuration(tx, scope);
      const intent = (await this.records.read<PurchaseIntent>(tx, 'intents', intentId))?.body;
      if (!intent || intent.buyerId !== buyerId) return undefined;
      const result = await tx.query<{ body: TransactionAggregate }>(`SELECT t.body FROM ${this.records.sql}.records b
        JOIN ${this.records.sql}.records t ON t.kind = 'transactions' AND t.id = b.id
        WHERE b.kind = 'bindings' AND b.body ->> 'intentId' = $1 ORDER BY t.id LIMIT 101`, [intentId]);
      if (result.rows.length > 100) throw new RangeError('Purchase query requires operator investigation of excessive candidate transactions');
      return { intent, transactions: result.rows.map(row => row.body) };
    });
  }

  async readSubscription(scope: PaymentScope, buyerId: string, bindingId: string): ReturnType<PaymentStore['readSubscription']> {
    return this.tx(scope, async tx => {
      await this.records.configuration(tx, scope);
      const binding = (await this.records.read<SubscriptionBinding>(tx, 'subscriptionBindings', bindingId))?.body;
      if (!binding || binding.buyerId !== buyerId) return undefined;
      if (binding.providerSubscriptionRefs.length > 100) throw new RangeError('Too many candidate subscription streams');
      const result = await tx.query<{ body: SubscriptionAggregate }>(`SELECT body FROM ${this.records.sql}.records
        WHERE kind = 'subscriptions' AND id = ANY($1::text[]) ORDER BY id`, [binding.providerSubscriptionRefs]);
      return { binding, observations: result.rows.map(row => row.body) };
    });
  }

  async listWork(scope: PaymentScope, kind: 'inbox' | 'publication' | 'prepared' | 'unknown', limit: number): Promise<readonly string[]> {
    assertBatchLimit(limit);
    return this.tx(scope, async tx => {
      await this.records.configuration(tx, scope);
      // Completed pg-boss jobs are disposable. These obligations outlive all job retention.
      const result = await tx.query<{ id: string }>(`SELECT id FROM ${this.records.sql}.obligations
        WHERE kind = $1 AND state = 'pending' ORDER BY next_attempt_at, id LIMIT $2`, [kind, limit]);
      return result.rows.map(row => row.id);
    });
  }

  async registerConsumer(scope: PaymentScope, consumerId: string, backfill: boolean): Promise<void> {
    if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(consumerId)) throw new TypeError('Invalid consumer identity');
    await this.tx(scope, async tx => {
      const config = await this.records.configuration(tx, scope, true);
      if (!config.body.consumers.includes(consumerId)) {
        if (config.body.consumers.length >= 32) throw new RangeError('Consumer target bound exceeded');
        config.body.consumers.push(consumerId);
        await tx.query(`UPDATE ${this.records.sql}.configuration SET revision = revision + 1, body = $1 WHERE id = 'owner'`, [JSON.stringify(config.body)]);
      }
      if (backfill) {
        // Bounded batches are resumed by a durable cursor, never a single unbounded transaction.
        await this.records.write(tx, 'backfills', consumerId, { consumerId, after: null, state: 'pending' });
        await this.records.obligation(tx, { kind: 'delivery', id: `backfill:${consumerId}` });
      }
    });
    if (backfill) await this.backfillConsumer(scope, consumerId);
  }

  private async backfillConsumer(scope: PaymentScope, consumerId: string): Promise<void> {
    await this.tx(scope, async tx => {
      await this.records.configuration(tx, scope);
      await this.records.lock(tx, [{ kind: 'backfills', id: consumerId }]);
      const cursor = (await this.records.read<{ consumerId: string; after: string | null; state: string }>(tx, 'backfills', consumerId))?.body;
      if (!cursor || cursor.state === 'complete') return;
      const messages = await tx.query<{ id: string }>(`SELECT id FROM ${this.records.sql}.records
        WHERE kind = 'evidence' AND ($1::text IS NULL OR id > $1) ORDER BY id LIMIT 100`, [cursor.after]);
      for (const row of messages.rows) {
        const id = canonicalJson([row.id, consumerId]);
        const existing = await this.records.read<Delivery>(tx, 'deliveries', id);
        if (!existing) await this.records.write(tx, 'deliveries', id, { consumerId, messageId: row.id, acknowledged: false, attempts: 0 });
        await this.work(tx, { kind: 'delivery', id }, existing?.body.acknowledged ? 'complete' : 'pending');
      }
      const last = messages.rows.at(-1)?.id;
      await this.records.write(tx, 'backfills', consumerId, { consumerId, after: last ?? cursor.after, state: messages.rows.length < 100 ? 'complete' : 'pending' });
      await this.records.obligation(tx, { kind: 'delivery', id: `backfill:${consumerId}` }, messages.rows.length < 100 ? 'complete' : 'pending');
    });
  }

  async listDeliveries(scope: PaymentScope, consumerId: string, limit: number): Promise<readonly EvidenceMessage[]> {
    assertBatchLimit(limit);
    await this.backfillConsumer(scope, consumerId);
    return this.tx(scope, async tx => {
      const config = await this.records.configuration(tx, scope);
      if (config.body.recoveryFenced || !config.body.consumers.includes(consumerId)) return [];
      const messages = await tx.query<{ body: EvidenceMessage }>(`SELECT e.body FROM ${this.records.sql}.records d
        JOIN ${this.records.sql}.records e ON e.kind = 'evidence' AND e.id = d.body ->> 'messageId'
        WHERE d.kind = 'deliveries' AND d.body ->> 'consumerId' = $1 AND d.body ->> 'acknowledged' = 'false'
        ORDER BY e.updated_at, e.id LIMIT $2`, [consumerId, limit]);
      return messages.rows.map(row => row.body);
    });
  }

  async acknowledgeDelivery(scope: PaymentScope, consumerId: string, messageId: string, bodyDigest: string): Promise<'acknowledged' | 'duplicate' | 'conflict'> {
    return this.tx(scope, async tx => {
      if ((await this.records.configuration(tx, scope)).body.recoveryFenced) return 'conflict';
      const id = canonicalJson([messageId, consumerId]);
      await this.records.lock(tx, [{ kind: 'deliveries', id }]);
      const delivery = (await this.records.read<Delivery>(tx, 'deliveries', id))?.body;
      const message = (await this.records.read<EvidenceMessage>(tx, 'evidence', messageId))?.body;
      if (!delivery || !message || message.bodyDigest !== bodyDigest) return 'conflict';
      if (delivery.acknowledged) return 'duplicate';
      delivery.acknowledged = true;
      await this.records.write(tx, 'deliveries', id, delivery);
      await this.work(tx, { kind: 'delivery', id }, 'complete');
      return 'acknowledged';
    });
  }

  async setRecoveryFence(scope: PaymentScope, recoveryFenced: boolean, auditRef: string): Promise<void> {
    if (!auditRef || auditRef.length > 512) throw new TypeError('A recovery fence requires an audit reference');
    await this.tx(scope, async tx => {
      const config = await this.records.configuration(tx, scope, true);
      if (!recoveryFenced && config.body.activeRecoverySessionId) throw new Error('An active recovery session must pass its resume gate');
      config.body.recoveryFenced = recoveryFenced;
      config.body.fenceAudits.push({ fenced: recoveryFenced, auditRef, at: new Date().toISOString() });
      await tx.query(`UPDATE ${this.records.sql}.configuration SET revision = revision + 1, body = $1 WHERE id = 'owner'`, [JSON.stringify(config.body)]);
    });
  }

  async readCheckpoint(scope: PaymentScope, scanId: string): Promise<ScanCheckpoint | undefined> {
    return this.tx(scope, async tx => {
      await this.records.configuration(tx, scope);
      return (await this.records.read<ScanCheckpoint>(tx, 'scans', scanId))?.body;
    });
  }

  async commitScanPage(scope: PaymentScope, expected: ScanCheckpoint | undefined, next: ScanCheckpoint, inputs: readonly VerifiedInput[]): Promise<StoreCommitResult> {
    return this.tx(scope, async tx => {
      if ((await this.records.configuration(tx, scope)).body.recoveryFenced) return fenced;
      await this.records.lock(tx, [{ kind: 'scans', id: next.scanId }]);
      const current = (await this.records.read<ScanCheckpoint>(tx, 'scans', next.scanId))?.body;
      if (canonicalJson(current ?? null) !== canonicalJson(expected ?? null)) return conflict;
      await this.admitInputs(tx, scope, inputs, 200);
      await this.records.write(tx, 'scans', next.scanId, next);
      await this.work(tx, { kind: 'scan', id: next.scanId }, next.status === 'running' ? 'pending' : next.status === 'gap' ? 'quarantined' : 'complete');
      return committed;
    });
  }
}
