import type { Pool, PoolClient, QueryConfig, QueryResult, QueryResultRow } from 'pg';

/** The caller owns the Pool. This package never calls Pool.end(). */
export type DatabaseTimeouts = Readonly<{
  acquireMs: number;
  lockMs: number;
  statementMs: number;
  transactionMs: number;
  deadlineMs: number;
}>;

export const defaultDatabaseTimeouts: DatabaseTimeouts = Object.freeze({
  acquireMs: 500,
  lockMs: 500,
  statementMs: 1_500,
  transactionMs: 2_500,
  deadlineMs: 3_500,
});

export class PaymentDatabaseError extends Error {
  readonly kind: 'acquisition_timeout' | 'transaction_timeout' | 'commit_unknown' | 'durability_profile';

  constructor(kind: PaymentDatabaseError['kind'], options?: ErrorOptions) {
    super(`Payment database ${kind}`, options);
    this.name = 'PaymentDatabaseError';
    this.kind = kind;
  }
}

export interface PaymentSqlTransaction {
  query<R extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]): Promise<QueryResult<R>>;
}

export interface PaymentSqlExecutor {
  executeSql(text: string, values?: unknown[]): Promise<{ rows: QueryResultRow[] }>;
}

/** SQL identifiers are configuration, never request data. Limit prevents PostgreSQL name truncation. */
export function sqlIdentifier(value: string): string {
  if (!/^[a-z][a-z0-9_]{0,47}$/.test(value)) throw new TypeError('Invalid payment schema or role identifier');
  return `"${value}"`;
}

function validateTimeouts(value: DatabaseTimeouts): void {
  for (const timeout of Object.values(value)) {
    if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 120_000) throw new TypeError('Invalid database timeout');
  }
  if (value.acquireMs >= value.deadlineMs || value.transactionMs >= value.deadlineMs) {
    throw new TypeError('Database deadline must include acquisition and transaction cleanup');
  }
}

/** A late checkout is released, so timing out while the host pool is exhausted cannot leak a slot. */
function acquire(pool: Pool, timeoutMs: number): Promise<PoolClient> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      reject(new PaymentDatabaseError('acquisition_timeout'));
    }, timeoutMs);
    timer.unref();
    pool.connect((error, client, release) => {
      if (settled) {
        if (client) release();
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else if (!client) reject(new Error('Pool returned no connection'));
      else resolve(client);
    });
  });
}

type OwnedConnection = Readonly<{
  sql: PaymentSqlTransaction;
  expired: () => boolean;
  destroy: () => void;
}>;

/** One connection ownership protocol for owner transactions and pg-boss's self-contained SQL. */
async function withPaymentConnection<T>(
  pool: Pool,
  operation: (connection: OwnedConnection) => Promise<T>,
  timeouts: DatabaseTimeouts,
): Promise<T> {
  validateTimeouts(timeouts);
  const startedAt = performance.now();
  const client = await acquire(pool, timeouts.acquireMs);
  let released = false;
  let expired = false;
  const release = (destroy: boolean): void => {
    if (released) return;
    released = true;
    client.release(destroy);
  };
  // A client checked out during a server restart may emit an error before its query rejects.
  const onError = (): void => { /* Query promises carry the observable failure. */ };
  client.on('error', onError);
  const remaining = (): number => Math.max(1, Math.floor(timeouts.deadlineMs - (performance.now() - startedAt)));
  const timer = setTimeout(() => {
    expired = true;
    release(true);
  }, remaining());
  timer.unref();
  const transaction: PaymentSqlTransaction = {
    async query<R extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]): Promise<QueryResult<R>> {
      if (expired || released) throw new PaymentDatabaseError('transaction_timeout');
      // pg 8.23 supports per-query timeout; @types/pg 8.20 omits this documented runtime option.
      const config: QueryConfig & { query_timeout: number } = { text, ...(values === undefined ? {} : { values: [...values] }), query_timeout: remaining() };
      return client.query<R>(config);
    },
  };
  try {
    return await operation({ sql: transaction, expired: () => expired, destroy: () => release(true) });
  } finally {
    clearTimeout(timer);
    release(false);
    client.removeListener('error', onError);
  }
}

/**
 * A deadline owns the checked-out connection and destroys it on expiration. It covers BEGIN,
 * statements, COMMIT and cleanup, rather than abandoning a live transaction with Promise.race.
 * A failed COMMIT is always unknown to the caller and cannot authorize an external dispatch.
 */
