import type {
  SubscriptionAggregate,
  PaymentOperation,
  IntentAdmission,
  OperationInput,
  OperationCommit,
  StoreCommitResult,
  PaymentStore,
  PurchaseIntent,
  SubscriptionBinding,
  TransactionAggregate,
  SubscriptionReclassification,
  ReductionInput,
  ReductionCommit,
} from "@agent-teams/payments-core/store";
import type {
  ScanCheckpoint,
  PaymentScope,
  JsonValue,
  AggregateIdentity,
  VerifiedInput,
  EvidenceMessage,
} from "@agent-teams/payments-core";
import type { ProviderResult } from "@agent-teams/payments-core/provider";
import type { StoredRecord, RecordKey } from "./records.js";
import type { PostgresPaymentStoreOptions } from "./store-contracts.js";
import { canonicalJson } from "@agent-teams/payments-core";
import { assertPostgresDurability } from "./database.js";
import { assertBatchLimit } from "./records.js";
import { committed, conflict, fenced, PaymentStoreContext } from "./store-context.js";
import { PaymentOperationCustody } from "./operation-custody.js";
import { PaymentInputCustody } from "./input-custody.js";
import { PaymentReductionCustody } from "./reduction-commit.js";
import { loadPaymentReductionInput } from "./reduction-working-set.js";
import { PaymentDeliveryCustody } from "./delivery-custody.js";
export type { PostgresPaymentStoreOptions } from "./store-contracts.js";

