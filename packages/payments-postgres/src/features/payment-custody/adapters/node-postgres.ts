import type { Pool, QueryConfig, QueryResult } from "pg";
import type { PaymentPostgresDatabase, PaymentSqlResult, PaymentSqlRow } from "./database.js";
// Query promises carry observable failures; a checked-out client can also emit an error
// during restart or destruction before its pending query rejects.
function onConnectionError(): void {}

/** Borrow a host-owned node-postgres Pool, including a Drizzle node-postgres db.$client.
 * Construction is inert. This adapter never creates or ends the pool. Only node-postgres
 * is qualified; an ORM's database/transaction object is not a connection source. */
export function createNodePostgresPaymentDatabase(pool: Pool): PaymentPostgresDatabase {
  return {
    async acquire() {
      const client = await pool.connect();
      client.on("error", onConnectionError);
      let released = false;
      const removeErrorListener = (): void => {
        client.removeListener("error", onConnectionError);
      };
      return {
        // oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- The SQL caller owns the row shape, not the driver mechanism.
        async query<Row extends PaymentSqlRow = PaymentSqlRow>(
          text: string,
          values: readonly unknown[] | undefined,
          timeoutMs: number,
        ): Promise<PaymentSqlResult<Row>> {
          if (released) {
            throw new Error("Payment PostgreSQL checkout is already released");
          }
          // pg 8.23 accepts per-query query_timeout; @types/pg 8.20 omits this runtime option.
          const config: QueryConfig & { query_timeout: number } = {
            text,
            ...(values === undefined ? {} : { values: [...values] }),
            query_timeout: timeoutMs,
          };
          const result = await client.query<Row>(config);
          // Vendor maintenance/migration scripts can return several results. Keep every
          // result's rows in statement order; command metadata is not payment state.
          const results: QueryResult<Row>[] = Array.isArray(result)
            ? (result as QueryResult<Row>[])
            : [result];
          return { rows: results.flatMap((item) => item.rows) };
        },
        release() {
          if (released) {
            return;
          }
          released = true;
          client.release();
          removeErrorListener();
        },
        destroy() {
          if (released) {
            return;
          }
          released = true;
          // Keep the listener until physical close: release(true) can reject the query and
          // emit a connection error after this method returns.
          client.once("end", removeErrorListener);
          client.release(true);
        },
      };
    },
  };
}
