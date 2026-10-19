import type { PaymentScope, PaymentState, PaymentStore } from './contracts.js';
import { createEmptyPaymentState, scopeKey } from './values.js';

/** Test store only. Production durability requires a durable storage adapter. */
export class MemoryPaymentStore implements PaymentStore {
  private readonly states = new Map<string, PaymentState>();
  private readonly tails = new Map<string, Promise<unknown>>();
  async atomic<T>(scope: PaymentScope, mutation: (draft: PaymentState) => T): Promise<T> {
    const key = scopeKey(scope);
    const previous = this.tails.get(key) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(() => {
      const draft = structuredClone(this.states.get(key) ?? createEmptyPaymentState());
      const result = mutation(draft);
      if (typeof result === 'object' && result !== null && 'then' in result) throw new TypeError('PaymentStore mutation must be synchronous');
      draft.revision += 1;
      const detached = structuredClone(result);
      this.states.set(key, structuredClone(draft));
      return detached;
    });
    this.tails.set(key, current);
    try { return await current; } finally { if (this.tails.get(key) === current) this.tails.delete(key); }
  }
  async read(scope: PaymentScope): Promise<PaymentState> {
    const key = scopeKey(scope);
    await this.tails.get(key)?.catch(() => undefined);
    return structuredClone(this.states.get(key) ?? createEmptyPaymentState());
  }
}
