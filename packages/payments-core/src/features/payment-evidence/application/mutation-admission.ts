import type { PaymentRuntimeContext } from './runtime-context.js';

/** Reserve before awaiting the durable dispatch marker. No in-memory waiting queue is created. */
export function reserveMutation(ctx: PaymentRuntimeContext): (() => void) | undefined {
  if (ctx.admittedMutations >= ctx.maxConcurrentMutations) {return;}
  ctx.admittedMutations += 1;
  let released = false;
  return () => {
    if (released) {return;}
    released = true;
    ctx.admittedMutations -= 1;
  };
}
