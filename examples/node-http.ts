/** Runnable composition boundary used by E2E. Host authentication/catalog/worker stay explicit. */
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createPayments } from '@agent-teams/payments-core';
import type { PaymentRuntimeOptions, Payments, VerifiedInput } from '@agent-teams/payments-core';
import type { ProviderResult } from '@agent-teams/payments-core/provider';

export type WebhookVerifier = (body: Uint8Array, signature: string) => Promise<ProviderResult<VerifiedInput>>;
export type HostedPayments = Pick<Payments, 'startPurchase' | 'readPurchase' | 'readObservedSubscription' | 'refreshPurchase' | 'refreshSubscription' | 'ingestVerifiedInput' | 'processInbox' | 'flushPublication' | 'repair' | 'registerConsumer' | 'readDeliveries' | 'acknowledgeDelivery' | 'requestCancellation' | 'openPaymentUpdate' | 'createManagementLink'>;

export async function handlePaymentRequest(request: Request, payments: HostedPayments, verify: WebhookVerifier, authenticate: (request: Request) => Promise<string | undefined>): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (request.method !== 'POST') {return new Response('Method not allowed', { status: 405 });}
  if (path === '/webhooks/paddle') {
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.byteLength > 65_536) {return new Response('Body too large', { status: 413 });}
    const verified = await verify(bytes, request.headers.get('paddle-signature') ?? '');
    if (verified.kind !== 'succeeded') {return new Response('Invalid webhook', { status: 401 });}
    try {
      const admitted = await payments.ingestVerifiedInput(verified.value);
      return new Response(admitted.kind === 'succeeded' ? 'Custody committed' : 'Admission rejected', { status: admitted.kind === 'succeeded' ? 200 : 503 });
    } catch { return new Response('Durable admission unavailable', { status: 503 }); }
  }
  if (path !== '/purchases') {return new Response('Not found', { status: 404 });}
  const buyerId = await authenticate(request);
  if (buyerId === undefined || buyerId === '') {return new Response('Unauthorized', { status: 401 });}
  const body = await request.json() as Record<string, unknown>;
  if (typeof body['offerId'] !== 'string' || typeof body['requestKey'] !== 'string') {return new Response('Invalid command', { status: 400 });}
  return Response.json(await payments.startPurchase({ buyerId, offerId: body['offerId'], requestKey: body['requestKey'] }));
}

export async function createNodeHttpHost(options: PaymentRuntimeOptions, verify: WebhookVerifier, authenticate: (request: Request) => Promise<string | undefined>) {
  const payments = createPayments(options);
  async function respond(incoming: IncomingMessage, outgoing: ServerResponse): Promise<void> {
    try {
      const chunks: Buffer[] = []; let bytes = 0;
      for await (const chunk of incoming) {
        const value: unknown = chunk;
        if (typeof value !== 'string' && !(value instanceof Uint8Array)) { throw new TypeError('Expected an HTTP body byte chunk'); }
        const buffer = Buffer.from(value);
        bytes += buffer.byteLength;
        if (bytes > 65_536) { outgoing.writeHead(413).end(); return; }
        chunks.push(buffer);
      }
      const headers = new Headers();
      for (const [key, value] of Object.entries(incoming.headers)) {if (value !== undefined) {headers.set(key, Array.isArray(value) ? value.join(',') : value);}}
      const request = new Request(`http://127.0.0.1${incoming.url ?? '/'}`, { method: incoming.method ?? 'GET', headers, ...((incoming.method ?? 'GET') === 'GET' ? {} : { body: Buffer.concat(chunks) }) });
      const response = await handlePaymentRequest(request, payments, verify, authenticate);
      outgoing.writeHead(response.status, Object.fromEntries(response.headers)); outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch { outgoing.writeHead(500).end(); }
  }
  const server = createServer((incoming, outgoing) => {
    void respond(incoming, outgoing).catch((error: unknown) => {
      outgoing.destroy(error instanceof Error ? error : new Error('HTTP response failed', { cause: error }));
    });
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address(); if (address === null || typeof address === 'string') {throw new Error('Expected TCP listener');}
  return { payments, url: `http://127.0.0.1:${address.port}`, async close() {
    await new Promise<void>((resolve, reject) => {
      server.close(error => { if (error) { reject(error); } else { resolve(); } });
    });
    payments.stop(); await payments.drain();
  } };
}
