import { canonicalJson } from '@agent-teams/payments-core';
import type { PaymentReadVersion, PaymentScope } from '@agent-teams/payments-core';
import { and, eq, gt, inArray, sql } from 'drizzle-orm';
import type { PaymentSqlTransaction } from './database.js';
import { sqlIdentifier } from './database.js';
import { executePaymentStatement, paymentQueries, paymentTables, selectPaymentRows } from './schema.js';

export type OwnerConfiguration = {
  schemaVersion: number;
  scope: PaymentScope;
  consumers: string[];
  recoveryFenced: boolean;
  fenceAudits: { fenced: boolean; auditRef: string; at: string }[];
  jobTransport?: { jobSchema: string; queueName: string };
  activeRecoverySessionId?: string;
};
export type StoredRecord<T> = Readonly<{ revision: number; body: T }>;
export type RecordKey = Readonly<{ kind: string; id: string }>;
export type RecordWrite = RecordKey & Readonly<{ body: unknown }>;
export type DurableWork = Readonly<{ kind: 'inbox' | 'publication' | 'reclassification' | 'prepared' | 'unknown' | 'delivery' | 'scan'; id: string }>;
const maximumRecordSet = 512;

/** Storage details stay in the outer adapter; core sees named atomic methods and revision tokens. */
export class PaymentRecords {
  readonly sql: string;
  readonly schema: string;
  readonly tables: ReturnType<typeof paymentTables>;

  constructor(schema: string) {
    this.sql = sqlIdentifier(schema);
    this.schema = schema;
    this.tables = paymentTables(schema);
  }

  async configuration(tx: PaymentSqlTransaction, scope: PaymentScope, exclusive = false): Promise<StoredRecord<OwnerConfiguration>> {
    const table = this.tables.configuration;
    const [row] = await selectPaymentRows(tx, paymentQueries.select({ revision: table.revision, body: table.body })
      .from(table).where(eq(table.id, 'owner')).for(exclusive ? 'update' : 'share'));
    const body = row?.body as OwnerConfiguration | undefined;
    if (!row || !body || body.schemaVersion !== 1 || canonicalJson(body.scope) !== canonicalJson(scope)) {
      throw new Error('Payment scope does not own this schema');
    }
    return { revision: safeRevision(row.revision), body };
  }

  /** Missing records also have a lock, so unique creation and membership reads have no phantom gap. */
  async lock(tx: PaymentSqlTransaction, keys: readonly RecordKey[]): Promise<void> {
    const rank = (kind: string): number => kind === 'inbox' ? 0 : kind === 'versionEvidence' ? 1 : 2;
    const compareKeys = (a: RecordKey, b: RecordKey): number => {
      const left = canonicalJson([a.kind, a.id]), right = canonicalJson([b.kind, b.id]);
      return left < right ? -1 : left > right ? 1 : 0;
    };
    const ordered = [...keys].sort((a, b) => rank(a.kind) - rank(b.kind) || compareKeys(a, b));
    const names = [...new Set(ordered.map(key => canonicalJson([this.schema, key.kind, key.id])))];
    if (names.length > maximumRecordSet) {throw new RangeError('Payment transaction lock set exceeds its bound');}
    // Exact-version certification must be stable before T1 discovers its retained parent.
    // T2 uses this same inbox/version/aggregate order, avoiding an inverse parent/version wait.
    await tx.query('SELECT pg_advisory_xact_lock(hashtextextended(key, 0)) FROM (SELECT key FROM unnest($1::text[]) WITH ORDINALITY AS keys(key, position) ORDER BY position) ordered', [names]);
  }

  async read<T>(tx: PaymentSqlTransaction, kind: string, id: string): Promise<StoredRecord<T> | undefined> {
    const table = this.tables.records;
    const [row] = await selectPaymentRows(tx, paymentQueries.select({ revision: table.revision, body: table.body })
      .from(table).where(and(eq(table.kind, kind), eq(table.id, id))));
    return row ? { revision: safeRevision(row.revision), body: row.body as T } : undefined;
  }

  /** Bounded lookups for identities whose existing transaction lock phase has completed. */
  async readMany<T>(tx: PaymentSqlTransaction, kind: string, ids: readonly string[]): Promise<ReadonlyMap<string, StoredRecord<T>>> {
    const unique = [...new Set(ids)];
    if (unique.length > maximumRecordSet) {throw new RangeError('Payment record lookup set exceeds its bound');}
    if (unique.length === 0) {return new Map();}
    const table = this.tables.records;
    const rows = await selectPaymentRows(tx, paymentQueries.select({ id: table.id, revision: table.revision, body: table.body })
      .from(table).where(and(eq(table.kind, kind), inArray(table.id, unique))));
    return new Map(rows.map(row => [row.id, { revision: safeRevision(row.revision), body: row.body as T }]));
  }

  async write(tx: PaymentSqlTransaction, kind: string, id: string, body: unknown): Promise<void> {
    await this.writeMany(tx, [{ kind, id, body }]);
  }

