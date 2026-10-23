import type { PaymentReconcilerOptions } from '../application/reconciliation.js';
import { createPaymentReconcilerRuntime } from '../application/reconciliation.js';
export function createPaymentReconciler(options: PaymentReconcilerOptions) { return createPaymentReconcilerRuntime(options, options.now ?? (() => new Date().toISOString())); }
