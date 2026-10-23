import type { PaymentScope, AggregateIdentity, Observation } from '@agent-teams/payments-core';
import type { InboxRecord, ReductionInput, PaymentReadVersion } from '@agent-teams/payments-core/store';
import type { PaymentSqlTransaction } from './database.js';
import type { StoredRecord, OwnerConfiguration } from './records.js';
import type { MutableTable } from './store-context.js';
import { canonicalJson } from '@agent-teams/payments-core';
import { createEmptyPaymentState, objectVersionDependentRoutes, objectVersionKey, transactionAggregate } from '@agent-teams/payments-core/store';
import { PaymentStoreContext } from './store-context.js';
export async function loadPaymentReductionInput(context: PaymentStoreContext, tx: PaymentSqlTransaction, scope: PaymentScope, inputId: string, aggregate?: AggregateIdentity): Promise<ReductionInput | undefined> {
    const configuration = await context.records.configuration(tx, scope);
    return new ReductionWorkingSet(context, tx, inputId, configuration).build(aggregate);
}
/** One bounded T2 read snapshot, including null creations and membership guards. */
class ReductionWorkingSet {
    private readonly context: PaymentStoreContext;
    private readonly transaction: PaymentSqlTransaction;
    private readonly inputId: string;
    state = createEmptyPaymentState();
    private readonly expected: PaymentReadVersion[];
    private readonly maximumRecords: number;
    private remainingBytes: number;
    incomplete = false;
    invalidVersion = false;
    seen = new Set<string>();
    transactionRefs = new Set<string>();
    subscriptionRefs = new Set<string>();
    constructor(context: PaymentStoreContext, transaction: PaymentSqlTransaction, inputId: string, configuration: StoredRecord<OwnerConfiguration>) {
        this.context = context;
        this.transaction = transaction;
        this.inputId = inputId;
        this.state.consumers = configuration.body.consumers;
        this.state.recoveryFenced = configuration.body.recoveryFenced;
        this.expected = [{ table: 'configuration', id: 'scope', revision: configuration.revision }];
        this.maximumRecords = context.options.maxWorkingSetRecords ?? 128;
        this.remainingBytes = context.options.maxWorkingSetBytes ?? 2_097_152;
    }
    async build(aggregate?: AggregateIdentity): Promise<ReductionInput | undefined> {
        if (!await this.collectRoutes(aggregate)) {
            return;
        }
        await this.collectTransactions();
        await this.collectSubscriptions();
        await this.collectObservationVersions();
        return { inputId: this.inputId, state: this.state, expected: this.expected,
            ...(this.incomplete ? { incompleteReason: this.invalidVersion ? 'invalid_object_version' : 'working_set_limit' } : {}) };
    }
    private async guard(id: string): Promise<void> {
        if (this.expected.some(item => item.table === 'guards' && item.id === id)) {
            return;
        }
        this.expected.push({ table: 'guards', id, revision: (await this.context.records.read(this.transaction, 'guards', id))?.revision ?? null });
    }
    private async add(table: MutableTable, id: string): Promise<void> {
        const key = canonicalJson([table, id]);
        if (this.seen.has(key)) {
            return;
        }
        this.seen.add(key);
        if (this.expected.length >= this.maximumRecords) {
            this.incomplete = true;
            return;
        }
        const result = await this.transaction.query<{ revision: string; body: unknown; bytes: number; metadata: { revision?: number; evidenceRevision?: number } }>(`SELECT revision, CASE WHEN octet_length(body::text) <= $3 THEN body ELSE NULL END AS body,
      octet_length(body::text) AS bytes,
      jsonb_build_object('revision', body -> 'revision', 'evidenceRevision', body -> 'evidenceRevision') AS metadata
      FROM ${this.context.records.sql}.records WHERE kind = $1 AND id = $2`, [table, id, Math.max(0, this.remainingBytes)]);
        const row = result.rows[0];
        const revision = row ? Number(row.revision) : null;
        if (revision !== null && !Number.isSafeInteger(revision)) {
            throw new RangeError('Unsupported stored revision');
        }
        this.expected.push({ table, id, revision });
        if (!row) {
            return;
        }
        if (row.body !== null) {
            this.remainingBytes -= row.bytes;
            (this.state[table] as Record<string, unknown>)[id] = row.body;
            return;
        }
        this.incomplete = true;
        // A held commit updates only these publication counters. Stored history is never replaced.
        if (table === 'transactions') {
            const partial = transactionAggregate(this.state, id);
            partial.revision = row.metadata.revision ?? 0;
            partial.evidenceRevision = row.metadata.evidenceRevision ?? 0;
            partial.publicationRequired = true;
        }
        else if (table === 'subscriptions') {
            this.state.subscriptions[id] = { subscriptionRef: id, revision: row.metadata.revision ?? 0, evidenceRevision: row.metadata.evidenceRevision ?? 0, flags: ['incomplete'], publicationRequired: true };
        }
    }
    private async includeVersion(observation: Observation): Promise<string | undefined> {
        let key: string | undefined;
        try {
            key = objectVersionKey(observation);
        }
        catch {
            this.incomplete = true;
            this.invalidVersion = true;
            return;
        }
        if (key !== undefined) {
            await this.add('versionEvidence', key);
        }
        return key;
    }
    private async includeIntent(intentId: string): Promise<void> {
        // Read the membership guard BEFORE its predicate, and validate it in the committing T2.
        await this.guard(`intent:${intentId}`);
        await this.add('intents', intentId);
        const intent = this.state.intents[intentId];
        if (!intent) {
            return;
        }
        if ((intent.subscriptionBasisId !== undefined && intent.subscriptionBasisId !== '')) {
            await this.add('subscriptionBindings', intent.subscriptionBasisId);
            await this.add('reclassifications', intent.subscriptionBasisId);
        }
        const candidates = await this.transaction.query<{ id: string }>(`SELECT id FROM ${this.context.records.sql}.records WHERE kind = 'transactions'
       AND body #>> '{completion,intentId}' = $1
       AND body #>> '{completion,classification}' IN ('initial', 'one_time') ORDER BY id LIMIT $2`, [intentId, this.maximumRecords + 1]);
        if (candidates.rows.length > this.maximumRecords) {
            this.incomplete = true;
        }
        for (const row of candidates.rows.slice(0, this.maximumRecords)) {
            await this.add('transactions', row.id);
        }
    }
    private async collectRoutes(aggregate?: AggregateIdentity): Promise<boolean> {
        if (aggregate) {
            if (aggregate.type === 'transaction') {
                this.transactionRefs.add(aggregate.id);
            }
            else {
                this.subscriptionRefs.add(aggregate.id);
            }
        }
        else {
            // Input custody is independently capped at admission; routing survives a smaller reducer budget.
            const receipt = await (this.context.records.read(this.transaction, 'inbox', this.inputId) as Promise<StoredRecord<InboxRecord> | undefined>);
            if (!receipt) {
                return false;
            }
            this.expected.push({ table: 'inbox', id: this.inputId, revision: receipt.revision });
            this.seen.add(canonicalJson(['inbox', this.inputId]));
            this.state.inbox[this.inputId] = receipt.body;
            this.remainingBytes -= Buffer.byteLength(JSON.stringify(receipt.body));
            if (this.remainingBytes < 0) {
                this.incomplete = true;
            }
            const observation = receipt.body.input.observation;
            const observationVersionKey = await this.includeVersion(observation);
            for (const route of objectVersionDependentRoutes(observation, observationVersionKey === undefined ? undefined : this.state.versionEvidence[observationVersionKey])) {
                if (route.type === 'transaction') {
                    this.transactionRefs.add(route.id);
                }
                else {
                    this.subscriptionRefs.add(route.id);
                }
            }
            if ((receipt.body.input.adverseTransactionRef !== undefined && receipt.body.input.adverseTransactionRef !== '')) {
                this.transactionRefs.add(receipt.body.input.adverseTransactionRef);
            }
            if (observation.kind === 'transaction' && observation.subscriptionRef.presence === 'known' && (observation.subscriptionRef.value !== null && observation.subscriptionRef.value !== '')) {
                this.subscriptionRefs.add(observation.subscriptionRef.value);
            }
        }
        return true;
    }
    private async collectTransactions(): Promise<void> {
        for (const transactionRef of this.transactionRefs) {
            await this.add('transactions', transactionRef);
            await this.add('bindings', transactionRef);
            const binding = this.state.bindings[transactionRef];
            if (binding) {
                await this.includeIntent(binding.intentId);
            }
            const current = this.state.transactions[transactionRef]?.current;
            if (current?.subscriptionRef.presence === 'known' && (current.subscriptionRef.value !== null && current.subscriptionRef.value !== '')) {
                this.subscriptionRefs.add(current.subscriptionRef.value);
            }
        }
    }
    private async collectSubscriptions(): Promise<void> {
        for (const subscriptionRef of this.subscriptionRefs) {
            await this.guard(`subscription:${subscriptionRef}`);
            await this.add('subscriptions', subscriptionRef);
            const matches = await this.transaction.query<{ id: string }>(`SELECT id FROM ${this.context.records.sql}.records WHERE kind = 'subscriptionBindings'
         AND body -> 'providerSubscriptionRefs' ? $1 ORDER BY id LIMIT $2`, [subscriptionRef, this.maximumRecords + 1]);
            if (matches.rows.length > this.maximumRecords) {
                this.incomplete = true;
            }
            for (const match of matches.rows.slice(0, this.maximumRecords)) {
                await this.add('subscriptionBindings', match.id);
                await this.add('reclassifications', match.id);
                const binding = this.state.subscriptionBindings[match.id];
                if (binding) {
                    await this.includeIntent(binding.originatingIntentId);
                }
            }
        }
    }
    private async collectObservationVersions(): Promise<void> {
        // Publication can replay observations after late binding. It uses the same exact-version
        // evidence and null-creation CAS as inbox reduction, within the existing record/byte bounds.
        for (const value of Object.values(this.state.transactions)) {
            for (const observation of value.observations) {
                await this.includeVersion(observation);
            }
            for (const observation of Object.values(value.adjustments)) {
                await this.includeVersion(observation);
            }
        }
        for (const value of Object.values(this.state.subscriptions)) {
            if (value.current) {
                await this.includeVersion(value.current);
            }
        }
    }
}
