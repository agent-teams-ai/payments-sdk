/** Connected test composition only: real SDK, real PostgreSQL and independently owned T3 fixtures. */
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { request as httpRequest } from "node:http";
import { Pool } from "pg";
import { MockAgent, getGlobalDispatcher, install, setGlobalDispatcher } from "undici";
import type {
  CheckoutReady,
  EvidenceMessage,
  OfferSnapshot,
  OperationResult,
  VerifiedInput,
} from "@agent-teams/payments-core";
import { createPaddleProvider } from "@agent-teams/payments-paddle";
import { createPostgresPaymentStore, migratePaymentSchema } from "@agent-teams/payments-postgres";
import { createNodePostgresPaymentDatabase } from "@agent-teams/payments-postgres/node-postgres";
import { createNodeHttpHost } from "../../examples/node-http.ts";
import { createFetchModularHost } from "../../examples/fetch-modular.ts";
import { AccessFixture, CreditFixture } from "../fixtures/consumers/index.ts";
import type { Effect } from "../fixtures/consumers/index.ts";
import {
  eventFixture,
  paddleIds,
  responseFixture,
  subscriptionFixture,
  transactionFixture,
} from "../fixtures/paddle/fixtures.ts";
import type { FixtureObject } from "../fixtures/paddle/fixtures.ts";
import { offer, producerNamespace, scope } from "./consumer-support.ts";

const secret = "synthetic-subscription-credit-secret";
export const hostKinds = ["node-http-factory", "fetch-static-gm"] as const;
type HostKind = (typeof hostKinds)[number];
type Host =
  | Awaited<ReturnType<typeof createNodeHttpHost>>
  | Awaited<ReturnType<typeof createFetchModularHost>>;
export const identifier = (prefix: string, sequence: number): string =>
  `${prefix}_${String(sequence).padStart(26, "0")}`;
export const periods = [
  { starts_at: "2026-10-01T00:00:00.123456Z", ends_at: "2026-11-01T00:00:00.123456Z" },
  { starts_at: "2026-11-01T00:00:00.123456Z", ends_at: "2026-12-01T00:00:00.123456Z" },
  { starts_at: "2026-12-01T00:00:00.123456Z", ends_at: "2027-01-01T00:00:00.123456Z" },
] as const;
export function success<T>(result: OperationResult<T>): T {
  assert.equal(result.kind, "succeeded", JSON.stringify(result));
  return result.value;
}
async function authenticateBuyer(): Promise<string> {
  return "buyer-a";
}
export function lifecycle(
  status: string,
  version: string,
  period: (typeof periods)[number] = periods[0],
): FixtureObject {
  const terminal = status === "paused" || status === "canceled";
  return {
    ...subscriptionFixture({ status, version }),
    current_billing_period: terminal ? null : period,
    next_billed_at: terminal ? null : period.ends_at,
    paused_at: status === "paused" ? version : null,
    canceled_at: status === "canceled" ? version : null,
  };
}
export function recurring(
  id: string,
  intentId: string,
  index: 1 | 2,
  status = "completed",
  version: string = periods[index].starts_at,
): FixtureObject {
  // A renewal is associated through the locally owned subscription, never trusted custom_data.
  return {
    ...transactionFixture({ id, intentId, origin: "subscription_recurring", status, version }),
    custom_data: null,
    billing_period: periods[index],
  };
}

