import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { EvidenceSource, VerifiedInput } from '@agent-teams/payments-core';
import type { PaymentJobStopResult } from '@agent-teams/payments-postgres';
import { handlePaymentRequest } from '../../examples/node-http.ts';
import type { PaymentHttpOperations, WebhookVerifier } from '../../examples/node-http.ts';
import { readPaymentBody, PaymentBodyError } from '../../examples/request-body.ts';
import { createPaymentHostCloser, failPaymentHostStartup, PaymentHostCloseError } from '../../examples/host-lifecycle.ts';

function streamed(path: string, body: ReadableStream<Uint8Array>, headers: HeadersInit = {}, signal?: AbortSignal): Request {
  const init: RequestInit & { duplex: 'half' } = { method: 'POST', body, duplex: 'half', headers,
    ...(signal === undefined ? {} : { signal }) };
  return new Request(`https://fixture.invalid${path}`, init);
}
function operations(): { api: PaymentHttpOperations; purchases: string[]; admitted: VerifiedInput[] } {
  const purchases: string[] = [], admitted: VerifiedInput[] = [];
  return { purchases, admitted, api: {
    startPurchase: async command => {purchases.push(command.buyerId); return { kind: 'pending', operationId: 'fixture-operation' };},
    ingestVerifiedInput: async input => {admitted.push(input); return { kind: 'succeeded', value: undefined };},
  } };
}
const deny: WebhookVerifier = async () => ({ kind: 'rejected', code: 'validation' });
const buyer = async () => 'authenticated-buyer';

await test('Fetch ingress bounds bytes before full accumulation and cancels without waiting for the producer', async () => {
  let pulls = 0, cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {pulls += 1; controller.enqueue(new Uint8Array(pulls === 1 ? 8 : 1));},
    cancel() {cancelled = true; return new Promise<void>(() => {});},
  }, { highWaterMark: 0 });
  const fixture = operations();
  const response = await handlePaymentRequest(streamed('/purchases', body), fixture.api, deny, buyer, { maxBytes: 8 });
  assert.equal(response.status, 413);
  assert.equal(pulls, 2);
  assert.equal(cancelled, true);
  assert.deepEqual(fixture.purchases, []);
});

await test('zero-length fragments cannot keep the parser spinning without progress', async () => {
  let pulls = 0;
  const body = new ReadableStream<Uint8Array>({pull(controller) {pulls += 1; controller.enqueue(new Uint8Array());}}, { highWaterMark: 0 });
  const response = await handlePaymentRequest(streamed('/purchases', body), operations().api, deny, buyer, { maxBytes: 8 });
  assert.equal(response.status, 413);
  assert.equal(pulls, 10);
});

await test('declared oversize and aborted requests are rejected without requesting stream chunks', async () => {
  for (const mode of ['length', 'abort'] as const) {
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({pull() {pulls += 1;}}, { highWaterMark: 0 });
    const abort = new AbortController();
    if (mode === 'abort') {abort.abort();}
    const request = streamed('/webhooks/paddle', body, mode === 'length' ? { 'content-length': '99999999' } : {}, abort.signal);
    const response = await handlePaymentRequest(request, operations().api, deny, buyer);
    assert.equal(response.status, mode === 'length' ? 413 : 408);
    assert.equal(pulls, 0);
  }
});

await test('a stalled body has an absolute deadline and a caller abort interrupts a pending read', { timeout: 2_000 }, async () => {
  let cancelled = 0;
  const stalled = () => new ReadableStream<Uint8Array>({cancel() {cancelled += 1;}}, { highWaterMark: 0 });
  await assert.rejects(readPaymentBody(streamed('/purchases', stalled()), { timeoutMs: 10 }), (error: unknown) => error instanceof PaymentBodyError && error.status === 408);
  const abort = new AbortController();
  const reading = readPaymentBody(streamed('/purchases', stalled(), {}, abort.signal));
  abort.abort();
  await assert.rejects(reading, (error: unknown) => error instanceof PaymentBodyError && error.status === 408);
  assert.equal(cancelled, 2);
});

await test('invalid JSON, UTF-8 and non-object bodies do not call the payment API', async () => {
  const fixture = operations();
  for (const body of ['{', 'null', '[]', '"text"', '17', '{"offerId":"","requestKey":"r"}', '{"offerId":"p"}']) {
    const response = await handlePaymentRequest(new Request('https://fixture.invalid/purchases', { method: 'POST', body }), fixture.api, deny, buyer);
    assert.equal(response.status, 400, body);
  }
  const invalidUtf8 = new Uint8Array([0x7b, 0xff, 0x7d]);
  const response = await handlePaymentRequest(new Request('https://fixture.invalid/purchases', { method: 'POST', body: invalidUtf8 }), fixture.api, deny, buyer);
  assert.equal(response.status, 400);
  assert.deepEqual(fixture.purchases, []);
  const accepted = await handlePaymentRequest(new Request('https://fixture.invalid/purchases', { method: 'POST', body: '{"offerId":"monthly","requestKey":"r","buyerId":"attacker"}' }), fixture.api, deny, buyer);
  assert.equal(accepted.status, 200);
  assert.deepEqual(fixture.purchases, ['authenticated-buyer']);
});

