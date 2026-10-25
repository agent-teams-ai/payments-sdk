import type { PaymentScope } from "@agent-teams/payments-core";
import type { DatabaseTimeouts, PaymentPostgresDatabase } from "./database.js";
import type { PaymentJobEnqueuer } from "./work-transport.js";
export type PostgresPaymentStoreOptions = Readonly<{
  database: PaymentPostgresDatabase;
  schema: string;
  scope: PaymentScope;
  timeouts?: DatabaseTimeouts;
  maxWorkingSetRecords?: number;
  maxWorkingSetBytes?: number;
  /** Optional job transport. Durable obligations remain authoritative when no worker is running. */
  queue?: PaymentJobEnqueuer;
}>;
