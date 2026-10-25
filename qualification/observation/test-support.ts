import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { MockAgent, getGlobalDispatcher, install, setGlobalDispatcher } from "undici";
import { createPayments } from "@agent-teams/payments-core";
import type {
  EvidenceMessage,
  OfferSnapshot,
  OperationResult,
  PaymentScope,
  Payments,
} from "@agent-teams/payments-core";
import type { ProviderResult } from "@agent-teams/payments-core/provider";
import { createPaddleProvider } from "@agent-teams/payments-paddle";
import { createNodePostgresPaymentDatabase } from "@agent-teams/payments-postgres/node-postgres";
import { createPostgresPaymentStore, migratePaymentSchema } from "@agent-teams/payments-postgres";
import { AccessFixture, CreditFixture } from "../../tests/fixtures/consumers/index.ts";
import { eventFixture, paddleIds } from "@agent-teams/payments-paddle/testing";

export const scope: PaymentScope = {
  applicationId: "app-a",
  provider: "paddle",
  paymentAccountId: "merchant-fixture",
  environment: "sandbox",
};
export const producerNamespace = "observation-qualification-v1";
export const monthlyOffer: OfferSnapshot = {
  applicationId: "app-a",
  offerId: "monthly",
  version: "offer-v1",
  policyVersion: "catalog-policy-v1",
  profile: "monthly",
  currency: "USD",
  allowZeroTotal: false,
  lines: [{ providerPriceRef: paddleIds.price, benefitSlotId: "included", quantity: 1 }],
};
export const topupOffer: OfferSnapshot = {
  ...monthlyOffer,
  offerId: "topup",
  profile: "one_time",
  lines: [{ providerPriceRef: paddleIds.price, benefitSlotId: "purchased", quantity: 1 }],
};
const secret = "synthetic-observation-qualification-secret";

export function success<T>(result: OperationResult<T> | ProviderResult<T>): T {
  assert.equal(result.kind, "succeeded", JSON.stringify(result));

  return result.value;
}

/** Test-process transport only. No unmatched URL can reach the network. */
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
  );
  const original = getGlobalDispatcher();
  install();
  const agent = new MockAgent();
  agent.disableNetConnect();
  setGlobalDispatcher(agent);
  return {
    agent,
    api: agent.get("https://sandbox-api.paddle.com"),
    async close() {
      setGlobalDispatcher(original);
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

/** Reuses the existing independently owned credit/access fixtures; no copied ledger. */
export async function durableWorld() {
  const connectionString = process.env["DATABASE_URL"];
  if (connectionString === undefined || connectionString === "") {
    throw new Error(
      "DATABASE_URL is mandatory: observation qualification requires real PostgreSQL18",
    );
  }
  const pool = new Pool({ connectionString, max: 12, connectionTimeoutMillis: 1000 });
  const database = createNodePostgresPaymentDatabase(pool);
  const prefix = `observation_${randomUUID().replaceAll("-", "").slice(0, 14)}`;
  const schema = `${prefix}_payments`;
  const trust = { producerNamespace, scope };
  const credit = new CreditFixture({ pool, schema: `${prefix}_credit`, trust });
  const access = new AccessFixture({
    pool,
    schema: `${prefix}_access`,
    trust,
    now: () => "2026-10-15T00:00:00Z",
  });
  const provider = createPaddleProvider({
    scope,
    apiKey: "synthetic-never-valid-key",
    apiVersion: 1,
    webhook: { endpointId: "observation-fixture-destination", secret, apiVersion: 1 },
  });
  try {
    const version = await pool.query<{ server_version_num: string }>("SHOW server_version_num");
    assert.equal(Math.floor(Number(version.rows[0]?.server_version_num) / 10_000), 18);
    await migratePaymentSchema({ database, schema, scope });
    await credit.migrate();
    await access.migrate();
    const store = await createPostgresPaymentStore({ database, schema, scope });
    const payments = createPayments({
      scope,
      producerNamespace,
      provider,
      store,
      catalog: {
        resolveOffer: async (_scope, id) =>
          id === "monthly" ? monthlyOffer : id === "topup" ? topupOffer : undefined,
      },
      now: () => "2026-10-15T00:00:00Z",
    });
    let sequence = 100;
    return {
      pool,
      provider,
      payments,
      credit,
      access,
      async ingest(type: string, data: Record<string, unknown>) {
        const body = JSON.stringify(
          eventFixture(type, data, `evt_${String(++sequence).padStart(26, "0")}`),
        );
        const ts = Math.floor(Date.now() / 1000);
        const signature = `ts=${ts};h1=${createHmac("sha256", secret).update(`${ts}:${body}`).digest("hex")}`;
        const input = success(await provider.verifyWebhook(Buffer.from(body), signature));
        success(await payments.ingestVerifiedInput(input)); // T1 finishes before reduction.
        assert.equal(await payments.processInbox(input.inputId), "processed");
        await payments.repair(100);
        return input;
      },
      async close() {
        payments.stop();
        await payments.drain();
        await pool.query(
          `DROP SCHEMA IF EXISTS "${schema}" CASCADE; DROP SCHEMA IF EXISTS ${credit.owner.sql} CASCADE; DROP SCHEMA IF EXISTS ${access.owner.sql} CASCADE`,
        );
        await pool.end();
      },
    };
  } catch (error) {
    await pool
      .query(
        `DROP SCHEMA IF EXISTS "${schema}" CASCADE; DROP SCHEMA IF EXISTS ${credit.owner.sql} CASCADE; DROP SCHEMA IF EXISTS ${access.owner.sql} CASCADE`,
      )
      .catch(() => {});
    await pool.end();
    throw error;
  }
}

export async function deliver(
  payments: Payments,
  consumerId: string,
  consumer: CreditFixture | AccessFixture,
  acknowledge = true,
): Promise<readonly EvidenceMessage[]> {
  const messages = await payments.readDeliveries(consumerId, 100);
  for (const message of messages) {
    assert.equal((await consumer.receive(message)).acknowledge, true);
    if (acknowledge) {
      assert.equal(
        await payments.acknowledgeDelivery(consumerId, message.messageId, message.bodyDigest),
        "acknowledged",
      );
    }
  }
  return messages;
}
