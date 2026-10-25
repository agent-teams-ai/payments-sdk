import type { PaymentScope, JsonValue } from "@agent-teams/payments-core";
import type {
  PaymentOperation,
  IntentAdmission,
  OperationInput,
  OperationCommit,
  StoreCommitResult,
  PaymentStore,
  PurchaseIntent,
  SubscriptionBinding,
  TransactionBinding,
  TransactionAggregate,
} from "@agent-teams/payments-core/store";
import type { ProviderResult } from "@agent-teams/payments-core/provider";
import type { PaymentSqlTransaction } from "./database.js";
import type { StoredRecord, RecordKey } from "./records.js";
import type { Lane } from "./store-context.js";
import { canonicalJson, digest } from "@agent-teams/payments-core";
import {
  createEmptyPaymentState,
  sameOperationCommand,
  transactionAggregate,
} from "@agent-teams/payments-core/store";
import { committed, conflict, fenced, PaymentStoreContext } from "./store-context.js";
function hasReference(value: string | undefined): value is string {
  return value !== undefined && value !== "";
}
function requestIdentity(operation: Pick<PaymentOperation, "buyerId" | "requestKey">): string {
  return canonicalJson([operation.buyerId, operation.requestKey]);
}
function laneIdentity(operation: PaymentOperation): string {
  return hasReference(operation.subscriptionBindingId)
    ? `subscription:${operation.subscriptionBindingId}`
    : `operation:${operation.operationId}`;
}
function unresolved(operation: PaymentOperation): boolean {
  return operation.state === "dispatch_started" || operation.state === "outcome_unknown";
}
function nextLaneOwner(lane: Lane, operation: PaymentOperation): string | undefined {
  // A late terminal result cannot release another command's unresolved lane.
  if (
    hasReference(lane.unresolvedOperationId) &&
    lane.unresolvedOperationId !== operation.operationId
  ) {
    return lane.unresolvedOperationId;
  }
  return unresolved(operation) ? operation.operationId : undefined;
}
function compatibleBinding(existing: TransactionBinding, proposed: TransactionBinding): boolean {
  const purpose =
    existing.purpose === proposed.purpose ||
    (existing.purpose === "commercial" && proposed.purpose === "recovery") ||
    (existing.purpose === "recovery" && proposed.purpose === "commercial");
  const customer =
    existing.customerRef === null ||
    proposed.customerRef === null ||
    existing.customerRef === proposed.customerRef;
  return (
    existing.intentId === proposed.intentId &&
    existing.buyerId === proposed.buyerId &&
    purpose &&
    customer
  );
}
function dispatchPrerequisites(current: PaymentOperation, commit: OperationCommit): boolean {
  if (current.kind === "purchase") {
    return true;
  }
  const reads = commit.expectedReadSet ?? [];
  return (
    hasReference(current.providerSubscriptionRef) &&
    hasReference(current.subscriptionBindingId) &&
    reads.some(
      (read) =>
        read.table === "subscriptionBindings" &&
        read.id === current.subscriptionBindingId &&
        read.revision !== null,
    ) &&
    reads.some(
      (read) =>
        read.table === "subscriptions" &&
        read.id === current.providerSubscriptionRef &&
        read.revision !== null,
    )
  );
}
function dispatchRejection(
  current: PaymentOperation,
  lane: Lane,
  commit: OperationCommit,
): StoreCommitResult | undefined {
  if (!dispatchPrerequisites(current, commit)) {
    return conflict;
  }
  if (hasReference(lane.recoveryReviewRequired)) {
    return fenced;
  }
  const anotherOwner =
    hasReference(lane.unresolvedOperationId) &&
    lane.unresolvedOperationId !== commit.operation.operationId;
  if (
    current.state !== "prepared" ||
    commit.operation.state !== "dispatch_started" ||
    anotherOwner
  ) {
    return conflict;
  }
  return;
}
/** Operation admission and dispatch-marker CAS remain inside one payment-owned transaction. */
export class PaymentOperationCustody {
  private readonly context: PaymentStoreContext;
  constructor(context: PaymentStoreContext) {
    this.context = context;
  }
  async admitIntent(
    scope: PaymentScope,
    admission: IntentAdmission,
  ): ReturnType<PaymentStore["admitIntent"]> {
    return this.admit(scope, admission.operation, admission);
  }
  async admitOperation(
    scope: PaymentScope,
    operation: PaymentOperation,
  ): ReturnType<PaymentStore["admitOperation"]> {
    return this.admit(scope, operation);
  }
  private admissionKeys(
    operation: PaymentOperation,
    requestKey: string,
    admission?: IntentAdmission,
  ): RecordKey[] {
    const keys: RecordKey[] = [
      { kind: "requestKeys", id: requestKey },
      { kind: "operations", id: operation.operationId },
    ];
    if (admission) {
      keys.push({ kind: "intents", id: admission.intent.intentId });
    }
    if (hasReference(operation.subscriptionBindingId)) {
      keys.push(
        { kind: "subscriptionBindings", id: operation.subscriptionBindingId },
        { kind: "lanes", id: laneIdentity(operation) },
      );
    }
    if (admission?.subscriptionBinding) {
      keys.push({ kind: "subscriptionBindings", id: admission.subscriptionBinding.bindingId });
    }
    return keys;
  }
  private async existingAdmission(
    tx: PaymentSqlTransaction,
    operation: PaymentOperation,
    requestKey: string,
  ): Promise<Awaited<ReturnType<PaymentStore["admitIntent"]>> | undefined> {
    const id = (
      await (this.context.records.read(tx, "requestKeys", requestKey) as Promise<
        StoredRecord<string> | undefined
      >)
    )?.body;
    if (!hasReference(id)) {
      return;
    }
    const previous = (
      await (this.context.records.read(tx, "operations", id) as Promise<
        StoredRecord<PaymentOperation> | undefined
      >)
    )?.body;
    if (!previous) {
      throw new Error("Corrupt request identity");
    }
    return previous.fingerprint === operation.fingerprint
      ? { kind: "existing", operation: previous }
      : conflict;
  }
  private async hasOwnedSubscription(
    tx: PaymentSqlTransaction,
    operation: PaymentOperation,
  ): Promise<boolean> {
    if (!hasReference(operation.subscriptionBindingId)) {
      return false;
    }
    const binding = (
      await (this.context.records.read(
        tx,
        "subscriptionBindings",
        operation.subscriptionBindingId,
      ) as Promise<StoredRecord<SubscriptionBinding> | undefined>)
    )?.body;
    if (!binding) {
      return false;
    }
    return binding.buyerId === operation.buyerId;
  }
  private async saveAdmission(
    tx: PaymentSqlTransaction,
    operation: PaymentOperation,
    requestKey: string,
    admission?: IntentAdmission,
  ): Promise<void> {
    await this.context.records.write(tx, "requestKeys", requestKey, operation.operationId);
    await this.context.records.write(tx, "operations", operation.operationId, operation);
    if (admission) {
      await this.context.records.write(tx, "intents", admission.intent.intentId, admission.intent);
      if (admission.subscriptionBinding) {
        await this.context.records.write(
          tx,
          "subscriptionBindings",
          admission.subscriptionBinding.bindingId,
          admission.subscriptionBinding,
        );
      }
    }
    await this.context.work(tx, { kind: "prepared", id: operation.operationId });
  }
  async admit(
    scope: PaymentScope,
    operation: PaymentOperation,
    admission?: IntentAdmission,
  ): ReturnType<PaymentStore["admitIntent"]> {
    return this.context.tx(scope, async (tx) => {
      if ((await this.context.records.configuration(tx, scope)).body.recoveryFenced) {
        return fenced;
      }
      const requestKey = requestIdentity(operation);
      await this.context.records.lock(tx, this.admissionKeys(operation, requestKey, admission));
      const existing = await this.existingAdmission(tx, operation, requestKey);
      if (existing) {
        return existing;
      }
      if (
        await (this.context.records.read(tx, "operations", operation.operationId) as Promise<
          StoredRecord<PaymentOperation> | undefined
        >)
      ) {
        return conflict;
      }
      if (!admission && !(await this.hasOwnedSubscription(tx, operation))) {
        return conflict;
      }
      const review = (
        await (this.context.records.read(tx, "lanes", laneIdentity(operation)) as Promise<
          StoredRecord<Lane> | undefined
        >)
      )?.body.recoveryReviewRequired;
      if (hasReference(review)) {
        return fenced;
      }
      await this.saveAdmission(tx, operation, requestKey, admission);
      return { kind: "created", operation };
    });
  }
  async findRequest(
    scope: PaymentScope,
    buyerId: string,
    requestKey: string,
  ): Promise<PaymentOperation | undefined> {
    return this.context.tx(scope, async (tx) => {
      await this.context.records.configuration(tx, scope);
      const id = (
        await (this.context.records.read(
          tx,
          "requestKeys",
          canonicalJson([buyerId, requestKey]),
        ) as Promise<StoredRecord<string> | undefined>)
      )?.body;
      return hasReference(id)
        ? (
            await (this.context.records.read(tx, "operations", id) as Promise<
              StoredRecord<PaymentOperation> | undefined
            >)
          )?.body
        : undefined;
    });
  }
  async loadOperation(
    scope: PaymentScope,
    operationId: string,
  ): Promise<OperationInput | undefined> {
    return this.context.tx(scope, async (tx) => {
      await this.context.records.configuration(tx, scope);
      const operation = (
        await (this.context.records.read(tx, "operations", operationId) as Promise<
          StoredRecord<PaymentOperation> | undefined
        >)
      )?.body;
      if (!operation) {
        return;
      }
      const intent = hasReference(operation.intentId)
        ? (
            await (this.context.records.read(tx, "intents", operation.intentId) as Promise<
              StoredRecord<PurchaseIntent> | undefined
            >)
          )?.body
        : undefined;
      const bindingId = operation.subscriptionBindingId ?? intent?.subscriptionBasisId;
      const subscriptionBinding = hasReference(bindingId)
        ? (
            await (this.context.records.read(tx, "subscriptionBindings", bindingId) as Promise<
              StoredRecord<SubscriptionBinding> | undefined
            >)
          )?.body
        : undefined;
      const lane = (
        await (this.context.records.read(tx, "lanes", laneIdentity(operation)) as Promise<
          StoredRecord<Lane> | undefined
        >)
      )?.body;
      return {
        operation,
        ...(intent ? { intent } : {}),
        ...(subscriptionBinding ? { subscriptionBinding } : {}),
        laneRevision: lane?.revision ?? 0,
      };
    });
  }
  beginExternalDispatch(scope: PaymentScope, commit: OperationCommit): Promise<StoreCommitResult> {
    return this.operationCommit(scope, commit, true);
  }
  finishAttempt(scope: PaymentScope, commit: OperationCommit): Promise<StoreCommitResult> {
    return this.operationCommit(scope, commit, false);
  }
  commitOperation(scope: PaymentScope, commit: OperationCommit): Promise<StoreCommitResult> {
    return this.operationCommit(scope, commit, false);
  }
  private commitKeys(commit: OperationCommit, laneId: string): RecordKey[] {
    const keys: RecordKey[] = [
      { kind: "operations", id: commit.operation.operationId },
      { kind: "lanes", id: laneId },
    ];
    for (const read of commit.expectedReadSet ?? []) {
      if (read.table !== "configuration") {
        keys.push({ kind: read.table, id: read.id });
      }
    }
    if (commit.intent) {
      keys.push({ kind: "intents", id: commit.intent.intentId });
    }
    if (commit.binding) {
      keys.push(
        { kind: "bindings", id: commit.binding.transactionRef },
        { kind: "transactions", id: commit.binding.transactionRef },
        { kind: "guards", id: `intent:${commit.binding.intentId}` },
      );
    }
    if (commit.subscriptionBinding) {
      keys.push({ kind: "subscriptionBindings", id: commit.subscriptionBinding.bindingId });
      for (const ref of commit.subscriptionBinding.providerSubscriptionRefs) {
        keys.push({ kind: "guards", id: `subscription:${ref}` });
      }
    }
    return keys;
  }
  private async matchesReadSet(
    tx: PaymentSqlTransaction,
    commit: OperationCommit,
  ): Promise<boolean> {
    for (const read of commit.expectedReadSet ?? []) {
      if ((await this.context.records.version(tx, read)) !== read.revision) {
        return false;
      }
    }
    return true;
  }
  private async bindTransaction(
    tx: PaymentSqlTransaction,
    proposed: TransactionBinding,
  ): Promise<boolean> {
    const existing = (
      await (this.context.records.read(tx, "bindings", proposed.transactionRef) as Promise<
        StoredRecord<TransactionBinding> | undefined
      >)
    )?.body;
    if (existing && !compatibleBinding(existing, proposed)) {
      return false;
    }
    const binding = {
      ...proposed,
      purpose: existing?.purpose === "recovery" ? "recovery" : proposed.purpose,
      customerRef: existing?.customerRef ?? proposed.customerRef,
    };
    await this.context.records.write(tx, "bindings", binding.transactionRef, binding);
    const state = createEmptyPaymentState();
    const previous = (
      await (this.context.records.read(tx, "transactions", binding.transactionRef) as Promise<
        StoredRecord<TransactionAggregate> | undefined
      >)
    )?.body;
    if (previous) {
      state.transactions[binding.transactionRef] = previous;
    }
    const aggregate = transactionAggregate(state, binding.transactionRef);
    aggregate.revision += 1;
    aggregate.publicationRequired = true;
    await this.context.records.write(tx, "transactions", binding.transactionRef, aggregate);
    await this.context.records.guard(tx, `intent:${binding.intentId}`);
    await this.context.work(tx, {
      kind: "publication",
      id: canonicalJson({ type: "transaction", id: binding.transactionRef }),
    });
    return true;
  }
  private async saveOperationCommit(
    tx: PaymentSqlTransaction,
    commit: OperationCommit,
    lane: Lane,
    owner: string | undefined,
    laneId: string,
  ): Promise<void> {
    const op = commit.operation;
    await this.context.records.write(tx, "operations", op.operationId, op);
    await this.context.records.write(tx, "lanes", laneId, {
      revision: lane.revision + 1,
      ...(hasReference(owner) ? { unresolvedOperationId: owner } : {}),
      ...(hasReference(lane.recoveryReviewRequired)
        ? { recoveryReviewRequired: lane.recoveryReviewRequired }
        : {}),
    });
    if (commit.intent) {
      await this.context.records.write(tx, "intents", commit.intent.intentId, commit.intent);
    }
    if (commit.subscriptionBinding) {
      await this.context.records.write(
        tx,
        "subscriptionBindings",
        commit.subscriptionBinding.bindingId,
        commit.subscriptionBinding,
      );
      for (const ref of commit.subscriptionBinding.providerSubscriptionRefs) {
        await this.context.records.guard(tx, `subscription:${ref}`);
      }
    }
    await this.context.work(
      tx,
      { kind: "prepared", id: op.operationId },
      op.state === "prepared" ? "pending" : "complete",
    );
    await this.context.work(
      tx,
      { kind: "unknown", id: op.operationId },
      unresolved(op) ? "pending" : "complete",
    );
  }
  async operationCommit(
    scope: PaymentScope,
    commit: OperationCommit,
    dispatch: boolean,
  ): Promise<StoreCommitResult> {
    return this.context.tx(scope, async (tx) => {
      if ((await this.context.records.configuration(tx, scope)).body.recoveryFenced) {
        return fenced;
      }
      const op = commit.operation;
      const laneId = laneIdentity(op);
      await this.context.records.lock(tx, this.commitKeys(commit, laneId));
      const current = (
        await (this.context.records.read(tx, "operations", op.operationId) as Promise<
          StoredRecord<PaymentOperation> | undefined
        >)
      )?.body;
      const lane = (
        await (this.context.records.read(tx, "lanes", laneId) as Promise<
          StoredRecord<Lane> | undefined
        >)
      )?.body ?? { revision: 0 };
      if (
        !current ||
        current.revision !== commit.expectedRevision ||
        lane.revision !== commit.expectedLaneRevision ||
        !sameOperationCommand(current, op)
      ) {
        return conflict;
      }
      if (!(await this.matchesReadSet(tx, commit))) {
        return conflict;
      }
      const rejected = dispatch ? dispatchRejection(current, lane, commit) : undefined;
      if (rejected) {
        return rejected;
      }
      const owner = nextLaneOwner(lane, op);
      if (unresolved(op) && owner !== op.operationId) {
        return conflict;
      }
      if (commit.binding && !(await this.bindTransaction(tx, commit.binding))) {
        return conflict;
      }
      await this.saveOperationCommit(tx, commit, lane, owner, laneId);
      return committed;
    });
  }
  async recordAttemptObservation(
    scope: PaymentScope,
    operationId: string,
    attemptId: string,
    result: ProviderResult<JsonValue>,
  ): Promise<void> {
    await this.context.tx(scope, async (tx) => {
      await this.context.records.configuration(tx, scope);
      await this.context.records.lock(tx, [{ kind: "operations", id: operationId }]);
      const operation = (
        await (this.context.records.read(tx, "operations", operationId) as Promise<
          StoredRecord<PaymentOperation> | undefined
        >)
      )?.body;
      const attempt = operation?.attempts.find((item) => item.attemptId === attemptId);
      if (!attempt || !operation) {
        throw new Error("Unknown payment operation attempt");
      }
      if (attempt.observations.some((item) => digest(item) === digest(result))) {
        return;
      }
      attempt.observations.push(result);
      operation.revision += 1;
      await this.context.records.write(tx, "operations", operationId, operation);
    });
  }
}
