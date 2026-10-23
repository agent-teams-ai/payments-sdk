import type { Field } from './model.js';
import { canonicalJson, exactTime } from './values.js';

export const known = <T>(field: Field<T>): field is Readonly<{ presence: 'known'; value: T; provenance?: 'observed' | 'schema_assumed_null' }> => field.presence === 'known';

export function semantic(value: unknown): unknown {
  if (Array.isArray(value)) {return value.map(semantic);}
  if (value !== null && typeof value === 'object') {return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'provenance' && key !== 'source').map(([key, item]) => [key, ((key === 'version' && 'kind' in value) || ['startsAt', 'endsAt', 'effectiveAt'].includes(key)) && typeof item === 'string' ? { seconds: exactTime(item).seconds, fraction: exactTime(item).fraction } : semantic(item)]));}
  return value;
}

function sortedCompatibleValues(values: readonly unknown[]): readonly unknown[] {
  return values.toSorted((x, y) => canonicalJson(x !== null && typeof x === 'object' && 'providerLineRef' in x ? x.providerLineRef : x).localeCompare(canonicalJson(y !== null && typeof y === 'object' && 'providerLineRef' in y ? y.providerLineRef : y)));
}

export function compatible(a: unknown, b: unknown): boolean {
  if (a === undefined || b === undefined) {return true;}
  if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object' && 'presence' in a && 'presence' in b) {
    if (a.presence === 'unknown' || b.presence === 'unknown') {return true;}
    if ('value' in a && 'value' in b) {return compatible(a.value, b.value);}
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {return false;}
    return sortedCompatibleValues(a).every((item, index) => compatible(item, sortedCompatibleValues(b)[index]));
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
      return newItems.map((item, index) => {
        const previous = item !== null && typeof item === 'object' && 'providerLineRef' in item ? oldItems.find(entry => entry !== null && typeof entry === 'object' && 'providerLineRef' in entry && entry.providerLineRef === item.providerLineRef) : oldItems[index];
        return previous === undefined ? item : mergeFields(previous, item);
      }) as T;
    }
    return Object.fromEntries([...new Set([...Object.keys(oldValue), ...Object.keys(newValue)])].map(key => [key, key === 'source' ? (newValue as Record<string, unknown>)[key] : mergeFields((oldValue as Record<string, unknown>)[key], (newValue as Record<string, unknown>)[key])])) as T;
  }
  return newValue;
}