/** Transport is replaced only in this isolated test process; SDK resources and constructors run. */
export function emulatePaddle() {
  const names = [
    "fetch",
    "Headers",
    "Response",
    "Request",
    "FormData",
    "WebSocket",
    "CloseEvent",
    "ErrorEvent",
    "MessageEvent",
    "EventSource",
  ] as const;
  const saved = names.map(
      (name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const,
    ),
    previous = getGlobalDispatcher();
  install();
  const agent = new MockAgent();
  agent.disableNetConnect();
  setGlobalDispatcher(agent);
  return {
    agent,
    api: agent.get("https://sandbox-api.paddle.com"),
    async close() {
      setGlobalDispatcher(previous);
      await agent.close();
      for (const [name, descriptor] of saved) {
        if (descriptor) {
          Object.defineProperty(globalThis, name, descriptor);
        } else {
          Reflect.deleteProperty(globalThis, name);
        }
      }
    },
  };
}

async function post(
  host: Host,
  path: string,
  body: string,
  headers: Record<string, string>,
): Promise<Readonly<{ status: number; body: string }>> {
  if (!("url" in host)) {
    const response = await host.handle(
      new Request(`https://fixture.test${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body,
      }),
    );
    return { status: response.status, body: await response.text() };
  }
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      new URL(path, host.url),
      { method: "POST", headers: { "content-type": "application/json", ...headers } },
      (response) => {
        const chunks: Uint8Array[] = [];
        response.on("data", (value: unknown) => {
          if (typeof value === "string" || value instanceof Uint8Array) {
            chunks.push(Buffer.from(value));
          } else {
            reject(new TypeError("Unexpected HTTP response body"));
          }
        });
        response.on("end", () => {
          resolve({
            status: response.statusCode ?? 500,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    request.on("error", reject);
    request.end(body);
  });
}

export async function subscriptionContext(
  kind: HostKind,
  emulation: ReturnType<typeof emulatePaddle>,
) {
  const connectionString = process.env["DATABASE_URL"];
  assert.ok(connectionString !== undefined && connectionString !== "", "DATABASE_URL is required");
  const pool = new Pool({ connectionString, max: 8, connectionTimeoutMillis: 1000 });
  const database = createNodePostgresPaymentDatabase(pool);
  const prefix = `subscription_${randomUUID().replaceAll("-", "").slice(0, 16)}`,
    schema = `${prefix}_payments`;
  const trust = { producerNamespace, scope };
  let now = "2026-10-15T00:00:00Z",
    sequence = 1000,
    creates = 0,
    host: Host | undefined;
  let credit = new CreditFixture({ pool, schema: `${prefix}_credit`, trust });
  let access = new AccessFixture({ pool, schema: `${prefix}_access`, trust, now: () => now });
  const provider = createPaddleProvider({
    scope,
    apiKey: "synthetic-never-valid-key",
    apiVersion: 1,
    webhook: { endpointId: "subscription-credit-destination", secret, apiVersion: 1 },
  });
  const topup: OfferSnapshot = {
    ...offer,
    offerId: "topup",
    profile: "one_time",
    lines: [{ providerPriceRef: paddleIds.price, benefitSlotId: "purchased", quantity: 1 }],
  };
  async function open(): Promise<void> {
    const store = await createPostgresPaymentStore({ database, schema, scope });
    const options = {
      scope,
      producerNamespace,
      provider,
      store,
      catalog: {
        resolveOffer: async (_scope: unknown, offerId: string) =>
          ({ monthly: offer, topup } as Record<string, OfferSnapshot>)[offerId],
      },
      now: () => now,
    };
    const verify = provider.verifyWebhook.bind(provider);
    host =
      kind === "node-http-factory"
        ? await createNodeHttpHost(options, verify, authenticateBuyer)
        : await createFetchModularHost(options, verify, authenticateBuyer);
  }
  try {
    await migratePaymentSchema({ database, schema, scope });
    await credit.migrate();
    await access.migrate();
    await open();
  } catch (error) {
    await pool.end();
    throw error;
  }
  const current = (): Host => {
    assert.ok(host);
    return host;
  };
  async function deliver(
    consumerId: string,
    consumer: CreditFixture | AccessFixture,
  ): Promise<readonly EvidenceMessage[]> {
    const messages = await current().payments.readDeliveries(consumerId, 100);
    for (const message of messages) {
      assert.equal((await consumer.receive(message)).acknowledge, true);
      assert.equal(
        await current().payments.acknowledgeDelivery(
          consumerId,
          message.messageId,
          message.bodyDigest,
        ),
        "acknowledged",
      );
    }
    return messages;
  }
  async function webhook(event: FixtureObject): Promise<void> {
    const body = JSON.stringify(event),
      timestamp = Math.floor(Date.now() / 1000);
    const signature = `ts=${timestamp};h1=${createHmac("sha256", secret).update(`${timestamp}:${body}`).digest("hex")}`;
    assert.equal(
      (await post(current(), "/webhooks/paddle", body, { "paddle-signature": signature })).status,
      200,
    );
  }
  return {
    pool,
    schema,
    provider,
    get payments() {
      return current().payments;
    },
    get credit() {
      return credit;
    },
    get access() {
      return access;
    },
    get creates() {
      return creates;
    },
    setNow: (time: string) => {
      now = time;
    },
    event(type: string, data: FixtureObject): FixtureObject {
      return {
        ...eventFixture(type, data, identifier("evt", ++sequence)),
        occurred_at: data["updated_at"],
      };
    },
    webhook,
    async observe(type: string, data: FixtureObject): Promise<FixtureObject> {
      const event = this.event(type, data);
      await webhook(event);
      return event;
    },
    async purchase(
      offerId: "monthly" | "topup",
      transactionRef: string,
      requestKey = transactionRef,
    ): Promise<CheckoutReady> {
      emulation.api
        .intercept({
          path: /^\/transactions\??$/u,
          method: "POST",
          headers: { "paddle-version": "1" },
        })
        .reply(201, (request) => {
          creates += 1;
          assert.ok(typeof request.body === "string");
          const body = JSON.parse(request.body) as {
            items: unknown;
            collection_mode: string;
            custom_data: {
              payments: {
                intentId: string;
                paymentAccountId: string;
                applicationId: string;
                environment: string;
              };
            };
          };
          assert.deepEqual(body.items, [{ price_id: paddleIds.price, quantity: 1 }]);
          assert.equal(body.collection_mode, "automatic");
          assert.deepEqual(
            [
              body.custom_data.payments.applicationId,
              body.custom_data.payments.paymentAccountId,
              body.custom_data.payments.environment,
            ],
            ["app-a", "merchant-fixture", "sandbox"],
          );
          return responseFixture(
            transactionFixture({
              id: transactionRef,
              monthly: offerId === "monthly",
              intentId: body.custom_data.payments.intentId,
              status: "ready",
              customerRef: null,
              subscriptionRef: null,
            }),
          );
        });
      const response = await post(
        current(),
        "/purchases",
        JSON.stringify({ offerId, requestKey, buyerId: "ignored-victim" }),
        {},
      );
      assert.equal(response.status, 200);
      return success(JSON.parse(response.body) as OperationResult<CheckoutReady>);
    },
    async apiEvents(events: readonly FixtureObject[]): Promise<void> {
      emulation.api
        .intercept({
          path: (path) => path.startsWith("/events?"),
          method: "GET",
          headers: { "paddle-version": "1" },
        })
        .reply(200, responseFixture(events));
      const result = await provider.readEventPage({
        from: "2026-10-01T00:00:00Z",
        to: "2027-02-01T00:00:00Z",
        epoch: "subscription-credit-matrix",
        queryVersion: "matrix/1",
      });
      assert.equal(result.kind, "page");
      assert.equal(result.inputs.length, events.length);
      for (const input of result.inputs) {
        assert.equal(input.source.kind, "authenticated_api");
        assert.equal(input.source.sdkVersion, "3.10.0");
        success(await current().payments.ingestVerifiedInput(input));
        assert.ok(
          ["processed", "duplicate"].includes(await current().payments.processInbox(input.inputId)),
        );
      }
    },
    async flush() {
      await current().payments.repair(100);
      await deliver("credit", credit);
      await deliver("access", access);
    },
    async register() {
      await current().payments.registerConsumer("credit");
      await current().payments.registerConsumer("access");
    },
    async restart() {
      await current().close();
      host = undefined;
      credit = new CreditFixture({ pool, schema: credit.owner.options.schema, trust });
      access = new AccessFixture({
        pool,
        schema: access.owner.options.schema,
        trust,
        now: () => now,
      });
      await open();
    },
    async effects(): Promise<readonly Effect[]> {
      return (await credit.owner.inspect<{ body: Effect }>("effects")).map((row) => row.body);
    },
    async inputs(): Promise<readonly VerifiedInput[]> {
      return (
        await pool.query<{ input: VerifiedInput }>(
          `SELECT body->'input' AS input FROM "${schema}".records WHERE kind='inbox' ORDER BY id`,
        )
      ).rows.map((row) => row.input);
    },
    async close() {
      await host?.close();
      await pool.query(
        `DROP SCHEMA "${schema}" CASCADE; DROP SCHEMA ${credit.owner.sql} CASCADE; DROP SCHEMA ${access.owner.sql} CASCADE`,
      );
      await pool.end();
    },
  };
}
export type SubscriptionContext = Awaited<ReturnType<typeof subscriptionContext>>;
