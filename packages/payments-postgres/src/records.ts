import { canonicalJson } from '@agent-teams/payments-core';
import type { PaymentReadVersion, PaymentScope } from '@agent-teams/payments-core';
import type { PaymentSqlTransaction } from './database.js';
import { sqlIdentifier } from './database.js';

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
export type DurableWork = Readonly<{ kind: 'inbox' | 'publication' | 'prepared' | 'unknown' | 'delivery' | 'scan'; id: string }>;

/** Storage details stay in the outer adapter; core sees named atomic methods and revision tokens. */
export class PaymentRecords {
  readonly sql: string;
  readonly schema: string;

  constructor(schema: string) {
    this.sql = sqlIdentifier(schema);
    this.schema = schema;
  }

  async configuration(tx: PaymentSqlTransaction, scope: PaymentScope, exclusive = false): Promise<StoredRecord<OwnerConfiguration>> {
    const result = await tx.query<{ revision: string; body: OwnerConfiguration }>(
      `SELECT revision, body FROM ${this.sql}.configuration WHERE id = 'owner' ${exclusive ? 'FOR UPDATE' : 'FOR SHARE'}`,
    );
    const row = result.rows[0];
    if (!row || row.body.schemaVersion !== 1 || canonicalJson(row.body.scope) !== canonicalJson(scope)) {
      throw new Error('Payment scope does not own this schema');
    }
    return { revision: safeRevision(row.revision), body: row.body };
  }

  /** Missing records also have a lock, so unique creation and membership reads have no phantom gap. */
  async lock(tx: PaymentSqlTransaction, keys: readonly RecordKey[]): Promise<void> {
    const names = [...new Set(keys.map(key => canonicalJson([this.schema, key.kind, key.id])))].sort();
    if (names.length > 512) throw new RangeError('Payment transaction lock set exceeds its bound');
    // One statement avoids a round trip per key. The sorted subquery defines a common lock order.
    await tx.query('SELECT pg_advisory_xact_lock(hashtextextended(key, 0)) FROM (SELECT unnest($1::text[]) AS key ORDER BY key) ordered', [names]);
  }

  async read<T>(tx: PaymentSqlTransaction, kind: string, id: string): Promise<StoredRecord<T> | undefined> {
    const result = await tx.query<{ revision: string; body: T }>(
      `SELECT revision, body FROM ${this.sql}.records WHERE kind = $1 AND id = $2`, [kind, id],
    );
    const row = result.rows[0];
    return row ? { revision: safeRevision(row.revision), body: row.body } : undefined;
  }

  async write(tx: PaymentSqlTransaction, kind: string, id: string, body: unknown): Promise<void> {
    await tx.query(`INSERT INTO ${this.sql}.records (kind, id, revision, body) VALUES ($1, $2, 1, $3)
      ON CONFLICT (kind, id) DO UPDATE SET revision = ${this.sql}.records.revision + 1, body = EXCLUDED.body, updated_at = clock_timestamp()
      WHERE ${this.sql}.records.body IS DISTINCT FROM EXCLUDED.body`, [kind, id, JSON.stringify(body)]);
  }

  async guard(tx: PaymentSqlTransaction, id: string): Promise<void> {
    await tx.query(`INSERT INTO ${this.sql}.records (kind, id, revision, body) VALUES ('guards', $1, 1, '{}')
      ON CONFLICT (kind, id) DO UPDATE SET revision = ${this.sql}.records.revision + 1, updated_at = clock_timestamp()`, [id]);
  }

  async version(tx: PaymentSqlTransaction, item: PaymentReadVersion): Promise<number | null> {
    if (item.table === 'configuration') {
      const result = await tx.query<{ revision: string }>(`SELECT revision FROM ${this.sql}.configuration WHERE id = 'owner'`);
      return result.rows[0] ? safeRevision(result.rows[0].revision) : null;
    }
    return (await this.read(tx, item.table, item.id))?.revision ?? null;
  }

  async obligation(tx: PaymentSqlTransaction, work: DurableWork, state: 'pending' | 'quarantined' | 'complete' = 'pending'): Promise<void> {
    await tx.query(`INSERT INTO ${this.sql}.obligations (kind, id, state) VALUES ($1, $2, $3)
      ON CONFLICT (kind, id) DO UPDATE SET state = EXCLUDED.state,
      next_attempt_at = CASE WHEN EXCLUDED.state = 'pending' THEN LEAST(${this.sql}.obligations.next_attempt_at, clock_timestamp()) ELSE ${this.sql}.obligations.next_attempt_at END`,
    [work.kind, work.id, state]);
  }
}

function safeRevision(value: string): number {
  const revision = Number(value);
  if (!Number.isSafeInteger(revision) || revision < 1) throw new RangeError('Payment record revision exceeds the supported range');
  return revision;
}

export function assertBatchLimit(limit: number, maximum: 100 | 200 = 100): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > maximum) throw new RangeError(`Payment batch limit must be between 1 and ${maximum}`);
}
