import type { AggregateIdentity, PaymentScope, TransactionObservation, SubscriptionObservation, AdjustmentObservation, Observation, VerifiedInput, ObjectVersionEvidence, SubscriptionBinding, CompletionFact, EvidenceFlag, EvidenceMessage, ProfileEvidenceHolds, TransactionAggregate, SubscriptionAggregate, PaymentState } from './model.js';
import { canonicalJson, compareTime, digest, exactTime, money, MAX_OBJECT_VERSION_EVIDENCE_BYTES, objectVersionKey } from './values.js';
import { isSupportedAdjustmentAction, isSupportedAdjustmentStatus, transactionOriginMeaning } from './vocabulary.js';
import { known, semantic, compatible, mergeFields } from './observation-fields.js';
import { transactionStatusFlags, classifyCompletion } from './completion.js';
import { inputRoutes, objectVersionDependentRoutes, eventIdentityEvidence, compareEventIdentity } from './event-identity.js';
import { subscriptionProfileFlags } from './subscription-profile.js';
export { classifyCompletion, validateOffer } from './completion.js';
export type { Classification } from './completion.js';
export { compareEventIdentity, eventIdentityEvidence, inputRoutes, mergeEventIdentityEvidence, objectVersionDependentRoutes } from './event-identity.js';
type FlaggedEvidence = ProfileEvidenceHolds & { flags: EvidenceFlag[] };
type VersionedObservation = Exclude<Observation, { kind: 'unsupported' }>;
function flag(target: FlaggedEvidence, value: EvidenceFlag): void {
    if (target.retainedFlags && !target.retainedFlags.includes(value)) {
        target.retainedFlags.push(value);
    }
    if (!target.flags.includes(value)) {
        target.flags.push(value);
    }
}

function removeFlag(target: FlaggedEvidence, value: EvidenceFlag): void {
    if (target.retainedFlags) {
        target.retainedFlags = target.retainedFlags.filter(item => item !== value);
    }
    target.flags = target.flags.filter(item => item !== value || target.currentProfileFlags?.includes(item) === true);
}

function setCurrentProfileFlags(target: FlaggedEvidence, flags: EvidenceFlag[]): void {
    // Existing persisted flags and independently added controls remain historical. A matching
    // historical flag must survive even when a current profile hold with the same name resolves.
    target.retainedFlags = [...new Set([...(target.retainedFlags ?? []), ...target.flags.filter(item => !(target.currentProfileFlags?.includes(item) === true))])];
    target.currentProfileFlags = [...new Set(flags)];
    target.flags = [...new Set([...target.retainedFlags, ...target.currentProfileFlags])];
}

export function transactionAggregate(state: PaymentState, ref: string): TransactionAggregate {
    return state.transactions[ref] ??= { transactionRef: ref, revision: 0, evidenceRevision: 0, observations: [], adjustments: {}, pendingAdverse: [], flags: [], publicationRequired: false };
}

export function subscriptionAggregate(state: PaymentState, ref: string): SubscriptionAggregate {
    return state.subscriptions[ref] ??= { subscriptionRef: ref, revision: 0, evidenceRevision: 0, flags: [], publicationRequired: false };
}

function certifyObjectVersion(state: PaymentState, observation: VersionedObservation): Readonly<{ kind: 'certified'; observation: VersionedObservation }> | Readonly<{ kind: 'conflict' | 'held' }> {
    const key = objectVersionKey(observation);
    if (!(typeof key === 'string' && key.length > 0)) {throw new Error('Versioned observation has no identity');}
    const time = exactTime(observation.version), entityRef = observation.kind === 'transaction' ? observation.transactionRef : observation.kind === 'subscription' ? observation.subscriptionRef : observation.adjustmentRef;
    const original = state.versionEvidence[key];
    if (original?.kind === 'held') {return { kind: 'held' };}
    const { source, ...incoming } = observation;
    if (original && (!compatible(semantic(original.projection), semantic(incoming)) || original.conflict)) {
        state.versionEvidence[key] = { ...original, conflict: true };
        return { kind: 'conflict' };
    }
    const projection = original ? mergeFields(original.projection, incoming) : incoming;
    const evidence: ObjectVersionEvidence = { kind: 'certified', entityKind: observation.kind, entityRef, seconds: time.seconds, fraction: time.fraction, projection, conflict: false };
    if (Buffer.byteLength(canonicalJson(evidence)) > MAX_OBJECT_VERSION_EVIDENCE_BYTES) {
        state.versionEvidence[key] = { kind: 'held', entityKind: observation.kind, entityRef, seconds: time.seconds, fraction: time.fraction, reason: 'version_evidence_size_limit' };
        return { kind: 'held' };
    }
    state.versionEvidence[key] = evidence;
    return { kind: 'certified', observation: { ...projection, source } };
}

