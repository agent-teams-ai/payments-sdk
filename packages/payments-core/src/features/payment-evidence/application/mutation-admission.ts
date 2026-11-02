import type { PaymentRuntimeContext } from "./runtime-context.js";

/** Reserve before the durable dispatch marker, without an in-memory waiting queue. */
export function reserveMutation(ctx: PaymentRuntimeContext): (() => void) | undefined {
  if (ctx.admittedMutations >= ctx.maxConcurrentMutations) {
    return undefined;
  }
  ctx.admittedMutations += 1;
  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    ctx.admittedMutations -= 1;
  };
}
