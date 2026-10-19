import { assertIdentifier, compareTime, exactTime, money } from '@agent-teams/payments-core';
import type { AdjustmentObservation, EvidenceSource, Field, Money, Observation, PaymentScope, Period, ProviderLine, SubscriptionObservation, TransactionObservation } from '@agent-teams/payments-core';

type RecordValue = Record<string, unknown>;
type Mode = 'raw' | 'mapped';
const unknown = <T>(): Field<T> => ({ presence: 'unknown' });
const known = <T>(value: T, assumed = false): Field<T> => assumed ? { presence: 'known', value, provenance: 'schema_assumed_null' } : { presence: 'known', value, provenance: 'observed' };
const record = (value: unknown): RecordValue => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError('Expected object');
  return value as RecordValue;
};
const text = (value: unknown): string => { if (typeof value !== 'string' || value.length === 0) throw new TypeError('Expected string'); return value; };
const id = (value: unknown): string => { const result = text(value); assertIdentifier(result); return result; };
const timestamp = (value: unknown): string => { const result = text(value); exactTime(result); return result; };
const array = (value: unknown): unknown[] => { if (!Array.isArray(value)) throw new TypeError('Expected array'); return value as unknown[]; };
const get = (value: RecordValue, mode: Mode, raw: string, mapped: string): unknown => value[mode === 'raw' ? raw : mapped];
const field = <T>(read: () => T): Field<T> => { try { return known(read()); } catch { return unknown(); } };

function nullable<T>(value: unknown, mode: Mode, schemaAssumption: boolean, decode: (input: unknown) => T): Field<T | null> {
  if (value === null) return mode === 'raw' ? known(null) : schemaAssumption ? known(null, true) : unknown();
  return field(() => decode(value));
}
function positiveInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw new TypeError('Expected positive integer');
  return value;
}
function period(value: unknown, mode: Mode): Period {
  const item = record(value), startsAt = timestamp(get(item, mode, 'starts_at', 'startsAt')), endsAt = timestamp(get(item, mode, 'ends_at', 'endsAt'));
  if (compareTime(startsAt, endsAt) >= 0) throw new TypeError('Invalid period');
  return { startsAt, endsAt };
}
function currency(value: unknown): string { const result = text(value); money(result, '0'); return result; }
function exactMoney(value: unknown, code: string, signed = false): Money {
  const result = money(code, text(value));
  if (!signed && result.minorUnits.startsWith('-')) throw new TypeError('Negative commercial total');
  return result;
}
function proration(value: unknown, mode: Mode): Field<boolean> {
  if (value === null) return known(false, mode === 'mapped');
  return field(() => {
    const item = record(value), rate = text(item['rate']);
    if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u.test(rate)) throw new TypeError('Invalid proration rate');
    period(get(item, mode, 'billing_period', 'billingPeriod'), mode);
    return true;
  });
}
function nonTrial(value: unknown, mode: Mode): Field<boolean> {
  if (value === null) return known(false, mode === 'mapped');
  return field(() => {
    const item = record(value);
    text(item['interval']); positiveInteger(item['frequency']);
    return true;
  });
}

function lines(data: RecordValue, mode: Mode, code: string): readonly ProviderLine[] {
  const details = record(data['details']);
  const items = array(data['items']).map(record), financialLines = array(get(details, mode, 'line_items', 'lineItems')).map(record);
  if (items.length === 0 || items.length !== financialLines.length) throw new TypeError('Unmatched transaction items');
  const prices = new Map<string, RecordValue>();
  for (const item of items) {
    const price = record(item['price']), ref = id(price['id']);
    if (prices.has(ref)) throw new TypeError('Ambiguous price mapping');
    prices.set(ref, item);
  }
  const lineIds = new Set<string>(), usedPrices = new Set<string>();
  return financialLines.map(line => {
    const providerLineRef = id(line['id']), providerPriceRef = id(get(line, mode, 'price_id', 'priceId'));
    if (lineIds.has(providerLineRef) || usedPrices.has(providerPriceRef)) throw new TypeError('Duplicate line identity');
    lineIds.add(providerLineRef); usedPrices.add(providerPriceRef);
    const item = prices.get(providerPriceRef);
    if (item === undefined) throw new TypeError('Missing matching price');
    const price = record(item['price']), quantity = positiveInteger(line['quantity']);
    if (positiveInteger(item['quantity']) !== quantity) throw new TypeError('Quantity mismatch');
    const cycle = get(price, mode, 'billing_cycle', 'billingCycle');
    const billingCycle = nullable(cycle, mode, true, value => { const current = record(value); return { interval: text(current['interval']), frequency: positiveInteger(current['frequency']) }; });
    const itemProration = proration(item['proration'], mode), lineProration = proration(line['proration'], mode);
    const combinedProration: Field<boolean> = itemProration.presence === 'known' && lineProration.presence === 'known'
      ? known(itemProration.value || lineProration.value, itemProration.provenance === 'schema_assumed_null' || lineProration.provenance === 'schema_assumed_null') : unknown();
    return {
      providerLineRef, providerPriceRef, quantity,
      amount: exactMoney(record(line['totals'])['total'], code), billingCycle,
      trial: nonTrial(get(price, mode, 'trial_period', 'trialPeriod'), mode), proration: combinedProration,
      period: nullable(get(data, mode, 'billing_period', 'billingPeriod'), mode, false, value => period(value, mode)),
    };
  });
}