function subscriptionOwnershipMismatch(state: PaymentState, observation: SubscriptionObservation): boolean {
    const customer = observation.customerRef;
    return known(customer) && Object.values(state.subscriptionBindings).some(binding => binding.providerSubscriptionRefs.includes(observation.subscriptionRef) && binding.customerRef !== null && binding.customerRef !== customer.value);
}

function bindRenewal(state: PaymentState, observation: TransactionObservation): void {
    if (state.bindings[observation.transactionRef] || !known(observation.subscriptionRef) || !(typeof observation.subscriptionRef.value === 'string' && observation.subscriptionRef.value.length > 0) || !known(observation.origin) || transactionOriginMeaning(observation.origin.value) !== 'recurring_subscription') {
        return;
    }
    const matches = Object.values(state.subscriptionBindings).filter(binding => binding.providerSubscriptionRefs.includes(observation.subscriptionRef.presence === 'known' ? observation.subscriptionRef.value ?? '' : ''));
    if (matches.length !== 1) {
        return;
    }
    const binding = matches[0];
    if (!binding) {
        return;
    }
    state.bindings[observation.transactionRef] = { transactionRef: observation.transactionRef, intentId: binding.originatingIntentId, buyerId: binding.buyerId, purpose: 'commercial', customerRef: binding.customerRef };
}

export function requireSubscriptionReclassification(state: PaymentState, binding: SubscriptionBinding): void {
    const revision = (binding.classificationDecision?.revision ?? 0) + 1;
    binding.classificationDecision = { revision, duplicateInitialPurchase: binding.classificationDecision?.duplicateInitialPurchase ?? false };
    state.reclassifications[binding.bindingId] = { bindingId: binding.bindingId, decisionRevision: revision, complete: false };
}

function markDuplicates(state: PaymentState, fact: CompletionFact): void {
    if (!['initial', 'one_time'].includes(fact.classification)) {
        return;
    }
    const candidates = Object.values(state.transactions).filter(aggregate => aggregate.completion?.intentId === fact.intentId && aggregate.completion.classification === fact.classification);
    if (candidates.length < 2) {
        return;
    }
    const duplicateFlag = fact.classification === 'initial' ? 'duplicate_initial_purchase' : 'duplicate_payment';
    for (const aggregate of candidates) {
        if (!aggregate.flags.includes(duplicateFlag)) {
            flag(aggregate, duplicateFlag);
            aggregate.publicationRequired = true;
            aggregate.revision += 1;
        }
    }
    const binding = (typeof fact.subscriptionBasisId === 'string' && fact.subscriptionBasisId.length > 0) ? state.subscriptionBindings[fact.subscriptionBasisId] : undefined;
    if (fact.classification === 'initial' && binding && !(binding.classificationDecision?.duplicateInitialPurchase === true)) {
        binding.classificationDecision = { revision: binding.classificationDecision?.revision ?? 0, duplicateInitialPurchase: true };
        requireSubscriptionReclassification(state, binding);
    }
}

function comparableCompletion(fact: CompletionFact): unknown {
    return semantic({ ...fact, classification: fact.classification === 'recovery' ? 'renewal' : fact.classification, source: undefined });
}

