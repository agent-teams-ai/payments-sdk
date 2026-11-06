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
import type { StoredRecord } from "./records.js";
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
import { PaymentReclassificationCustody } from "./reclassification-custody.js";
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
  private readonly reclassifications: PaymentReclassificationCustody;
  constructor(options: PostgresPaymentStoreOptions) {
    this.context = new PaymentStoreContext(options);
    this.operations = new PaymentOperationCustody(this.context);
    this.inputs = new PaymentInputCustody(this.context);
    this.reductions = new PaymentReductionCustody(this.context);
    this.deliveries = new PaymentDeliveryCustody(this.context);
    this.reclassifications = new PaymentReclassificationCustody(this.context);
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
  processReclassification(
    scope: PaymentScope,
    bindingId: string,
    limit: number,
  ): Promise<StoreCommitResult> {
    return this.reclassifications.processReclassification(scope, bindingId, limit);
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