function intentCorrelation(data: RecordValue, mode: Mode, scope: PaymentScope): Field<string | null> {
  const custom = get(data, mode, 'custom_data', 'customData');
  if (custom === null) return mode === 'raw' ? known(null) : unknown();
  if (custom === undefined) return unknown();
  const metadata = record(custom)['payments'];
  if (metadata === undefined) return known(null);
  const binding = record(metadata);
  if (binding['applicationId'] !== scope.applicationId || binding['paymentAccountId'] !== scope.paymentAccountId || binding['environment'] !== scope.environment) throw new TypeError('Foreign application correlation');
  return known(id(binding['intentId']));
}

export function transactionObservation(value: unknown, mode: Mode, source: EvidenceSource, scope: PaymentScope): TransactionObservation {
  const data = record(value);
  if (get(data, mode, 'collection_mode', 'collectionMode') !== 'automatic') throw new TypeError('Unsupported collection mode');
  const code = field(() => currency(get(data, mode, 'currency_code', 'currencyCode')));
  const total = field(() => {
    if (code.presence !== 'known') throw new TypeError('Missing currency');
    const totals = record(record(data['details'])['totals']);
    if (currency(get(totals, mode, 'currency_code', 'currencyCode')) !== code.value) throw new TypeError('Currency mismatch');
    return exactMoney(totals['total'], code.value);
  });
  return {
    kind: 'transaction', transactionRef: id(data['id']), version: timestamp(get(data, mode, 'updated_at', 'updatedAt')),
    status: text(data['status']), origin: field(() => text(data['origin'])),
    customerRef: nullable(get(data, mode, 'customer_id', 'customerId'), mode, false, id),
    subscriptionRef: nullable(get(data, mode, 'subscription_id', 'subscriptionId'), mode, false, id),
    intentCorrelation: intentCorrelation(data, mode, scope), currency: code, total,
    lines: field(() => { if (code.presence !== 'known') throw new TypeError('Missing currency'); return lines(data, mode, code.value); }), source,
  };
}

export function subscriptionObservation(value: unknown, mode: Mode, source: EvidenceSource): SubscriptionObservation {
  const data = record(value);
  return {
    kind: 'subscription', subscriptionRef: id(data['id']), version: timestamp(get(data, mode, 'updated_at', 'updatedAt')),
    status: field(() => text(data['status'])), customerRef: nullable(get(data, mode, 'customer_id', 'customerId'), mode, false, id),
    scheduledChange: nullable(get(data, mode, 'scheduled_change', 'scheduledChange'), mode, true, value => {
      const current = record(value); return { action: text(current['action']), effectiveAt: timestamp(get(current, mode, 'effective_at', 'effectiveAt')) };
    }),
    currentPeriod: nullable(get(data, mode, 'current_billing_period', 'currentBillingPeriod'), mode, false, value => period(value, mode)),
    priceRefs: field(() => array(data['items']).map(value => id(record(record(value)['price'])['id']))), source,
  };
}

export function adjustmentObservation(value: unknown, mode: Mode, source: EvidenceSource): AdjustmentObservation {
  const data = record(value), code = currency(get(data, mode, 'currency_code', 'currencyCode')), totals = record(data['totals']);
  if (currency(get(totals, mode, 'currency_code', 'currencyCode')) !== code) throw new TypeError('Adjustment currency mismatch');
  const allocationIds = new Set<string>();
  const allocations = array(data['items']).map(value => {
    const item = record(value), allocationId = id(item['id']);
    if (allocationIds.has(allocationId)) throw new TypeError('Duplicate adjustment item');
    allocationIds.add(allocationId);
    return { providerLineRef: id(get(item, mode, 'item_id', 'itemId')), providerAllocationRef: allocationId, type: text(item['type']),
      requestedAmount: item['amount'] === null ? null : exactMoney(item['amount'], code, true), amount: exactMoney(record(item['totals'])['total'], code, true) };
  });
  return { kind: 'adjustment', adjustmentRef: id(data['id']), transactionRef: id(get(data, mode, 'transaction_id', 'transactionId')),
    version: timestamp(get(data, mode, 'updated_at', 'updatedAt')), action: text(data['action']), status: text(data['status']), type: text(data['type']),
    amount: exactMoney(totals['total'], code, true), allocations, source };
}

/** Raw is decoded directly to preserve field presence; mapped API values carry explicit loss assumptions. */
export function normalizeObservation(value: unknown, type: string, mode: Mode, source: EvidenceSource, scope: PaymentScope): Observation {
  try {
    if (type.startsWith('transaction.')) return transactionObservation(value, mode, source, scope);
    if (type.startsWith('subscription.')) return subscriptionObservation(value, mode, source);
    if (type.startsWith('adjustment.')) return adjustmentObservation(value, mode, source);
    return { kind: 'unsupported', reason: 'unsupported_event_type', source };
  } catch {
    const data = typeof value === 'object' && value !== null && !Array.isArray(value) ? value as RecordValue : {};
    const candidate = type.startsWith('transaction.') ? data['id'] : get(data, mode, 'transaction_id', 'transactionId');
    const subscription = type.startsWith('subscription.') ? data['id'] : undefined;
    return { kind: 'unsupported', reason: 'invalid_or_unsupported_provider_shape',
      ...(typeof candidate === 'string' && candidate.length <= 256 ? { transactionRef: candidate } : {}),
      ...(typeof subscription === 'string' && subscription.length <= 256 ? { subscriptionRef: subscription } : {}), source };
  }
}
