import type { AggregateIdentity } from "../domain/model.js";
import type { PaymentRuntimeContext } from "./runtime-context.js";
import { markUnknown, executeOperation } from "./operations.js";
import { processInbox, flushPublication, refreshPurchase } from "./evidence.js";
import { processReclassification } from "./selection.js";

export async function repair(
  ctx: PaymentRuntimeContext,
  limit = 25,
): Promise<
  Readonly<{
    inbox: number;
    reclassifications: number;
    publications: number;
    prepared: number;
    unknown: number;
  }>
> {
  const { store, scope } = ctx;
  if (!ctx.accepting) {
    return { inbox: 0, reclassifications: 0, publications: 0, prepared: 0, unknown: 0 };
  }
  let inbox = 0,
    reclassifications = 0,
    publications = 0,
    prepared = 0,
    unknown = 0;
  for (const id of await store.listWork(scope, "inbox", limit)) {
    await processInbox(ctx, id);
    inbox += 1;
  }
  for (const id of await store.listWork(scope, "reclassification", limit)) {
    await processReclassification(ctx, id, limit);
    reclassifications += 1;
  }
  for (const id of await store.listWork(scope, "publication", limit)) {
    await flushPublication(ctx, JSON.parse(id) as AggregateIdentity);
    publications += 1;
  }
  for (const id of await store.listWork(scope, "prepared", limit)) {
    await executeOperation(ctx, id);
    prepared += 1;
  }
  for (const id of await store.listWork(scope, "unknown", limit)) {
    const input = await store.loadOperation(scope, id);
    if (!input) {
      continue;
    }
    const attemptId = input.operation.attempts.at(-1)?.attemptId;
    if (typeof attemptId === "string" && attemptId.length > 0) {
      await markUnknown(ctx, id, attemptId);
    }
    if (input.intent) {
      await refreshPurchase(ctx, input.intent.buyerId, input.intent.intentId);
    }
    unknown += 1;
  }
  return { inbox, reclassifications, publications, prepared, unknown };
}
