/** Bounded Fetch ingress. Never materialize an unbounded Request body first. */
export const paymentRequestBodyLimit = 65_536;
export type PaymentBodyLimits = Readonly<{ maxBytes?: number; timeoutMs?: number }>;
export class PaymentBodyError extends Error {
  readonly status: 400 | 408 | 413;
  constructor(status: 400 | 408 | 413, message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'PaymentBodyError';
    this.status = status;
  }
}

function cancelBody(body: ReadableStream<Uint8Array> | null, reason: unknown): void {
  // A hostile or disconnected producer may never settle cancel(). It cannot hold the response.
  if (body !== null && !body.locked) { void body.cancel(reason).catch(() => {}); }
}

function declaredLength(request: Request, maximum: number): number | undefined {
  const raw = request.headers.get('content-length');
  if (raw === null) {return undefined;}
  if (!/^\d+$/u.test(raw)) {throw new PaymentBodyError(400, 'Invalid body length');}
  const length = Number(raw);
  if (!Number.isSafeInteger(length)) {throw new PaymentBodyError(413, 'Body too large');}
  if (length > maximum) {throw new PaymentBodyError(413, 'Body too large');}
  return length;
}

export async function readPaymentBody(request: Request, limits: PaymentBodyLimits = {}): Promise<Uint8Array> {
  const maximum = limits.maxBytes ?? paymentRequestBodyLimit;
  const timeout = limits.timeoutMs ?? 10_000;
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 16_777_216 ||
      !Number.isSafeInteger(timeout) || timeout < 1 || timeout > 300_000) {
    throw new RangeError('Invalid payment HTTP body limits');
  }
  let expected: number | undefined;
  try {
    expected = declaredLength(request, maximum);
    if (request.signal.aborted) {throw new PaymentBodyError(408, 'Request aborted');}
  } catch (error) {
    cancelBody(request.body, error);
    throw error;
  }
  if (request.body === null) {
    if (expected !== undefined && expected !== 0) {throw new PaymentBodyError(400, 'Incomplete request body');}
    return new Uint8Array();
  }
  const reader = request.body.getReader();
  const bytes = new Uint8Array(maximum);
  let size = 0, fragments = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  const stopped = new Promise<never>((_resolve, reject) => {
    abort = () => reject(new PaymentBodyError(408, 'Request aborted'));
    request.signal.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => reject(new PaymentBodyError(408, 'Body read deadline exceeded')), timeout);
    if (request.signal.aborted) {abort();}
  });
  try {
    for (;;) {
      const item = await Promise.race([reader.read(), stopped]);
      if (item.done) {break;}
      fragments += 1;
      if (fragments > maximum + 1) {throw new PaymentBodyError(413, 'Too many body fragments');}
      if (!(item.value instanceof Uint8Array)) {throw new PaymentBodyError(400, 'Invalid request body');}
      if (item.value.byteLength > maximum - size) {throw new PaymentBodyError(413, 'Body too large');}
      if (item.value.byteLength === 0) {continue;}
      // One bounded buffer also limits overhead from many tiny/reused chunks.
      bytes.set(item.value, size);
      size += item.value.byteLength;
    }
    if (expected !== undefined && expected !== size) {throw new PaymentBodyError(400, 'Incomplete request body');}
    return bytes.slice(0, size);
  } catch (error) {
    void reader.cancel(error).catch(() => {});
    if (error instanceof PaymentBodyError) {throw error;}
    throw new PaymentBodyError(400, 'Unreadable request body', error);
  } finally {
    if (timer !== undefined) {clearTimeout(timer);}
    if (abort !== undefined) {request.signal.removeEventListener('abort', abort);}
    reader.releaseLock();
  }
}
