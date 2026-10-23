import type { ProviderResult, VerifiedInput, PaymentOperation } from '../domain/model.js';
import type { OperationResult, PaymentReadVersion, ReductionInput } from './models/payment-models.js';
import type { PaymentRuntimeContext } from './runtime-context.js';
import { unavailable } from './runtime-context.js';
import { acquireAndProcess } from './evidence.js';

function ownsSubscription(input: ReductionInput, operation: PaymentOperation, ref: string, bindingId: string): boolean {
    const binding = input.state.subscriptionBindings[bindingId];
    return (binding !== undefined &&
        binding.buyerId === operation.buyerId &&
        binding.providerSubscriptionRefs.includes(ref) &&
        input.state.subscriptions[ref]?.flags.includes('ownership_mismatch') !== true);
}

function confirmedAuthority(authority: ReductionInput | undefined, operation: PaymentOperation, ref: string, bindingId: string): OperationResult<readonly PaymentReadVersion[]> {
    if (!authority ||
        (typeof authority.incompleteReason === 'string' && authority.incompleteReason.length > 0)) {
        return { kind: 'rejected', code: 'unclassified_external_state' };
    }
    if (!ownsSubscription(authority, operation, ref, bindingId)) {
        return { kind: 'rejected', code: 'ownership_mismatch' };
    }
    const binding = authority.state.subscriptionBindings[bindingId];
    const customer = authority.state.subscriptions[ref]?.current?.customerRef;
    if (!binding ||
        !(typeof binding.customerRef === 'string' && binding.customerRef.length > 0) ||
        customer?.presence !== 'known') {
        return { kind: 'rejected', code: 'unclassified_external_state' };
    }
    if (customer.value !== binding.customerRef) {
        return { kind: 'rejected', code: 'ownership_mismatch' };
    }
    return { kind: 'succeeded', value: authority.expected };
}

export async function subscriptionAuthority(ctx: PaymentRuntimeContext, operation: PaymentOperation): Promise<OperationResult<readonly PaymentReadVersion[]>> {
    const { provider, store, scope } = ctx;
    const ref = operation.providerSubscriptionRef;
    if (!(typeof ref === 'string' && ref.length > 0) ||
        !(typeof operation.subscriptionBindingId === 'string' &&
            operation.subscriptionBindingId.length > 0)) {
        return { kind: 'rejected', code: 'unclassified_external_state' };
    }
    const local = await store.loadPublicationInput(scope, { type: 'subscription', id: ref });
    if (!local || !ownsSubscription(local, operation, ref, operation.subscriptionBindingId)) {
        return { kind: 'rejected', code: 'ownership_mismatch' };
    }
    if (!provider.readSubscriptionInput) {
        return { kind: 'unsupported', capability: 'subscription_authority_acquisition' };
    }
    let receipt: ProviderResult<VerifiedInput>;
    try {
        receipt = await provider.readSubscriptionInput(ref);
    }
    catch {
        return unavailable;
    }
    if (receipt.kind !== 'succeeded') {
        if (receipt.kind === 'outcome_unknown') {
            return unavailable;
        }
        return receipt.kind === 'rejected' ? { kind: 'rejected', code: receipt.code } : receipt;
    }
    const acquired = await acquireAndProcess(ctx, receipt.value, { type: 'subscription', id: ref });
    if (acquired.kind !== 'succeeded') {
        return acquired;
    }
    if (acquired.value !== 1) {
        return { kind: 'rejected', code: 'unclassified_external_state' };
    }
    const authority = await store.loadPublicationInput(scope, { type: 'subscription', id: ref });
    return confirmedAuthority(authority, operation, ref, operation.subscriptionBindingId);
}
