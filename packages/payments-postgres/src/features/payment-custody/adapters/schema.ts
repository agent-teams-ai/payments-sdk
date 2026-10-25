import { sql } from "drizzle-orm";
import {
  customType,
  integer,
  jsonb,
  PgSchema,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pg-proxy";
import type { PaymentSqlRow, PaymentSqlTransaction } from "./database.js";
import { sqlIdentifier } from "./database.js";
// Qualified drivers return int8 as text. Keep that exact representation until the adapter checks its
// supported revision range; Drizzle's number mode would silently lose bigint precision.
const revision = customType<{ data: string; driverData: string }>({ dataType: () => "bigint" });

/** Runtime bindings for the existing schemaVersion 1. migrations.ts remains the DDL owner. */
export function paymentTables(namespace: string) {
  sqlIdentifier(namespace);
  // Always qualify the configured namespace, including 'public'. The pgSchema()
  // convenience factory rejects public and suggests unqualified tables, which would
  // make correctness depend on the borrowed host connection's search_path.
  const schema = new PgSchema(namespace, undefined);
  return {
    configuration: schema.table("configuration", {
      id: text().primaryKey(),
      revision: revision().notNull(),
      body: jsonb().$type<unknown>().notNull(),
    }),
    records: schema.table(
      "records",
      {
        kind: text().notNull(),
        id: text().notNull(),
        revision: revision().notNull(),
        body: jsonb().$type<unknown>().notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
          .notNull()
          .default(sql`clock_timestamp()`),
      },
      (table) => [primaryKey({ columns: [table.kind, table.id] })],
    ),
    obligations: schema.table(
      "obligations",
      {
        kind: text().notNull(),
        id: text().notNull(),
        state: text({ enum: ["pending", "quarantined", "complete"] })
          .notNull()
          .default("pending"),
        nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true, mode: "string" })
          .notNull()
          .default(sql`clock_timestamp()`),
        attempts: integer().notNull().default(0),
        issue: text(),
        revision: revision().notNull().default("1"),
      },
      (table) => [primaryKey({ columns: [table.kind, table.id] })],
    ),
  };
}

// The public PostgreSQL proxy builder compiles .toSQL() without loading a driver.
// Execution is forbidden: withPaymentTransaction owns the physical connection and T1/T2.
export const paymentQueries = drizzle(() =>
  Promise.reject(new Error("Payment query builder cannot execute SQL")),
);

type CompiledQuery = { toSQL: () => { sql: string; params: unknown[] } };

/** Execute compiled Drizzle SQL through the already bounded, checked-out pg transaction. */
export async function executePaymentStatement(
  tx: PaymentSqlTransaction,
  query: CompiledQuery,
): Promise<void> {
  const statement = query.toSQL();
  await tx.query(statement.sql, statement.params);
}

/** Result shape follows the selected schema columns; execution keeps the qualified driver's parsers. */
export async function selectPaymentRows<Row extends PaymentSqlRow>(
  tx: PaymentSqlTransaction,
  query: CompiledQuery & { _: { result: Row[] } },
): Promise<Row[]> {
  const statement = query.toSQL();
  return (await tx.query<Row>(statement.sql, statement.params)).rows;
}
