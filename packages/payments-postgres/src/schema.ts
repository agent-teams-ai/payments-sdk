import { sql } from 'drizzle-orm';
import { customType, integer, jsonb, pgSchema, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { QueryResultRow } from 'pg';
import type { PaymentSqlTransaction } from './database.js';
import { sqlIdentifier } from './database.js';

// pg returns int8 as text. Keep that exact representation until the adapter checks its
// supported revision range; Drizzle's number mode would silently lose bigint precision.
const revision = customType<{ data: string; driverData: string }>({ dataType: () => 'bigint' });

/** Runtime bindings for the existing schemaVersion 1. migrations.ts remains the DDL owner. */
export function paymentTables(namespace: string) {
  sqlIdentifier(namespace);
  const schema = pgSchema(namespace);
  return {
    configuration: schema.table('configuration', {
      id: text().primaryKey(),
      revision: revision().notNull(),
      body: jsonb().$type<unknown>().notNull(),
    }),
    records: schema.table('records', {
      kind: text().notNull(),
      id: text().notNull(),
      revision: revision().notNull(),
      body: jsonb().$type<unknown>().notNull(),
      updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().default(sql`clock_timestamp()`),
    }, table => [primaryKey({ columns: [table.kind, table.id] })]),
    obligations: schema.table('obligations', {
      kind: text().notNull(),
      id: text().notNull(),
      state: text({ enum: ['pending', 'quarantined', 'complete'] }).notNull().default('pending'),
      nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true, mode: 'string' }).notNull().default(sql`clock_timestamp()`),
      attempts: integer().notNull().default(0),
      issue: text(),
      revision: revision().notNull().default('1'),
    }, table => [primaryKey({ columns: [table.kind, table.id] })]),
  };
}

// The public connection-free builder compiles queries only. It cannot acquire a host
// connection or own BEGIN/COMMIT. withPaymentTransaction remains the sole T1/T2 owner.
export const paymentQueries = drizzle.mock();

type CompiledQuery = { toSQL(): { sql: string; params: unknown[] } };

/** Execute compiled Drizzle SQL through the already bounded, checked-out pg transaction. */
export async function executePaymentStatement(tx: PaymentSqlTransaction, query: CompiledQuery): Promise<void> {
  const statement = query.toSQL();
  await tx.query(statement.sql, statement.params);
}

/** Result shape follows the selected schema columns; execution keeps pg's existing parsers. */
export async function selectPaymentRows<Row extends QueryResultRow>(
  tx: PaymentSqlTransaction,
  query: CompiledQuery & { _: { result: Row[] } },
): Promise<Row[]> {
  const statement = query.toSQL();
  return (await tx.query<Row>(statement.sql, statement.params)).rows;
}
