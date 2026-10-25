import type { PaymentScope } from "@agent-teams/payments-core";
import type { EventIdentityEvidence } from "@agent-teams/payments-core/store";
import type { PaymentSqlTransaction } from "./database.js";
import type { DurableWork } from "./records.js";
import type { PostgresPaymentStoreOptions } from "./store-contracts.js";
import { canonicalJson } from "@agent-teams/payments-core";
import { withPaymentTransaction } from "./database.js";
import { PaymentRecords } from "./records.js";
export const mutableTables = [
  "intents",
  "operations",
  "bindings",
  "subscriptionBindings",
  "reclassifications",
  "transactions",
  "subscriptions",
  "inbox",
  "versionEvidence",
] as const;
export type MutableTable = (typeof mutableTables)[number];
export type Lane = {
  revision: number;
  unresolvedOperationId?: string;
  recoveryReviewRequired?: string;
};
export type StoredEventIdentity = { evidence: EventIdentityEvidence; conflict: boolean };
export const committed = { kind: "committed" } as const;
export const conflict = { kind: "conflict" } as const;
export const fenced = { kind: "recovery_fenced" } as const;
/** Payment-local transaction and scheduling mechanics, shared by its named custody steps. */
export class PaymentStoreContext {
  readonly options: PostgresPaymentStoreOptions;
  readonly records: PaymentRecords;
  constructor(options: PostgresPaymentStoreOptions) {
    if (
      options.queue &&
      (options.queue.namespace.paymentSchema !== options.schema ||
        canonicalJson(options.queue.namespace.scope) !== canonicalJson(options.scope))
    ) {
      throw new Error("Payment store transport namespace mismatch");
    }
    this.options = options;
    this.records = new PaymentRecords(options.schema);
    const maxRecords = options.maxWorkingSetRecords ?? 128;
    const maxBytes = options.maxWorkingSetBytes ?? 2_097_152;
    if (
      !Number.isInteger(maxRecords) ||
      maxRecords < 16 ||
      maxRecords > 256 ||
      !Number.isInteger(maxBytes) ||
      maxBytes < 4_096 ||
      maxBytes > 16_777_216
    ) {
      throw new RangeError("Invalid payment working-set bounds");
    }
  }
  async tx<T>(scope: PaymentScope, action: (tx: PaymentSqlTransaction) => Promise<T>): Promise<T> {
    if (canonicalJson(scope) !== canonicalJson(this.options.scope)) {
      throw new Error("Payment store scope mismatch");
    }
    return withPaymentTransaction(this.options.database, action, this.options.timeouts);
  }
  async work(
    tx: PaymentSqlTransaction,
    work: DurableWork,
    state: "pending" | "quarantined" | "complete" = "pending",
    reset = false,
  ): Promise<void> {
    await this.records.obligation(tx, work, state, reset);
    if (state === "pending" && this.options.queue) {
      await this.options.queue.enqueue(work, tx);
    }
  }
}
