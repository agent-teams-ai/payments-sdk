import type { AdjustmentObservation, AggregateIdentity, CompletionFact, EventIdentityEvidence, EvidenceFlag, EvidenceMessage, Field, ObjectVersionEvidence, Observation, OfferSnapshot, PaymentScope, PaymentState, ProfileEvidenceHolds, ProviderLine, SubscriptionAggregate, SubscriptionBinding, SubscriptionObservation, TransactionAggregate, TransactionObservation, VerifiedInput } from './contracts.js';
import { assertIdentifier, canonicalJson, compareTime, digest, exactTime, money, MAX_OBJECT_VERSION_EVIDENCE_BYTES, objectVersionKey } from './values.js';

const known = <T>(field: Field<T>): field is Readonly<{ presence: 'known'; value: T; provenance?: 'observed' | 'schema_assumed_null' }> => field.presence === 'known';
type FlaggedEvidence = ProfileEvidenceHolds & { flags: EvidenceFlag[] };
function flag(target: FlaggedEvidence, value: EvidenceFlag): void {
  if (target.retainedFlags && !target.retainedFlags.includes(value)) target.retainedFlags.push(value);
  if (!target.flags.includes(value)) target.flags.push(value);
}
function removeFlag(target: FlaggedEvidence, value: EvidenceFlag): void {
  if (target.retainedFlags) target.retainedFlags = target.retainedFlags.filter(item => item !== value);
  target.flags = target.flags.filter(item => item !== value || target.currentProfileFlags?.includes(item));
}
function setCurrentProfileFlags(target: FlaggedEvidence, flags: EvidenceFlag[]): void {
  // Existing persisted flags and independently added controls remain historical. A matching
  // historical flag must survive even when a current profile hold with the same name resolves.
  target.retainedFlags = [...new Set([...(target.retainedFlags ?? []), ...target.flags.filter(item => !target.currentProfileFlags?.includes(item))])];
  target.currentProfileFlags = [...new Set(flags)];
  target.flags = [...new Set([...target.retainedFlags, ...target.currentProfileFlags])];
}
function transactionStatusFlags(observation: TransactionObservation): EvidenceFlag[] {
  switch (observation.statusMeaning?.kind) {
    case 'completed': case 'not_completed': return [];
    case 'unsupported': return ['unsupported'];
    default: return ['incomplete'];
  }
}
export function transactionAggregate(state: PaymentState, ref: string): TransactionAggregate {
  return state.transactions[ref] ??= { transactionRef: ref, revision: 0, evidenceRevision: 0, observations: [], adjustments: {}, pendingAdverse: [], flags: [], publicationRequired: false };
}
export function subscriptionAggregate(state: PaymentState, ref: string): SubscriptionAggregate {
  return state.subscriptions[ref] ??= { subscriptionRef: ref, revision: 0, evidenceRevision: 0, flags: [], publicationRequired: false };
}
function semantic(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(semantic);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'provenance' && key !== 'source').map(([key, item]) => [key, ((key === 'version' && 'kind' in value) || ['startsAt', 'endsAt', 'effectiveAt'].includes(key)) && typeof item === 'string' ? { seconds: exactTime(item).seconds, fraction: exactTime(item).fraction } : semantic(item)]));
  return value;
}
function compatible(a: unknown, b: unknown): boolean {
  if (a === undefined || b === undefined) return true;
  if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object' && 'presence' in a && 'presence' in b) {
    if (a.presence === 'unknown' || b.presence === 'unknown') return true;
    if ('value' in a && 'value' in b) return compatible(a.value, b.value);
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    const sort = (values: unknown[]): unknown[] => [...values].sort((x, y) => canonicalJson(x !== null && typeof x === 'object' && 'providerLineRef' in x ? x.providerLineRef : x).localeCompare(canonicalJson(y !== null && typeof y === 'object' && 'providerLineRef' in y ? y.providerLineRef : y)));
    return sort(a).every((item, index) => compatible(item, sort(b)[index]));
  }
  if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object') {
    const aa = a as Record<string, unknown>, bb = b as Record<string, unknown>;
    return [...new Set([...Object.keys(aa), ...Object.keys(bb)])].filter(key => key !== 'provenance' && key !== 'source').every(key => compatible(aa[key], bb[key]));
  }
  return a === b;
}
function mergeFields<T>(oldValue: T, newValue: T): T {
  if (newValue === undefined) return oldValue;
  if (oldValue === undefined) return newValue;
  if (oldValue !== null && newValue !== null && typeof oldValue === 'object' && typeof newValue === 'object') {
    if ('presence' in oldValue && 'presence' in newValue) {
      if (newValue.presence === 'unknown') return oldValue;
      if (oldValue.presence === 'unknown') return newValue;
    }
    if (Array.isArray(oldValue) && Array.isArray(newValue)) {
      return newValue.map((item, index) => {
        const previous = item !== null && typeof item === 'object' && 'providerLineRef' in item ? oldValue.find((entry: unknown) => entry !== null && typeof entry === 'object' && 'providerLineRef' in entry && entry.providerLineRef === item.providerLineRef) : oldValue[index];
        return previous === undefined ? item : mergeFields(previous, item);
      }) as T;
    }
    return Object.fromEntries([...new Set([...Object.keys(oldValue), ...Object.keys(newValue)])].map(key => [key, key === 'source' ? (newValue as Record<string, unknown>)[key] : mergeFields((oldValue as Record<string, unknown>)[key], (newValue as Record<string, unknown>)[key])])) as T;
  }
  return newValue;
}
type VersionedObservation = Exclude<Observation, { kind: 'unsupported' }>;
function certifyObjectVersion(state: PaymentState, observation: VersionedObservation): Readonly<{ kind: 'certified'; observation: VersionedObservation }> | Readonly<{ kind: 'conflict' | 'held' }> {
  const key = objectVersionKey(observation); if (!key) throw new Error('Versioned observation has no identity');
  const time = exactTime(observation.version), entityRef = observation.kind === 'transaction' ? observation.transactionRef : observation.kind === 'subscription' ? observation.subscriptionRef : observation.adjustmentRef;
  const original = state.versionEvidence[key];
  if (original?.kind === 'held') return { kind: 'held' };
  const { source, ...incoming } = observation;
  if (original && (!compatible(semantic(original.projection), semantic(incoming)) || original.conflict)) {
    state.versionEvidence[key] = { ...original, conflict: true }; return { kind: 'conflict' };
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
export function validateOffer(offer: OfferSnapshot, scope: PaymentScope): void {
  for (const id of [offer.offerId, offer.version, offer.policyVersion, offer.applicationId]) assertIdentifier(id);
  if (offer.applicationId !== scope.applicationId || !['one_time', 'monthly'].includes(offer.profile) || offer.lines.length !== 1 || typeof offer.allowZeroTotal !== 'boolean') throw new TypeError('Unsupported or foreign offer');
  money(offer.currency, '0');
  for (const line of offer.lines) { assertIdentifier(line.benefitSlotId); assertIdentifier(line.providerPriceRef); if (line.quantity !== 1) throw new TypeError('Unsupported offer quantity'); }
}
function validLine(line: ProviderLine, offer: OfferSnapshot): boolean {
  const expected = offer.lines[0];
  if (!expected || line.providerPriceRef !== expected.providerPriceRef || line.quantity !== 1 || line.amount.currency !== offer.currency || !known(line.trial) || line.trial.value || !known(line.proration) || line.proration.value || !known(line.billingCycle)) return false;
  money(line.amount.currency, line.amount.minorUnits); assertIdentifier(line.providerLineRef);
  if (BigInt(line.amount.minorUnits) < 0n) return false;
  if (offer.profile === 'one_time') return line.billingCycle.value === null && (!known(line.period) || line.period.value === null);
  const cycle = line.billingCycle.value;
  if (cycle?.interval !== 'month' || cycle.frequency !== 1 || !known(line.period) || line.period.value === null) return false;
  return compareTime(line.period.value.startsAt, line.period.value.endsAt) < 0;
}
export type Classification = Readonly<{ kind: 'commercial'; fact: CompletionFact; holdReason?: EvidenceFlag }> | Readonly<{ kind: 'management' }> | Readonly<{ kind: 'held'; reason: EvidenceFlag }> | Readonly<{ kind: 'not_completed' }>;
/** Final server completed classifier. Neither amount, customer nor correlation alone proves ownership. */
export function classifyCompletion(state: PaymentState, scope: PaymentScope, observation: TransactionObservation): Classification {
  const statusFlags = transactionStatusFlags(observation), statusHold = statusFlags[0];
  if (statusHold) return { kind: 'held', reason: statusHold };
  if (observation.statusMeaning.kind !== 'completed') return { kind: 'not_completed' };
  const binding = state.bindings[observation.transactionRef];
  if (!binding) return { kind: 'held', reason: 'unresolved_binding' };
  if (binding.purpose === 'payment_method' || (known(observation.origin) && observation.origin.value === 'subscription_payment_method_change')) return { kind: 'management' };
  const intent = state.intents[binding.intentId];
  if (!intent) return { kind: 'held', reason: 'unresolved_binding' };
  const offer = intent.offer;
  if (!known(observation.lines) || !known(observation.total) || !known(observation.currency) || !known(observation.origin) || !known(observation.customerRef) || (offer.profile === 'monthly' && !known(observation.subscriptionRef))) return { kind: 'held', reason: 'incomplete' };
  if (observation.lines.value.some(line => !known(line.billingCycle) || !known(line.trial) || !known(line.proration) || (offer.profile === 'monthly' && !known(line.period)))) return { kind: 'held', reason: 'incomplete' };
  if (observation.currency.value !== offer.currency || observation.total.value.currency !== offer.currency || observation.lines.value.length !== offer.lines.length || !observation.lines.value.every(line => validLine(line, offer))) return { kind: 'held', reason: 'catalog_mismatch' };
  money(observation.total.value.currency, observation.total.value.minorUnits);
  if (BigInt(observation.total.value.minorUnits) < 0n || (!offer.allowZeroTotal && observation.total.value.minorUnits === '0')) return { kind: 'held', reason: 'catalog_mismatch' };
  if (observation.customerRef.value === null) return { kind: 'held', reason: 'incomplete' };
  if (binding.customerRef !== null && binding.customerRef !== observation.customerRef.value) return { kind: 'held', reason: 'ownership_mismatch' };
  if (known(observation.intentCorrelation) && observation.intentCorrelation.value !== null && observation.intentCorrelation.value !== intent.intentId) return { kind: 'held', reason: 'ownership_mismatch' };
  const origin = observation.origin.value;
  if (['subscription_update', 'subscription_charge', 'subscription_recurring_manual', 'subscription_trial'].includes(origin)) return { kind: 'held', reason: 'unsupported' };
  let classification: CompletionFact['classification'] = 'one_time';
  let sub: SubscriptionBinding | undefined;
  let holdReason: EvidenceFlag | undefined;
  if (offer.profile === 'monthly') {
    const subRef = known(observation.subscriptionRef) ? observation.subscriptionRef.value : null;
    if (!subRef || !intent.subscriptionBasisId) return { kind: 'held', reason: 'incomplete' };
    sub = state.subscriptionBindings[intent.subscriptionBasisId];
    if (!sub) return { kind: 'held', reason: 'unresolved_binding' };
    classification = origin === 'subscription_recurring' ? (binding.purpose === 'recovery' ? 'recovery' : 'renewal') : 'initial';
    if (classification === 'initial' && !['web', 'api', 'subscription_create', 'automatic'].includes(origin)) return { kind: 'held', reason: 'unsupported' };
    if (!sub.providerSubscriptionRefs.includes(subRef)) sub.providerSubscriptionRefs.push(subRef);
    if (sub.customerRef !== null && sub.customerRef !== observation.customerRef.value) return { kind: 'held', reason: 'ownership_mismatch' };
    sub.customerRef ??= observation.customerRef.value;
    if (!sub.selectedSubscriptionRef) sub.selectedSubscriptionRef = subRef;
    if (classification === 'renewal' || classification === 'recovery') {
      const duplicateInitial = sub.classificationDecision?.duplicateInitialPurchase ?? Object.values(state.transactions).some(candidate => candidate.completion?.intentId === intent.intentId && candidate.flags.includes('duplicate_initial_purchase'));
      if (sub.selectedSubscriptionRef !== subRef || (duplicateInitial && !sub.streamSelection)) holdReason = 'duplicate_initial_purchase';
    }
  } else {
    if ((known(observation.subscriptionRef) && observation.subscriptionRef.value !== null) || !['web', 'api', 'automatic'].includes(origin)) return { kind: 'held', reason: 'unsupported' };
  }
  binding.customerRef ??= observation.customerRef.value;
  const lines = observation.lines.value.map(line => {
    const benefitSlotId = offer.lines.find(expected => expected.providerPriceRef === line.providerPriceRef)?.benefitSlotId;
    if (!benefitSlotId) throw new Error('Validated line has no benefit');
    const period = known(line.period) ? line.period.value : null;
    return { providerLineRef: line.providerLineRef, benefitSlotId, amount: line.amount, quantity: 1 as const, ...(period === null ? {} : { period }) };
  });
  return { kind: 'commercial', ...(holdReason ? { holdReason } : {}), fact: { factId: digest([scope.provider, scope.paymentAccountId, scope.environment, observation.transactionRef, 'completion']), scope, transactionRef: observation.transactionRef, intentId: intent.intentId, buyerId: intent.buyerId, ...(sub ? { subscriptionBasisId: sub.bindingId, providerSubscriptionRef: known(observation.subscriptionRef) ? observation.subscriptionRef.value as string : '' } : {}), classification, offer, total: observation.total.value, lines, source: observation.source } };
}
function bindRenewal(state: PaymentState, observation: TransactionObservation): void {
  if (state.bindings[observation.transactionRef] || !known(observation.subscriptionRef) || !observation.subscriptionRef.value || !known(observation.origin) || observation.origin.value !== 'subscription_recurring') return;
  const matches = Object.values(state.subscriptionBindings).filter(binding => binding.providerSubscriptionRefs.includes(observation.subscriptionRef.presence === 'known' ? observation.subscriptionRef.value ?? '' : ''));
  if (matches.length !== 1) return;
  const binding = matches[0]; if (!binding) return;
  state.bindings[observation.transactionRef] = { transactionRef: observation.transactionRef, intentId: binding.originatingIntentId, buyerId: binding.buyerId, purpose: 'commercial', customerRef: binding.customerRef };
}
/** Atomically persist the core decision and its restartable bounded dependent traversal. */
export function requireSubscriptionReclassification(state: PaymentState, binding: SubscriptionBinding): void {
  const revision = (binding.classificationDecision?.revision ?? 0) + 1;
  binding.classificationDecision = { revision, duplicateInitialPurchase: binding.classificationDecision?.duplicateInitialPurchase ?? false };
  state.reclassifications[binding.bindingId] = { bindingId: binding.bindingId, decisionRevision: revision, complete: false };
}
function markDuplicates(state: PaymentState, fact: CompletionFact): void {
  if (!['initial', 'one_time'].includes(fact.classification)) return;
  const candidates = Object.values(state.transactions).filter(aggregate => aggregate.completion?.intentId === fact.intentId && aggregate.completion.classification === fact.classification);
  if (candidates.length < 2) return;
  const duplicateFlag = fact.classification === 'initial' ? 'duplicate_initial_purchase' : 'duplicate_payment';
  for (const aggregate of candidates) if (!aggregate.flags.includes(duplicateFlag)) { flag(aggregate, duplicateFlag); aggregate.publicationRequired = true; aggregate.revision += 1; }
  const binding = fact.subscriptionBasisId ? state.subscriptionBindings[fact.subscriptionBasisId] : undefined;
  if (fact.classification === 'initial' && binding && !binding.classificationDecision?.duplicateInitialPurchase) {
    binding.classificationDecision = { revision: binding.classificationDecision?.revision ?? 0, duplicateInitialPurchase: true };
    requireSubscriptionReclassification(state, binding);
  }
}
function reduceTransaction(state: PaymentState, scope: PaymentScope, observation: TransactionObservation): void {
  exactTime(observation.version);
  const aggregate = transactionAggregate(state, observation.transactionRef);
  let effective = observation;
  const sameVersion = aggregate.observations.find(item => compareTime(item.version, observation.version) === 0);
  if (sameVersion) {
    if (!compatible(semantic(sameVersion), semantic(observation))) { flag(aggregate, 'conflict'); aggregate.publicationRequired = true; aggregate.revision += 1; return; }
    effective = mergeFields(sameVersion, observation);
    aggregate.observations[aggregate.observations.indexOf(sameVersion)] = effective;
  } else aggregate.observations.push(observation);
  if (!aggregate.current || compareTime(effective.version, aggregate.current.version) >= 0) {
    aggregate.current = effective; setCurrentProfileFlags(aggregate, transactionStatusFlags(effective));
  }
  bindRenewal(state, effective);
  const classification = classifyCompletion(state, scope, effective);
  if (classification.kind === 'commercial') {
    if (aggregate.completion) {
      const comparable = (fact: CompletionFact) => semantic({ ...fact, classification: fact.classification === 'recovery' ? 'renewal' : fact.classification, source: undefined });
      if (!compatible(comparable(aggregate.completion), comparable(classification.fact))) flag(aggregate, 'conflict');
    } else aggregate.completion = classification.fact;
    removeFlag(aggregate, 'incomplete'); removeFlag(aggregate, 'unresolved_binding');
    if (classification.holdReason) flag(aggregate, classification.holdReason);
    else if (['renewal', 'recovery'].includes(classification.fact.classification)) removeFlag(aggregate, 'duplicate_initial_purchase');
    markDuplicates(state, classification.fact);
    const subRef = classification.fact.providerSubscriptionRef;
    const subscription = subRef ? state.subscriptions[subRef]?.current : undefined;
    if (subscription) reduceSubscription(state, subscription);
  } else if (classification.kind === 'held' && transactionStatusFlags(effective).length === 0) flag(aggregate, classification.reason);
  else if (classification.kind === 'management') removeFlag(aggregate, 'unresolved_binding');
  aggregate.revision += 1; aggregate.publicationRequired = true;
}
function reduceSubscription(state: PaymentState, observation: SubscriptionObservation): void {
  exactTime(observation.version);
  const aggregate = subscriptionAggregate(state, observation.subscriptionRef);
  if (known(observation.currentPeriod) && observation.currentPeriod.value && compareTime(observation.currentPeriod.value.startsAt, observation.currentPeriod.value.endsAt) >= 0) throw new TypeError('Invalid subscription period');
  if (known(observation.scheduledChange) && observation.scheduledChange.value) exactTime(observation.scheduledChange.value.effectiveAt);
  const newOwnershipHold = subscriptionOwnershipMismatch(state, observation) && !aggregate.flags.includes('ownership_mismatch');
  if (newOwnershipHold) flag(aggregate, 'ownership_mismatch');
  const current = aggregate.current;
  if (current) {
    const order = compareTime(observation.version, current.version);
    if (order < 0) { if (newOwnershipHold) { aggregate.revision += 1; aggregate.publicationRequired = true; } return; }
    if (order === 0 && !compatible(semantic(current), semantic(observation))) { flag(aggregate, 'conflict'); aggregate.revision += 1; aggregate.publicationRequired = true; return; }
    if (order === 0) observation = mergeFields(current, observation);
    else aggregate.lastKnown = current;
  }
  aggregate.current = observation;
  const profileFlags: EvidenceFlag[] = [];
  if ((known(observation.status) && !['active', 'past_due', 'canceled'].includes(observation.status.value)) || (known(observation.scheduledChange) && observation.scheduledChange.value && observation.scheduledChange.value.action !== 'cancel') || (observation.collection?.presence === 'known' && observation.collection.value.kind !== 'automatic')) profileFlags.push('unsupported');
  if (!known(observation.status) || !known(observation.scheduledChange) || !known(observation.currentPeriod) || !known(observation.customerRef) || observation.collection?.presence !== 'known' || observation.items?.presence !== 'known') profileFlags.push('incomplete');
  if (observation.items?.presence === 'known') {
    for (const item of observation.items.value) {
      if (!known(item.quantity) || !known(item.billingCycle) || !known(item.trial)) profileFlags.push('incomplete');
      if ((known(item.quantity) && item.quantity.value !== 1) || (known(item.billingCycle) && (item.billingCycle.value?.interval !== 'month' || item.billingCycle.value.frequency !== 1)) || (known(item.trial) && item.trial.value)) profileFlags.push('unsupported');
    }
  }
  const bindings = Object.values(state.subscriptionBindings).filter(binding => binding.providerSubscriptionRefs.includes(observation.subscriptionRef));
  if (bindings.length !== 1) flag(aggregate, 'unresolved_binding');
  else {
    removeFlag(aggregate, 'unresolved_binding');
    const binding = bindings[0];
    if (binding && known(observation.customerRef) && binding.customerRef !== null && observation.customerRef.value !== binding.customerRef) flag(aggregate, 'ownership_mismatch');
    if (binding && observation.items?.presence === 'known' && canonicalJson(observation.items.value.map(item => item.providerPriceRef).sort()) !== canonicalJson(binding.offer.lines.map(line => line.providerPriceRef).sort())) profileFlags.push('catalog_mismatch');
  }
  setCurrentProfileFlags(aggregate, profileFlags);
  aggregate.revision += 1; aggregate.publicationRequired = true;
}
function reduceAdjustment(state: PaymentState, observation: AdjustmentObservation): void {
  exactTime(observation.version); money(observation.amount.currency, observation.amount.minorUnits);
  for (const allocation of observation.allocations) money(allocation.amount.currency, allocation.amount.minorUnits);
  const aggregate = transactionAggregate(state, observation.transactionRef), current = aggregate.adjustments[observation.adjustmentRef];
  if (current) {
    const order = compareTime(observation.version, current.version);
    if (order < 0) return;
    if (order === 0 && !compatible(semantic(current), semantic(observation))) { flag(aggregate, 'conflict'); aggregate.revision += 1; aggregate.publicationRequired = true; return; }
  }
  aggregate.adjustments[observation.adjustmentRef] = observation;
  if (observation.allocations.some(allocation => allocation.amount.currency !== observation.amount.currency)) flag(aggregate, 'unsupported');
  if (!['refund', 'credit', 'chargeback', 'chargeback_reverse', 'chargeback_warning', 'chargeback_warning_reverse', 'credit_reverse'].includes(observation.action) || !['pending_approval', 'approved', 'rejected', 'reversed'].includes(observation.status)) flag(aggregate, 'unsupported');
  aggregate.revision += 1; aggregate.publicationRequired = true;
}
export function reduceObservation(state: PaymentState, scope: PaymentScope, observation: Observation): 'applied' | 'conflict' | 'held' {
  if (observation.kind !== 'unsupported') {
    const certified = certifyObjectVersion(state, observation);
    if (certified.kind !== 'certified') {
      for (const route of objectVersionDependentRoutes(observation, state.versionEvidence[objectVersionKey(observation) ?? ''])) {
        const aggregate = route.type === 'subscription' ? subscriptionAggregate(state, route.id) : transactionAggregate(state, route.id);
        flag(aggregate, certified.kind === 'held' ? 'incomplete_history' : 'conflict');
        if (observation.kind === 'subscription' && subscriptionOwnershipMismatch(state, observation)) flag(aggregate, 'ownership_mismatch');
        aggregate.revision += 1; aggregate.publicationRequired = true;
      }
      return certified.kind;
    }
    observation = certified.observation;
  }
  switch (observation.kind) {
    case 'transaction': reduceTransaction(state, scope, observation); break;
    case 'subscription': reduceSubscription(state, observation); break;
    case 'adjustment': reduceAdjustment(state, observation); break;
    case 'unsupported': {
      if (observation.transactionRef) { const target = transactionAggregate(state, observation.transactionRef); flag(target, 'unsupported'); target.revision += 1; target.publicationRequired = true; }
      else if (observation.subscriptionRef) { const target = subscriptionAggregate(state, observation.subscriptionRef); flag(target, 'unsupported'); target.revision += 1; target.publicationRequired = true; }
      else state.issues.push(`unresolved-routing:${observation.source.receiptId}`);
    }
  }
  return 'applied';
}
/** All payment-owner aggregate routes affected by one trusted receipt; no product authority is inferred. */
export function inputRoutes(input: Pick<VerifiedInput, 'observation' | 'adverseTransactionRef'>): readonly AggregateIdentity[] {
  const routes: AggregateIdentity[] = [], observation = input.observation;
  const transactionRef = input.adverseTransactionRef ?? ('transactionRef' in observation ? observation.transactionRef : undefined);
  if (transactionRef) routes.push({ type: 'transaction', id: transactionRef });
  if ('transactionRef' in observation && observation.transactionRef && observation.transactionRef !== transactionRef) routes.push({ type: 'transaction', id: observation.transactionRef });
  if ('subscriptionRef' in observation && typeof observation.subscriptionRef === 'string' && observation.subscriptionRef) routes.push({ type: 'subscription', id: observation.subscriptionRef });
  return routes;
}
/** Exact-version adjustment contradictions affect both the retained certified parent and the
 * incoming parent. Stores load these bounded routes before core reduction; no history scan is needed. */
export function objectVersionDependentRoutes(observation: Observation, evidence: ObjectVersionEvidence | undefined): readonly AggregateIdentity[] {
  const routes = [...inputRoutes({ observation })];
  if (observation.kind === 'adjustment' && evidence?.kind === 'certified' && evidence.projection.kind === 'adjustment') {
    const parent = evidence.projection.transactionRef;
    if (!routes.some(route => route.type === 'transaction' && route.id === parent)) routes.push({ type: 'transaction', id: parent });
  }
  return routes;
}
export function eventIdentityEvidence(input: VerifiedInput): EventIdentityEvidence {
  const { source: ignored, ...projection } = input.observation;
  void ignored;
  const source = input.source;
  return { provider: input.scope.provider, paymentAccountId: input.scope.paymentAccountId, environment: input.scope.environment,
    ...(source.eventId === undefined ? {} : { eventId: source.eventId }), ...(source.eventType === undefined ? {} : { eventType: source.eventType }), ...(source.occurredAt === undefined ? {} : { occurredAt: source.occurredAt }),
    ...(source.kind === 'verified_webhook' && source.stableEnvelopeDigest !== undefined ? { rawStableEnvelopeDigest: source.stableEnvelopeDigest } : {}), projection, routes: inputRoutes(input) };
}
function eventSubject(evidence: EventIdentityEvidence): Readonly<{ kind: string; id: string }> | undefined {
  const projection = evidence.projection;
  if (projection.kind === 'transaction') return { kind: projection.kind, id: projection.transactionRef };
  if (projection.kind === 'subscription') return { kind: projection.kind, id: projection.subscriptionRef };
  if (projection.kind === 'adjustment') return { kind: projection.kind, id: projection.adjustmentRef };
  if (evidence.eventType?.startsWith('transaction.') && projection.transactionRef) return { kind: 'transaction', id: projection.transactionRef };
  if (evidence.eventType?.startsWith('subscription.') && projection.subscriptionRef) return { kind: 'subscription', id: projection.subscriptionRef };
  return undefined;
}
function eventParent(evidence: EventIdentityEvidence): string | undefined {
  const projection = evidence.projection;
  return projection.kind === 'adjustment' || (projection.kind === 'unsupported' && evidence.eventType?.startsWith('adjustment.')) ? projection.transactionRef : undefined;
}
/** Pairwise compatibility is not transitive: compare every receipt, or merge all compatible certified fields. */
export function compareEventIdentity(a: EventIdentityEvidence, b: EventIdentityEvidence): 'unrelated' | 'compatible' | 'conflict' {
  if (!a.eventId || a.eventId !== b.eventId || a.provider !== b.provider || a.paymentAccountId !== b.paymentAccountId || a.environment !== b.environment) return 'unrelated';
  if (a.eventType !== undefined && b.eventType !== undefined && a.eventType !== b.eventType) return 'conflict';
  if (a.occurredAt !== undefined && b.occurredAt !== undefined) { try { if (compareTime(a.occurredAt, b.occurredAt) !== 0) return 'conflict'; } catch { return 'conflict'; } }
  if (a.rawStableEnvelopeDigest !== undefined && b.rawStableEnvelopeDigest !== undefined && a.rawStableEnvelopeDigest !== b.rawStableEnvelopeDigest) return 'conflict';
  const aa = eventSubject(a), bb = eventSubject(b);
  if (aa && bb && (aa.kind !== bb.kind || aa.id !== bb.id)) return 'conflict';
  const ap = eventParent(a), bp = eventParent(b); if (ap !== undefined && bp !== undefined && ap !== bp) return 'conflict';
  if (a.projection.kind !== 'unsupported' && b.projection.kind !== 'unsupported' && !compatible(semantic(a.projection), semantic(b.projection))) return 'conflict';
  return 'compatible';
}
/** Retains every mutually certified field so partial A cannot hide a later B/C contradiction. */
export function mergeEventIdentityEvidence(a: EventIdentityEvidence, b: EventIdentityEvidence): EventIdentityEvidence {
  if (compareEventIdentity(a, b) !== 'compatible') throw new TypeError('Cannot merge conflicting or unrelated event identities');
  const projection = a.projection.kind === 'unsupported' && b.projection.kind !== 'unsupported' ? b.projection : b.projection.kind === 'unsupported' && a.projection.kind !== 'unsupported' ? a.projection : mergeFields(a.projection, b.projection);
  const routes = [...a.routes]; for (const route of b.routes) if (!routes.some(existing => existing.type === route.type && existing.id === route.id)) routes.push(route);
  return { ...a, ...(a.eventType === undefined && b.eventType !== undefined ? { eventType: b.eventType } : {}), ...(a.occurredAt === undefined && b.occurredAt !== undefined ? { occurredAt: b.occurredAt } : {}), ...(a.rawStableEnvelopeDigest === undefined && b.rawStableEnvelopeDigest !== undefined ? { rawStableEnvelopeDigest: b.rawStableEnvelopeDigest } : {}), projection, routes };
}
function flagInputConflict(state: PaymentState, input: Pick<VerifiedInput, 'observation' | 'adverseTransactionRef'>): void {
  for (const route of inputRoutes(input)) {
    const aggregate = route.type === 'transaction' ? transactionAggregate(state, route.id) : subscriptionAggregate(state, route.id);
    flag(aggregate, 'conflict'); aggregate.revision += 1; aggregate.publicationRequired = true;
  }
}
export function admitInput(state: PaymentState, input: VerifiedInput): 'admitted' | 'duplicate' | 'conflict' {
  const existing = state.inbox[input.inputId];
  if (existing) {
    const identityConflict = compareEventIdentity(eventIdentityEvidence(existing.input), eventIdentityEvidence(input)) === 'conflict';
    if (existing.input.source.representationDigest === input.source.representationDigest && !identityConflict) { if (existing.state !== 'processed') existing.state = 'pending'; return 'duplicate'; }
    existing.conflict = true; state.issues.push(`input-identity-conflict:${input.inputId}`);
    flagInputConflict(state, existing.input); flagInputConflict(state, input);
    return 'conflict';
  }
  let conflict = false;
  const incomingIdentity = eventIdentityEvidence(input);
  if (input.source.eventId) for (const receipt of Object.values(state.inbox)) {
    if (compareEventIdentity(eventIdentityEvidence(receipt.input), incomingIdentity) === 'conflict') {
      conflict = true; flagInputConflict(state, receipt.input);
    }
  }
  state.inbox[input.inputId] = { input, state: 'pending', conflict, attempts: 0 };
  const adverse = input.adverseTransactionRef ?? (input.observation.kind === 'adjustment' ? input.observation.transactionRef : undefined);
  if (adverse) {
    const aggregate = transactionAggregate(state, adverse);
    if (!aggregate.pendingAdverse.includes(input.inputId)) aggregate.pendingAdverse.push(input.inputId);
    aggregate.revision += 1; aggregate.publicationRequired = true;
  }
  if (conflict) flagInputConflict(state, input);
  return conflict ? 'conflict' : 'admitted';
}
function storeMessage(state: PaymentState, scope: PaymentScope, producerNamespace: string, aggregate: Readonly<{ type: 'transaction' | 'subscription'; id: string }>, revision: number, payload: object, maxBytes: number): EvidenceMessage {
  const messageId = digest([producerNamespace, scope, aggregate, revision]);
  const base = { envelopeVersion: 1 as const, schemaVersion: 1 as const, producerNamespace, scope, aggregate, revision, messageId };
  let body: Record<string, unknown> = { ...base, ...payload };
  if (Buffer.byteLength(canonicalJson(body)) + 80 > maxBytes) body = { ...base, kind: 'held', reason: 'evidence_size_limit', resolutionRef: messageId };
  const message = { ...body, bodyDigest: digest(body) } as EvidenceMessage;
  if (Buffer.byteLength(canonicalJson(message)) > maxBytes) throw new RangeError('Evidence control envelope exceeds configured limit');
  const existing = state.evidence[messageId];
  if (existing && existing.bodyDigest !== message.bodyDigest) throw new Error('Evidence revision identity reused');
  state.evidence[messageId] = message;
  for (const consumerId of state.consumers) state.deliveries[canonicalJson([messageId, consumerId])] ??= { consumerId, messageId, acknowledged: false, attempts: 0 };
  return message;
}
/** Must run inside the same owner commit as the reduction or quarantine state. */
export function publishEvidence(state: PaymentState, scope: PaymentScope, producerNamespace: string, maxBytes: number): EvidenceMessage[] {
  const messages: EvidenceMessage[] = [];
  for (const aggregate of Object.values(state.transactions)) if (aggregate.publicationRequired) {
    const flags = [...aggregate.flags]; if (aggregate.pendingAdverse.length > 0 && !flags.includes('pending_adverse')) flags.push('pending_adverse');
    aggregate.evidenceRevision += 1;
    const payload = flags.includes('incomplete_history') ? { kind: 'held', reason: 'object_version_history_incomplete', resolutionRef: aggregate.transactionRef } : { kind: 'complete', ...(aggregate.completion ? { completion: aggregate.completion } : {}), adjustments: Object.values(aggregate.adjustments).sort((a, b) => a.adjustmentRef.localeCompare(b.adjustmentRef)), flags };
    messages.push(storeMessage(state, scope, producerNamespace, { type: 'transaction', id: aggregate.transactionRef }, aggregate.evidenceRevision, payload, maxBytes));
    aggregate.publicationRequired = false;
  }
  for (const aggregate of Object.values(state.subscriptions)) if (aggregate.publicationRequired) {
    aggregate.evidenceRevision += 1;
    const bindings = Object.values(state.subscriptionBindings).filter(binding => binding.providerSubscriptionRefs.includes(aggregate.subscriptionRef));
    const binding = bindings[0];
    const payload = !aggregate.flags.includes('incomplete_history') && bindings.length === 1 && binding && aggregate.current ? { kind: 'subscription_complete', binding, observation: aggregate.current, flags: aggregate.flags } : { kind: 'held', reason: aggregate.flags.includes('incomplete_history') ? 'object_version_history_incomplete' : 'unresolved_binding', resolutionRef: aggregate.subscriptionRef };
    messages.push(storeMessage(state, scope, producerNamespace, { type: 'subscription', id: aggregate.subscriptionRef }, aggregate.evidenceRevision, payload, maxBytes));
    aggregate.publicationRequired = false;
  }
  return messages;
}
export function processInput(state: PaymentState, scope: PaymentScope, inputId: string): 'processed' | 'duplicate' | 'quarantined' {
  let record = state.inbox[inputId]; if (!record) throw new Error('Unknown inbox input');
  if (record.state === 'processed') return 'duplicate';
  record.attempts += 1;
  if (record.conflict) { record.state = 'quarantined'; record.issue = 'conflicting_input'; return 'quarantined'; }
  try {
    const staged = structuredClone(state);
    const reduction = reduceObservation(staged, scope, record.input.observation);
    Object.assign(state, staged);
    const updatedRecord = state.inbox[inputId];
    if (!updatedRecord) throw new Error('Inbox disappeared during reduction');
    record = updatedRecord;
    if (reduction === 'held') { record.state = 'quarantined'; record.issue = 'version_evidence_size_limit'; return 'quarantined'; }
  }
  catch (error) {
    record.state = 'quarantined'; record.issue = error instanceof Error ? error.name : 'decoder_failure';
    const ref = record.input.adverseTransactionRef ?? ('transactionRef' in record.input.observation ? record.input.observation.transactionRef : undefined);
    if (ref) { const aggregate = transactionAggregate(state, ref); flag(aggregate, 'incomplete'); aggregate.publicationRequired = true; }
    else if ('subscriptionRef' in record.input.observation && typeof record.input.observation.subscriptionRef === 'string' && record.input.observation.subscriptionRef) { const aggregate = subscriptionAggregate(state, record.input.observation.subscriptionRef); flag(aggregate, 'incomplete'); aggregate.publicationRequired = true; }
    else state.issues.push(`quarantine-unresolved:${inputId}`);
    return 'quarantined';
  }
  const adverse = record.input.adverseTransactionRef ?? (record.input.observation.kind === 'adjustment' ? record.input.observation.transactionRef : undefined);
  if (adverse && record.input.observation.kind === 'unsupported') { record.state = 'quarantined'; record.issue = record.input.observation.reason; return 'quarantined'; }
  if (adverse) { const aggregate = transactionAggregate(state, adverse); aggregate.pendingAdverse = aggregate.pendingAdverse.filter(id => id !== inputId); aggregate.revision += 1; aggregate.publicationRequired = true; }
  record.state = 'processed'; return 'processed';
}
/** Quarantine/working-set overflow never serializes a partial history as a complete snapshot. */
export function publishHeldEvidence(state: PaymentState, scope: PaymentScope, producerNamespace: string, reason: string, maxBytes: number): EvidenceMessage[] {
  const messages: EvidenceMessage[] = [];
  for (const aggregate of Object.values(state.transactions)) {
    aggregate.evidenceRevision += 1; aggregate.revision += 1; aggregate.publicationRequired = false;
    const message = storeMessage(state, scope, producerNamespace, { type: 'transaction', id: aggregate.transactionRef }, aggregate.evidenceRevision, { kind: 'held', reason, resolutionRef: aggregate.transactionRef }, maxBytes);
    messages.push(message);
  }
  for (const aggregate of Object.values(state.subscriptions)) {
    aggregate.evidenceRevision += 1; aggregate.revision += 1; aggregate.publicationRequired = false;
    messages.push(storeMessage(state, scope, producerNamespace, { type: 'subscription', id: aggregate.subscriptionRef }, aggregate.evidenceRevision, { kind: 'held', reason, resolutionRef: aggregate.subscriptionRef }, maxBytes));
  }
  return messages;
}
