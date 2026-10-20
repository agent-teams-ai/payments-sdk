import type { PaymentScope, PaymentStore, ReconciliationQuery, ScanCheckpoint, ScanReadFailure, VerifiedInput } from './contracts.js';
import { assertIdentifier, assertScope, canonicalJson, compareTime, digest, exactTime, sameScope } from './values.js';

/** One public acquisition call. A failed SDK collection must never be reused by the source. */
export type ReconciliationPage = Readonly<{ kind: 'page'; inputs: readonly VerifiedInput[]; hasMore: boolean; lastId?: string; ids?: readonly string[] }> |
  Readonly<{ kind: 'failed'; reason: string; sdkVersion?: string; code?: string }>;
export interface ReconciliationSource {
  readonly scope: PaymentScope;
  readPage(query: ReconciliationQuery, after: string | undefined, epoch: string): Promise<ReconciliationPage>;
}
export type ScanResult = Readonly<{ kind: 'saved'; checkpoint: ScanCheckpoint; admitted: number }> |
  Readonly<{ kind: 'missing' | 'conflict' | 'recovery_fenced' }>;
export type ReconciliationCoverage = Readonly<{
  status: 'queries_exhausted' | 'incomplete'; historyComplete: false;
  /** Provider availability/visibility and missing history remain separate from query exhaustion. */
  limitations: readonly string[];
  scans: readonly Readonly<{ scanId: string; status: ScanCheckpoint['status'] | 'missing'; issue?: string }>[];
}>;
export type PaymentReconcilerOptions = Readonly<{ scope: PaymentScope; store: PaymentStore; source: ReconciliationSource; now?: () => string; maxWindowMilliseconds?: number }>;

export function reconciliationFingerprint(scope: PaymentScope, epoch: string, query: ReconciliationQuery): string { return digest([scope, epoch, query]); }
function validateQuery(query: ReconciliationQuery, maxWindow: number): void {
  assertIdentifier(query.queryVersion);
  const kind: unknown = query.kind;
  if (kind !== 'events' && kind !== 'adjustments') {throw new TypeError('Unsupported reconciliation query');}
  if (query.kind === 'events') {
    exactTime(query.from); exactTime(query.to);
    if (compareTime(query.from, query.to) >= 0 || Date.parse(query.to) - Date.parse(query.from) > maxWindow) {throw new RangeError('Invalid bounded event window');}
    if (query.eventType !== undefined) {assertIdentifier(query.eventType);}
    if (!['catch_up', 'retention_sweep'].includes(query.purpose)) {throw new TypeError('Invalid scan purpose');}
    if (!Number.isInteger(query.perPage) || query.perPage < 1 || query.perPage > 200) {throw new RangeError('Invalid page bound');}
  } else {assertIdentifier(query.transactionRef);}
}
function validateInput(scope: PaymentScope, input: VerifiedInput): void {
  assertIdentifier(input.inputId);
  if (!sameScope(scope, input.scope) || input.source.kind !== 'authenticated_api' || input.inputId !== input.source.receiptId ||
    canonicalJson(input.source) !== canonicalJson(input.observation.source) || digest(input.retainedRepresentation) !== input.source.representationDigest) {throw new TypeError('Invalid acquired receipt custody');}
}
function validatePage(scope: PaymentScope, checkpoint: ScanCheckpoint, page: Extract<ReconciliationPage, { kind: 'page' }>): void {
  const query = checkpoint.query;
  if (!query) {throw new TypeError('Missing durable query');}
  const bound = query.kind === 'events' ? query.perPage : 200;
  if (typeof page.hasMore !== 'boolean' || page.inputs.length > bound || page.inputs.length === 0 && page.hasMore) {throw new TypeError('Invalid bounded page');}
  if (page.ids !== undefined && page.ids.length !== page.inputs.length) {throw new TypeError('Page ID count mismatch');}
  let previous = checkpoint.after;
  for (const [index, input] of page.inputs.entries()) {
    validateInput(scope, input);
    const observationId = query.kind === 'events' ? input.source.eventId : input.observation.kind === 'adjustment' ? input.observation.adjustmentRef : undefined;
    const id = page.ids?.[index] ?? observationId;
    if (observationId !== undefined && id !== observationId) {throw new TypeError('Page ID contradicts observation');}
    if (!(typeof id === 'string' && id.length > 0) || previous !== undefined && id <= previous) {throw new TypeError('Nonprogressing page');}
    assertIdentifier(id); previous = id;
    if (query.kind === 'events' && (input.source.eventType === undefined || query.eventType !== undefined && input.source.eventType !== query.eventType)) {throw new TypeError('Event type mismatch');}
    if (query.kind === 'adjustments' && ((input.observation.kind !== 'adjustment' && input.observation.kind !== 'unsupported') || input.observation.transactionRef !== query.transactionRef || input.adverseTransactionRef !== query.transactionRef)) {throw new TypeError('Adjustment subject mismatch');}
  }
  if (page.lastId !== previous) {throw new TypeError('Page cursor does not describe all acquired inputs');}
}

