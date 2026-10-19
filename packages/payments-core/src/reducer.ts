import type { AdjustmentObservation, CompletionFact, EvidenceFlag, EvidenceMessage, Field, Observation, OfferSnapshot, PaymentScope, PaymentState, ProviderLine, SubscriptionAggregate, SubscriptionBinding, SubscriptionObservation, TransactionAggregate, TransactionBinding, TransactionObservation, VerifiedInput } from './contracts.js';
import { assertIdentifier, canonicalJson, compareTime, digest, exactTime, money } from './values.js';

const known = <T>(field: Field<T>): field is Readonly<{ presence: 'known'; value: T; provenance?: 'observed' | 'schema_assumed_null' }> => field.presence === 'known';
function flag(target: { flags: EvidenceFlag[] }, value: EvidenceFlag): void { if (!target.flags.includes(value)) target.flags.push(value); }
function removeFlag(target: { flags: EvidenceFlag[] }, value: EvidenceFlag): void { target.flags = target.flags.filter(item => item !== value); }
export function transactionAggregate(state: PaymentState, ref: string): TransactionAggregate {
  return state.transactions[ref] ??= { transactionRef: ref, revision: 0, evidenceRevision: 0, observations: [], adjustments: {}, pendingAdverse: [], flags: [], publicationRequired: false };
}
function subscriptionAggregate(state: PaymentState, ref: string): SubscriptionAggregate {
  return state.subscriptions[ref] ??= { subscriptionRef: ref, revision: 0, evidenceRevision: 0, flags: [], publicationRequired: false };
}
function semantic(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(semantic);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'provenance' && key !== 'source').map(([key, item]) => [key, semantic(item)]));
  return value;
}
function compatible(a: unknown, b: unknown): boolean {
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
    return Object.fromEntries(Object.keys(newValue).map(key => [key, key === 'source' ? (newValue as Record<string, unknown>)[key] : mergeFields((oldValue as Record<string, unknown>)[key], (newValue as Record<string, unknown>)[key])])) as T;
  }
  return newValue;
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
  if (offer.profile === 'one_time') return line.billingCycle.value === null && known(line.period) && line.period.value === null;
  const cycle = line.billingCycle.value;
  if (cycle?.interval !== 'month' || cycle.frequency !== 1 || !known(line.period) || line.period.value === null) return false;
  return compareTime(line.period.value.startsAt, line.period.value.endsAt) < 0;
}
export type Classification = Readonly<{ kind: 'commercial'; fact: CompletionFact }> | Readonly<{ kind: 'management' }> | Readonly<{ kind: 'held'; reason: EvidenceFlag }> | Readonly<{ kind: 'not_completed' }>;
/** Final server completed classifier. Neither amount, customer nor correlation alone proves ownership. */
export function classifyCompletion(state: PaymentState, scope: PaymentScope, observation: TransactionObservation): Classification {
  if (observation.status !== 'completed') return { kind: 'not_completed' };
  const binding = state.bindings[observation.transactionRef];
  if (!binding) return { kind: 'held', reason: 'unresolved_binding' };
  if (binding.purpose === 'payment_method' || (known(observation.origin) && observation.origin.value === 'subscription_payment_method_change')) return { kind: 'management' };
  const intent = state.intents[binding.intentId];
  if (!intent) return { kind: 'held', reason: 'unresolved_binding' };
  const offer = intent.offer;
  if (!known(observation.lines) || !known(observation.total) || !known(observation.currency) || !known(observation.origin) || !known(observation.customerRef) || !known(observation.subscriptionRef)) return { kind: 'held', reason: 'incomplete' };
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
  if (offer.profile === 'monthly') {
    const subRef = observation.subscriptionRef.value;
    if (!subRef || !intent.subscriptionBasisId) return { kind: 'held', reason: 'incomplete' };
    sub = state.subscriptionBindings[intent.subscriptionBasisId];
    if (!sub) return { kind: 'held', reason: 'unresolved_binding' };
    if (!sub.providerSubscriptionRefs.includes(subRef)) sub.providerSubscriptionRefs.push(subRef);
    if (sub.customerRef !== null && sub.customerRef !== observation.customerRef.value) return { kind: 'held', reason: 'ownership_mismatch' };
    sub.customerRef ??= observation.customerRef.value;
    if (!sub.selectedSubscriptionRef) sub.selectedSubscriptionRef = subRef;
    classification = origin === 'subscription_recurring' ? (binding.purpose === 'recovery' ? 'recovery' : 'renewal') : 'initial';
    if (classification === 'initial' && !['web', 'api', 'subscription_create', 'automatic'].includes(origin)) return { kind: 'held', reason: 'unsupported' };
    if (classification === 'renewal' || classification === 'recovery') {
      if (sub.selectedSubscriptionRef !== subRef) return { kind: 'held', reason: 'duplicate_initial_purchase' };
    }
  } else {
    if (observation.subscriptionRef.value !== null || !['web', 'api', 'automatic'].includes(origin)) return { kind: 'held', reason: 'unsupported' };
  }
  binding.customerRef ??= observation.customerRef.value;
  const lines = observation.lines.value.map(line => {
    const benefitSlotId = offer.lines.find(expected => expected.providerPriceRef === line.providerPriceRef)?.benefitSlotId;
    if (!benefitSlotId) throw new Error('Validated line has no benefit');
    const period = known(line.period) ? line.period.value : null;
    return { providerLineRef: line.providerLineRef, benefitSlotId, amount: line.amount, quantity: 1 as const, ...(period === null ? {} : { period }) };
  });
  return { kind: 'commercial', fact: { factId: digest([scope.provider, scope.paymentAccountId, scope.environment, observation.transactionRef, 'completion']), scope, transactionRef: observation.transactionRef, intentId: intent.intentId, buyerId: intent.buyerId, ...(sub ? { subscriptionBasisId: sub.bindingId, providerSubscriptionRef: observation.subscriptionRef.value as string } : {}), classification, offer, total: observation.total.value, lines, source: observation.source } };
}
function bindRenewal(state: PaymentState, observation: TransactionObservation): void {
  if (state.bindings[observation.transactionRef] || !known(observation.subscriptionRef) || !observation.subscriptionRef.value || !known(observation.origin) || observation.origin.value !== 'subscription_recurring') return;
  const matches = Object.values(state.subscriptionBindings).filter(binding => binding.providerSubscriptionRefs.includes(observation.subscriptionRef.presence === 'known' ? observation.subscriptionRef.value ?? '' : ''));
  if (matches.length !== 1) return;
  const binding = matches[0]; if (!binding) return;
  state.bindings[observation.transactionRef] = { transactionRef: observation.transactionRef, intentId: binding.originatingIntentId, buyerId: binding.buyerId, purpose: 'commercial', customerRef: binding.customerRef };
}
function markDuplicates(state: PaymentState, fact: CompletionFact): void {
  if (fact.classification !== 'initial') return;
  const candidates = Object.values(state.transactions).filter(aggregate => aggregate.completion?.intentId === fact.intentId && aggregate.completion.classification === 'initial');
  if (candidates.length > 1) for (const aggregate of candidates) { flag(aggregate, 'duplicate_initial_purchase'); aggregate.publicationRequired = true; aggregate.revision += 1; }
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
  if (!aggregate.current || compareTime(effective.version, aggregate.current.version) >= 0) aggregate.current = effective;
  bindRenewal(state, effective);
  const classification = classifyCompletion(state, scope, effective);
  if (classification.kind === 'commercial') {
    if (aggregate.completion) {
      if (!compatible(semantic({ ...aggregate.completion, source: undefined }), semantic({ ...classification.fact, source: undefined }))) flag(aggregate, 'conflict');
    } else aggregate.completion = classification.fact;
    removeFlag(aggregate, 'incomplete'); removeFlag(aggregate, 'unresolved_binding');
    markDuplicates(state, classification.fact);
  } else if (classification.kind === 'held') flag(aggregate, classification.reason);
  aggregate.revision += 1; aggregate.publicationRequired = true;
}
function reduceSubscription(state: PaymentState, observation: SubscriptionObservation): void {
  exactTime(observation.version);
  const aggregate = subscriptionAggregate(state, observation.subscriptionRef);
  const current = aggregate.current;
  if (current) {
    const order = compareTime(observation.version, current.version);
    if (order < 0) return;
    if (order === 0 && !compatible(semantic(current), semantic(observation))) { flag(aggregate, 'conflict'); aggregate.revision += 1; aggregate.publicationRequired = true; return; }
    if (order === 0) observation = mergeFields(current, observation);
    else aggregate.lastKnown = current;
  }
  aggregate.current = observation;
  if (!known(observation.status) || !known(observation.scheduledChange) || !known(observation.currentPeriod) || !known(observation.priceRefs) || !known(observation.customerRef)) flag(aggregate, 'incomplete'); else removeFlag(aggregate, 'incomplete');
  const bindings = Object.values(state.subscriptionBindings).filter(binding => binding.providerSubscriptionRefs.includes(observation.subscriptionRef));
  if (bindings.length !== 1) flag(aggregate, 'unresolved_binding');
  else {
    removeFlag(aggregate, 'unresolved_binding');
    const binding = bindings[0];
    if (binding && known(observation.customerRef) && binding.customerRef !== null && observation.customerRef.value !== binding.customerRef) flag(aggregate, 'ownership_mismatch');
    if (binding && known(observation.priceRefs) && canonicalJson([...observation.priceRefs.value].sort()) !== canonicalJson(binding.offer.lines.map(line => line.providerPriceRef).sort())) flag(aggregate, 'catalog_mismatch');
  }
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
  if (!['refund', 'credit', 'chargeback', 'chargeback_reverse', 'chargeback_warning', 'chargeback_warning_reverse', 'credit_reverse'].includes(observation.action) || !['pending_approval', 'approved', 'rejected', 'reversed'].includes(observation.status)) flag(aggregate, 'unsupported');
  aggregate.revision += 1; aggregate.publicationRequired = true;
}
export function reduceObservation(state: PaymentState, scope: PaymentScope, observation: Observation): void {
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
}
export function admitInput(state: PaymentState, input: VerifiedInput): 'admitted' | 'duplicate' | 'conflict' {
  const existing = state.inbox[input.inputId];
  if (existing) {
    if (existing.input.source.representationDigest === input.source.representationDigest) { if (existing.state !== 'processed') existing.state = 'pending'; return 'duplicate'; }
    existing.conflict = true; state.issues.push(`input-identity-conflict:${input.inputId}`);
    const ref = input.adverseTransactionRef ?? ('transactionRef' in input.observation ? input.observation.transactionRef : undefined);
    if (ref) { const aggregate = transactionAggregate(state, ref); flag(aggregate, 'conflict'); aggregate.revision += 1; aggregate.publicationRequired = true; }
    return 'conflict';
  }
  let conflict = false;
  if (input.source.eventId && input.source.stableEnvelopeDigest) for (const receipt of Object.values(state.inbox)) {
    if (receipt.input.source.eventId === input.source.eventId && receipt.input.source.stableEnvelopeDigest && receipt.input.source.stableEnvelopeDigest !== input.source.stableEnvelopeDigest) conflict = true;
  }
  state.inbox[input.inputId] = { input, state: 'pending', conflict, attempts: 0 };
  const adverse = input.adverseTransactionRef ?? (input.observation.kind === 'adjustment' ? input.observation.transactionRef : undefined);
  if (adverse) {
    const aggregate = transactionAggregate(state, adverse);
    if (!aggregate.pendingAdverse.includes(input.inputId)) aggregate.pendingAdverse.push(input.inputId);
    aggregate.revision += 1; aggregate.publicationRequired = true;
  }
  if (conflict) {
    const ref = 'transactionRef' in input.observation ? input.observation.transactionRef : undefined;
    if (ref) { const aggregate = transactionAggregate(state, ref); flag(aggregate, 'conflict'); aggregate.revision += 1; aggregate.publicationRequired = true; }
  }
  return conflict ? 'conflict' : 'admitted';
}
function storeMessage(state: PaymentState, scope: PaymentScope, producerNamespace: string, aggregate: Readonly<{ type: 'transaction' | 'subscription'; id: string }>, revision: number, payload: object, maxBytes: number): EvidenceMessage {
  const messageId = digest([producerNamespace, scope, aggregate, revision]);
  const base = { envelopeVersion: 1 as const, schemaVersion: 1 as const, producerNamespace, scope, aggregate, revision, messageId };
  let body = { ...base, ...payload };
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
    const payload = { kind: 'complete', ...(aggregate.completion ? { completion: aggregate.completion } : {}), adjustments: Object.values(aggregate.adjustments).sort((a, b) => a.adjustmentRef.localeCompare(b.adjustmentRef)), flags };
    messages.push(storeMessage(state, scope, producerNamespace, { type: 'transaction', id: aggregate.transactionRef }, aggregate.evidenceRevision, payload, maxBytes));
    aggregate.publicationRequired = false;
  }
  for (const aggregate of Object.values(state.subscriptions)) if (aggregate.publicationRequired) {
    aggregate.evidenceRevision += 1;
    const bindings = Object.values(state.subscriptionBindings).filter(binding => binding.providerSubscriptionRefs.includes(aggregate.subscriptionRef));
    const binding = bindings[0];
    const payload = bindings.length === 1 && binding && aggregate.current ? { kind: 'subscription_complete', binding, observation: aggregate.current, flags: aggregate.flags } : { kind: 'held', reason: 'unresolved_binding', resolutionRef: aggregate.subscriptionRef };
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
    reduceObservation(staged, scope, record.input.observation);
    Object.assign(state, staged);
    record = state.inbox[inputId];
    if (!record) throw new Error('Inbox disappeared during reduction');
  }
  catch (error) {
    record.state = 'quarantined'; record.issue = error instanceof Error ? error.name : 'decoder_failure';
    const ref = record.input.adverseTransactionRef ?? ('transactionRef' in record.input.observation ? record.input.observation.transactionRef : undefined);
    if (ref) { const aggregate = transactionAggregate(state, ref); flag(aggregate, 'incomplete'); aggregate.publicationRequired = true; }
    else if ('subscriptionRef' in record.input.observation && record.input.observation.subscriptionRef) { const aggregate = subscriptionAggregate(state, record.input.observation.subscriptionRef); flag(aggregate, 'incomplete'); aggregate.publicationRequired = true; }
    else state.issues.push(`quarantine-unresolved:${inputId}`);
    return 'quarantined';
  }
  const adverse = record.input.adverseTransactionRef ?? (record.input.observation.kind === 'adjustment' ? record.input.observation.transactionRef : undefined);
  if (adverse) { const aggregate = transactionAggregate(state, adverse); aggregate.pendingAdverse = aggregate.pendingAdverse.filter(id => id !== inputId); aggregate.revision += 1; aggregate.publicationRequired = true; }
  record.state = 'processed'; return 'processed';
}
