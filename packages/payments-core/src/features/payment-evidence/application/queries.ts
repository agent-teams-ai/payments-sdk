import type { PaymentRuntimeContext } from './runtime-context.js';
import type { PaymentOperationRead, PurchaseRead, ObservedSubscriptionRead } from './models/read-models.js';
import type { ReadOperation } from './payments-api.js';
import { assertIdentifier } from '../domain/values.js';
import { operationSnapshot, purchaseSnapshot, subscriptionSnapshot } from './read-snapshots.js';

/** Buyer authority is mandatory even for JavaScript callers that bypass static declarations. */
export async function readOperation(ctx: PaymentRuntimeContext, query: ReadOperation): Promise<PaymentOperationRead | undefined> {
  const { buyerId, operationId } = query;
  assertIdentifier(buyerId);
  assertIdentifier(operationId);
  const input = await ctx.store.loadOperation(ctx.scope, operationId);
  return input?.operation.buyerId === buyerId ? operationSnapshot(input.operation) : undefined;
}

/** Selected explicitly by a trusted Host for workers and audited operator recovery. */
export async function inspectOperation(ctx: PaymentRuntimeContext, operationId: string): Promise<PaymentOperationRead | undefined> {
  assertIdentifier(operationId);
  const input = await ctx.store.loadOperation(ctx.scope, operationId);
  return input ? operationSnapshot(input.operation) : undefined;
}
export async function readPurchase(ctx: PaymentRuntimeContext, buyerId: string, intentId: string): Promise<PurchaseRead | undefined> {
 const read = await ctx.store.readPurchase(ctx.scope, buyerId, intentId); return read ? purchaseSnapshot(read) : undefined;
}
export async function readObservedSubscription(ctx: PaymentRuntimeContext, buyerId: string, bindingId: string): Promise<ObservedSubscriptionRead | undefined> {
 const read = await ctx.store.readSubscription(ctx.scope, buyerId, bindingId); return read ? subscriptionSnapshot(read) : undefined;
}
