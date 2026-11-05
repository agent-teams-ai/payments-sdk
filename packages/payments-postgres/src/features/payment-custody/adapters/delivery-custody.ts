import type { EvidenceMessage, PaymentScope } from "@agent-teams/payments-core";
import { canonicalJson } from "@agent-teams/payments-core";
import type { Delivery } from "@agent-teams/payments-core/store";
import type { StoredRecord } from "./records.js";
import { assertBatchLimit } from "./records.js";
import { PaymentStoreContext } from "./store-context.js";

/** Consumer registration, bounded backfill and ACK share payment-owned SQL custody. */
export class PaymentDeliveryCustody {
  private readonly context: PaymentStoreContext;
  constructor(context: PaymentStoreContext) {
    this.context = context;
  }

  async registerConsumer(
    scope: PaymentScope,
    consumerId: string,
    backfill: boolean,
  ): Promise<void> {
    if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(consumerId)) {
      throw new TypeError("Invalid consumer identity");
    }
    await this.context.tx(scope, async (tx) => {
      const config = await this.context.records.configuration(tx, scope, true);
      if (!config.body.consumers.includes(consumerId)) {
        if (config.body.consumers.length >= 32) {
          throw new RangeError("Consumer target bound exceeded");
        }
        config.body.consumers.push(consumerId);
        await this.context.records.writeConfiguration(tx, config.body);
      }
      if (backfill) {
        // Bounded batches are resumed by a durable cursor, never a single unbounded transaction.
        await this.context.records.write(tx, "backfills", consumerId, {
          consumerId,
          after: null,
          state: "pending",
        });
        await this.context.records.obligation(tx, {
          kind: "delivery",
          id: `backfill:${consumerId}`,
        });
      }
    });
    if (backfill) {
      await this.backfillConsumer(scope, consumerId);
    }
  }
  async backfillConsumer(scope: PaymentScope, consumerId: string): Promise<void> {
    await this.context.tx(scope, async (tx) => {
      await this.context.records.configuration(tx, scope);
      await this.context.records.lock(tx, [{ kind: "backfills", id: consumerId }]);
      const cursor = (
        await (this.context.records.read(tx, "backfills", consumerId) as Promise<
          | StoredRecord<{
              consumerId: string;
              after: string | null;
              state: "pending" | "complete";
            }>
          | undefined
        >)
      )?.body;
      if (!cursor || cursor.state === "complete") {
        return;
      }
      const messages = await this.context.records.listKeys(tx, "evidence", cursor.after, 100);
      // ACK owns the same delivery lock. Read its state only after locking the page,
      // so a concurrent committed ACK cannot be reopened by stale backfill state.
      await this.context.records.lock(
        tx,
        messages.map((row) => ({ kind: "deliveries", id: canonicalJson([row.id, consumerId]) })),
      );
      for (const row of messages) {
        const id = canonicalJson([row.id, consumerId]);
        const existing = await (this.context.records.read(tx, "deliveries", id) as Promise<
          StoredRecord<Delivery> | undefined
        >);
        if (!existing) {
          await this.context.records.write(tx, "deliveries", id, {
            consumerId,
            messageId: row.id,
            acknowledged: false,
            attempts: 0,
          });
        }
        await this.context.work(
          tx,
          { kind: "delivery", id },
          existing?.body.acknowledged === true ? "complete" : "pending",
        );
      }
      const last = messages.at(-1)?.id;
      await this.context.records.write(tx, "backfills", consumerId, {
        consumerId,
        after: last ?? cursor.after,
        state: messages.length < 100 ? "complete" : "pending",
      });
      await this.context.records.obligation(
        tx,
        { kind: "delivery", id: `backfill:${consumerId}` },
        messages.length < 100 ? "complete" : "pending",
      );
    });
  }
  async listDeliveries(
    scope: PaymentScope,
    consumerId: string,
    limit: number,
  ): Promise<readonly EvidenceMessage[]> {
    assertBatchLimit(limit);
    await this.backfillConsumer(scope, consumerId);
    return this.context.tx(scope, async (tx) => {
      const config = await this.context.records.configuration(tx, scope);
      if (config.body.recoveryFenced || !config.body.consumers.includes(consumerId)) {
        return [];
      }
      const messages = await tx.query<{ body: EvidenceMessage }>(
        `SELECT e.body FROM ${this.context.records.sql}.records d
        JOIN ${this.context.records.sql}.records e ON e.kind = 'evidence' AND e.id = d.body ->> 'messageId'
        WHERE d.kind = 'deliveries' AND d.body ->> 'consumerId' = $1 AND d.body ->> 'acknowledged' = 'false'
        ORDER BY e.updated_at, e.id LIMIT $2`,
        [consumerId, limit],
      );
      return messages.rows.map((row) => row.body);
    });
  }
  async acknowledgeDelivery(
    scope: PaymentScope,
    consumerId: string,
    messageId: string,
    bodyDigest: string,
  ): Promise<"acknowledged" | "duplicate" | "conflict"> {
    return this.context.tx(scope, async (tx) => {
      if ((await this.context.records.configuration(tx, scope)).body.recoveryFenced) {
        return "conflict";
      }
      const id = canonicalJson([messageId, consumerId]);
      await this.context.records.lock(tx, [{ kind: "deliveries", id }]);
      const delivery = (
        await (this.context.records.read(tx, "deliveries", id) as Promise<
          StoredRecord<Delivery> | undefined
        >)
      )?.body;
      const message = (
        await (this.context.records.read(tx, "evidence", messageId) as Promise<
          StoredRecord<EvidenceMessage> | undefined
        >)
      )?.body;
      if (!delivery || !message || message.bodyDigest !== bodyDigest) {
        return "conflict";
      }
      const result = delivery.acknowledged ? "duplicate" : "acknowledged";
      if (!delivery.acknowledged) {
        delivery.acknowledged = true;
        await this.context.records.write(tx, "deliveries", id, delivery);
      }
      // Reassert completion after a replay, including debt left by an older backfill.
      await this.context.work(tx, { kind: "delivery", id }, "complete");
      return result;
    });
  }
}