function reduceTransaction(state: PaymentState, scope: PaymentScope, observation: TransactionObservation): void {
    exactTime(observation.version);
    const aggregate = transactionAggregate(state, observation.transactionRef);
    let effective = observation;
    const sameVersion = aggregate.observations.find(item => compareTime(item.version, observation.version) === 0);
    if (sameVersion) {
        if (!compatible(semantic(sameVersion), semantic(observation))) {
            flag(aggregate, 'conflict');
            aggregate.publicationRequired = true;
            aggregate.revision += 1;
            return;
        }
        effective = mergeFields(sameVersion, observation);
        aggregate.observations[aggregate.observations.indexOf(sameVersion)] = effective;
    }
    else {
        aggregate.observations.push(observation);
    }
    if (!aggregate.current || compareTime(effective.version, aggregate.current.version) >= 0) {
        aggregate.current = effective;
        setCurrentProfileFlags(aggregate, transactionStatusFlags(effective));
    }
    bindRenewal(state, effective);
    const classification = classifyCompletion(state, scope, effective);
    if (classification.kind === 'commercial') {
        if (aggregate.completion) {
            if (!compatible(comparableCompletion(aggregate.completion), comparableCompletion(classification.fact))) {
                flag(aggregate, 'conflict');
            }
        }
        else {
            aggregate.completion = classification.fact;
        }
        removeFlag(aggregate, 'incomplete');
        removeFlag(aggregate, 'unresolved_binding');
        if (classification.holdReason) {
            flag(aggregate, classification.holdReason);
        }
        else if (['renewal', 'recovery'].includes(classification.fact.classification)) {
            removeFlag(aggregate, 'duplicate_initial_purchase');
        }
        markDuplicates(state, classification.fact);
        const subRef = classification.fact.providerSubscriptionRef;
        const subscription = (typeof subRef === 'string' && subRef.length > 0) ? state.subscriptions[subRef]?.current : undefined;
        if (subscription) {
            reduceSubscription(state, subscription);
        }
    }
    else if (classification.kind === 'held' && transactionStatusFlags(effective).length === 0) {
        flag(aggregate, classification.reason);
    }
    else if (classification.kind === 'management') {
        removeFlag(aggregate, 'unresolved_binding');
    }
    aggregate.revision += 1;
    aggregate.publicationRequired = true;
}

function reduceSubscription(state: PaymentState, observation: SubscriptionObservation): void {
    exactTime(observation.version);
    const aggregate = subscriptionAggregate(state, observation.subscriptionRef);
    if (known(observation.currentPeriod) && observation.currentPeriod.value && compareTime(observation.currentPeriod.value.startsAt, observation.currentPeriod.value.endsAt) >= 0) {throw new TypeError('Invalid subscription period');}
    if (known(observation.scheduledChange) && observation.scheduledChange.value) {
        exactTime(observation.scheduledChange.value.effectiveAt);
    }
    const newOwnershipHold = subscriptionOwnershipMismatch(state, observation) && !aggregate.flags.includes('ownership_mismatch');
    if (newOwnershipHold) {
        flag(aggregate, 'ownership_mismatch');
    }
    const current = aggregate.current;
    if (current) {
        const order = compareTime(observation.version, current.version);
        if (order < 0) {
            if (newOwnershipHold) {
                aggregate.revision += 1;
                aggregate.publicationRequired = true;
            }
            return;
        }
        if (order === 0 && !compatible(semantic(current), semantic(observation))) {
            flag(aggregate, 'conflict');
            aggregate.revision += 1;
            aggregate.publicationRequired = true;
            return;
        }
        if (order === 0) {
            observation = mergeFields(current, observation);
        }
        else {
            aggregate.lastKnown = current;
        }
    }
    aggregate.current = observation;
    const profileFlags = subscriptionProfileFlags(observation);
    applySubscriptionBindings(state, observation, aggregate, profileFlags);
    setCurrentProfileFlags(aggregate, profileFlags);
    aggregate.revision += 1;
    aggregate.publicationRequired = true;
}

function applySubscriptionBindings(state: PaymentState, observation: SubscriptionObservation, aggregate: SubscriptionAggregate, profileFlags: EvidenceFlag[]): void {
    const profileFields: Partial<Pick<SubscriptionObservation, 'collection' | 'items'>> = observation;
    const bindings = Object.values(state.subscriptionBindings).filter(binding => binding.providerSubscriptionRefs.includes(observation.subscriptionRef));
    if (bindings.length !== 1) {
        flag(aggregate, 'unresolved_binding');
    }
    else {
        removeFlag(aggregate, 'unresolved_binding');
        const binding = bindings[0];
        if (binding && known(observation.customerRef) && binding.customerRef !== null && observation.customerRef.value !== binding.customerRef) {
            flag(aggregate, 'ownership_mismatch');
        }
        if (binding && profileFields.items?.presence === 'known' && canonicalJson(profileFields.items.value.map(item => item.providerPriceRef).toSorted()) !== canonicalJson(binding.offer.lines.map(line => line.providerPriceRef).toSorted())) {
            profileFlags.push('catalog_mismatch');
        }
    }
}

