import type { PaymentScope, AggregateIdentity, VerifiedInput } from '@agent-teams/payments-core';
import type { PaymentStore, TransactionAggregate, SubscriptionAggregate, InboxRecord, PaymentState, EventIdentityEvidence, ObjectVersionEvidence } from '@agent-teams/payments-core/store';
import type { PaymentSqlTransaction } from './database.js';
import type { StoredRecord, RecordWrite } from './records.js';
import type { StoredEventIdentity } from './store-context.js';
import { admitInput, compareEventIdentity, createEmptyPaymentState, eventIdentityEvidence, inputRoutes, mergeEventIdentityEvidence, objectVersionDependentRoutes, objectVersionKey, subscriptionAggregate, transactionAggregate } from '@agent-teams/payments-core/store';
import { canonicalJson, digest } from '@agent-teams/payments-core';
import { assertBatchLimit } from './records.js';
import { PaymentStoreContext } from './store-context.js';
type InputPage = { events: Map<string, StoredEventIdentity>; receipts: Map<string, InboxRecord>; versions: Map<string, ObjectVersionEvidence> };
type InputTransition = { input: VerifiedInput; state: PaymentState; kind: 'admitted' | 'duplicate' | 'conflict'; identity: StoredEventIdentity | undefined; incomingIdentity: EventIdentityEvidence; eventConflict: boolean };

