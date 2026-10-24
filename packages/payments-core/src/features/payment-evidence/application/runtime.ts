import type { PaymentRuntimeOptions } from './models/payment-models.js';
import type { Payments } from './payments-api.js';
import type { PaymentRuntimeContext, RuntimePlatform } from './runtime-context.js';
import { assertIdentifier, assertScope, sameScope } from '../domain/values.js';
import { readOperation, inspectOperation, readPurchase, readObservedSubscription } from './queries.js';
import { startPurchase, executeOperation } from './operations.js';
import { requestCancellation, openPaymentUpdate, createManagementLink } from './subscriptions.js';
import { resolveUnknownOperation } from './resolutions.js';
import { ingestVerifiedInput, processInbox, flushPublication, refreshPurchase, refreshSubscription } from './evidence.js';
import { readSubscriptionSelection, selectSubscriptionStream, processReclassification } from './selection.js';
import { repair } from './repair.js';
import { tracked, stop, drain } from './lifecycle.js';
export function createPaymentRuntime(options: PaymentRuntimeOptions, platform: RuntimePlatform): Payments {
  const { provider, store, catalog, producerNamespace } = options;
  const scope = Object.freeze(structuredClone(options.scope));
  assertScope(scope); assertIdentifier(producerNamespace);
  if (!sameScope(scope, provider.scope)) {throw new TypeError('Provider scope mismatch');}
  const requiredCapabilities: readonly unknown[] = [provider.capabilities.checkout, provider.capabilities.transactionRead, provider.capabilities.subscriptionRead];
  if (requiredCapabilities.some(capability => capability !== true)) {throw new TypeError('Required provider capability missing');}
  const now = options.now ?? platform.now, newId = options.newId ?? platform.newId;
  const maxBytes = options.maxEvidenceBytes ?? 262_144, timeoutMs = options.operationTimeoutMs ?? 15_000;
  const maxConcurrentMutations = options.maxConcurrentMutations ?? 32;
  if (!Number.isSafeInteger(maxConcurrentMutations) || maxConcurrentMutations < 1 || maxConcurrentMutations > 1024) {throw new RangeError('Invalid mutation concurrency bound');}
  if (!Number.isInteger(maxBytes) || maxBytes < 4096 || maxBytes > 16_777_216) {throw new RangeError('Invalid evidence limit');}
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000) {throw new RangeError('Invalid operation deadline');}

 const ctx: PaymentRuntimeContext = {provider, store, catalog, producerNamespace, scope, now, newId, maxBytes, timeoutMs, maxConcurrentMutations, admittedMutations: 0, platform, active: new Set(), work: new Set(), accepting: true};
 return { scope,
startPurchase: tracked(ctx, (...args: Parameters<Payments['startPurchase']>) => startPurchase(ctx, ...args)),
readOperation: tracked(ctx, (...args: Parameters<Payments['readOperation']>) => readOperation(ctx, ...args)),
inspectOperation: tracked(ctx, (operationId: string) => inspectOperation(ctx, operationId)),
executeOperation: tracked(ctx, (...args: Parameters<Payments['executeOperation']>) => executeOperation(ctx, ...args)),
ingestVerifiedInput: tracked(ctx, (...args: Parameters<Payments['ingestVerifiedInput']>) => ingestVerifiedInput(ctx, ...args)),
processInbox: tracked(ctx, (...args: Parameters<Payments['processInbox']>) => processInbox(ctx, ...args)),
processReclassification: tracked(ctx, (...args: Parameters<Payments['processReclassification']>) => processReclassification(ctx, ...args)),
flushPublication: tracked(ctx, (...args: Parameters<Payments['flushPublication']>) => flushPublication(ctx, ...args)),
refreshPurchase: tracked(ctx, (...args: Parameters<Payments['refreshPurchase']>) => refreshPurchase(ctx, ...args)),
refreshSubscription: tracked(ctx, (...args: Parameters<Payments['refreshSubscription']>) => refreshSubscription(ctx, ...args)),
requestCancellation: tracked(ctx, (...args: Parameters<Payments['requestCancellation']>) => requestCancellation(ctx, ...args)),
openPaymentUpdate: tracked(ctx, (...args: Parameters<Payments['openPaymentUpdate']>) => openPaymentUpdate(ctx, ...args)),
createManagementLink: tracked(ctx, (...args: Parameters<Payments['createManagementLink']>) => createManagementLink(ctx, ...args)),
resolveUnknownOperation: tracked(ctx, (...args: Parameters<Payments['resolveUnknownOperation']>) => resolveUnknownOperation(ctx, ...args)),
repair: tracked(ctx, (...args: Parameters<Payments['repair']>) => repair(ctx, ...args)),
readSubscriptionSelection: tracked(ctx, (...args: Parameters<Payments['readSubscriptionSelection']>) => readSubscriptionSelection(ctx, ...args)),
selectSubscriptionStream: tracked(ctx, (...args: Parameters<Payments['selectSubscriptionStream']>) => selectSubscriptionStream(ctx, ...args)),
readPurchase: tracked(ctx, (...args: Parameters<Payments['readPurchase']>) => readPurchase(ctx, ...args)),
readObservedSubscription: tracked(ctx, (...args: Parameters<Payments['readObservedSubscription']>) => readObservedSubscription(ctx, ...args)),
registerConsumer: tracked(ctx, (consumerId: string, backfill = false) => { assertIdentifier(consumerId); return store.registerConsumer(scope, consumerId, backfill); }),
readDeliveries: tracked(ctx, (consumerId: string, limit = 25) => store.listDeliveries(scope, consumerId, limit)),
acknowledgeDelivery: tracked(ctx, (consumerId: string, messageId: string, bodyDigest: string) => store.acknowledgeDelivery(scope, consumerId, messageId, bodyDigest)),
stop: () => stop(ctx), drain: () => drain(ctx), lifecycle: () => ({accepting: ctx.accepting, mutationCapacity: ctx.maxConcurrentMutations, admittedMutations: ctx.admittedMutations, unresolvedExternalCalls: ctx.active.size, pendingWork: ctx.work.size}),
}; }