function reduceAdjustment(state: PaymentState, observation: AdjustmentObservation): void {
    exactTime(observation.version);
    money(observation.amount.currency, observation.amount.minorUnits);
    for (const allocation of observation.allocations) {
        money(allocation.amount.currency, allocation.amount.minorUnits);
    }
    const aggregate = transactionAggregate(state, observation.transactionRef), current = aggregate.adjustments[observation.adjustmentRef];
    if (current) {
        const order = compareTime(observation.version, current.version);
        if (order < 0) {
            return;
        }
        if (order === 0 && !compatible(semantic(current), semantic(observation))) {
            flag(aggregate, 'conflict');
            aggregate.revision += 1;
            aggregate.publicationRequired = true;
            return;
        }
    }
    aggregate.adjustments[observation.adjustmentRef] = observation;
    if (observation.allocations.some(allocation => allocation.amount.currency !== observation.amount.currency)) {
        flag(aggregate, 'unsupported');
    }
    if (!isSupportedAdjustmentAction(observation.action) || !isSupportedAdjustmentStatus(observation.status)) {
        flag(aggregate, 'unsupported');
    }
    aggregate.revision += 1;
    aggregate.publicationRequired = true;
}

export function reduceObservation(state: PaymentState, scope: PaymentScope, observation: Observation): 'applied' | 'conflict' | 'held' {
    if (observation.kind !== 'unsupported') {
        const certified = certifyObjectVersion(state, observation);
        if (certified.kind !== 'certified') {
            for (const route of objectVersionDependentRoutes(observation, state.versionEvidence[objectVersionKey(observation) ?? ''])) {
                const aggregate = route.type === 'subscription' ? subscriptionAggregate(state, route.id) : transactionAggregate(state, route.id);
                flag(aggregate, certified.kind === 'held' ? 'incomplete_history' : 'conflict');
                if (observation.kind === 'subscription' && subscriptionOwnershipMismatch(state, observation)) {
                    flag(aggregate, 'ownership_mismatch');
                }
                aggregate.revision += 1;
                aggregate.publicationRequired = true;
            }
            return certified.kind;
        }
        observation = certified.observation;
    }
    switch (observation.kind) {
        case 'transaction':
            reduceTransaction(state, scope, observation);
            break;
        case 'subscription':
            reduceSubscription(state, observation);
            break;
        case 'adjustment':
            reduceAdjustment(state, observation);
            break;
        case 'unsupported': {
            if ((typeof observation.transactionRef === 'string' && observation.transactionRef.length > 0)) {
                const target = transactionAggregate(state, observation.transactionRef);
                flag(target, 'unsupported');
                target.revision += 1;
                target.publicationRequired = true;
            }
            else if ((typeof observation.subscriptionRef === 'string' && observation.subscriptionRef.length > 0)) {
                const target = subscriptionAggregate(state, observation.subscriptionRef);
                flag(target, 'unsupported');
                target.revision += 1;
                target.publicationRequired = true;
            }
            else {
                state.issues.push(`unresolved-routing:${observation.source.receiptId}`);
            }
        }
    }
    return 'applied';
}

function adverseTransactionRefs(state: PaymentState, input: VerifiedInput): readonly string[] {
    const direct = input.adverseTransactionRef ?? (input.observation.kind === 'adjustment' ? input.observation.transactionRef : undefined);
    const refs = new Set((typeof direct === 'string' && direct.length > 0) ? [direct] : []);
    if (input.observation.kind === 'adjustment') {
        let key: string | undefined;
        try {
            key = objectVersionKey(input.observation);
        }
        catch {
            return [...refs];
        }
        for (const route of objectVersionDependentRoutes(input.observation, key === undefined ? undefined : state.versionEvidence[key])) {
            if (route.type === 'transaction') {
                refs.add(route.id);
            }
        }
    }
    return [...refs];
}

function flagInputConflict(state: PaymentState, input: Pick<VerifiedInput, 'observation' | 'adverseTransactionRef'>): void {
    for (const route of inputRoutes(input)) {
        const aggregate = route.type === 'transaction' ? transactionAggregate(state, route.id) : subscriptionAggregate(state, route.id);
        flag(aggregate, 'conflict');
        aggregate.revision += 1;
        aggregate.publicationRequired = true;
    }
}

function retainReplayCustody(state: PaymentState, input: VerifiedInput): void {
    for (const ref of adverseTransactionRefs(state, input)) {
        const aggregate = transactionAggregate(state, ref);
        if (!aggregate.pendingAdverse.includes(input.inputId)) {
            aggregate.pendingAdverse.push(input.inputId);
            aggregate.revision += 1;
            aggregate.publicationRequired = true;
        }
    }
}

