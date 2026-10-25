import { mutableTables, buildMemoryWorkingSet } from "./memory-working-set.js";
import {
  admitMemoryIntent,
  admitMemoryOperation,
  findMemoryRequest,
  loadMemoryOperation,
  readMemoryPurchase,
  readMemorySubscription,
  recordMemoryAttemptObservation,
  commitMemoryOperation,
} from "./memory-operation-state.js";
import type {
  PaymentScope,
  JsonValue,
  ProviderResult,
  VerifiedInput,
  PaymentOperation,
  AggregateIdentity,
  EvidenceMessage,
  TransactionAggregate,
  SubscriptionAggregate,
  ScanCheckpoint,
  PaymentState,
} from "../domain/model.js";
import type {
  PaymentReadVersion,
  ReductionInput,
  ReductionCommit,
  IntentAdmission,
  OperationInput,
  OperationCommit,
  StoreCommitResult,
} from "../application/models/payment-models.js";
import type { PaymentStore } from "../application/ports/payment-ports.js";
import { admitInput } from "../domain/reducer.js";
import { canonicalJson, createEmptyPaymentState, sameScope, scopeKey } from "../domain/values.js";

type VersionTable = PaymentReadVersion["table"];

/** Test-only implementation of the same record/CAS protocol as the durable adapter. */

export class MemoryPaymentStore implements PaymentStore {
  private readonly states = new Map<string, PaymentState>();
  private readonly versions = new Map<string, Map<string, number>>();
  private readonly tails = new Map<string, Promise<unknown>>();
  private revision(scope: PaymentScope, table: VersionTable, id: string): number | null {
    return this.versions.get(scopeKey(scope))?.get(canonicalJson([table, id])) ?? null;
  }
  private bump(scope: PaymentScope, table: VersionTable, id: string): void {
    const key = scopeKey(scope),
      versions = this.versions.get(key) ?? new Map<string, number>();
    versions.set(canonicalJson([table, id]), (versions.get(canonicalJson([table, id])) ?? 0) + 1);
    this.versions.set(key, versions);
  }
  private async atomic<T>(scope: PaymentScope, mutation: (draft: PaymentState) => T): Promise<T> {
    const key = scopeKey(scope),
      previous = this.tails.get(key) ?? Promise.resolve();
    const current = previous
      .catch(() => {})
      .then(() => {
        const before = this.states.get(key) ?? createEmptyPaymentState(),
          draft = structuredClone(before);
        const result = mutation(draft);
        if (typeof result === "object" && result !== null && "then" in result) {
          throw new TypeError("Store mutation must be synchronous");
        }
        this.recordChanges(scope, before, draft);
        draft.revision += 1;
        this.states.set(key, structuredClone(draft));
        return structuredClone(result);
      });
    this.tails.set(key, current);
    try {
      return await current;
    } finally {
      if (this.tails.get(key) === current) {
        this.tails.delete(key);
      }
    }
  }
  private async view<T>(scope: PaymentScope, read: (state: PaymentState) => T): Promise<T> {
    const key = scopeKey(scope);
    await this.tails.get(key)?.catch(() => {});
    return structuredClone(read(this.states.get(key) ?? createEmptyPaymentState()));
  }
  async admitIntent(
    scope: PaymentScope,
    admission: IntentAdmission,
  ): ReturnType<PaymentStore["admitIntent"]> {
    return this.atomic(scope, (state) => admitMemoryIntent(state, admission));
  }
  async admitOperation(
    scope: PaymentScope,
    operation: PaymentOperation,
  ): ReturnType<PaymentStore["admitOperation"]> {
    return this.atomic(scope, (state) => admitMemoryOperation(state, operation));
  }
  async findRequest(
    scope: PaymentScope,
    buyerId: string,
    requestKey: string,
  ): Promise<PaymentOperation | undefined> {
    return this.view(scope, (state) => findMemoryRequest(state, buyerId, requestKey));
  }
  async loadOperation(
    scope: PaymentScope,
    operationId: string,
  ): Promise<OperationInput | undefined> {
    return this.view(scope, (state) =>
      loadMemoryOperation(state, operationId, (current, operation) =>
        this.laneRevision(current, operation),
      ),
    );
  }

