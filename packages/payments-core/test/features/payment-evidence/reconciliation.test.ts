import assert from "node:assert/strict";
import test from "node:test";
import {
  createPaymentReconciler,
  digest,
  nextReconciliationWindow,
  type PaymentScope,
  type ReconciliationPage,
  type ReconciliationQuery,
  type ReconciliationSource,
  type VerifiedInput,
} from "../../../src/index.ts";
import { MemoryPaymentStore } from "../../../src/memory.ts";

const scope: PaymentScope = {
  applicationId: "app",
  provider: "fixture",
  paymentAccountId: "account",
  environment: "sandbox",
};
const query: ReconciliationQuery = {
  kind: "events",
  from: "2026-01-01T00:00:00Z",
  to: "2026-01-02T00:00:00Z",
  eventType: "transaction.updated",
  queryVersion: "events/1",
  perPage: 2,
  purpose: "catch_up",
};
function receipt(id: string): VerifiedInput {
  const retainedRepresentation = {
    representationKind: "sdk_mapped_observation",
    diagnostic: { fullDiagnostic: id },
  };
  const source = {
    kind: "authenticated_api" as const,
    receiptId: id,
    representationDigest: digest(retainedRepresentation),
    decoderVersion: "decoder/1",
    apiProfile: "fixture/1",
    eventId: id,
    eventType: "transaction.updated",
    occurredAt: query.kind === "events" ? query.from : "",
  };
  return {
    scope,
    inputId: id,
    source,
    observation: { kind: "unsupported", reason: "future_schema", source },
    retainedRepresentation,
  };
}
const emptyPage: ReconciliationSource["readPage"] = async () => ({
  kind: "page",
  inputs: [],
  hasMore: false,
});
function setup() {
  const store = new MemoryPaymentStore(),
    calls: (string | undefined)[] = [];
  let read: ReconciliationSource["readPage"] = emptyPage;
  const source: ReconciliationSource = {
    scope,
    readPage: async (...args) => {
      calls.push(args[1]);
      return read(...args);
    },
  };
  const reconciler = createPaymentReconciler({
    scope,
    store,
    source,
    now: () => "2026-01-02T00:00:00Z",
  });
  return {
    store,
    calls,
    reconciler,
    replaceRead: (value: typeof read) => {
      read = value;
    },
  };
}

void test("begin persists the complete immutable query before acquisition; one resume commits all receipt custody and cursor", async () => {
  const context = setup(),
    input = receipt("event-1");
  const begin = await context.reconciler.beginScan({ scanId: "scan", epoch: "epoch", query });
  assert.equal(begin.kind, "saved");
  assert.equal(context.calls.length, 0);
  assert.deepEqual((await context.store.readCheckpoint(scope, "scan"))?.query, query);
  context.replaceRead(async () => ({
    kind: "page",
    inputs: [input],
    hasMore: true,
    lastId: "event-1",
  }));
  const page = await context.reconciler.resumeScan("scan");
  assert.equal(page.kind, "saved");
  assert.equal((await context.store.readCheckpoint(scope, "scan"))?.after, "event-1");
  const acquired = (await context.store.loadReductionInput(scope, input.inputId))?.state.inbox[
    input.inputId
  ]?.input;
  assert.deepEqual(acquired, input);
  assert.equal(digest(acquired.retainedRepresentation), acquired.source.representationDigest);
  assert.equal(
    (await context.reconciler.beginScan({ scanId: "scan", epoch: "other-epoch", query })).kind,
    "conflict",
  );
  assert.deepEqual(context.calls, [undefined]);
});

void test("invalid page, changed scope, and broken receipt digest cannot admit a prefix or advance cursor", async () => {
  for (const bad of [
    { inputs: [], hasMore: true },
    { inputs: [receipt("event-1"), receipt("event-1")], hasMore: false, lastId: "event-1" },
    { inputs: [receipt("event-1")], hasMore: false, lastId: "event-2" },
    {
      inputs: [{ ...receipt("event-1"), scope: { ...scope, applicationId: "other" } }],
      hasMore: false,
      lastId: "event-1",
    },
    {
      inputs: [{ ...receipt("event-1"), retainedRepresentation: { changed: true } }],
      hasMore: false,
      lastId: "event-1",
    },
  ]) {
    const context = setup();
    await context.reconciler.beginScan({ scanId: "scan", epoch: "epoch", query });
    context.replaceRead(async () => ({ kind: "page", ...bad }));
    await context.reconciler.resumeScan("scan");
    const checkpoint = await context.store.readCheckpoint(scope, "scan");
    assert.equal(checkpoint?.status, "gap");
    assert.equal(checkpoint.after, undefined);
    assert.equal((await context.store.listWork(scope, "inbox", 10)).length, 0);
  }
});