export function admitInput(state: PaymentState, input: VerifiedInput): 'admitted' | 'duplicate' | 'conflict' {
    const existing = state.inbox[input.inputId];
    if (existing) {
        const identityConflict = compareEventIdentity(eventIdentityEvidence(existing.input), eventIdentityEvidence(input)) === 'conflict';
        if (existing.input.source.representationDigest === input.source.representationDigest && !identityConflict) {
            if (existing.state !== 'processed') {
                existing.state = 'pending';
                // Certification may have appeared since the first admission. Replays retain custody
                // on any newly known route without reopening markers already completed by T2.
                retainReplayCustody(state, input);
            }
            return 'duplicate';
        }
        existing.conflict = true;
        state.issues.push(`input-identity-conflict:${input.inputId}`);
        flagInputConflict(state, existing.input);
        flagInputConflict(state, input);
        return 'conflict';
    }
    let conflict = false;
    const incomingIdentity = eventIdentityEvidence(input);
    if ((typeof input.source.eventId === 'string' && input.source.eventId.length > 0)) {
        for (const receipt of Object.values(state.inbox)) {
            if (compareEventIdentity(eventIdentityEvidence(receipt.input), incomingIdentity) === 'conflict') {
                conflict = true;
                flagInputConflict(state, receipt.input);
            }
        }
    }
    state.inbox[input.inputId] = { input, state: 'pending', conflict, attempts: 0 };
    for (const adverse of adverseTransactionRefs(state, input)) {
        const aggregate = transactionAggregate(state, adverse);
        if (!aggregate.pendingAdverse.includes(input.inputId)) {
            aggregate.pendingAdverse.push(input.inputId);
        }
        aggregate.revision += 1;
        aggregate.publicationRequired = true;
    }
    if (conflict) {
        flagInputConflict(state, input);
    }
    return conflict ? 'conflict' : 'admitted';
}

function storeMessage(state: PaymentState, publication: Readonly<{scope: PaymentScope; producerNamespace: string; maxBytes: number}>, aggregate: AggregateIdentity, revision: number, payload: object): EvidenceMessage {
    const { scope, producerNamespace, maxBytes } = publication;
    const messageId = digest([producerNamespace, scope, aggregate, revision]);
    const base = { envelopeVersion: 1, schemaVersion: 1, producerNamespace, scope, aggregate, revision, messageId };
    let body: Record<string, unknown> = { ...base, ...payload };
    if (Buffer.byteLength(canonicalJson(body)) + 80 > maxBytes) {
        body = { ...base, kind: 'held', reason: 'evidence_size_limit', resolutionRef: messageId };
    }
    const message = { ...body, bodyDigest: digest(body) } as EvidenceMessage;
    if (Buffer.byteLength(canonicalJson(message)) > maxBytes) {throw new RangeError('Evidence control envelope exceeds configured limit');}
    const existing = state.evidence[messageId];
    if (existing && existing.bodyDigest !== message.bodyDigest) {throw new Error('Evidence revision identity reused');}
    state.evidence[messageId] = message;
    for (const consumerId of state.consumers) {
        state.deliveries[canonicalJson([messageId, consumerId])] ??= { consumerId, messageId, acknowledged: false, attempts: 0 };
    }
    return message;
}

export function publishEvidence(state: PaymentState, scope: PaymentScope, producerNamespace: string, maxBytes: number): EvidenceMessage[] {
    const messages = [], publication = { scope, producerNamespace, maxBytes };
    for (const aggregate of Object.values(state.transactions)) {
        if (aggregate.publicationRequired) {
            const flags = [...aggregate.flags];
            if (aggregate.pendingAdverse.length > 0 && !flags.includes('pending_adverse')) {
                flags.push('pending_adverse');
            }
            aggregate.evidenceRevision += 1;
            const payload = flags.includes('incomplete_history') ? { kind: 'held', reason: 'object_version_history_incomplete', resolutionRef: aggregate.transactionRef } : { kind: 'complete', ...(aggregate.completion ? { completion: aggregate.completion } : {}), adjustments: Object.values(aggregate.adjustments).toSorted((a, b) => a.adjustmentRef.localeCompare(b.adjustmentRef)), flags };
            messages.push(storeMessage(state, publication, { type: 'transaction', id: aggregate.transactionRef }, aggregate.evidenceRevision, payload));
            aggregate.publicationRequired = false;
        }
    }
    for (const aggregate of Object.values(state.subscriptions)) {
        if (aggregate.publicationRequired) {
            aggregate.evidenceRevision += 1;
            const bindings = Object.values(state.subscriptionBindings).filter(binding => binding.providerSubscriptionRefs.includes(aggregate.subscriptionRef));
            const binding = bindings[0];
            const payload = !aggregate.flags.includes('incomplete_history') && bindings.length === 1 && binding && aggregate.current ? { kind: 'subscription_complete', binding, observation: aggregate.current, flags: aggregate.flags } : { kind: 'held', reason: aggregate.flags.includes('incomplete_history') ? 'object_version_history_incomplete' : 'unresolved_binding', resolutionRef: aggregate.subscriptionRef };
            messages.push(storeMessage(state, publication, { type: 'subscription', id: aggregate.subscriptionRef }, aggregate.evidenceRevision, payload));
            aggregate.publicationRequired = false;
        }
    }
    return messages;
}