  /** Group one input's distinct transitions; never coalesce revisions across inputs. */
  async writeMany(tx: PaymentSqlTransaction, writes: readonly RecordWrite[]): Promise<void> {
    // One locked route set plus event identity, inbox and conflicting representation.
    if (writes.length > maximumRecordSet + 3) {throw new RangeError('Payment record write set exceeds its bound');}
    if (new Set(writes.map(item => canonicalJson([item.kind, item.id]))).size !== writes.length) {
      throw new TypeError('A payment record write set cannot repeat an identity');
    }
    const table = this.tables.records;
    let rows: (typeof table.$inferInsert)[] = [];
    let batchBytes = 0;
    const flush = async (): Promise<void> => {
      if (rows.length === 0) {return;}
      await executePaymentStatement(tx, paymentQueries.insert(table).values(rows).onConflictDoUpdate({
        target: [table.kind, table.id],
        set: { revision: sql`${table.revision} + 1`, body: sql`excluded.body`, updatedAt: sql`clock_timestamp()` },
        setWhere: sql`${table.body} IS DISTINCT FROM excluded.body`,
      }));
      rows = []; batchBytes = 0;
    };
    for (const write of writes) {
      const body = JSON.stringify(write.body), bytes = body === undefined ? 0 : Buffer.byteLength(body);
      if (rows.length > 0 && (rows.length >= 100 || batchBytes + bytes > 2_097_152)) {await flush();}
      // An individual large stored body still executes singly, as write() did before.
      // Explicit jsonb parameters preserve JSON null instead of inserting SQL NULL.
      rows.push({ kind: write.kind, id: write.id, revision: '1', body: sql`${body}::jsonb` });
      batchBytes += bytes;
    }
    await flush();
  }

  async guard(tx: PaymentSqlTransaction, id: string): Promise<void> {
    const table = this.tables.records;
    await executePaymentStatement(tx, paymentQueries.insert(table).values({ kind: 'guards', id, revision: '1', body: {} })
      .onConflictDoUpdate({ target: [table.kind, table.id], set: { revision: sql`${table.revision} + 1`, updatedAt: sql`clock_timestamp()` } }));
  }

  async version(tx: PaymentSqlTransaction, item: PaymentReadVersion): Promise<number | null> {
    if (item.table === 'configuration') {
      const table = this.tables.configuration;
      const [row] = await selectPaymentRows(tx, paymentQueries.select({ revision: table.revision }).from(table).where(eq(table.id, 'owner')));
      return row ? safeRevision(row.revision) : null;
    }
    return (await this.read(tx, item.table, item.id))?.revision ?? null;
  }

  async obligation(tx: PaymentSqlTransaction, work: DurableWork, state: 'pending' | 'quarantined' | 'complete' = 'pending', reset = false): Promise<void> {
    const table = this.tables.obligations;
    await executePaymentStatement(tx, paymentQueries.insert(table).values({ kind: work.kind, id: work.id, state })
      .onConflictDoUpdate({
        target: [table.kind, table.id],
        set: {
          state: sql`excluded.state`,
          revision: sql`${table.revision} + CASE WHEN ${reset} OR ${table.state} <> excluded.state THEN 1 ELSE 0 END`,
          attempts: sql`CASE WHEN ${reset} THEN 0 ELSE ${table.attempts} END`,
          issue: sql`CASE WHEN ${reset} THEN NULL ELSE ${table.issue} END`,
          nextAttemptAt: sql`CASE WHEN ${reset} THEN clock_timestamp() WHEN excluded.state = 'pending' THEN LEAST(${table.nextAttemptAt}, clock_timestamp()) ELSE ${table.nextAttemptAt} END`,
        },
      }));
  }

  /** Configuration changes share the same owner lock and checked-out transaction. */
  async writeConfiguration(tx: PaymentSqlTransaction, body: OwnerConfiguration): Promise<void> {
    const table = this.tables.configuration;
    await executePaymentStatement(tx, paymentQueries.update(table)
      .set({ revision: sql`${table.revision} + 1`, body: sql`${JSON.stringify(body)}::jsonb` }).where(eq(table.id, 'owner')));
  }

  /** Bounded stable keyset shared by recovery scans and delivery backfills. */
  async listKeys(tx: PaymentSqlTransaction, kind: string, after: string | null, limit: number): Promise<readonly { id: string }[]> {
    const table = this.tables.records;
    return selectPaymentRows(tx, paymentQueries.select({ id: table.id }).from(table)
      .where(and(eq(table.kind, kind), after === null ? undefined : gt(table.id, after))).orderBy(table.id).limit(limit));
  }

  async pendingWork(tx: PaymentSqlTransaction, kind: DurableWork['kind'], limit: number): Promise<readonly string[]> {
    const table = this.tables.obligations;
    const rows = await selectPaymentRows(tx, paymentQueries.select({ id: table.id }).from(table)
      .where(and(eq(table.kind, kind), eq(table.state, 'pending'))).orderBy(table.nextAttemptAt, table.id).limit(limit));
    return rows.map(row => row.id);
  }
}

function safeRevision(value: string): number {
  const revision = Number(value);
  if (!Number.isSafeInteger(revision) || revision < 1) {throw new RangeError('Payment record revision exceeds the supported range');}
  return revision;
}

export function assertBatchLimit(limit: number, maximum: 100 | 200 = 100): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > maximum) {throw new RangeError(`Payment batch limit must be between 1 and ${maximum}`);}
}