await test('signed webhook bytes stay exact and success is returned only after durable admission', async () => {
  const raw = new TextEncoder().encode(' { "note": "кредиты", "event": 1 }\n');
  const source: EvidenceSource = { kind: 'verified_webhook', receiptId: 'receipt', representationDigest: 'digest', decoderVersion: 'fixture/1', apiProfile: 'fixture/1' };
  const input: VerifiedInput = { scope: { applicationId: 'fixture', provider: 'fixture', paymentAccountId: 'fixture', environment: 'sandbox' }, inputId: 'receipt', source,
    observation: { kind: 'unsupported', reason: 'fixture', source }, retainedRepresentation: { event: 1 } };
  const fixture = operations();
  const commit = Promise.withResolvers<void>();
  const admitted = Promise.withResolvers<void>();
  fixture.api.ingestVerifiedInput = async value => {assert.equal(value, input); admitted.resolve(); await commit.promise; return { kind: 'succeeded', value: undefined };};
  const verify: WebhookVerifier = async (bytes, signature) => {assert.deepEqual(bytes, raw); assert.equal(signature, 'fixture-signature'); return { kind: 'succeeded', value: input };};
  const body = new ReadableStream<Uint8Array>({start(controller) {controller.enqueue(raw.slice(0, 14)); controller.enqueue(raw.slice(14)); controller.close();}});
  let completed = false;
  const response = handlePaymentRequest(streamed('/webhooks/paddle', body, { 'paddle-signature': 'fixture-signature' }), fixture.api, verify, buyer).then(value => {completed = true; return value;});
  await admitted.promise;
  assert.equal(completed, false);
  commit.resolve();
  assert.equal((await response).status, 200);
  const refused: PaymentHttpOperations = { ...fixture.api, ingestVerifiedInput: async () => {throw new Error('disposable store unavailable');} };
  assert.equal((await handlePaymentRequest(new Request('https://fixture.invalid/webhooks/paddle', {method: 'POST', body: raw, headers: {'paddle-signature': 'fixture-signature'}}), refused, verify, buyer)).status, 503);
});

const drained: PaymentJobStopResult = { transportStopped: true, admittedHandlers: 0, unresolvedExternalCalls: 0, pendingCoreWork: 0 };
await test('a failed worker stop still admits both drains and concurrent callers share physical cleanup', async () => {
  const jobsEntered = Promise.withResolvers<void>(), coreEntered = Promise.withResolvers<void>();
  const jobsReleased = Promise.withResolvers<void>(), coreReleased = Promise.withResolvers<void>();
  const stopFailure = new Error('transport stop failed');
  let attempts = 0, stops = 0, completed = false;
  const close = createPaymentHostCloser({ stop: () => {stops += 1; return { unresolvedExternalCalls: 0, pendingWork: 0 };}, drain: async () => {coreEntered.resolve(); await coreReleased.promise;} }, {
    stop: async () => {attempts += 1; if (attempts === 1) {throw stopFailure;} return drained;},
    drain: async () => {jobsEntered.resolve(); await jobsReleased.promise; return drained;}, status: () => drained,
  });
  const first = close();
  assert.equal(close(), first);
  const rejected = assert.rejects(first, (error: unknown) => error instanceof PaymentHostCloseError && error.errors[0] === stopFailure && error.report === drained).then(() => {completed = true; return undefined;});
  await Promise.all([jobsEntered.promise, coreEntered.promise]);
  jobsReleased.resolve();
  await Promise.resolve();
  assert.equal(completed, false);
  coreReleased.resolve();
  await rejected;
  assert.equal(stops, 1);
  assert.equal(await close(), drained);
  assert.equal(attempts, 2);
});

await test('startup cleanup preserves the original cause and collects independent cleanup failures', async () => {
  const initial = new Error('startup failed'), stopCore = new Error('stop core'), stopJobs = new Error('stop jobs'), drainCore = new Error('drain core'), drainJobs = new Error('drain jobs');
  const close = createPaymentHostCloser({stop: () => {throw stopCore;}, drain: async () => {throw drainCore;}}, {
    stop: async () => {throw stopJobs;}, drain: async () => {throw drainJobs;}, status: () => drained,
  });
  await assert.rejects(failPaymentHostStartup(initial, close), (error: unknown) => {
    assert.ok(error instanceof AggregateError);
    assert.equal(error.cause, initial);
    assert.equal(error.errors[0], initial);
    const cleanup: unknown = error.errors[1];
    assert.ok(cleanup instanceof PaymentHostCloseError);
    assert.deepEqual(new Set(cleanup.errors), new Set([stopCore, stopJobs, drainCore, drainJobs]));
    return true;
  });
});