export function processInput(state: PaymentState, scope: PaymentScope, inputId: string): 'processed' | 'duplicate' | 'quarantined' {
    let record = state.inbox[inputId];
    if (!record) {throw new Error('Unknown inbox input');}
    if (record.state === 'processed') {return 'duplicate';}
    record.attempts += 1;
    if (record.conflict) {
        record.state = 'quarantined';
        record.issue = 'conflicting_input';
        return 'quarantined';
    }
    try {
        const staged = structuredClone(state);
        const reduction = reduceObservation(staged, scope, record.input.observation);
        Object.assign(state, staged);
        const updatedRecord = state.inbox[inputId];
        if (!updatedRecord) {throw new Error('Inbox disappeared during reduction');}
        record = updatedRecord;
        if (reduction === 'held') {
            record.state = 'quarantined';
            record.issue = 'version_evidence_size_limit';
            return 'quarantined';
        }
    }
    catch (error) {
        record.state = 'quarantined';
        record.issue = error instanceof Error ? error.name : 'decoder_failure';
        const ref = record.input.adverseTransactionRef ?? ('transactionRef' in record.input.observation ? record.input.observation.transactionRef : undefined);
        if ((typeof ref === 'string' && ref.length > 0)) {
            const aggregate = transactionAggregate(state, ref);
            flag(aggregate, 'incomplete');
            aggregate.publicationRequired = true;
        }
        else if ('subscriptionRef' in record.input.observation && typeof record.input.observation.subscriptionRef === 'string' && record.input.observation.subscriptionRef) {
            const aggregate = subscriptionAggregate(state, record.input.observation.subscriptionRef);
            flag(aggregate, 'incomplete');
            aggregate.publicationRequired = true;
        }
        else {
            state.issues.push(`quarantine-unresolved:${inputId}`);
        }
        return 'quarantined';
    }
    const adverse = adverseTransactionRefs(state, record.input);
    if (adverse.length > 0 && record.input.observation.kind === 'unsupported') {
        record.state = 'quarantined';
        record.issue = record.input.observation.reason;
        return 'quarantined';
    }
    for (const ref of adverse) {
        const aggregate = transactionAggregate(state, ref);
        aggregate.pendingAdverse = aggregate.pendingAdverse.filter(id => id !== inputId);
        aggregate.revision += 1;
        aggregate.publicationRequired = true;
    }
    record.state = 'processed';
    return 'processed';
}

export function publishHeldEvidence(state: PaymentState, scope: PaymentScope, producerNamespace: string, reason: string, maxBytes: number): EvidenceMessage[] {
    const messages = [], publication = { scope, producerNamespace, maxBytes };
    for (const aggregate of Object.values(state.transactions)) {
        aggregate.evidenceRevision += 1;
        aggregate.revision += 1;
        aggregate.publicationRequired = false;
        const message = storeMessage(state, publication, { type: 'transaction', id: aggregate.transactionRef }, aggregate.evidenceRevision, { kind: 'held', reason, resolutionRef: aggregate.transactionRef });
        messages.push(message);
    }
    for (const aggregate of Object.values(state.subscriptions)) {
        aggregate.evidenceRevision += 1;
        aggregate.revision += 1;
        aggregate.publicationRequired = false;
        messages.push(storeMessage(state, publication, { type: 'subscription', id: aggregate.subscriptionRef }, aggregate.evidenceRevision, { kind: 'held', reason, resolutionRef: aggregate.subscriptionRef }));
    }
    return messages;
}