/** Durable scans perform one bounded read per resume; the host owns scheduling and concurrency. */
export function createPaymentReconciler(options: PaymentReconcilerOptions) {
  const { store, source } = options, scope = structuredClone(options.scope), now = options.now ?? (() => new Date().toISOString());
  assertScope(scope);
  if (!sameScope(scope, source.scope)) {throw new TypeError('Reconciliation source scope mismatch');}
  const maxWindow = options.maxWindowMilliseconds ?? 90 * 24 * 60 * 60 * 1000;
  if (!Number.isSafeInteger(maxWindow) || maxWindow < 1) {throw new RangeError('Invalid scan window bound');}
  function validateCheckpoint(checkpoint: ScanCheckpoint): void {
    assertIdentifier(checkpoint.scanId); assertIdentifier(checkpoint.epoch);
    if (!checkpoint.query || checkpoint.queryFingerprint !== reconciliationFingerprint(scope, checkpoint.epoch, checkpoint.query)) {throw new TypeError('Missing or mismatched immutable scan query');}
    validateQuery(checkpoint.query, maxWindow);
  }
  async function save(expected: ScanCheckpoint | undefined, next: ScanCheckpoint, inputs: readonly VerifiedInput[] = []): Promise<ScanResult> {
    const result = await store.commitScanPage(scope, expected, next, inputs);
    return result.kind === 'committed' ? { kind: 'saved', checkpoint: structuredClone(next), admitted: inputs.length } : result;
  }
  async function read(scan: string | ScanCheckpoint): Promise<ScanCheckpoint | undefined> {
    const id = typeof scan === 'string' ? scan : scan.scanId; assertIdentifier(id);
    const current = await store.readCheckpoint(scope, id);
    // A caller holding an old epoch/query/cursor cannot accidentally resume a replacement scan.
    if (current && typeof scan !== 'string' && canonicalJson(current) !== canonicalJson(scan)) {return;}
    return current;
  }
  async function beginScan(input: Readonly<{ scanId: string; epoch: string; query: ReconciliationQuery }>): Promise<ScanResult> {
    const query = structuredClone(input.query);
    const next: ScanCheckpoint = { scanId: input.scanId, epoch: input.epoch, query, queryFingerprint: reconciliationFingerprint(scope, input.epoch, query), status: 'running' };
    validateCheckpoint(next);
    const prior = await store.readCheckpoint(scope, next.scanId);
    if (prior) {return prior.epoch === next.epoch && prior.queryFingerprint === next.queryFingerprint ? { kind: 'saved', checkpoint: prior, admitted: 0 } : { kind: 'conflict' };}
    // The durable checkpoint/work obligation exists before any network read.
    return save(undefined, next);
  }
  async function resumeScan(scan: string | ScanCheckpoint): Promise<ScanResult> {
    const checkpoint = await read(scan);
    if (!checkpoint) {return { kind: 'missing' };}
    validateCheckpoint(checkpoint);
    if (checkpoint.status !== 'running') {return { kind: 'saved', checkpoint, admitted: 0 };}
    let page: ReconciliationPage;
    try { page = await source.readPage(structuredClone(checkpoint.query!), checkpoint.after, checkpoint.epoch); }
    catch { page = { kind: 'failed', reason: 'source_read_failed' }; }
    if (page.kind === 'page') {
      try { validatePage(scope, checkpoint, page); }
      catch { page = { kind: 'failed', reason: 'invalid_acquired_page' }; }
    }
    if (page.kind === 'failed') {
      assertIdentifier(page.reason); const at = now(); exactTime(at);
      const lastFailure: ScanReadFailure = { at, reason: page.reason, ...(checkpoint.after === undefined ? {} : { after: checkpoint.after }), ...(page.sdkVersion === undefined ? {} : { sdkVersion: page.sdkVersion }), ...(page.code === undefined ? {} : { code: page.code }) };
      return save(checkpoint, { ...checkpoint, status: 'gap', issue: page.reason, failureCount: (checkpoint.failureCount ?? 0) + 1, lastFailure });
    }
    return save(checkpoint, { ...checkpoint, ...(page.lastId === undefined ? {} : { after: page.lastId }), status: page.hasMore ? 'running' : 'complete' }, page.inputs);
  }
  /** Explicit redrive retries the exact durable pre-page cursor, including after SDK mapping failure. */
  async function retryScan(scan: string | ScanCheckpoint): Promise<ScanResult> {
    const checkpoint = await read(scan);
    if (!checkpoint) {return { kind: 'missing' };}
    validateCheckpoint(checkpoint);
    if (checkpoint.status !== 'gap') {return { kind: 'saved', checkpoint, admitted: 0 };}
    const { issue: _issue, ...rest } = checkpoint;
    return save(checkpoint, { ...rest, status: 'running' });
  }
  async function coverage(input: Readonly<{ scanIds: readonly string[]; requiredEventTypes?: readonly string[]; from?: string; to?: string; historyAvailableFrom?: string }>): Promise<ReconciliationCoverage> {
    if (input.scanIds.length < 1 || input.scanIds.length > 100 || new Set(input.scanIds).size !== input.scanIds.length) {throw new RangeError('Invalid coverage scan bound');}
    if ((input.from === undefined) !== (input.to === undefined)) {throw new TypeError('Incomplete coverage window');}
    if (input.from !== undefined && input.to !== undefined && compareTime(input.from, input.to) >= 0) {throw new TypeError('Invalid coverage window');}
    const checkpoints = await Promise.all(input.scanIds.map(async id => { assertIdentifier(id); return store.readCheckpoint(scope, id); }));
    const limitations = ['query_exhaustion_does_not_prove_complete_history', 'provider_visibility_has_no_assumed_absolute_bound'];
    let exhausted = checkpoints.every(checkpoint => checkpoint?.status === 'complete');
    for (const eventType of input.requiredEventTypes ?? []) {
      assertIdentifier(eventType);
      const windows = checkpoints.flatMap(checkpoint => checkpoint?.status === 'complete' && checkpoint.query?.kind === 'events' && checkpoint.query.eventType === eventType ? [checkpoint.query] : []).toSorted((a, b) => compareTime(a.from, b.from));
      if (input.from === undefined || input.to === undefined) {throw new TypeError('Required event coverage needs a fixed window');}
      let through = input.from, started = false;
      for (const window of windows) {
        // Boundaries are exclusive: adjacent windows without overlap leave a real hole.
        if (compareTime(window.from, through) > 0 || started && compareTime(window.from, through) === 0) {break;}
        if (compareTime(window.to, through) > 0) { through = window.to; started = true; }
      }
      if (!started || compareTime(through, input.to) < 0) { exhausted = false; limitations.push(`required_event_type_not_covered:${eventType}`); }
    }
    if (input.historyAvailableFrom !== undefined) {
      exactTime(input.historyAvailableFrom);
      if (input.from !== undefined && compareTime(input.from, input.historyAvailableFrom) < 0) { exhausted = false; limitations.push('requested_history_precedes_provider_availability'); }
    }
    return { status: exhausted ? 'queries_exhausted' : 'incomplete', historyComplete: false, limitations, scans: input.scanIds.map((scanId, index) => { const checkpoint = checkpoints[index]; return { scanId, status: checkpoint?.status ?? 'missing', ...(checkpoint?.issue === undefined ? {} : { issue: checkpoint.issue }) }; }) };
  }
  return { beginScan, resumeScan, retryScan, coverage };
}

/** Adjacent exclusive windows overlap; the returned window is fixed before it is persisted. */
export function nextReconciliationWindow(input: Readonly<{ previousTo: string; to: string; overlapMilliseconds: number }>): Readonly<{ from: string; to: string }> {
  exactTime(input.previousTo); exactTime(input.to);
  if (compareTime(input.previousTo, input.to) >= 0 || !Number.isSafeInteger(input.overlapMilliseconds) || input.overlapMilliseconds < 1) {throw new RangeError('Invalid overlapping window');}
  return { from: new Date(Date.parse(input.previousTo) - input.overlapMilliseconds).toISOString(), to: input.to };
}
