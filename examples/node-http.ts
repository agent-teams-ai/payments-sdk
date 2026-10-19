/** Runnable composition boundary used by E2E. Host authentication/catalog/worker stay explicit. */
import { createServer } from 'node:http';
import { createPayments } from '@agent-teams/payments-core';
import type { PaymentRuntimeOptions, Payments, ProviderResult, VerifiedInput } from '@agent-teams/payments-core';

export type WebhookVerifier = (body: Uint8Array, signature: string) => Promise<ProviderResult<VerifiedInput>>;
export type HostedPayments = Pick<Payments, 'startPurchase' | 'readPurchase' | 'readObservedSubscription' | 'refreshPurchase' | 'refreshSubscription' | 'ingestVerifiedInput' | 'processInbox' | 'flushPublication' | 'repair' | 'registerConsumer' | 'readDeliveries' | 'acknowledgeDelivery' | 'requestCancellation' | 'openPaymentUpdate' | 'createManagementLink'>;

export async function handlePaymentRequest(request: Request, payments: HostedPayments, verify: WebhookVerifier, authenticate: (request: Request) => Promise<string | undefined>): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  if (path === '/webhooks/paddle') {
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.byteLength > 65_536) return new Response('Body too large', { status: 413 });
    const verified = await verify(bytes, request.headers.get('paddle-signature') ?? '');
    if (verified.kind !== 'succeeded') return new Response('Invalid webhook', { status: 401 });
    try {
      const admitted = await payments.ingestVerifiedInput(verified.value);
      return new Response(admitted.kind === 'succeeded' ? 'Custody committed' : 'Admission rejected', { status: admitted.kind === 'succeeded' ? 200 : 503 });
    } catch { return new Response('Durable admission unavailable', { status: 503 }); }
  }
  if (path !== '/purchases') return new Response('Not found', { status: 404 });
  const buyerId = await authenticate(request);
  if (!buyerId) return new Response('Unauthorized', { status: 401 });
  const body = await request.json() as Record<string, unknown>;
  if (typeof body['offerId'] !== 'string' || typeof body['requestKey'] !== 'string') return new Response('Invalid command', { status: 400 });
  return Response.json(await payments.startPurchase({ buyerId, offerId: body['offerId'], requestKey: body['requestKey'] }));
}

export async function createNodeHttpHost(options: PaymentRuntimeOptions, verify: WebhookVerifier, authenticate: (request: Request) => Promise<string | undefined>) {
  const payments = createPayments(options);
  const server = createServer(async (incoming, outgoing) => {
    try {
      const chunks: Buffer[] = []; let bytes = 0;
      for await (const chunk of incoming) { const buffer = Buffer.from(chunk); bytes += buffer.byteLength; if (bytes > 65_536) { outgoing.writeHead(413).end(); return; } chunks.push(buffer); }
      const headers = new Headers();
      for (const [key, value] of Object.entries(incoming.headers)) if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(',') : value);
      const request = new Request(`http://127.0.0.1${incoming.url ?? '/'}`, { method: incoming.method ?? 'GET', headers, ...((incoming.method ?? 'GET') === 'GET' ? {} : { body: Buffer.concat(chunks) }) });
      const response = await handlePaymentRequest(request, payments, verify, authenticate);
      outgoing.writeHead(response.status, Object.fromEntries(response.headers)); outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch { outgoing.writeHead(500).end(); }
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Expected TCP listener');
  return { payments, url: `http://127.0.0.1:${address.port}`, async close() { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); payments.stop(); await payments.drain(); } };
}
