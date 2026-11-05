import type { PaymentScope } from "@agent-teams/payments-core";
import { canonicalJson } from "@agent-teams/payments-core";
import type {
  StoreCommitResult,
  SubscriptionBinding,
  SubscriptionReclassification,
} from "@agent-teams/payments-core/store";
import type { StoredRecord, RecordKey } from "./records.js";
import { assertBatchLimit } from "./records.js";
import { committed, conflict, fenced, PaymentStoreContext } from "./store-context.js";

/** Bounded local reclassification and durable publication scheduling. */
export class PaymentReclassificationCustody {
  constructor(private readonly context: PaymentStoreContext) {}

  async processReclassification(
    scope: PaymentScope,
    bindingId: string,
    limit: number,
  ): Promise<StoreCommitResult> {
    assertBatchLimit(limit);
    return this.context.tx(scope, async (tx) => {
      if ((await this.context.records.configuration(tx, scope)).body.recoveryFenced) {
        return fenced;
      }
      const initial = await (this.context.records.read(
        tx,
        "subscriptionBindings",
        bindingId,
      ) as Promise<StoredRecord<SubscriptionBinding> | undefined>);
      const keys: RecordKey[] = [
        { kind: "subscriptionBindings", id: bindingId },
        { kind: "reclassifications", id: bindingId },
      ];
      if (initial) {
        keys.push({ kind: "guards", id: `intent:${initial.body.originatingIntentId}` });
      }
      await this.context.records.lock(tx, keys);
      const binding = await (this.context.records.read(
        tx,
        "subscriptionBindings",
        bindingId,
      ) as Promise<StoredRecord<SubscriptionBinding> | undefined>);
      const record = await (this.context.records.read(
        tx,
        "reclassifications",
        bindingId,
      ) as Promise<StoredRecord<SubscriptionReclassification> | undefined>);
      if (!record || record.body.complete) {
        return committed;
      }
      if (
        !binding ||
        binding.revision !== initial?.revision ||
        record.body.decisionRevision !== binding.body.classificationDecision?.revision
      ) {
        return conflict;
      }
      // Membership changes use the same originating-intent guard. A newly admitted member which
      // sorts behind the cursor classifies against this binding decision in its ordinary T2.
      // Selection/reselection CAS shares the binding and cursor locks, so completion cannot erase
      // a newer decision or reset. No adapter-owned business classification is performed here.
      const batch = Math.min(limit, (this.context.options.maxWorkingSetRecords ?? 128) - 3);
      const targets = await tx.query<{ id: string }>(
        `SELECT t.id FROM ${this.context.records.sql}.records b
        JOIN ${this.context.records.sql}.records t ON t.kind = 'transactions' AND t.id = b.id
        WHERE b.kind = 'bindings' AND b.body ->> 'intentId' = $1 AND ($2::text IS NULL OR t.id > $2)
        ORDER BY t.id LIMIT $3`,
        [binding.body.originatingIntentId, record.body.afterTransactionRef ?? null, batch + 1],
      );
      const refs = targets.rows.slice(0, batch).map((row) => row.id);
      const bytes = Buffer.byteLength(JSON.stringify([binding.body, record.body, refs]));
      if (bytes > (this.context.options.maxWorkingSetBytes ?? 2_097_152)) {
        throw new RangeError("Payment reclassification working set exceeds its byte bound");
      }
      await this.context.records.lock(
        tx,
        refs.map((id) => ({ kind: "transactions", id })),
      );
      // Update only publication metadata; immutable completion facts and evidence stay intact.
      await tx.query(
        `UPDATE ${this.context.records.sql}.records SET revision = revision + 1,
        body = jsonb_set(jsonb_set(body, '{revision}', to_jsonb((body ->> 'revision')::bigint + 1)), '{publicationRequired}', 'true'),
        updated_at = clock_timestamp() WHERE kind = 'transactions' AND id = ANY($1::text[])`,
        [refs],
      );
      for (const id of refs) {
        await this.context.work(tx, {
          kind: "publication",
          id: canonicalJson({ type: "transaction", id }),
        });
      }
      const last = refs.at(-1);
      const next = {
        ...record.body,
        ...(last === undefined ? {} : { afterTransactionRef: last }),
        complete: targets.rows.length <= batch,
      };
      await this.context.records.write(tx, "reclassifications", bindingId, next);
      // Pending pages preserve the claimant's deadline/revision until genuine progress settles.
      if (next.complete) {
        await this.context.work(tx, { kind: "reclassification", id: bindingId }, "complete");
      }
      return committed;
    });
  }
}
