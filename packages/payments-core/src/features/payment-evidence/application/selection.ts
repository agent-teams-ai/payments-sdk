import type { SubscriptionSelection, SelectSubscriptionStream } from './payments-api.js';
import type { SubscriptionBindingRead } from './models/read-models.js';
import { bindingSnapshot } from './read-snapshots.js';
import type { OperationResult, PaymentReadVersion } from './models/payment-models.js';
import { publishEvidence, requireSubscriptionReclassification } from '../domain/reducer.js';
import { assertIdentifier, canonicalJson, digest } from '../domain/values.js';
import type { PaymentRuntimeContext } from './runtime-context.js';
import { unavailable } from './runtime-context.js';

/** Complete optimistic precondition only; the Host still supplies authorization independently. */
function selectionVersion(ctx: PaymentRuntimeContext, subject: Readonly<{buyerId: string; bindingId: string; providerSubscriptionRef: string}>, reads: readonly PaymentReadVersion[]): string {
const ordered = reads.map(read => [read.table, read.id, read.revision]).toSorted((a, b) => {const left = canonicalJson(a), right = canonicalJson(b); return left < right ? -1 : left > right ? 1 : 0;});
return digest(['payments/subscription-selection/v1', ctx.scope, subject, ordered]);
}
export async function readSubscriptionSelection(ctx: PaymentRuntimeContext, buyerId: string, bindingId: string, providerSubscriptionRef?: string): Promise<SubscriptionSelection | undefined> {
  const { store, scope } = ctx;
    const subscription = await store.readSubscription(scope, buyerId, bindingId);
    const ref = providerSubscriptionRef ?? subscription?.binding.selectedSubscriptionRef ?? subscription?.binding.providerSubscriptionRefs[0];
    if (!subscription || !(typeof ref === 'string' && ref.length > 0) || !subscription.binding.providerSubscriptionRefs.includes(ref)) {return;}
    const loaded = await store.loadPublicationInput(scope, { type: 'subscription', id: ref });
    if (!loaded || (typeof loaded.incompleteReason === 'string' && loaded.incompleteReason.length > 0)) {return;}
    const binding = loaded.state.subscriptionBindings[bindingId];
    return binding && binding.buyerId === buyerId && binding.providerSubscriptionRefs.includes(ref) ? {binding: bindingSnapshot(binding), providerSubscriptionRef: ref, version: selectionVersion(ctx, {buyerId, bindingId, providerSubscriptionRef: ref}, loaded.expected)} : undefined;
  }

export async function selectSubscriptionStream(ctx: PaymentRuntimeContext, command: SelectSubscriptionStream): Promise<OperationResult<SubscriptionBindingRead>> {
  const { store, producerNamespace, scope, now, maxBytes } = ctx;
    if (!ctx.accepting) {return unavailable;}
    for (const value of [command.buyerId, command.bindingId, command.providerSubscriptionRef, command.actorId, command.auditRef, command.reason]) {assertIdentifier(value);}
    const loaded = await store.loadPublicationInput(scope, { type: 'subscription', id: command.providerSubscriptionRef });
    if (!loaded || (typeof loaded.incompleteReason === 'string' && loaded.incompleteReason.length > 0)) {return { kind: 'rejected', code: 'conflict' };}
    const binding = loaded.state.subscriptionBindings[command.bindingId];
    if (!binding || binding.buyerId !== command.buyerId || !binding.providerSubscriptionRefs.includes(command.providerSubscriptionRef)) {return { kind: 'rejected', code: 'ownership_mismatch' };}
    const subject = {buyerId: command.buyerId, bindingId: command.bindingId, providerSubscriptionRef: command.providerSubscriptionRef};
  if (command.version !== selectionVersion(ctx, subject, loaded.expected)) {return {kind: 'rejected', code: 'conflict'};}
    binding.selectedSubscriptionRef = command.providerSubscriptionRef;
    binding.streamSelection = { actorId: command.actorId, auditRef: command.auditRef, reason: command.reason, at: now() };
    requireSubscriptionReclassification(loaded.state, binding);
    const aggregate = loaded.state.subscriptions[command.providerSubscriptionRef] ??= { subscriptionRef: command.providerSubscriptionRef, revision: 0, evidenceRevision: 0, flags: [], publicationRequired: false };
    aggregate.revision += 1; aggregate.publicationRequired = true;
    publishEvidence(loaded.state, scope, producerNamespace, maxBytes);
    const committed = await store.commitReduction(scope, { inputId: loaded.inputId, expected: loaded.expected, state: loaded.state });
    return committed.kind === 'committed' ? { kind: 'succeeded', value: bindingSnapshot(binding) } : committed.kind === 'recovery_fenced' ? unavailable : { kind: 'rejected', code: 'conflict' };
  }

export async function processReclassification(ctx: PaymentRuntimeContext, bindingId: string, limit = 25) {
  const { store, scope } = ctx;
    assertIdentifier(bindingId);
    if (!ctx.accepting) {return 'recovery_fenced' as const;}
    return (await store.processReclassification(scope, bindingId, limit)).kind;
  }
