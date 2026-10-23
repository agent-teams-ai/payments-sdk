import type { PaymentRuntimeOptions } from './models/payment-models.js';
import type { PaymentScope } from '../domain/model.js';
/** Platform effects enter through explicit ports selected by the public factory. */
export type RuntimePlatform = Readonly<{ now: () => string; newId: () => string; schedule: (milliseconds: number, run: () => void) => (() => void) }>;
export type PaymentRuntimeContext = Readonly<{
provider: PaymentRuntimeOptions['provider']; store: PaymentRuntimeOptions['store']; catalog: PaymentRuntimeOptions['catalog'];
producerNamespace: string; scope: PaymentScope; now: () => string; newId: () => string;
maxBytes: number; timeoutMs: number; active: Set<Promise<unknown>>; work: Set<Promise<unknown>>; platform: RuntimePlatform;
}> & { accepting: boolean };
export const unavailable = {kind: 'rejected', code: 'unavailable'} as const;
