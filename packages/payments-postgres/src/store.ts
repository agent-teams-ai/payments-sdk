import {
  admitInput, canonicalJson, createEmptyPaymentState, digest, transactionAggregate,
} from '@agent-teams/payments-core';
import type {
  AggregateIdentity, Delivery, EvidenceMessage, InboxRecord, IntentAdmission, JsonValue,
  OperationCommit, OperationInput, PaymentOperation, PaymentReadVersion, PaymentScope,
  PaymentState, PaymentStore, ProviderResult, PurchaseIntent, ReductionCommit, ReductionInput,
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

const mutableTables = ['intents', 'operations', 'bindings', 'subscriptionBindings', 'transactions', 'subscriptions', 'inbox'] as const;
type MutableTable = typeof mutableTables[number];
type Lane = { revision: number; unresolvedOperationId?: string };
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
      if (operation.subscriptionBindingId) keys.push({ kind: 'subscriptionBindings', id: operation.subscriptionBindingId });
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
      if (commit.intent) keys.push({ kind: 'intents', id: commit.intent.intentId });
      if (commit.binding) keys.push({ kind: 'bindings', id: commit.binding.transactionRef }, { kind: 'transactions', id: commit.binding.transactionRef }, { kind: 'guards', id: `intent:${commit.binding.intentId}` });
      if (commit.subscriptionBinding) {
        keys.push({ kind: 'subscriptionBindings', id: commit.subscriptionBinding.bindingId });
        for (const ref of commit.subscriptionBinding.providerSubscriptionRefs) keys.push({ kind: 'guards', id: `subscription:${ref}` });
      }
      await this.records.lock(tx, keys);
      const current = (await this.records.read<PaymentOperation>(tx, 'operations', op.operationId))?.body;
      const lane = (await this.records.read<Lane>(tx, 'lanes', laneId))?.body ?? { revision: 0 };
      if (!current || current.revision !== commit.expectedRevision || lane.revision !== commit.expectedLaneRevision) return conflict;
      if (dispatch && (current.state !== 'prepared' || op.state !== 'dispatch_started' || (lane.unresolvedOperationId && lane.unresolvedOperationId !== op.operationId))) return conflict;
      if (commit.binding) {
        const existing = (await this.records.read<TransactionBinding>(tx, 'bindings', commit.binding.transactionRef))?.body;
        if (existing && (existing.intentId !== commit.binding.intentId || existing.buyerId !== commit.binding.buyerId || existing.purpose !== commit.binding.purpose || (existing.customerRef !== null && commit.binding.customerRef !== null && existing.customerRef !== commit.binding.customerRef))) return conflict;
        const binding = { ...commit.binding, customerRef: existing?.customerRef ?? commit.binding.customerRef };
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
      const unresolved = op.state === 'dispatch_started' || op.state === 'outcome_unknown';
      await this.records.write(tx, 'lanes', laneId, { revision: lane.revision + 1, ...(unresolved ? { unresolvedOperationId: op.operationId } : {}) });
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

  private async admitInputs(tx: PaymentSqlTransaction, scope: PaymentScope, inputs: readonly VerifiedInput[]): ReturnType<PaymentStore['admitVerifiedInputs']> {
    if (inputs.length === 0) return [];
    assertBatchLimit(inputs.length);
    if (Buffer.byteLength(JSON.stringify(inputs)) > 2_097_152) throw new RangeError('Payment receipt batch exceeds custody bound');
    const keys: RecordKey[] = [];
    for (const input of inputs) {
      if (canonicalJson(input.scope) !== canonicalJson(scope)) throw new Error('Verified input scope mismatch');
      keys.push({ kind: 'inbox', id: input.inputId });
      if (input.source.eventId) keys.push({ kind: 'eventIdentity', id: input.source.eventId });
      const ref = input.adverseTransactionRef ?? ('transactionRef' in input.observation ? input.observation.transactionRef : undefined);
      if (ref) keys.push({ kind: 'transactions', id: ref });
    }
    await this.records.lock(tx, keys);
    const result: { inputId: string; kind: 'admitted' | 'duplicate' | 'conflict' }[] = [];
    for (const input of inputs) {
      const state = createEmptyPaymentState();
      const existing = (await this.records.read<InboxRecord>(tx, 'inbox', input.inputId))?.body;
      if (existing) state.inbox[input.inputId] = existing;
      let eventConflict = false;
      if (input.source.eventId && input.source.stableEnvelopeDigest) {
        const identity = (await this.records.read<{ digest: string }>(tx, 'eventIdentity', input.source.eventId))?.body;
        if (!identity) await this.records.write(tx, 'eventIdentity', input.source.eventId, { digest: input.source.stableEnvelopeDigest });
        else eventConflict = identity.digest !== input.source.stableEnvelopeDigest;
      }
      const ref = input.adverseTransactionRef ?? ('transactionRef' in input.observation ? input.observation.transactionRef : undefined);
      if (ref) {
        const aggregate = (await this.records.read<TransactionAggregate>(tx, 'transactions', ref))?.body;
        if (aggregate) state.transactions[ref] = aggregate;
      }
      let kind = admitInput(state, input);
      if (eventConflict) {
        kind = 'conflict';
        const receipt = state.inbox[input.inputId];
        if (receipt) receipt.conflict = true;
        if (ref) {
          const aggregate = transactionAggregate(state, ref);
          if (!aggregate.flags.includes('conflict')) aggregate.flags.push('conflict');
          aggregate.revision += 1;
          aggregate.publicationRequired = true;
        }
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
      await this.work(tx, { kind: 'inbox', id: input.inputId }, receipt.state === 'processed' ? 'complete' : 'pending');
      result.push({ inputId: input.inputId, kind });
    }
    return result;
  }

  // Bounded reduction and delivery methods are implemented below.
}