  private laneRevision(state: PaymentState, operation: PaymentOperation): number {
    return Object.values(state.operations)
      .filter(
        (candidate) =>
          typeof candidate.subscriptionBindingId === "string" &&
          candidate.subscriptionBindingId.length > 0 &&
          candidate.subscriptionBindingId === operation.subscriptionBindingId,
      )
      .reduce((sum, candidate) => sum + candidate.revision, 0);
  }

  private async operationCommit(
    scope: PaymentScope,
    commit: OperationCommit,
    dispatch: boolean,
  ): Promise<StoreCommitResult> {
    return this.atomic(scope, (state) =>
      commitMemoryOperation(
        state,
        commit,
        dispatch,
        () => this.readSetMatches(scope, commit.expectedReadSet),
        (current, operation) => this.laneRevision(current, operation),
      ),
    );
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
  async recordAttemptObservation(
    scope: PaymentScope,
    operationId: string,
    attemptId: string,
    result: ProviderResult<JsonValue>,
  ): Promise<void> {
    await this.atomic(scope, (state) => {
      recordMemoryAttemptObservation(state, operationId, attemptId, result);
    });
  }
  async admitVerifiedInputs(
    scope: PaymentScope,
    inputs: readonly VerifiedInput[],
  ): ReturnType<PaymentStore["admitVerifiedInputs"]> {
    if (inputs.some((input) => !sameScope(input.scope, scope))) {
      throw new TypeError("Input scope mismatch");
    }
    if (inputs.length > 100) {
      throw new RangeError("Admission batch too large");
    }
    return this.atomic(scope, (state) =>
      inputs.map((input) => ({ inputId: input.inputId, kind: admitInput(state, input) })),
    );
  }
  private workingSet(
    scope: PaymentScope,
    state: PaymentState,
    inputId: string,
    aggregate?: AggregateIdentity,
  ): ReductionInput | undefined {
    return buildMemoryWorkingSet(
      state,
      inputId,
      (table, id) => this.revision(scope, table, id),
      aggregate,
    );
  }
  async loadReductionInput(
    scope: PaymentScope,
    inputId: string,
  ): Promise<ReductionInput | undefined> {
    return this.view(scope, (state) => this.workingSet(scope, state, inputId));
  }
  async loadPublicationInput(
    scope: PaymentScope,
    aggregate: AggregateIdentity,
  ): Promise<ReductionInput | undefined> {
    return this.view(scope, (state) => this.workingSet(scope, state, "", aggregate));
  }
  async commitReduction(scope: PaymentScope, commit: ReductionCommit): Promise<StoreCommitResult> {
    return this.atomic(scope, (state) => {
      if (state.recoveryFenced) {
        return { kind: "recovery_fenced" } as const;
      }
      if (
        commit.expected.some((item) => this.revision(scope, item.table, item.id) !== item.revision)
      ) {
        return { kind: "conflict" } as const;
      }
      for (const table of mutableTables) {
        if (
          !(typeof commit.heldReason === "string" && commit.heldReason.length > 0) ||
          table === "inbox"
        ) {
          Object.assign(state[table], commit.state[table]);
        } else if (table === "transactions" || table === "subscriptions") {
          const records: Readonly<Record<string, TransactionAggregate | SubscriptionAggregate>> =
            commit.state[table];
          for (const [id, metadata] of Object.entries(records)) {
            const target = state[table][id];
            if (target) {
              target.revision = metadata.revision;
              target.evidenceRevision = metadata.evidenceRevision;
              target.publicationRequired = metadata.publicationRequired;
            }
          }
        }
      }
      for (const [id, message] of Object.entries(commit.state.evidence)) {
        if (state.evidence[id] && state.evidence[id].bodyDigest !== message.bodyDigest) {
          return { kind: "conflict" } as const;
        }
        state.evidence[id] = message;
      }
      Object.assign(state.deliveries, commit.state.deliveries);
      state.issues.push(...commit.state.issues);
      return { kind: "committed" } as const;
    });
  }
  async processReclassification(
    scope: PaymentScope,
    bindingId: string,
    limit: number,
  ): Promise<StoreCommitResult> {
    this.limit(limit);
    return this.atomic(scope, (state) => {
      if (state.recoveryFenced) {
        return { kind: "recovery_fenced" } as const;
      }
      const obligation = state.reclassifications[bindingId],
        binding = state.subscriptionBindings[bindingId];
      if (!obligation || obligation.complete) {
        return { kind: "committed" } as const;
      }
      if (!binding || obligation.decisionRevision !== binding.classificationDecision?.revision) {
        return { kind: "conflict" } as const;
      }
      const refs = Object.keys(state.bindings)
        .filter(
          (ref) =>
            state.bindings[ref]?.intentId === binding.originatingIntentId &&
            state.transactions[ref] !== undefined &&
            (obligation.afterTransactionRef === undefined || ref > obligation.afterTransactionRef),
        )
        .toSorted();
      const batch = refs.slice(0, limit);
      for (const ref of batch) {
        const target = state.transactions[ref];
        if (target) {
          target.revision += 1;
          target.publicationRequired = true;
        }
      }
      const last = batch.at(-1);
      if (last !== undefined) {
        obligation.afterTransactionRef = last;
      }
      obligation.complete = refs.length <= limit;
      return { kind: "committed" } as const;
    });
  }
  async readPurchase(
    scope: PaymentScope,
    buyerId: string,
    intentId: string,
  ): ReturnType<PaymentStore["readPurchase"]> {
    return this.view(scope, (state) => readMemoryPurchase(state, buyerId, intentId));
  }
  async readSubscription(
    scope: PaymentScope,
    buyerId: string,
    bindingId: string,
  ): ReturnType<PaymentStore["readSubscription"]> {
    return this.view(scope, (state) => readMemorySubscription(state, buyerId, bindingId));
  }
  async listWork(
    scope: PaymentScope,
    kind: "inbox" | "publication" | "reclassification" | "prepared" | "unknown",
    limit: number,
  ): Promise<readonly string[]> {
    this.limit(limit);
    return this.view(scope, (state) => {
      if (kind === "inbox") {
        return Object.entries(state.inbox)
          .filter(([, item]) => item.state === "pending")
          .map(([id]) => id)
          .slice(0, limit);
      }
      if (kind === "reclassification") {
        return Object.values(state.reclassifications)
          .filter((item) => !item.complete)
          .map((item) => item.bindingId)
          .slice(0, limit);
      }
      if (kind === "publication") {
        return [
          ...Object.values(state.transactions)
            .filter((item) => item.publicationRequired)
            .map((item) => canonicalJson({ type: "transaction", id: item.transactionRef })),
          ...Object.values(state.subscriptions)
            .filter((item) => item.publicationRequired)
            .map((item) => canonicalJson({ type: "subscription", id: item.subscriptionRef })),
        ].slice(0, limit);
      }
      return Object.values(state.operations)
        .filter((item) =>
          kind === "prepared"
            ? item.state === "prepared"
            : ["dispatch_started", "outcome_unknown"].includes(item.state),
        )
        .map((item) => item.operationId)
        .slice(0, limit);
    });
  }
  private limit(limit: number): void {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new RangeError("Invalid bounded batch limit");
    }
  }
  async registerConsumer(
    scope: PaymentScope,
    consumerId: string,
    backfill: boolean,
  ): Promise<void> {
    await this.atomic(scope, (state) => {
      if (!state.consumers.includes(consumerId)) {
        if (state.consumers.length >= 32) {
          throw new RangeError("Consumer limit");
        }
        state.consumers.push(consumerId);
      }
      if (backfill) {
        for (const messageId of Object.keys(state.evidence)) {
          state.deliveries[canonicalJson([messageId, consumerId])] ??= {
            consumerId,
            messageId,
            acknowledged: false,
            attempts: 0,
          };
        }
      }
    });
  }
  async listDeliveries(
    scope: PaymentScope,
    consumerId: string,
    limit: number,
  ): Promise<readonly EvidenceMessage[]> {
    this.limit(limit);
    return this.view(scope, (state) =>
      Object.values(state.deliveries)
        .filter((item) => item.consumerId === consumerId && !item.acknowledged)
        .slice(0, limit)
        .flatMap((item) => {
          const message = state.evidence[item.messageId];
          return message ? [message] : [];
        }),
    );
  }
  async acknowledgeDelivery(
    scope: PaymentScope,
    consumerId: string,
    messageId: string,
    bodyDigest: string,
  ): Promise<"acknowledged" | "duplicate" | "conflict"> {
    return this.atomic(scope, (state) => {
      const delivery = state.deliveries[canonicalJson([messageId, consumerId])],
        message = state.evidence[messageId];
      if (!delivery || !message || message.bodyDigest !== bodyDigest) {
        return "conflict";
      }
      if (delivery.acknowledged) {
        return "duplicate";
      }
      delivery.acknowledged = true;
      return "acknowledged";
    });
  }
  async setRecoveryFence(scope: PaymentScope, fenced: boolean, auditRef: string): Promise<void> {
    await this.atomic(scope, (state) => {
      state.recoveryFenced = fenced;
      state.issues.push(`recovery-fence:${fenced}:${auditRef}`);
    });
  }
  async readCheckpoint(scope: PaymentScope, scanId: string): Promise<ScanCheckpoint | undefined> {
    return this.view(scope, (state) => state.scans[scanId]);
  }
  async commitScanPage(
    scope: PaymentScope,
    expected: ScanCheckpoint | undefined,
    next: ScanCheckpoint,
    inputs: readonly VerifiedInput[],
  ): Promise<StoreCommitResult> {
    return this.atomic(scope, (state) => {
      if (state.recoveryFenced) {
        return { kind: "recovery_fenced" } as const;
      }
      if (canonicalJson(state.scans[next.scanId] ?? null) !== canonicalJson(expected ?? null)) {
        return { kind: "conflict" } as const;
      }
      for (const input of inputs) {
        admitInput(state, input);
      }
      state.scans[next.scanId] = next;
      return { kind: "committed" } as const;
    });
  }
  private recordChanges(scope: PaymentScope, before: PaymentState, draft: PaymentState): void {
    for (const table of mutableTables) {
      for (const id of new Set([...Object.keys(before[table]), ...Object.keys(draft[table])])) {
        if (canonicalJson(before[table][id] ?? null) !== canonicalJson(draft[table][id] ?? null)) {
          this.bump(scope, table, id);
        }
      }
    }
    this.recordTransactionGuards(scope, before, draft);
    this.recordSubscriptionGuards(scope, before, draft);
    if (
      canonicalJson(before.consumers) !== canonicalJson(draft.consumers) ||
      before.recoveryFenced !== draft.recoveryFenced
    ) {
      this.bump(scope, "configuration", "scope");
    }
  }
  private recordTransactionGuards(
    scope: PaymentScope,
    before: PaymentState,
    draft: PaymentState,
  ): void {
    for (const ref of new Set([
      ...Object.keys(before.transactions),
      ...Object.keys(draft.transactions),
    ])) {
      if (
        canonicalJson(before.transactions[ref] ?? null) ===
        canonicalJson(draft.transactions[ref] ?? null)
      ) {
        continue;
      }
      const intent = draft.bindings[ref]?.intentId ?? before.bindings[ref]?.intentId;
      if (typeof intent === "string" && intent.length > 0) {
        this.bump(scope, "guards", `intent:${intent}`);
      }
    }
  }
  private recordSubscriptionGuards(
    scope: PaymentScope,
    before: PaymentState,
    draft: PaymentState,
  ): void {
    for (const id of new Set([
      ...Object.keys(before.subscriptionBindings),
      ...Object.keys(draft.subscriptionBindings),
    ])) {
      if (
        canonicalJson(before.subscriptionBindings[id] ?? null) ===
        canonicalJson(draft.subscriptionBindings[id] ?? null)
      ) {
        continue;
      }
      const refs = new Set([
        ...(before.subscriptionBindings[id]?.providerSubscriptionRefs ?? []),
        ...(draft.subscriptionBindings[id]?.providerSubscriptionRefs ?? []),
      ]);
      for (const ref of refs) {
        this.bump(scope, "guards", `subscription:${ref}`);
      }
    }
  }
  private readSetMatches(
    scope: PaymentScope,
    expected: readonly PaymentReadVersion[] | undefined,
  ): boolean {
    return (
      expected?.some((item) => this.revision(scope, item.table, item.id) !== item.revision) !== true
    );
  }
}