export async function withPaymentTransaction<T>(
  pool: Pool,
  operation: (transaction: PaymentSqlTransaction) => Promise<T>,
  timeouts: DatabaseTimeouts = defaultDatabaseTimeouts,
): Promise<T> {
  return withPaymentConnection(pool, async connection => {
    const transaction = connection.sql;
    let phase: 'begin' | 'work' | 'commit' | 'done' = 'begin';
    try {
    await transaction.query('BEGIN');
    await transaction.query(
      "SELECT set_config('synchronous_commit', 'on', true), set_config('lock_timeout', $1, true), set_config('statement_timeout', $2, true), set_config('transaction_timeout', $3, true)",
      [`${timeouts.lockMs}ms`, `${timeouts.statementMs}ms`, `${timeouts.transactionMs}ms`],
    );
    phase = 'work';
    const result = await operation(transaction);
    phase = 'commit';
    await transaction.query('COMMIT');
    if (connection.expired()) throw new PaymentDatabaseError('commit_unknown');
    phase = 'done';
    return result;
  } catch (error) {
    if (phase === 'commit') {
      connection.destroy();
      throw new PaymentDatabaseError('commit_unknown', { cause: error });
    }
    if (!connection.expired()) {
      try { await transaction.query('ROLLBACK'); }
      catch { connection.destroy(); }
    }
    if (connection.expired()) throw new PaymentDatabaseError('transaction_timeout', { cause: error });
    throw error;
    }
  }, timeouts);
}

/**
 * pg-boss migrations and maintenance issue SQL scripts containing their own BEGIN/COMMIT.
 * Session settings cover those scripts without nesting transactions. Previous host settings
 * are restored before a healthy connection returns to the borrowed pool; failed scripts destroy
 * only their checkout, so no open transaction or weakened durability can leak to a sibling.
 */
export function createPaymentSqlExecutor(pool: Pool, timeouts: DatabaseTimeouts = defaultDatabaseTimeouts): PaymentSqlExecutor {
  validateTimeouts(timeouts);
  return {
    executeSql(text, values) {
      return withPaymentConnection(pool, async connection => {
        const sql = connection.sql;
        try {
          const previous = (await sql.query<{ sync: string; lock: string; statement: string; transaction: string }>(
            "SELECT current_setting('synchronous_commit') AS sync, current_setting('lock_timeout') AS lock, current_setting('statement_timeout') AS statement, current_setting('transaction_timeout') AS transaction",
          )).rows[0];
          if (!previous) throw new Error('PostgreSQL session settings are unavailable');
          const configure = "SELECT set_config('synchronous_commit', $1, false), set_config('lock_timeout', $2, false), set_config('statement_timeout', $3, false), set_config('transaction_timeout', $4, false)";
          await sql.query(configure, ['on', `${timeouts.lockMs}ms`, `${timeouts.statementMs}ms`, `${timeouts.transactionMs}ms`]);
          const result = await sql.query(text, values);
          await sql.query(configure, [previous.sync, previous.lock, previous.statement, previous.transaction]);
          // pg-boss's maintenance and migration scripts inspect rows from multiple statements.
          // Match its documented custom Db behavior and preserve every result row in order.
          const rows: QueryResultRow[] = Array.isArray(result)
            ? (result as QueryResult[]).flatMap(item => item.rows ?? []) : result.rows;
          return { rows };
        } catch (error) {
          connection.destroy();
          throw error;
        }
      }, timeouts);
    },
  };
}

export async function assertPostgresDurability(pool: Pool, schema: string): Promise<void> {
  const quoted = sqlIdentifier(schema);
  await withPaymentTransaction(pool, async tx => {
    const result = await tx.query<{ version: string; fsync: string; wal: string }>(
      "SELECT current_setting('server_version_num') AS version, current_setting('fsync') AS fsync, current_setting('wal_level') AS wal",
    );
    const settings = result.rows[0];
    if (!settings || Number(settings.version) < 180_000 || Number(settings.version) >= 190_000 || settings.fsync !== 'on' || settings.wal === 'minimal') {
      throw new PaymentDatabaseError('durability_profile');
    }
    const unlogged = await tx.query<{ relation: string }>(
      'SELECT c.relname AS relation FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = $1 AND c.relpersistence <> $2 AND c.relkind IN ($3, $4)',
      [schema, 'p', 'r', 'p'],
    );
    if (unlogged.rows.length > 0) throw new PaymentDatabaseError('durability_profile');
    await tx.query(`SELECT 1 FROM ${quoted}.configuration WHERE id = 'owner'`);
  });
}