/** Factory performs read-only qualification; bootstrap remains a separate migration-role action. */
export async function createPostgresPaymentStore(
  options: PostgresPaymentStoreOptions,
): Promise<PaymentStore> {
  await assertPostgresDurability(options.database, options.schema);
  const store = new PostgresPaymentStore(options);
  await store.qualify();
  return store;
}
class PostgresPaymentStore implements PaymentStore {
  private readonly context: PaymentStoreContext;
  private readonly operations: PaymentOperationCustody;
  private readonly inputs: PaymentInputCustody;
  private readonly reductions: PaymentReductionCustody;
  private readonly deliveries: PaymentDeliveryCustody;
  constructor(options: PostgresPaymentStoreOptions) {
    this.context = new PaymentStoreContext(options);
    this.operations = new PaymentOperationCustody(this.context);
    this.inputs = new PaymentInputCustody(this.context);
    this.reductions = new PaymentReductionCustody(this.context);
    this.deliveries = new PaymentDeliveryCustody(this.context);
  }
  async qualify(): Promise<void> {
    await this.context.tx(this.context.options.scope, async (tx) => {
      await this.context.records.configuration(tx, this.context.options.scope);
    });
  }
  async admitIntent(
    scope: PaymentScope,
    admission: IntentAdmission,
  ): ReturnType<PaymentStore["admitIntent"]> {
    return this.operations.admitIntent(scope, admission);
  }
  async admitOperation(
    scope: PaymentScope,
    operation: PaymentOperation,
  ): ReturnType<PaymentStore["admitOperation"]> {
    return this.operations.admitOperation(scope, operation);
  }
  async findRequest(
    scope: PaymentScope,
    buyerId: string,
    requestKey: string,
  ): Promise<PaymentOperation | undefined> {
    return this.operations.findRequest(scope, buyerId, requestKey);
  }
  async loadOperation(scope: PaymentScope, id: string): Promise<OperationInput | undefined> {
    return this.operations.loadOperation(scope, id);
  }
  beginExternalDispatch(scope: PaymentScope, commit: OperationCommit): Promise<StoreCommitResult> {
    return this.operations.beginExternalDispatch(scope, commit);
  }
  finishAttempt(scope: PaymentScope, commit: OperationCommit): Promise<StoreCommitResult> {
    return this.operations.finishAttempt(scope, commit);
  }
  commitOperation(scope: PaymentScope, commit: OperationCommit): Promise<StoreCommitResult> {
    return this.operations.commitOperation(scope, commit);
  }
  async recordAttemptObservation(
    scope: PaymentScope,
    id: string,
    attempt: string,
    result: ProviderResult<JsonValue>,
  ): Promise<void> {
    return this.operations.recordAttemptObservation(scope, id, attempt, result);
  }
  async admitVerifiedInputs(
    scope: PaymentScope,
    inputs: readonly VerifiedInput[],
  ): ReturnType<PaymentStore["admitVerifiedInputs"]> {
    return this.context.tx(scope, async (tx) => {
      await this.context.records.configuration(tx, scope);
      return this.inputs.admitInputs(tx, scope, inputs);
    });
  }
  async loadReductionInput(
    scope: PaymentScope,
    inputId: string,
  ): Promise<ReductionInput | undefined> {
    return this.context.tx(scope, (tx) =>
      loadPaymentReductionInput(this.context, tx, scope, inputId),
    );
  }
  async loadPublicationInput(
    scope: PaymentScope,
    aggregate: AggregateIdentity,
  ): Promise<ReductionInput | undefined> {
    return this.context.tx(scope, (tx) =>
      loadPaymentReductionInput(this.context, tx, scope, "", aggregate),
    );
  }
  async commitReduction(scope: PaymentScope, commit: ReductionCommit): Promise<StoreCommitResult> {
    return this.reductions.commitReduction(scope, commit);
  }
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
  async readPurchase(
    scope: PaymentScope,
    buyerId: string,
    intentId: string,
  ): ReturnType<PaymentStore["readPurchase"]> {
    return this.context.tx(scope, async (tx) => {
      await this.context.records.configuration(tx, scope);
      const intent = (
        await (this.context.records.read(tx, "intents", intentId) as Promise<
          StoredRecord<PurchaseIntent> | undefined
        >)
      )?.body;
      if (!intent || intent.buyerId !== buyerId) {
        return;
      }
      const result = await tx.query<{ body: TransactionAggregate }>(
        `SELECT t.body FROM ${this.context.records.sql}.records b
        JOIN ${this.context.records.sql}.records t ON t.kind = 'transactions' AND t.id = b.id
        WHERE b.kind = 'bindings' AND b.body ->> 'intentId' = $1 ORDER BY t.id LIMIT 101`,
        [intentId],
      );
      if (result.rows.length > 100) {
        throw new RangeError(
          "Purchase query requires operator investigation of excessive candidate transactions",
        );
      }
      return { intent, transactions: result.rows.map((row) => row.body) };
    });
  }
  async readSubscription(
    scope: PaymentScope,
    buyerId: string,
    bindingId: string,
  ): ReturnType<PaymentStore["readSubscription"]> {
    return this.context.tx(scope, async (tx) => {
      await this.context.records.configuration(tx, scope);
      const binding = (
        await (this.context.records.read(tx, "subscriptionBindings", bindingId) as Promise<
          StoredRecord<SubscriptionBinding> | undefined
        >)
      )?.body;
      if (!binding || binding.buyerId !== buyerId) {
        return;
      }
      if (binding.providerSubscriptionRefs.length > 100) {
        throw new RangeError("Too many candidate subscription streams");
      }
      const result = await tx.query<{ body: SubscriptionAggregate }>(
        `SELECT body FROM ${this.context.records.sql}.records
        WHERE kind = 'subscriptions' AND id = ANY($1::text[]) ORDER BY id`,
        [binding.providerSubscriptionRefs],
      );
      return { binding, observations: result.rows.map((row) => row.body) };
    });
  }
  async listWork(
    scope: PaymentScope,
    kind: "inbox" | "publication" | "reclassification" | "prepared" | "unknown",
    limit: number,
  ): Promise<readonly string[]> {
    assertBatchLimit(limit);
    return this.context.tx(scope, async (tx) => {
      await this.context.records.configuration(tx, scope);
      // Completed transport jobs are disposable. These obligations outlive all job retention.
      return this.context.records.pendingWork(tx, kind, limit);
    });
  }
  registerConsumer(scope: PaymentScope, consumerId: string, backfill: boolean): Promise<void> {
    return this.deliveries.registerConsumer(scope, consumerId, backfill);
  }
  backfillConsumer(scope: PaymentScope, consumerId: string): Promise<void> {
    return this.deliveries.backfillConsumer(scope, consumerId);
  }
  listDeliveries(
    scope: PaymentScope,
    consumerId: string,
    limit: number,
  ): Promise<readonly EvidenceMessage[]> {
    return this.deliveries.listDeliveries(scope, consumerId, limit);
  }
  acknowledgeDelivery(
    scope: PaymentScope,
    consumerId: string,
    messageId: string,
    bodyDigest: string,
  ): Promise<"acknowledged" | "duplicate" | "conflict"> {
    return this.deliveries.acknowledgeDelivery(scope, consumerId, messageId, bodyDigest);
  }
  async setRecoveryFence(
    scope: PaymentScope,
    recoveryFenced: boolean,
    auditRef: string,
  ): Promise<void> {
    if (!auditRef || auditRef.length > 512) {
      throw new TypeError("A recovery fence requires an audit reference");
    }
    await this.context.tx(scope, async (tx) => {
      const config = await this.context.records.configuration(tx, scope, true);
      if (
        !recoveryFenced &&
        config.body.activeRecoverySessionId !== undefined &&
        config.body.activeRecoverySessionId !== ""
      ) {
        throw new Error("An active recovery session must pass its resume gate");
      }
      config.body.recoveryFenced = recoveryFenced;
      config.body.fenceAudits.push({
        fenced: recoveryFenced,
        auditRef,
        at: new Date().toISOString(),
      });
      await this.context.records.writeConfiguration(tx, config.body);
    });
  }
  async readCheckpoint(scope: PaymentScope, scanId: string): Promise<ScanCheckpoint | undefined> {
    return this.context.tx(scope, async (tx) => {
      await this.context.records.configuration(tx, scope);
      return (
        await (this.context.records.read(tx, "scans", scanId) as Promise<
          StoredRecord<ScanCheckpoint> | undefined
        >)
      )?.body;
    });
  }
  async commitScanPage(
    scope: PaymentScope,
    expected: ScanCheckpoint | undefined,
    next: ScanCheckpoint,
    inputs: readonly VerifiedInput[],
  ): Promise<StoreCommitResult> {
    return this.context.tx(scope, async (tx) => {
      if ((await this.context.records.configuration(tx, scope)).body.recoveryFenced) {
        return fenced;
      }
      await this.context.records.lock(tx, [{ kind: "scans", id: next.scanId }]);
      const current = (
        await (this.context.records.read(tx, "scans", next.scanId) as Promise<
          StoredRecord<ScanCheckpoint> | undefined
        >)
      )?.body;
      if (canonicalJson(current ?? null) !== canonicalJson(expected ?? null)) {
        return conflict;
      }
      await this.inputs.admitInputs(tx, scope, inputs, 200);
      await this.context.records.write(tx, "scans", next.scanId, next);
      await this.context.work(
        tx,
        { kind: "scan", id: next.scanId },
        next.status === "running" ? "pending" : next.status === "gap" ? "quarantined" : "complete",
      );
      return committed;
    });
  }
}
