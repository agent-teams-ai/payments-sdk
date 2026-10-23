import type { Field } from './model.js';
import { canonicalJson, exactTime } from './values.js';

export const known = <T>(field: Field<T>): field is Readonly<{ presence: 'known'; value: T; provenance?: 'observed' | 'schema_assumed_null' }> => field.presence === 'known';

export function semantic(value: unknown): unknown {
  if (Array.isArray(value)) {return value.map(semantic);}
  if (value !== null && typeof value === 'object') {return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'provenance' && key !== 'source').map(([key, item]) => [key, ((key === 'version' && 'kind' in value) || ['startsAt', 'endsAt', 'effectiveAt'].includes(key)) && typeof item === 'string' ? { seconds: exactTime(item).seconds, fraction: exactTime(item).fraction } : semantic(item)]));}
  return value;
}

function sortedCompatibleValues(values: readonly unknown[]): readonly unknown[] {
  return values.toSorted((x, y) => canonicalJson(x).localeCompare(canonicalJson(y)));
}

type ArrayAlignment = Readonly<{kind: 'unkeyed' | 'ambiguous'}> | Readonly<{kind: 'keyed'; previous: readonly unknown[]}>;
function evidenceItemId(item: unknown, key: 'providerLineRef' | 'providerPriceRef'): string | undefined {
  if (item === null || typeof item !== 'object' || !(key in item)) {return;}
  const value = (item as Record<string, unknown>)[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Price identity owns subscription items; line identity owns transaction lines and allocations.
 * Missing or duplicate identities cannot authorize combining partial values by array position. */
function alignEvidenceItems(previous: readonly unknown[], incoming: readonly unknown[]): ArrayAlignment {
  const key = (['providerLineRef', 'providerPriceRef'] as const).find(field =>
    [...previous, ...incoming].some(item => item !== null && typeof item === 'object' && field in item));
  if (key === undefined) {
    return [...previous, ...incoming].some(item => item !== null && typeof item === 'object') ? {kind: 'ambiguous'} : {kind: 'unkeyed'};
  }
  const byId = new Map<string, unknown>(), seen = new Set<string>(), ordered: unknown[] = [];
  for (const item of previous) {
    const id = evidenceItemId(item, key);
    if (id === undefined || byId.has(id)) {return {kind: 'ambiguous'};}
    byId.set(id, item);
  }
  for (const item of incoming) {
    const id = evidenceItemId(item, key);
    if (id === undefined || seen.has(id) || !byId.has(id)) {return {kind: 'ambiguous'};}
    seen.add(id); ordered.push(byId.get(id));
  }
  return seen.size === byId.size ? {kind: 'keyed', previous: ordered} : {kind: 'ambiguous'};
}

function compatibleArrays(previous: readonly unknown[], incoming: readonly unknown[]): boolean {
  if (previous.length !== incoming.length) {return false;}
  const alignment = alignEvidenceItems(previous, incoming);
  if (alignment.kind === 'ambiguous') {return canonicalJson(semantic(previous)) === canonicalJson(semantic(incoming));}
  if (alignment.kind === 'keyed') {return incoming.every((item, index) => compatible(alignment.previous[index], item));}
  return sortedCompatibleValues(previous).every((item, index) => compatible(item, sortedCompatibleValues(incoming)[index]));
}

export function compatible(a: unknown, b: unknown): boolean {
  if (a === undefined || b === undefined) {return true;}
  if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object' && 'presence' in a && 'presence' in b) {
    if (a.presence === 'unknown' || b.presence === 'unknown') {return true;}
    if ('value' in a && 'value' in b) {return compatible(a.value, b.value);}
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return compatibleArrays(a, b);
  }
  if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object') {
    const aa = a as Record<string, unknown>, bb = b as Record<string, unknown>;
    return [...new Set([...Object.keys(aa), ...Object.keys(bb)])].filter(key => key !== 'provenance' && key !== 'source').every(key => compatible(aa[key], bb[key]));
  }
  return a === b;
}

export function mergeFields<T>(oldValue: T, newValue: T): T {
  if (newValue === undefined) {return oldValue;}
  if (oldValue === undefined) {return newValue;}
  if (oldValue !== null && newValue !== null && typeof oldValue === 'object' && typeof newValue === 'object') {
    if ('presence' in oldValue && 'presence' in newValue) {
      if (newValue.presence === 'unknown') {return oldValue;}
      if (oldValue.presence === 'unknown') {return newValue;}
    }
    if (Array.isArray(oldValue) && Array.isArray(newValue)) {
      const oldItems: readonly unknown[] = oldValue, newItems: readonly unknown[] = newValue;
      const alignment = alignEvidenceItems(oldItems, newItems);
      if (alignment.kind === 'ambiguous') {
        if (canonicalJson(semantic(oldItems)) !== canonicalJson(semantic(newItems))) {throw new TypeError('Ambiguous evidence item identities');}
        return newValue;
      }
      return newItems.map((item, index) => {
        const previous = alignment.kind === 'keyed' ? alignment.previous[index] : oldItems[index];
        return previous === undefined ? item : mergeFields(previous, item);
      }) as T;
    }
    return Object.fromEntries([...new Set([...Object.keys(oldValue), ...Object.keys(newValue)])].map(key => [key, key === 'source' ? (newValue as Record<string, unknown>)[key] : mergeFields((oldValue as Record<string, unknown>)[key], (newValue as Record<string, unknown>)[key])])) as T;
  }
  return newValue;
}
