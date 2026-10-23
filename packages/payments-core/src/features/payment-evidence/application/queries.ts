import type { PaymentRuntimeContext } from './runtime-context.js';
import type { PaymentOperationRead, PurchaseRead, ObservedSubscriptionRead } from './models/read-models.js';
import { operationSnapshot, purchaseSnapshot, subscriptionSnapshot } from './read-snapshots.js';
export async function readOperation(ctx: PaymentRuntimeContext, operationId: string, buyerId?: string): Promise<PaymentOperationRead | undefined> {
 const input = await ctx.store.loadOperation(ctx.scope, operationId);
 return input && (buyerId === undefined || input.operation.buyerId === buyerId) ? operationSnapshot(input.operation) : undefined;
}
export async function readPurchase(ctx: PaymentRuntimeContext, buyerId: string, intentId: string): Promise<PurchaseRead | undefined> {
 const read = await ctx.store.readPurchase(ctx.scope, buyerId, intentId); return read ? purchaseSnapshot(read) : undefined;
}
export async function readObservedSubscription(ctx: PaymentRuntimeContext, buyerId: string, bindingId: string): Promise<ObservedSubscriptionRead | undefined> {
 const read = await ctx.store.readSubscription(ctx.scope, buyerId, bindingId); return read ? subscriptionSnapshot(read) : undefined;
}
