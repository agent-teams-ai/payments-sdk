import { createHash } from 'node:crypto';
import type { ExactTime, Money, PaymentScope, PaymentState } from './contracts.js';

export function canonicalJson(value: unknown): string {
  const visit = (input: unknown): unknown => {
    if (input === null || typeof input === 'string' || typeof input === 'boolean') return input;
    if (typeof input === 'number' && Number.isFinite(input)) return input;
    if (Array.isArray(input)) return input.map(visit);
    if (typeof input === 'object' && input !== null) return Object.fromEntries(Object.entries(input).filter(([, item]) => item !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, visit(item)]));
    throw new TypeError('Value is not canonical JSON');
  };
  return JSON.stringify(visit(value));
}
export function digest(value: unknown): string { return createHash('sha256').update(canonicalJson(value)).digest('hex'); }
export function scopeKey(scope: PaymentScope): string { return canonicalJson([scope.applicationId, scope.provider, scope.paymentAccountId, scope.environment]); }
export function sameScope(a: PaymentScope, b: PaymentScope): boolean { return scopeKey(a) === scopeKey(b); }
export function assertScope(scope: PaymentScope): void {
  for (const field of [scope.applicationId, scope.provider, scope.paymentAccountId]) assertIdentifier(field);
  if (scope.environment !== 'sandbox' && scope.environment !== 'production') throw new TypeError('Invalid environment');
}
export function assertIdentifier(value: string): void { if (typeof value !== 'string' || value.length === 0 || value.length > 256 || [...value].some(character => character.charCodeAt(0) < 32)) throw new TypeError('Invalid bounded identifier'); }
export function money(currency: string, minorUnits: string): Money {
  if (!/^[A-Z]{3}$/u.test(currency) || !/^-?(0|[1-9][0-9]{0,77})$/u.test(minorUnits) || minorUnits === '-0') throw new TypeError('Invalid exact money');
  return Object.freeze({ currency, minorUnits });
}
export function addMoney(a: Money, b: Money): Money {
  money(a.currency, a.minorUnits); money(b.currency, b.minorUnits);
  if (a.currency !== b.currency) throw new TypeError('Cannot add different currencies');
  return money(a.currency, (BigInt(a.minorUnits) + BigInt(b.minorUnits)).toString());
}
/** Exact RFC3339 ordering, preserving 0..9 fractional digits; leap seconds are unsupported. */
export function exactTime(input: string): ExactTime {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/u.exec(input);
  if (!match) throw new TypeError('Unsupported RFC3339 timestamp');
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fractionText, zone] = match;
  const year = Number(yearText), month = Number(monthText), day = Number(dayText), hour = Number(hourText), minute = Number(minuteText), second = Number(secondText);
  if (hour > 23 || minute > 59 || second > 59 || month < 1 || month > 12 || day < 1 || day > 31) throw new TypeError('Invalid timestamp component');
  const date = new Date(0); date.setUTCFullYear(year, month - 1, day); date.setUTCHours(hour, minute, second, 0);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) throw new TypeError('Invalid calendar date');
  let offset = 0;
  if (zone !== 'Z' && zone !== undefined) {
    const zh = Number(zone.slice(1, 3)), zm = Number(zone.slice(4, 6));
    if (zh > 23 || zm > 59 || zone === '-00:00') throw new TypeError('Invalid or unknown timezone');
    offset = (zh * 3600 + zm * 60) * (zone[0] === '+' ? 1 : -1);
  }
  return Object.freeze({ original: input, seconds: (BigInt(date.getTime() / 1000) - BigInt(offset)).toString(), fraction: (fractionText ?? '').padEnd(9, '0') });
}
export function compareTime(a: string, b: string): -1 | 0 | 1 {
  const x = exactTime(a), y = exactTime(b), xs = BigInt(x.seconds), ys = BigInt(y.seconds);
  if (xs !== ys) return xs < ys ? -1 : 1;
  return x.fraction === y.fraction ? 0 : x.fraction < y.fraction ? -1 : 1;
}
export function createEmptyPaymentState(): PaymentState {
  return { revision: 0, recoveryFenced: false, intents: {}, operations: {}, requestKeys: {}, bindings: {}, subscriptionBindings: {}, transactions: {}, subscriptions: {}, inbox: {}, evidence: {}, deliveries: {}, consumers: [], scans: {}, issues: [] };
}