void test("failed acquisition records durable SDK/cursor evidence and explicit redrive reads the original cursor", async () => {
  const context = setup();
  await context.reconciler.beginScan({ scanId: "scan", epoch: "epoch", query });
  context.replaceRead(async () => ({
    kind: "page",
    inputs: [receipt("event-1")],
    hasMore: true,
    lastId: "event-1",
  }));
  await context.reconciler.resumeScan("scan");
  context.replaceRead(async () => ({
    kind: "failed",
    reason: "sdk_mapping_failed",
    sdkVersion: "3.10.0",
    code: "unclassified_external_state",
  }));
  await context.reconciler.resumeScan("scan");
  const gap = await context.store.readCheckpoint(scope, "scan");
  assert.equal(gap?.after, "event-1");
  assert.equal(gap.status, "gap");
  assert.equal(gap.lastFailure?.sdkVersion, "3.10.0");
  assert.equal(gap.lastFailure.after, "event-1");
  await context.reconciler.resumeScan("scan");
  assert.equal(context.calls.length, 2);
  context.replaceRead(async () => ({
    kind: "page",
    inputs: [receipt("event-2")],
    hasMore: false,
    lastId: "event-2",
  }));
  await context.reconciler.retryScan("scan");
  await context.reconciler.resumeScan("scan");
  assert.deepEqual(context.calls, [undefined, "event-1", "event-1"]);
  const done = await context.store.readCheckpoint(scope, "scan");
  assert.equal(done?.after, "event-2");
  assert.equal(done.status, "complete");
  assert.equal(done.failureCount, 1);
});

void test("concurrent page reads use CAS so a stale page never admits inputs", async () => {
  const context = setup();
  await context.reconciler.beginScan({ scanId: "scan", epoch: "epoch", query });
  const readers: ((page: ReconciliationPage) => void)[] = [];
  context.replaceRead(
    async () =>
      new Promise((resolve) => {
        readers.push(resolve);
      }),
  );
  const first = context.reconciler.resumeScan("scan"),
    second = context.reconciler.resumeScan("scan");
  while (readers.length < 2) {
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
  }
  readers[0]!({ kind: "page", inputs: [receipt("event-1")], hasMore: true, lastId: "event-1" });
  assert.equal((await first).kind, "saved");
  readers[1]!({ kind: "page", inputs: [receipt("event-2")], hasMore: false, lastId: "event-2" });
  assert.equal((await second).kind, "conflict");
  assert.equal(await context.store.loadReductionInput(scope, "event-2"), undefined);
  assert.equal((await context.store.readCheckpoint(scope, "scan"))?.after, "event-1");
});

void test("coverage requires independent mandatory types, overlapping exclusive windows, retained history and adjustment scans", async () => {
  const context = setup();
  for (const [scanId, eventType] of [
    ["transactions", "transaction.updated"],
    ["adjustments", "adjustment.updated"],
  ] as const) {
    await context.reconciler.beginScan({ scanId, epoch: "epoch", query: { ...query, eventType } });
    await context.reconciler.resumeScan(scanId);
  }
  const request = {
    scanIds: ["transactions", "adjustments"],
    requiredEventTypes: ["transaction.updated", "adjustment.updated"],
    from: "2026-01-01T00:00:00Z",
    to: "2026-01-02T00:00:00Z",
  };
  assert.equal((await context.reconciler.coverage(request)).status, "queries_exhausted");
  assert.equal(
    (await context.reconciler.coverage({ ...request, scanIds: ["transactions"] })).status,
    "incomplete",
  );
  assert.equal(
    (
      await context.reconciler.coverage({
        ...request,
        historyAvailableFrom: "2026-01-01T01:00:00Z",
      })
    ).status,
    "incomplete",
  );
  assert.equal((await context.reconciler.coverage(request)).historyComplete, false);
  await context.reconciler.beginScan({
    scanId: "later",
    epoch: "epoch",
    query: { ...query, from: query.to, to: "2026-01-03T00:00:00Z" },
  });
  await context.reconciler.resumeScan("later");
  assert.equal(
    (
      await context.reconciler.coverage({
        scanIds: ["transactions", "later"],
        requiredEventTypes: ["transaction.updated"],
        from: query.from,
        to: "2026-01-03T00:00:00Z",
      })
    ).status,
    "incomplete",
  );
  assert.deepEqual(
    nextReconciliationWindow({
      previousTo: query.to,
      to: "2026-01-03T00:00:00Z",
      overlapMilliseconds: 1000,
    }),
    { from: "2026-01-01T23:59:59.000Z", to: "2026-01-03T00:00:00Z" },
  );
});
