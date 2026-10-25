import type { PaymentJobHandlers } from "./jobs.js";
import type { AggregateIdentity, EvidenceMessage } from "@agent-teams/payments-core";
import type { SubscriptionReclassification, Delivery } from "@agent-teams/payments-core/store";
import type { StoredRecord } from "./records.js";
import { canonicalJson } from "@agent-teams/payments-core";

import { withPaymentTransaction } from "./database.js";

import type { PaymentJobNamespace, PaymentJobTransport, PaymentJobWork } from "./work-transport.js";
import { PaymentRecords } from "./records.js";

export class WorkIssue extends Error {
  readonly issue: string;
  readonly quarantine: boolean;
  constructor(issue: string, quarantine = false) {
    super(issue);
    this.issue = issue;
    this.quarantine = quarantine;
  }
}

export function isWork(value: unknown): value is PaymentJobWork {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const item = value as Partial<PaymentJobWork>;
  return (
    [
      "inbox",
      "publication",
      "reclassification",
      "prepared",
      "unknown",
      "delivery",
      "scan",
    ].includes(item.kind ?? "") &&
    typeof item.id === "string" &&
    item.id.length > 0 &&
    item.id.length <= 4_096
  );
}

export function aggregate(id: string): AggregateIdentity {
  const value: unknown = JSON.parse(id);
  if (
    value === null ||
    typeof value !== "object" ||
    !("type" in value) ||
    !("id" in value) ||
    (value.type !== "transaction" && value.type !== "subscription") ||
    typeof value.id !== "string" ||
    !value.id
  ) {
    throw new WorkIssue("invalid_publication_identity", true);
  }
  return { type: value.type, id: value.id };
}

export async function claimJobObligation(
  work: PaymentJobWork,
  readOptions: () => PaymentJobNamespace,
  readRecords: () => PaymentRecords,
  readMaxCooldown: () => number,
): Promise<Readonly<{ attempt: number; revision: string }> | undefined> {
  return withPaymentTransaction(
    readOptions().database,
    async (tx) => {
      if ((await readRecords().configuration(tx, readOptions().scope)).body.recoveryFenced) {
        return;
      }
      const row = await tx.query<{ attempts: number; revision: string }>(
        `UPDATE ${readRecords().sql}.obligations SET attempts = attempts + 1, revision = revision + 1,
        next_attempt_at = clock_timestamp() + $3 * interval '1 second'
        WHERE kind = $1 AND id = $2 AND state = 'pending' AND next_attempt_at <= clock_timestamp()
        RETURNING attempts, revision::text`,
        [work.kind, work.id, readMaxCooldown()],
      );
      const claimed = row.rows[0];
      return claimed ? { attempt: claimed.attempts, revision: claimed.revision } : undefined;
    },
    readOptions().timeouts,
  );
}

