import type { PaymentScope, EvidenceMessage } from "@agent-teams/payments-core";
import type {
  StoreCommitResult,
  SubscriptionBinding,
  TransactionBinding,
  TransactionAggregate,
  SubscriptionAggregate,
  SubscriptionReclassification,
  ReductionCommit,
  Delivery,
} from "@agent-teams/payments-core/store";
import type { PaymentSqlTransaction } from "./database.js";
import type { StoredRecord, RecordKey } from "./records.js";
import type { MutableTable } from "./store-context.js";
import { canonicalJson, digest } from "@agent-teams/payments-core";
import {
  mutableTables,
  committed,
  conflict,
  fenced,
  PaymentStoreContext,
} from "./store-context.js";
type MutableWrite = {
  table: MutableTable;
  id: string;
  value: unknown;
  previous: StoredRecord<unknown> | undefined;
};

/** T2 validates the entire read set and every immutable output before any write. */
export class PaymentReductionCustody {
  private readonly context: PaymentStoreContext;
  constructor(context: PaymentStoreContext) {
    this.context = context;
  }
  commitReduction(scope: PaymentScope, commit: ReductionCommit): Promise<StoreCommitResult> {
    return this.context.tx(scope, async (tx) => {
      if ((await this.context.records.configuration(tx, scope)).body.recoveryFenced) {
        return fenced;
      }
      if (!(await this.lockAndValidate(tx, commit))) {
        return conflict;
      }
      const admitted = await this.admitNamespace(tx, commit);
      if (!admitted || !(await this.validEvidence(tx, scope, commit))) {
        return conflict;
      }
      if (admitted.create) {
        await this.context.records.write(
          tx,
          "ownerIdentity",
          "producerNamespace",
          admitted.namespace,
        );
      }
      await this.writeMutableState(tx, commit);
      for (const [id, message] of Object.entries(commit.state.evidence)) {
        await this.context.records.write(tx, "evidence", id, message);
      }
      await this.writeDeliveries(tx, commit);
      for (const issue of commit.state.issues) {
        await this.context.records.write(tx, "issues", digest(issue), { issue });
      }
      await this.schedulePublications(tx, commit);
      const receipt = commit.state.inbox[commit.inputId];
      if (receipt) {
        await this.context.work(
          tx,
          { kind: "inbox", id: commit.inputId },
          receipt.state === "pending"
            ? "pending"
            : receipt.state === "quarantined"
              ? "quarantined"
              : "complete",
        );
      }
      return committed;
    });
  }
  private async lockAndValidate(
    tx: PaymentSqlTransaction,
    commit: ReductionCommit,
  ): Promise<boolean> {
    const keys: RecordKey[] = commit.expected
      .filter((item) => item.table !== "configuration")
      .map((item) => ({ kind: item.table, id: item.id }));
    for (const table of mutableTables) {
      for (const id of Object.keys(commit.state[table])) {
        keys.push({ kind: table, id });
      }
    }
    for (const binding of Object.values(commit.state.bindings)) {
      keys.push({ kind: "guards", id: `intent:${binding.intentId}` });
    }
    for (const binding of Object.values(commit.state.subscriptionBindings)) {
      for (const ref of binding.providerSubscriptionRefs) {
        keys.push({ kind: "guards", id: `subscription:${ref}` });
      }
    }
    for (const id of Object.keys(commit.state.evidence)) {
      keys.push({ kind: "evidence", id });
    }
    await this.context.records.lock(tx, keys);
    for (const item of commit.expected) {
      if ((await this.context.records.version(tx, item)) !== item.revision) {
        return false;
      }
    }
    return true;
  }
  private async admitNamespace(
    tx: PaymentSqlTransaction,
    commit: ReductionCommit,
  ): Promise<{ namespace: string | undefined; create: boolean } | undefined> {
    const namespaces = [
      ...new Set(Object.values(commit.state.evidence).map((message) => message.producerNamespace)),
    ];
    if (namespaces.length > 1) {
      return;
    }
    const namespace = namespaces.at(0);
    let saved = (
      await (this.context.records.read(tx, "ownerIdentity", "producerNamespace") as Promise<
        StoredRecord<string> | undefined
      >)
    )?.body;
    if (namespace !== undefined && saved === undefined) {
      // Only first creation locks this immutable identity. Unrelated aggregate
      // commits retain their existing concurrency once it has been established.
      await this.context.records.lock(tx, [{ kind: "ownerIdentity", id: "producerNamespace" }]);
      saved = (
        await (this.context.records.read(tx, "ownerIdentity", "producerNamespace") as Promise<
          StoredRecord<string> | undefined
        >)
      )?.body;
    }
    if (namespace !== undefined && saved !== undefined && saved !== namespace) {
      return;
    }
    return { namespace, create: namespace !== undefined && saved === undefined };
  }
  private async validEvidence(
    tx: PaymentSqlTransaction,
    scope: PaymentScope,
    commit: ReductionCommit,
  ): Promise<boolean> {
    for (const [id, message] of Object.entries(commit.state.evidence)) {
      const { bodyDigest, ...body } = message;
      if (
        message.messageId !== id ||
        bodyDigest !== digest(body) ||
        canonicalJson(message.scope) !== canonicalJson(scope)
      ) {
        return false;
      }
      const existing = await (this.context.records.read(tx, "evidence", id) as Promise<
        StoredRecord<EvidenceMessage> | undefined
      >);
      if (existing && existing.body.bodyDigest !== message.bodyDigest) {
        return false;
      }
    }
    return true;
  }
  private async writeMutableState(
    tx: PaymentSqlTransaction,
    commit: ReductionCommit,
  ): Promise<void> {
    for (const table of mutableTables) {
      const entries: [string, unknown][] = Object.entries(commit.state[table]) as [
        string,
        unknown,
      ][];
      for (const [id, value] of entries) {
        const previous = await this.context.records.read(tx, table, id);
        const write = { table, id, value, previous };
        if (commit.heldReason !== undefined && commit.heldReason !== "") {
          await this.writeHeld(tx, write, commit);
          continue;
        }
        if (canonicalJson(previous?.body ?? null) === canonicalJson(value)) {
          continue;
        }
        await this.context.records.write(tx, table, id, value);
        await this.afterMutableWrite(tx, write, commit);
      }
    }
  }
  private async writeHeld(
    tx: PaymentSqlTransaction,
    write: MutableWrite,
    commit: ReductionCommit,
  ): Promise<void> {
    const { table, id, value, previous } = write;
    // A bounded held result updates only publication counters. Stored financial
    // history is never replaced by the partial working-set representation.
    if (table === "transactions" || table === "subscriptions") {
      const partial = value as TransactionAggregate | SubscriptionAggregate;
      if (previous) {
        await tx.query(
          `UPDATE ${this.context.records.sql}.records SET revision = revision + 1,
                  body = body || $3::jsonb, updated_at = clock_timestamp() WHERE kind = $1 AND id = $2`,
          [
            table,
            id,
            JSON.stringify({
              revision: partial.revision,
              evidenceRevision: partial.evidenceRevision,
              publicationRequired: false,
            }),
          ],
        );
      }
    } else if (table === "inbox" && id === commit.inputId) {
      await tx.query(
        `UPDATE ${this.context.records.sql}.records SET revision = revision + 1,
                body = body || $2::jsonb, updated_at = clock_timestamp() WHERE kind = 'inbox' AND id = $1`,
        [id, JSON.stringify({ state: "quarantined", issue: commit.heldReason })],
      );
    }
  }
  private async afterMutableWrite(
    tx: PaymentSqlTransaction,
    write: MutableWrite,
    commit: ReductionCommit,
  ): Promise<void> {
    const { table, id, value, previous } = write;
    if (table === "reclassifications") {
      const item = value as SubscriptionReclassification;
      const prior = previous?.body as SubscriptionReclassification | undefined;
      if (prior?.decisionRevision !== item.decisionRevision) {
        await this.context.work(
          tx,
          { kind: "reclassification", id },
          item.complete ? "complete" : "pending",
          true,
        );
      } else if (item.complete) {
        await this.context.work(tx, { kind: "reclassification", id }, "complete");
      }
    } else if (table === "transactions") {
      const intentId =
        (value as TransactionAggregate).completion?.intentId ?? commit.state.bindings[id]?.intentId;
      if (intentId !== undefined && intentId !== "") {
        await this.context.records.guard(tx, `intent:${intentId}`);
      }
    } else if (table === "bindings") {
      await this.context.records.guard(tx, `intent:${(value as TransactionBinding).intentId}`);
    } else if (table === "subscriptionBindings") {
      for (const ref of (value as SubscriptionBinding).providerSubscriptionRefs) {
        await this.context.records.guard(tx, `subscription:${ref}`);
      }
    }
  }
  private async writeDeliveries(tx: PaymentSqlTransaction, commit: ReductionCommit): Promise<void> {
    for (const [id, delivery] of Object.entries(commit.state.deliveries)) {
      const existing = await (this.context.records.read(tx, "deliveries", id) as Promise<
        StoredRecord<Delivery> | undefined
      >);
      if (!existing) {
        await this.context.records.write(tx, "deliveries", id, delivery);
      }
      await this.context.work(
        tx,
        { kind: "delivery", id },
        existing?.body.acknowledged === true ? "complete" : "pending",
      );
    }
  }
  private async schedulePublications(
    tx: PaymentSqlTransaction,
    commit: ReductionCommit,
  ): Promise<void> {
    for (const aggregate of Object.values(commit.state.transactions)) {
      await this.context.work(
        tx,
        {
          kind: "publication",
          id: canonicalJson({ type: "transaction", id: aggregate.transactionRef }),
        },
        aggregate.publicationRequired ? "pending" : "complete",
      );
    }
    for (const aggregate of Object.values(commit.state.subscriptions)) {
      await this.context.work(
        tx,
        {
          kind: "publication",
          id: canonicalJson({ type: "subscription", id: aggregate.subscriptionRef }),
        },
        aggregate.publicationRequired ? "pending" : "complete",
      );
    }
  }
}