function versionKey(input: VerifiedInput): string | undefined {
    if (input.observation.kind !== 'adjustment') {
        return;
    }
    try {
        return objectVersionKey(input.observation);
    }
    catch {
        return;
    }
}
function eventId(input: VerifiedInput): string | undefined { return input.source.eventId !== '' ? input.source.eventId : undefined; }
function knownRoutes(input: VerifiedInput, versions: ReadonlyMap<string, ObjectVersionEvidence>): readonly AggregateIdentity[] {
    return [...inputRoutes(input), ...objectVersionDependentRoutes(input.observation, versions.get(versionKey(input) ?? ''))];
}
function affectedRoutes(input: VerifiedInput, page: InputPage, identity: StoredEventIdentity | undefined): readonly AggregateIdentity[] {
    const previous = page.receipts.get(input.inputId);
    return [...new Map([
            ...knownRoutes(input, page.versions), ...(previous ? knownRoutes(previous.input, page.versions) : []), ...(identity?.evidence.routes ?? []),
        ].map(route => [canonicalJson([route.type, route.id]), route])).values()];
}
function fenceConflict(state: PaymentState, inputId: string, affected: readonly AggregateIdentity[]): void {
    const receipt = state.inbox[inputId];
    if (receipt) {
        receipt.conflict = true;
    }
    for (const route of affected) {
        const aggregate = route.type === 'transaction' ? transactionAggregate(state, route.id) : subscriptionAggregate(state, route.id);
        if (!aggregate.flags.includes('conflict')) {
            aggregate.flags.push('conflict');
            aggregate.revision += 1;
            aggregate.publicationRequired = true;
        }
    }
}
/** Authenticated T1 custody retains sequential page semantics and the shared T1/T2 lock order. */
export class PaymentInputCustody {
    private readonly context: PaymentStoreContext;
    constructor(context: PaymentStoreContext) { this.context = context; }
    async admitInputs(tx: PaymentSqlTransaction, scope: PaymentScope, inputs: readonly VerifiedInput[], maximum: 100 | 200 = 100): ReturnType<PaymentStore['admitVerifiedInputs']> {
        if (inputs.length === 0) {
            return [];
        }
        assertBatchLimit(inputs.length, maximum);
        if (Buffer.byteLength(JSON.stringify(inputs)) > 2_097_152) {
            throw new RangeError('Payment receipt batch exceeds custody bound');
        }
        for (const input of inputs) {
            if (canonicalJson(input.scope) !== canonicalJson(scope)) {
                throw new Error('Verified input scope mismatch');
            }
        }
        const page = await this.lockPage(tx, inputs);
        const result: Awaited<ReturnType<PaymentStore['admitVerifiedInputs']>>[number][] = [];
        for (const input of inputs) {
            result.push(await this.admitPageInput(tx, input, page));
        }
        return result;
    }
    private async lockPage(tx: PaymentSqlTransaction, inputs: readonly VerifiedInput[]): Promise<InputPage> {
        // Event identity has only T1 writers. It precedes receipts, exact-version
        // certification and aggregate routes, including contradictory OLD routes.
        const events = new Map<string, StoredEventIdentity>();
        const eventIds = [...new Set(inputs.flatMap(input => { const id = eventId(input); return id === undefined ? [] : [id]; }))];
        await this.context.records.lock(tx, eventIds.map(id => ({ kind: 'eventIdentity', id })));
        for (const [id, record] of await (this.context.records.readMany(tx, 'eventIdentity', eventIds) as Promise<ReadonlyMap<string, StoredRecord<StoredEventIdentity>>>)) {
            events.set(id, record.body);
        }
        await this.context.records.lock(tx, inputs.map(input => ({ kind: 'inbox', id: input.inputId })));
        const receipts = new Map<string, InboxRecord>();
        for (const [id, record] of await (this.context.records.readMany(tx, 'inbox', inputs.map(input => input.inputId)) as Promise<ReadonlyMap<string, StoredRecord<InboxRecord>>>)) {
            receipts.set(id, record.body);
        }
        // Read certification only after its lock: concurrent first certification
        // must not introduce an unfenced retained parent behind T1's discovery.
        const versions = new Map<string, ObjectVersionEvidence>();
        const versionKeys = [...new Set([...inputs, ...[...receipts.values()].map(receipt => receipt.input)].flatMap(input => {
                const key = versionKey(input);
                return key === undefined ? [] : [key];
            }))];
        await this.context.records.lock(tx, versionKeys.map(id => ({ kind: 'versionEvidence', id })));
        for (const [id, record] of await (this.context.records.readMany(tx, 'versionEvidence', versionKeys) as Promise<ReadonlyMap<string, StoredRecord<ObjectVersionEvidence>>>)) {
            versions.set(id, record.body);
        }
        const page = { events, receipts, versions };
        const routes = inputs.flatMap(input => {
            const id = eventId(input);
            return affectedRoutes(input, page, id === undefined ? undefined : events.get(id));
        });
        await this.context.records.lock(tx, routes.map(route => ({ kind: route.type === 'transaction' ? 'transactions' : 'subscriptions', id: route.id })));
        return page;
    }
    private async inputState(tx: PaymentSqlTransaction, input: VerifiedInput, page: InputPage, affected: readonly AggregateIdentity[]): Promise<PaymentState> {
        const state = createEmptyPaymentState();
        const key = versionKey(input), evidence = key === undefined ? undefined : page.versions.get(key);
        if (key !== undefined && evidence) {
            state.versionEvidence[key] = evidence;
        }
        const previous = page.receipts.get(input.inputId);
        if (previous) {
            state.inbox[input.inputId] = previous;
        }
        // Read each input's locked routes after all preceding input writes. A
        // page-wide snapshot would lose sequential duplicate/conflict transitions.
        const transactions = await (this.context.records.readMany(tx, 'transactions', affected.filter(route => route.type === 'transaction').map(route => route.id)) as Promise<ReadonlyMap<string, StoredRecord<TransactionAggregate>>>);
        const subscriptions = await (this.context.records.readMany(tx, 'subscriptions', affected.filter(route => route.type === 'subscription').map(route => route.id)) as Promise<ReadonlyMap<string, StoredRecord<SubscriptionAggregate>>>);
        for (const route of affected) {
            if (route.type === 'transaction') {
                const record = transactions.get(route.id);
                if (record) {
                    state.transactions[route.id] = record.body;
                }
            }
            else {
                const record = subscriptions.get(route.id);
                if (record) {
                    state.subscriptions[route.id] = record.body;
                }
            }
        }
        return state;
    }
    private async admitPageInput(tx: PaymentSqlTransaction, input: VerifiedInput, page: InputPage): Promise<Awaited<ReturnType<PaymentStore['admitVerifiedInputs']>>[number]> {
        const id = eventId(input), identity = id === undefined ? undefined : page.events.get(id);
        const incomingIdentity = eventIdentityEvidence(input);
        const eventConflict = identity !== undefined && (identity.conflict || compareEventIdentity(identity.evidence, incomingIdentity) === 'conflict');
        const affected = affectedRoutes(input, page, identity);
        const state = await this.inputState(tx, input, page, affected);
        let kind = admitInput(state, input);
        if (eventConflict) {
            kind = 'conflict';
            fenceConflict(state, input.inputId, affected);
        }
        await this.persistInput(tx, { input, state, kind, identity, incomingIdentity, eventConflict }, page);
        return { inputId: input.inputId, kind };
    }
    private async persistInput(tx: PaymentSqlTransaction, transition: InputTransition, page: InputPage): Promise<void> {
        const { input, state, kind, identity, incomingIdentity, eventConflict } = transition;
        const writes: RecordWrite[] = [];
        const id = eventId(input);
        let nextIdentity: StoredEventIdentity | undefined;
        if (id !== undefined) {
            // Compatible partial receipts are not transitive. A contradiction keeps
            // the original certified summary fenced without an unbounded replay list.
            nextIdentity = identity ? { evidence: eventConflict ? identity.evidence : mergeEventIdentityEvidence(identity.evidence, incomingIdentity), conflict: eventConflict } : { evidence: incomingIdentity, conflict: false };
            writes.push({ kind: 'eventIdentity', id, body: nextIdentity });
        }
        const receipt = state.inbox[input.inputId];
        if (!receipt) {
            throw new Error('Admission lost its durable receipt');
        }
        writes.push({ kind: 'inbox', id: input.inputId, body: receipt });
        if (kind === 'conflict') {
            writes.push({ kind: 'conflictingInputs', id: digest([input.inputId, input.source.representationDigest]), body: input });
        }
        for (const [key, aggregate] of Object.entries(state.transactions)) {
            writes.push({ kind: 'transactions', id: key, body: aggregate });
        }
        for (const [key, aggregate] of Object.entries(state.subscriptions)) {
            writes.push({ kind: 'subscriptions', id: key, body: aggregate });
        }
        await this.context.records.writeMany(tx, writes);
        page.receipts.set(input.inputId, receipt);
        if (id !== undefined && nextIdentity) {
            page.events.set(id, nextIdentity);
        }
        await this.schedulePublications(tx, state);
        await this.context.work(tx, { kind: 'inbox', id: input.inputId }, receipt.state === 'processed' ? 'complete' : 'pending');
    }
    private async schedulePublications(tx: PaymentSqlTransaction, state: PaymentState): Promise<void> {
        for (const [id, aggregate] of Object.entries(state.transactions)) {
            if (aggregate.publicationRequired) {
                await this.context.work(tx, { kind: 'publication', id: canonicalJson({ type: 'transaction', id }) });
            }
        }
        for (const [id, aggregate] of Object.entries(state.subscriptions)) {
            if (aggregate.publicationRequired) {
                await this.context.work(tx, { kind: 'publication', id: canonicalJson({ type: 'subscription', id }) });
            }
        }
    }
}
