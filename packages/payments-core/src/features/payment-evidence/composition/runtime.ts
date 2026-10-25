import { randomUUID } from "node:crypto";
import type { PaymentRuntimeOptions } from "../application/models/payment-models.js";
import type { Payments } from "../application/payments-api.js";
import { createPaymentRuntime } from "../application/runtime.js";
/** Fixed platform implementations; the Host's explicit clock and IDs override these defaults. */
export function createPayments(options: PaymentRuntimeOptions): Payments {
  return createPaymentRuntime(options, {
    now: () => new Date().toISOString(),
    newId: randomUUID,
    schedule: (milliseconds, run) => {
      const timer = setTimeout(run, milliseconds);
      return () => {
        clearTimeout(timer);
      };
    },
  });
}
