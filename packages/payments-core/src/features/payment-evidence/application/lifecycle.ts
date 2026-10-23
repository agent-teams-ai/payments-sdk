import type { PaymentRuntimeContext } from './runtime-context.js';

export function tracked<A extends unknown[], R>(ctx: PaymentRuntimeContext, run: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
  const { work } = ctx;
    return (...args) => {
      const promise = run(...args); work.add(promise);
      void promise.finally(() => work.delete(promise)).catch(() => {});
      return promise;
    };
  }

export function stop(ctx: PaymentRuntimeContext): Readonly<{ unresolvedExternalCalls: number; pendingWork: number }> {
  const { active, work } = ctx; ctx.accepting = false; return { unresolvedExternalCalls: active.size, pendingWork: work.size }; }

export async function drain(ctx: PaymentRuntimeContext): Promise<void> {
  const { active, work } = ctx; while (active.size > 0 || work.size > 0) {await Promise.allSettled([...active, ...work]);} }
