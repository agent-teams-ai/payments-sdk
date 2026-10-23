import { Pool } from 'pg';
import type { PoolClient } from 'pg';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { createNodePostgresPaymentDatabase } from '../../../../dist/node-postgres.js';
import { paymentQueries, paymentTables } from '../../../../dist/features/payment-custody/adapters/schema.js';
import { databaseFixture } from '../../../../dist/testing.js';
import assert from 'node:assert/strict';
import test from 'node:test';

void test('node-postgres composition reuses a Drizzle host pool and preserves result and checkout semantics', { timeout: 10_000 }, async () => {
  const f = await databaseFixture();
  const pool = new Pool({ connectionString: f.connectionString, max: 1, connectionTimeoutMillis: 1000 });
  let acquired: PoolClient | undefined;
  pool.on('acquire', client => { acquired = client; });
  try {
    const hostDatabase = drizzle({ client: pool });
    const database = createNodePostgresPaymentDatabase(hostDatabase.$client);
    assert.equal(pool.totalCount, 0, 'composing an existing Drizzle pool starts no connection');
    const connection = await database.acquire();
    assert.deepEqual(await connection.query('SELECT 9007199254740993::bigint AS revision, $1::jsonb AS body', ['{"key":null}'], 1000), {
      rows: [{ revision: '9007199254740993', body: { key: null } }],
    }, 'the driver keeps exact int8 text, decoded jsonb and rows-only results');
    assert.deepEqual(await connection.query('SELECT 1 AS position; SELECT 2 AS position', undefined, 1000), {
      rows: [{ position: 1 }, { position: 2 }],
    }, 'multi-statement results retain every row in statement order');
    connection.release(); connection.release(); connection.destroy();
    assert.equal(pool.idleCount, 1, 'repeated cleanup cannot discard an already returned checkout');

    const doomed = await database.acquire();
    const client = acquired;
    assert.ok(client);
    const checkedOutErrorListeners = client.listeners('error');
    assert.ok(checkedOutErrorListeners.length > 0);
    const ended = new Promise<void>(resolve => { client.once('end', resolve); });
    const rejected = assert.rejects(doomed.query('SELECT pg_sleep(30)', undefined, 1000));
    doomed.destroy(); doomed.destroy(); doomed.release();
    assert.ok(client.listenerCount('error') > 0, 'destroy retains an error listener until physical close');
    await Promise.all([ended, rejected]);
    assert.ok(checkedOutErrorListeners.every(listener => !client.listeners('error').includes(listener)), 'physical close releases the adapter error listener without removing the pool listener');
    assert.deepEqual((await pool.query('SELECT 1 AS alive')).rows, [{ alive: 1 }], 'destroying a checkout preserves the borrowed pool');
    assert.equal(pool.totalCount, 1); assert.equal(pool.idleCount, 1); assert.equal(pool.waitingCount, 0);
  } finally { await pool.end(); await f.close(); }
});

void test('private Drizzle compilation cannot execute outside the bounded payment connection', async () => {
  const table = paymentTables('compiler_guard').records;
  assert.deepEqual(paymentQueries.select({ id: table.id }).from(table).toSQL(), { sql: 'select "id" from "compiler_guard"."records"', params: [] });
  await assert.rejects(paymentQueries.execute(sql`SELECT 1`), (error: unknown) => error instanceof Error && error.cause instanceof Error && error.cause.message === 'Payment query builder cannot execute SQL');
});