export async function deliverJobObligation(
  work: PaymentJobWork,
  installed: PaymentJobHandlers,
  readOptions: () => PaymentJobNamespace,
  readRecords: () => PaymentRecords,
  readBatch: () => number,
): Promise<boolean> {
  if (work.id.startsWith("backfill:")) {
    const consumer = work.id.slice("backfill:".length);
    const cursor = () =>
      withPaymentTransaction(
        readOptions().database,
        async (tx) => {
          await readRecords().configuration(tx, readOptions().scope);
          return (
            await (readRecords().read(tx, "backfills", consumer) as Promise<
              | StoredRecord<{
                  consumerId: string;
                  after: string | null;
                  state: "pending" | "complete";
                }>
              | undefined
            >)
          )?.body;
        },
        readOptions().timeouts,
      );
    const before = await cursor();
    await installed.store.listDeliveries(readOptions().scope, consumer, readBatch());
    return canonicalJson(before ?? null) !== canonicalJson((await cursor()) ?? null);
  }
  const target = await withPaymentTransaction(
    readOptions().database,
    async (tx) => {
      if ((await readRecords().configuration(tx, readOptions().scope)).body.recoveryFenced) {
        throw new WorkIssue("recovery_fenced");
      }
      const delivery = (
        await (readRecords().read(tx, "deliveries", work.id) as Promise<
          StoredRecord<Delivery> | undefined
        >)
      )?.body;
      if (!delivery) {
        throw new WorkIssue("missing_delivery_authority", true);
      }
      if (canonicalJson([delivery.messageId, delivery.consumerId]) !== work.id) {
        throw new WorkIssue("invalid_delivery_identity", true);
      }
      const message = (
        await (readRecords().read(tx, "evidence", delivery.messageId) as Promise<
          StoredRecord<EvidenceMessage> | undefined
        >)
      )?.body;
      if (
        !message ||
        message.messageId !== delivery.messageId ||
        canonicalJson(message.scope) !== canonicalJson(readOptions().scope)
      ) {
        throw new WorkIssue("missing_delivery_evidence", true);
      }
      return { delivery, message };
    },
    readOptions().timeouts,
  );
  if (!target.delivery.acknowledged) {
    const consume = installed.consumers?.[target.delivery.consumerId];
    if (!consume) {
      throw new WorkIssue("consumer_not_installed");
    }
    const receipt = await consume(structuredClone(target.message));
    if (
      receipt.messageId !== target.message.messageId ||
      receipt.bodyDigest !== target.message.bodyDigest
    ) {
      throw new WorkIssue("consumer_receipt_mismatch", true);
    }
  }
  const result = await installed.payments.acknowledgeDelivery(
    target.delivery.consumerId,
    target.message.messageId,
    target.message.bodyDigest,
  );
  if (result === "conflict") {
    throw new WorkIssue("delivery_ack_conflict", true);
  }
  return false;
}

export async function reclassifyJobObligation(
  id: string,
  installed: PaymentJobHandlers,
  readOptions: () => PaymentJobNamespace,
  readRecords: () => PaymentRecords,
  readBatch: () => number,
): Promise<boolean> {
  const cursor = () =>
    withPaymentTransaction(
      readOptions().database,
      async (tx) => {
        await readRecords().configuration(tx, readOptions().scope);
        return (
          await (readRecords().read(tx, "reclassifications", id) as Promise<
            StoredRecord<SubscriptionReclassification> | undefined
          >)
        )?.body;
      },
      readOptions().timeouts,
    );
  const before = await cursor();
  const result = await installed.payments.processReclassification(id, readBatch());
  if (result === "conflict" || result === "recovery_fenced") {
    throw new WorkIssue(result);
  }
  // A successful bounded page preserves the logical fault budget while more
  // pages remain, including after queue deletion and worker restart.
  return canonicalJson(before ?? null) !== canonicalJson((await cursor()) ?? null);
}

export async function repairJobObligations(
  limit: number,
  readOptions: () => PaymentJobNamespace,
  readRecords: () => PaymentRecords,
  readTransport: () => PaymentJobTransport,
): Promise<Readonly<{ enqueued: number }>> {
  return withPaymentTransaction(
    readOptions().database,
    async (tx) => {
      if ((await readRecords().configuration(tx, readOptions().scope)).body.recoveryFenced) {
        return { enqueued: 0 };
      }
      // Queue rows can all disappear. The payment-owned obligation is the only work authority.
      // Existing runnable jobs are excluded before LIMIT, so an older live job cannot starve later
      // obligations. Locking the obligation serializes competing repair replicas and admissions.
      const pending = readTransport().pendingWorkSql("o.kind", "o.id");
      const due = await tx.query<{ kind: string; id: string }>(
        `SELECT o.kind, o.id FROM ${readRecords().sql}.obligations o
        WHERE o.state = 'pending' AND o.next_attempt_at <= clock_timestamp()
        AND NOT (${pending.text})
        ORDER BY o.next_attempt_at, o.kind, o.id LIMIT $${pending.values.length + 1} FOR UPDATE OF o SKIP LOCKED`,
        [...pending.values, limit],
      );
      let enqueued = 0;
      for (const work of due.rows) {
        if (!isWork(work)) {
          await tx.query(
            `UPDATE ${readRecords().sql}.obligations SET state = 'quarantined', issue = 'unsupported_work_kind' WHERE kind = $1 AND id = $2`,
            [work.kind, work.id],
          );
          continue;
        }
        if (await readTransport().enqueue(work, tx)) {
          enqueued += 1;
        }
      }
      return { enqueued };
    },
    readOptions().timeouts,
  );
}
