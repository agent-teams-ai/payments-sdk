/** Runnable composition boundary used by E2E. Host authentication/catalog/worker stay explicit. */
import { createServer } from "node:http";
import { PaymentBodyError, paymentRequestBodyLimit, readPaymentBody } from "./request-body.ts";
import type { PaymentBodyLimits } from "./request-body.ts";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createPayments } from "@agent-teams/payments-core";
import type { PaymentRuntimeOptions, Payments, VerifiedInput } from "@agent-teams/payments-core";
import type { ProviderResult } from "@agent-teams/payments-core/provider";

export type WebhookVerifier = (
  body: Uint8Array,
  signature: string,
) => Promise<ProviderResult<VerifiedInput>>;
export type HostedPayments = Pick<
  Payments,
  | "startPurchase"
  | "readPurchase"
  | "readObservedSubscription"
  | "refreshPurchase"
  | "refreshSubscription"
  | "ingestVerifiedInput"
  | "processInbox"
  | "flushPublication"
  | "repair"
  | "registerConsumer"
  | "readDeliveries"
  | "acknowledgeDelivery"
  | "requestCancellation"
  | "openPaymentUpdate"
  | "createManagementLink"
>;

export type PaymentHttpOperations = Pick<HostedPayments, "startPurchase" | "ingestVerifiedInput">;

export async function handlePaymentRequest(
  request: Request,
  payments: PaymentHttpOperations,
  verify: WebhookVerifier,
  authenticate: (request: Request) => Promise<string | undefined>,
  limits: PaymentBodyLimits = {},
): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
  }
  if (path !== "/webhooks/paddle" && path !== "/purchases") {
    return new Response("Not found", { status: 404 });
  }
  let buyerId: string | undefined;
  if (path === "/purchases") {
    try {
      buyerId = await authenticate(request);
    } catch {
      return new Response("Authentication unavailable", { status: 503 });
    }
    if (buyerId === undefined || buyerId === "") {
      return new Response("Unauthorized", { status: 401 });
    }
  }
  let bytes: Uint8Array;
  try {
    bytes = await readPaymentBody(request, limits);
  } catch (error) {
    if (error instanceof PaymentBodyError) {
      return new Response(error.message, { status: error.status });
    }
    throw error;
  }
  if (path === "/webhooks/paddle") {
    try {
      const verified = await verify(bytes, request.headers.get("paddle-signature") ?? "");
      if (verified.kind !== "succeeded") {
        return new Response("Invalid webhook", { status: 401 });
      }
      const admitted = await payments.ingestVerifiedInput(verified.value);
      return new Response(
        admitted.kind === "succeeded" ? "Custody committed" : "Admission rejected",
        { status: admitted.kind === "succeeded" ? 200 : 503 },
      );
    } catch {
      return new Response("Durable admission unavailable", { status: 503 });
    }
  }
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  if (
    body === null ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    !("offerId" in body) ||
    typeof body.offerId !== "string" ||
    body.offerId.length === 0 ||
    !("requestKey" in body) ||
    typeof body.requestKey !== "string" ||
    body.requestKey.length === 0 ||
    buyerId === undefined
  ) {
    return new Response("Invalid command", { status: 400 });
  }
  try {
    return Response.json(
      await payments.startPurchase({ buyerId, offerId: body.offerId, requestKey: body.requestKey }),
    );
  } catch {
    return new Response("Purchase unavailable", { status: 503 });
  }
}

export async function createNodeHttpHost(
  options: PaymentRuntimeOptions,
  verify: WebhookVerifier,
  authenticate: (request: Request) => Promise<string | undefined>,
) {
  const payments = createPayments(options);
  async function respond(incoming: IncomingMessage, outgoing: ServerResponse): Promise<void> {
    try {
      const chunks: Buffer[] = [];
      let bytes = 0;
      for await (const chunk of incoming) {
        const value: unknown = chunk;
        if (typeof value !== "string" && !(value instanceof Uint8Array)) {
          throw new TypeError("Expected an HTTP body byte chunk");
        }
        const buffer = Buffer.from(value);
        bytes += buffer.byteLength;
        if (bytes > paymentRequestBodyLimit) {
          outgoing.writeHead(413).end();
          return;
        }
        chunks.push(buffer);
      }
      const headers = new Headers();
      for (const [key, value] of Object.entries(incoming.headers)) {
        if (value !== undefined) {
          headers.set(key, Array.isArray(value) ? value.join(",") : value);
        }
      }
      const request = new Request(`http://127.0.0.1${incoming.url ?? "/"}`, {
        method: incoming.method ?? "GET",
        headers,
        ...(["GET", "HEAD"].includes(incoming.method ?? "GET")
          ? {}
          : { body: Buffer.concat(chunks) }),
      });
      const response = await handlePaymentRequest(request, payments, verify, authenticate);
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      outgoing.writeHead(500).end();
    }
  }
  const server = createServer(
    { requestTimeout: 15_000, headersTimeout: 10_000, connectionsCheckingInterval: 1_000 },
    (incoming, outgoing) => {
      void respond(incoming, outgoing).catch((error: unknown) => {
        outgoing.destroy(
          error instanceof Error ? error : new Error("HTTP response failed", { cause: error }),
        );
      });
    },
  );
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected TCP listener");
  }
  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => {
    closing ??= (async () => {
      const errors: unknown[] = [];
      try {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error) {
              reject(error);
            } else {
              resolve();
            }
          });
        });
      } catch (error) {
        errors.push(error);
      }
      try {
        payments.stop();
      } catch (error) {
        errors.push(error);
      }
      try {
        await payments.drain();
      } catch (error) {
        errors.push(error);
      }
      if (errors.length !== 0) {
        throw new AggregateError(errors, "Node payment host cleanup failed");
      }
    })().catch((error: unknown) => {
      closing = undefined;
      throw error;
    });
    return closing;
  };
  return { payments, url: `http://127.0.0.1:${address.port}`, close };
}
