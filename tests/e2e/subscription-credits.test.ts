import assert from "node:assert/strict";
import test from "node:test";
import type { AccessDecision } from "../fixtures/consumers/index.ts";
import {
  adjustmentFixture,
  paddleIds,
  responseFixture,
  transactionFixture,
} from "../fixtures/paddle/fixtures.ts";
import {
  emulatePaddle,
  hostKinds,
  identifier,
  lifecycle,
  periods,
  recurring,
  subscriptionContext,
  success,
} from "./subscription-credits-fixture.ts";
import type { SubscriptionContext } from "./subscription-credits-fixture.ts";

function subscriptionPath(value: string): boolean {
  return (
    new URL(value, "https://sandbox-api.paddle.com").pathname ===
    `/subscriptions/${paddleIds.subscription}`
  );
}
async function grantIds(context: SubscriptionContext): Promise<readonly string[]> {
  return (await context.credit.decisions())
    .map((row) => row.body.originalGrant ?? "")
    .toSorted((a, b) => a.localeCompare(b));
}

// Independent acceptance oracle: one paid monthly period gives Q=100, an intentional
// separate one-time purchase gives T=25. No price conversion, spend, rollover or expiry policy.
async function assertCredits(
  context: SubscriptionContext,
  included: number,
  purchased: number,
): Promise<void> {
  const decisions = (await context.credit.decisions()).map((row) => row.body);
  assert.deepEqual(
    decisions
      .filter((row) => row.bucket === "included")
      .map((row) => [row.status, row.allocated, row.eligible, row.held]),
    Array.from({ length: included }, () => ["issued", "100", "100", "0"]),
  );
  assert.deepEqual(
    decisions
      .filter((row) => row.bucket === "purchased")
      .map((row) => [row.status, row.allocated, row.eligible, row.held]),
    Array.from({ length: purchased }, () => ["issued", "25", "25", "0"]),
  );
  const effects = await context.effects();
  assert.equal(effects.filter((effect) => effect.kind === "grant").length, included + purchased);
  assert.equal(new Set(decisions.map((row) => row.originalGrant)).size, included + purchased);
  assert.equal(
    effects.reduce((sum, effect) => sum + BigInt(effect.amount), 0n),
    BigInt(included * 100 + purchased * 25),
  );
}
async function permission(
  context: SubscriptionContext,
  status: string,
  allowed: boolean,
): Promise<AccessDecision> {
  const decisions = await context.access.decisions();
  assert.equal(decisions.length, 1);
  const decision = decisions[0]!.body;
  assert.deepEqual(
    [
      decision.status,
      decision.newAction,
      decision.expand,
      decision.read,
      decision.export,
      decision.cancel,
    ],
    [status, allowed, allowed, true, true, true],
  );
  return decision;
}
async function initial(context: SubscriptionContext) {
  await context.register();
  const checkout = await context.purchase("monthly", paddleIds.transaction);
  const event = await context.observe(
    "transaction.completed",
    transactionFixture({ intentId: checkout.intentId }),
  );
  await context.observe("subscription.activated", lifecycle("active", "2026-10-01T00:00:01Z"));
  await context.flush();
  await assertCredits(context, 1, 0);
  await permission(context, "active", true);
  const purchase = await context.payments.readPurchase("buyer-a", checkout.intentId);
  assert.ok(
    purchase?.intent.subscriptionBasisId !== undefined &&
      purchase.intent.subscriptionBasisId !== "",
  );
  return { checkout, event, bindingId: purchase.intent.subscriptionBasisId };
}

void test(
  "monthly credits remain one grant per paid period through SDK/webhook cross-receipts, stale lifecycle and restart at both hosts",
  { timeout: 60_000 },
  async (t) => {
    const emulation = emulatePaddle();
    try {
      for (const kind of hostKinds) {
        await t.test(kind, async () => {
          const context = await subscriptionContext(kind, emulation);
          try {
            const { checkout, event: initialEvent } = await initial(context);
            const initialFact = (await context.payments.readPurchase("buyer-a", checkout.intentId))!
              .transactions[0]!.completion!;
            context.setNow("2026-11-01T00:00:01Z");
            // Paddle advances lifecycle before the renewal is completed. Billed/paid is not Q.
            await context.observe(
              "subscription.updated",
              lifecycle("active", "2026-11-01T00:00:01Z", periods[1]),
            );
            await context.observe(
              "transaction.billed",
              recurring(
                paddleIds.secondTransaction,
                checkout.intentId,
                1,
                "billed",
                "2026-11-01T00:00:01Z",
              ),
            );
            await context.observe(
              "transaction.paid",
              recurring(
                paddleIds.secondTransaction,
                checkout.intentId,
                1,
                "paid",
                "2026-11-01T00:00:02Z",
              ),
            );
            await context.flush();
            await assertCredits(context, 1, 0);
            const unpaid = await permission(context, "active", false);
            assert.ok(unpaid.restrictions.includes("paid_period_expired"));
            const november = await context.observe(
              "transaction.completed",
              recurring(
                paddleIds.secondTransaction,
                checkout.intentId,
                1,
                "completed",
                "2026-11-01T00:00:03Z",
              ),
            );
            await context.flush();
            await assertCredits(context, 2, 0);
            assert.equal((await permission(context, "active", true)).paidUntil, periods[1].ends_at);
            const firstTwoGrants = await grantIds(context);
            await context.restart();
            // The same provider event now arrives through SDK Event constructors, as well as a
            // new delivery notification for the original event. Neither is a second payment.
            await context.apiEvents([initialEvent, november]);
            await context.webhook({ ...november, notification_id: identifier("ntf", 2000) });
            await context.observe(
              "transaction.billed",
              recurring(
                paddleIds.secondTransaction,
                checkout.intentId,
                1,
                "billed",
                "2026-11-01T00:00:01Z",
              ),
            );
            await context.observe(
              "subscription.past_due",
              lifecycle("past_due", "2026-11-01T00:00:00Z", periods[1]),
            );
            await context.flush();
            await assertCredits(context, 2, 0);
            await permission(context, "active", true);
            assert.deepEqual(await grantIds(context), firstTwoGrants);

            context.setNow("2026-12-01T00:00:05Z");
            const decemberRef = identifier("txn", 3),
              december = context.event(
                "transaction.completed",
                recurring(decemberRef, checkout.intentId, 2, "completed", "2026-12-01T00:00:03Z"),
              );
            // Reverse acquisition order for the next paid month: API first, raw webhook later.
            await context.apiEvents([december]);
            await context.observe(
              "subscription.updated",
              lifecycle("active", "2026-12-01T00:00:04Z", periods[2]),
            );
            await context.flush();
            await assertCredits(context, 3, 0);
            await context.restart();
            await context.webhook(december);
            await context.webhook({ ...december, notification_id: identifier("ntf", 2001) });
            await context.apiEvents([initialEvent, november, december]);
            await context.flush();
            await assertCredits(context, 3, 0);
            assert.equal((await permission(context, "active", true)).paidUntil, periods[2].ends_at);
            const credits = (await context.credit.decisions())
              .map((row) => row.body)
              .toSorted((a, b) => a.period!.startsAt.localeCompare(b.period!.startsAt));
            assert.deepEqual(
              credits.map((row) => row.period),
              periods.map((period) => ({ startsAt: period.starts_at, endsAt: period.ends_at })),
            );
            const paid = await context.payments.readPurchase("buyer-a", checkout.intentId);
            assert.ok(paid);
            assert.deepEqual(
              paid.transactions
                .map((row) => row.completion?.classification ?? "missing")
                .toSorted((a, b) => a.localeCompare(b)),
              ["initial", "renewal", "renewal"],
            );
            assert.ok(
              paid.transactions.every(
                (row) => row.completion !== undefined && row.flags.length === 0,
              ),
            );
            assert.deepEqual(
              paid.transactions.find((row) => row.transactionRef === paddleIds.transaction)
                ?.completion,
              initialFact,
            );
            const inputs = await context.inputs();
            for (const event of [initialEvent, november, december]) {
              const receipts = inputs.filter((input) => input.source.eventId === event["event_id"]);
              assert.deepEqual(
                new Set(receipts.map((input) => input.source.kind)),
                new Set(["verified_webhook", "authenticated_api"]),
              );
            }
            assert.equal(context.creates, 1, "renewal observations do not create new purchases");
            assert.equal((await context.payments.readDeliveries("credit", 100)).length, 0);
            assert.equal((await context.payments.readDeliveries("access", 100)).length, 0);
            emulation.agent.assertNoPendingInterceptors();
          } finally {
            await context.close();
          }
        });
      }
    } finally {
      await emulation.close();
    }
  },
);

void test(
  "independent credit purchases survive restricted subscription states; refunds and chargebacks correct only their causal grants",
  { timeout: 60_000 },
  async (t) => {
    const emulation = emulatePaddle();
    try {
      for (const kind of hostKinds) {
        await t.test(kind, async () => {
          const context = await subscriptionContext(kind, emulation);
          try {
            const { checkout } = await initial(context);
            const topups: {
              intentId: string;
              transactionRef: string;
              event: Record<string, unknown>;
            }[] = [];
            const states = [
              {
                status: "active",
                type: "subscription.updated",
                allowed: true,
                version: "2026-10-15T00:00:01Z",
              },
              {
                status: "past_due",
                type: "subscription.past_due",
                allowed: false,
                version: "2026-11-01T00:00:02Z",
              },
              {
                status: "paused",
                type: "subscription.paused",
                allowed: false,
                version: "2026-11-02T00:00:01Z",
              },
              {
                status: "canceled",
                type: "subscription.canceled",
                allowed: false,
                version: "2026-11-03T00:00:01Z",
              },
            ] as const;
            for (const [index, state] of states.entries()) {
              context.setNow(state.version);
              if (state.status === "past_due") {
                await context.observe(
                  "transaction.payment_failed",
                  recurring(
                    paddleIds.secondTransaction,
                    checkout.intentId,
                    1,
                    "past_due",
                    "2026-11-01T00:00:01Z",
                  ),
                );
              }
              if (state.status === "paused") {
                // Paddle cancels unpaid automatic recurring transactions when pausing dunning.
                await context.observe(
                  "transaction.canceled",
                  recurring(
                    paddleIds.secondTransaction,
                    checkout.intentId,
                    1,
                    "canceled",
                    state.version,
                  ),
                );
              }
              await context.observe(
                state.type,
                lifecycle(
                  state.status,
                  state.version,
                  state.status === "active" ? periods[0] : periods[1],
                ),
              );
              await context.flush();
              const accessStatus = state.status === "paused" ? "unknown" : state.status;
              const before = await permission(context, accessStatus, state.allowed);
              if (state.status === "paused") {
                const observed = (await context.payments.readPurchase("buyer-a", checkout.intentId))
                  ?.intent.subscriptionBasisId;
                assert.ok(observed !== undefined && observed !== "");
                const aggregate = (
                  await context.payments.readObservedSubscription("buyer-a", observed)
                )?.observations[0];
                assert.equal(aggregate?.current?.status.presence, "known");
                assert.equal(aggregate.current.status.value, "paused");
                assert.ok(aggregate.flags.includes("unsupported"));
                assert.ok(before.restrictions.includes("incomplete_lifecycle"));
              }
              const ready = await context.purchase("topup", identifier("txn", 10 + index));
              const complete = transactionFixture({
                id: ready.transactionRef,
                intentId: ready.intentId,
                monthly: false,
                version: state.version,
              });
              const event = context.event("transaction.completed", complete);
              topups.push({ ...ready, event });
              if (index % 2 === 0) {
                await context.webhook(event);
              } else {
                await context.apiEvents([event]);
              }
              await context.flush();
              await assertCredits(context, 1, index + 1);
              const after = await permission(context, accessStatus, state.allowed);
              assert.equal(after.paidUntil, periods[0].ends_at);
              assert.deepEqual(after.restrictions, before.restrictions);
              assert.equal(
                (await context.payments.readPurchase("buyer-a", ready.intentId))?.transactions[0]
                  ?.completion?.classification,
                "one_time",
              );
              await context.restart();
              await context.webhook({ ...event, notification_id: identifier("ntf", 3000 + index) });
              await context.flush();
              await assertCredits(context, 1, index + 1);
              await permission(context, accessStatus, state.allowed);
            }
            assert.equal(
              (
                await context.payments.readPurchase("buyer-a", checkout.intentId)
              )?.transactions.find((row) => row.transactionRef === paddleIds.secondTransaction)
                ?.completion,
              undefined,
              "an unpaid canceled renewal never creates included credits",
            );
            const target = topups[1]!;
            const targetBefore = (await context.credit.decisions()).find((row) =>
              row.body.basisKey.includes(target.intentId),
            )!.body;
            assert.ok(
              targetBefore.originalGrant !== undefined && targetBefore.originalGrant !== "",
            );
            const pending = {
              ...adjustmentFixture({
                transactionRef: target.transactionRef,
                status: "pending_approval",
                version: "2026-11-04T00:00:01Z",
              }),
              subscription_id: null,
            };
            await context.observe("adjustment.created", pending);
            await context.flush();
            const held = (await context.credit.decisions()).find(
              (row) => row.body.basisKey === targetBefore.basisKey,
            )!.body;
            assert.deepEqual(
              [held.status, held.allocated, held.eligible, held.held],
              ["held", "25", "0", "25"],
            );
            assert.equal(
              (await context.effects()).filter((effect) => effect.kind === "correction").length,
              0,
            );
            const approved = context.event("adjustment.updated", {
              ...pending,
              status: "approved",
              updated_at: "2026-11-05T00:00:01Z",
            });
            await context.restart();
            await context.apiEvents([approved]);
            await context.webhook(approved);
            await context.flush();
            const targetAfter = (await context.credit.decisions()).find(
              (row) => row.body.basisKey === targetBefore.basisKey,
            )!.body;
            assert.deepEqual(
              [
                targetAfter.status,
                targetAfter.allocated,
                targetAfter.eligible,
                targetAfter.held,
                targetAfter.originalGrant,
              ],
              ["withheld", "0", "0", "0", targetBefore.originalGrant],
            );
            const decisions = (await context.credit.decisions()).map((row) => row.body);
            assert.equal(
              decisions.filter((row) => row.status === "issued" && row.bucket === "purchased")
                .length,
              3,
            );
            assert.equal(decisions.find((row) => row.bucket === "included")?.eligible, "100");
            const corrections = (await context.effects()).filter(
              (effect) => effect.kind === "correction",
            );
            assert.deepEqual(
              corrections.map((effect) => [effect.amount, effect.causeEffectKey]),
              [["-25", targetBefore.originalGrant]],
            );
            await context.restart();
            await context.webhook(topups[1]!.event);
            await context.webhook(approved);
            await context.flush();
            assert.equal(
              (await context.effects()).filter((effect) => effect.kind === "correction").length,
              1,
            );
            assert.equal(
              (await context.effects()).reduce((sum, effect) => sum + BigInt(effect.amount), 0n),
              175n,
            );
            const charged = topups[0]!,
              chargedGrant = (await context.credit.decisions()).find((row) =>
                row.body.basisKey.includes(charged.intentId),
              )!.body.originalGrant;
            const chargeback = {
              ...adjustmentFixture({
                id: identifier("adj", 40),
                transactionRef: charged.transactionRef,
                action: "chargeback",
                version: "2026-11-06T00:00:01Z",
              }),
              subscription_id: null,
            };
            await context.observe("adjustment.created", chargeback);
            await context.flush();
            assert.equal(
              (await context.effects()).reduce((sum, effect) => sum + BigInt(effect.amount), 0n),
              150n,
            );
            const reversed = context.event("adjustment.updated", {
              ...chargeback,
              status: "reversed",
              updated_at: "2026-11-07T00:00:01Z",
            });
            await context.webhook(reversed);
            await context.flush();
            assert.equal(
              (await context.effects()).filter((effect) => effect.kind === "restoration").length,
              0,
              "a reversed original alone does not prove its matching reverse",
            );
            const reverse = context.event("adjustment.created", {
              ...adjustmentFixture({
                id: identifier("adj", 41),
                transactionRef: charged.transactionRef,
                action: "chargeback_reverse",
                total: "-1000",
                version: "2026-11-07T00:00:02Z",
              }),
              subscription_id: null,
            });
            await context.apiEvents([reverse]);
            await context.flush();
            await context.restart();
            await context.webhook(reverse);
            await context.webhook(reversed);
            await context.webhook(charged.event);
            await context.flush();
            const financialEffects = await context.effects();
            assert.equal(financialEffects.filter((effect) => effect.kind === "grant").length, 5);
            assert.equal(
              financialEffects.filter((effect) => effect.kind === "correction").length,
              2,
            );
            assert.deepEqual(
              financialEffects
                .filter((effect) => effect.kind === "restoration")
                .map((effect) => [effect.amount, effect.causeEffectKey]),
              [["25", chargedGrant]],
            );
            assert.equal(
              financialEffects.reduce((sum, effect) => sum + BigInt(effect.amount), 0n),
              175n,
            );
            const restored = (await context.credit.decisions()).find((row) =>
              row.body.basisKey.includes(charged.intentId),
            )!.body;
            assert.deepEqual(
              [restored.status, restored.eligible, restored.originalGrant],
              ["issued", "25", chargedGrant],
            );
            const finalPermission = await permission(context, "canceled", false);
            assert.equal(finalPermission.knownLastPeriod?.endsAt, periods[0].ends_at);
            assert.equal(context.creates, 5);
            emulation.agent.assertNoPendingInterceptors();
          } finally {
            await context.close();
          }
        });
      }
    } finally {
      await emulation.close();
    }
  },
);

void test(
  "past-due payment update uses the existing unpaid recurring transaction and recovers its original paid period exactly once",
  { timeout: 60_000 },
  async (t) => {
    const emulation = emulatePaddle();
    try {
      for (const kind of hostKinds) {
        await t.test(kind, async () => {
          const context = await subscriptionContext(kind, emulation);
          try {
            const { checkout, bindingId } = await initial(context);
            context.setNow("2026-11-02T00:00:00Z");
            const unpaid = recurring(
              paddleIds.secondTransaction,
              checkout.intentId,
              1,
              "past_due",
              "2026-11-01T00:00:01Z",
            );
            const pastDue = lifecycle("past_due", "2026-11-01T00:00:02Z", periods[1]);
            await context.observe("transaction.payment_failed", unpaid);
            await context.observe("subscription.past_due", pastDue);
            await context.flush();
            await assertCredits(context, 1, 0);
            await permission(context, "past_due", false);
            emulation.api
              .intercept({ path: subscriptionPath, method: "GET" })
              .reply(200, responseFixture(pastDue));
            let recoveryCheckouts = 0;
            emulation.api
              .intercept({
                path: `/subscriptions/${paddleIds.subscription}/update-payment-method-transaction`,
                method: "GET",
              })
              .reply(200, () => {
                recoveryCheckouts += 1;
                return responseFixture(unpaid);
              });
            const command = {
              buyerId: "buyer-a",
              bindingId,
              requestKey: "recover-original-november-period",
            };
            const ready = success(await context.payments.openPaymentUpdate(command));
            assert.deepEqual(
              [ready.purpose, ready.intentId, ready.transactionRef],
              ["recovery", checkout.intentId, paddleIds.secondTransaction],
            );
            await context.flush();
            await assertCredits(context, 1, 0);
            await permission(context, "past_due", false);
            assert.deepEqual(await context.payments.openPaymentUpdate(command), {
              kind: "succeeded",
              value: ready,
            });
            await context.restart();
            assert.deepEqual(await context.payments.openPaymentUpdate(command), {
              kind: "succeeded",
              value: ready,
            });
            const completed = context.event("transaction.completed", {
              ...unpaid,
              status: "completed",
              updated_at: "2026-11-02T00:00:01Z",
            });
            await context.apiEvents([completed]);
            await context.observe(
              "subscription.updated",
              lifecycle("active", "2026-11-02T00:00:02Z", periods[1]),
            );
            await context.flush();
            await assertCredits(context, 2, 0);
            assert.equal((await permission(context, "active", true)).paidUntil, periods[1].ends_at);
            const paid = await context.payments.readPurchase("buyer-a", checkout.intentId);
            assert.ok(paid);
            assert.equal(paid.transactions.length, 2);
            const recovered = paid.transactions.find(
              (row) => row.transactionRef === paddleIds.secondTransaction,
            );
            assert.ok(recovered?.completion);
            assert.equal(recovered.completion.classification, "recovery");
            assert.deepEqual(recovered.flags, []);
            assert.deepEqual(recovered.completion.lines[0]?.period, {
              startsAt: periods[1].starts_at,
              endsAt: periods[1].ends_at,
            });
            const grants = await grantIds(context);
            await context.restart();
            await context.webhook(completed);
            await context.webhook({ ...completed, notification_id: identifier("ntf", 4000) });
            await context.flush();
            await assertCredits(context, 2, 0);
            assert.deepEqual(await grantIds(context), grants);
            assert.equal(
              (
                await context.payments.readPurchase("buyer-a", checkout.intentId)
              )?.transactions.find((row) => row.transactionRef === paddleIds.secondTransaction)
                ?.completion?.factId,
              recovered.completion.factId,
            );
            assert.equal(recoveryCheckouts, 1);
            assert.equal(context.creates, 1);
            emulation.agent.assertNoPendingInterceptors();
          } finally {
            await context.close();
          }
        });
      }
    } finally {
      await emulation.close();
    }
  },
);

void test(
  "period-end cancellation closes access on the explicit owner clock before its terminal webhook and transient SDK reads preserve history",
  { timeout: 60_000 },
  async (t) => {
    const emulation = emulatePaddle();
    try {
      for (const kind of hostKinds) {
        await t.test(kind, async () => {
          const context = await subscriptionContext(kind, emulation);
          try {
            const { checkout, bindingId, event: initialEvent } = await initial(context);
            const before = await context.payments.readPurchase("buyer-a", checkout.intentId),
              creditsBefore = await context.credit.decisions();
            // Authorization is enforced before any SDK request; no interceptor exists here.
            assert.equal(
              await context.payments.readPurchase("buyer-b", checkout.intentId),
              undefined,
            );
            assert.equal(
              await context.payments.readObservedSubscription("buyer-b", bindingId),
              undefined,
            );
            assert.deepEqual(await context.payments.refreshPurchase("buyer-b", checkout.intentId), {
              kind: "rejected",
              code: "ownership_mismatch",
            });
            assert.deepEqual(await context.payments.refreshSubscription("buyer-b", bindingId), {
              kind: "rejected",
              code: "ownership_mismatch",
            });
            assert.deepEqual(
              await context.payments.requestCancellation({
                buyerId: "buyer-b",
                bindingId,
                requestKey: "foreign-cancel",
                timing: "now",
              }),
              { kind: "rejected", code: "ownership_mismatch" },
            );
            const observationsBefore = await context.payments.readObservedSubscription(
                "buyer-a",
                bindingId,
              ),
              inputCount = (await context.inputs()).length;
            emulation.api.intercept({ path: subscriptionPath, method: "GET" }).reply(503, {
              error: {
                type: "api_error",
                code: "service_unavailable",
                detail: "Synthetic unavailable",
                documentation_url: "https://developer.paddle.com/errors/shared/service_unavailable",
              },
              meta: { request_id: "synthetic-read-error" },
            });
            assert.deepEqual(await context.payments.refreshSubscription("buyer-a", bindingId), {
              kind: "rejected",
              code: "unavailable",
            });
            assert.deepEqual(
              await context.payments.readObservedSubscription("buyer-a", bindingId),
              observationsBefore,
            );
            assert.equal((await context.inputs()).length, inputCount);
            assert.deepEqual(await context.credit.decisions(), creditsBefore);

            const scheduled = {
              ...lifecycle("active", "2026-10-16T00:00:01Z"),
              scheduled_change: {
                action: "cancel",
                effective_at: periods[0].ends_at,
                resume_at: null,
              },
            };
            emulation.api
              .intercept({ path: subscriptionPath, method: "GET" })
              .reply(200, responseFixture(lifecycle("active", "2026-10-15T00:00:01Z")));
            let cancellations = 0;
            emulation.api
              .intercept({
                path: `/subscriptions/${paddleIds.subscription}/cancel`,
                method: "POST",
                body: JSON.stringify({ effective_from: "next_billing_period" }),
              })
              .reply(200, () => {
                cancellations += 1;
                return responseFixture(scheduled);
              });
            const command = {
              buyerId: "buyer-a",
              bindingId,
              requestKey: "scheduled-cancel",
              timing: "period_end" as const,
            };
            assert.deepEqual(success(await context.payments.requestCancellation(command)), {
              kind: "scheduled",
              effectiveAt: periods[0].ends_at,
            });
            // Read-only acquisition after the 503 converges to the provider's scheduled state.
            emulation.api
              .intercept({ path: subscriptionPath, method: "GET" })
              .reply(200, responseFixture(scheduled));
            assert.equal(
              success(await context.payments.refreshSubscription("buyer-a", bindingId)),
              1,
            );
            await context.flush();
            const scheduledDecision = await permission(context, "active", true);
            assert.deepEqual(scheduledDecision.scheduledChange, {
              action: "cancel",
              effectiveAt: periods[0].ends_at,
            });
            context.setNow("2026-11-01T00:00:00.124Z");
            await context.restart();
            await context.access.refresh("buyer-a");
            const expired = await permission(context, "active", false);
            assert.ok(expired.restrictions.includes("scheduled_change_effective"));
            assert.ok(expired.restrictions.includes("paid_period_expired"));
            // An older paid receipt and completed top-up do not act as a lifecycle clock or
            // revive subscription access while the cancellation webhook is delayed.
            await context.webhook(initialEvent);
            await context.observe(
              "subscription.updated",
              lifecycle("active", "2026-10-15T00:00:00Z"),
            );
            const topup = await context.purchase("topup", identifier("txn", 20));
            await context.observe(
              "transaction.completed",
              transactionFixture({
                id: topup.transactionRef,
                intentId: topup.intentId,
                monthly: false,
                version: "2026-11-01T00:00:02Z",
              }),
            );
            await context.flush();
            await assertCredits(context, 1, 1);
            await permission(context, "active", false);
            await context.observe(
              "subscription.canceled",
              lifecycle("canceled", "2026-11-01T00:00:03Z"),
            );
            await context.flush();
            const canceled = await permission(context, "canceled", false);
            assert.equal(canceled.knownLastPeriod?.endsAt, periods[0].ends_at);
            assert.deepEqual(
              (await context.payments.readPurchase("buyer-a", checkout.intentId))?.transactions[0]
                ?.completion,
              before?.transactions[0]?.completion,
            );
            assert.deepEqual(await context.payments.requestCancellation(command), {
              kind: "succeeded",
              value: { kind: "scheduled", effectiveAt: periods[0].ends_at },
            });
            assert.deepEqual(
              await context.payments.requestCancellation({ ...command, timing: "now" }),
              { kind: "rejected", code: "conflict" },
            );
            assert.equal(cancellations, 1);
            assert.equal(context.creates, 2);
            emulation.agent.assertNoPendingInterceptors();
          } finally {
            await context.close();
          }
        });
      }
    } finally {
      await emulation.close();
    }
  },
);

void test(
  "bound purchases with zero, incomplete or foreign-account completed evidence stay unfulfilled through cross-channel replay",
  { timeout: 60_000 },
  async (t) => {
    const emulation = emulatePaddle();
    try {
      for (const kind of hostKinds) {
        await t.test(kind, async () => {
          const context = await subscriptionContext(kind, emulation);
          try {
            await context.register();
            const cases = [
              { key: "unapproved-zero", flag: "catalog_mismatch" },
              { key: "incomplete-financial-lines", flag: "incomplete" },
              { key: "foreign-account-correlation", flag: "unsupported" },
            ] as const;
            for (const [index, scenario] of cases.entries()) {
              const ready = await context.purchase("topup", identifier("txn", 30 + index));
              const data = transactionFixture({
                id: ready.transactionRef,
                monthly: false,
                intentId: ready.intentId,
                total: index === 0 ? "0" : "1000",
              });
              if (index === 1) {
                data["details"] = null;
              }
              if (index === 2) {
                data["custom_data"] = {
                  payments: {
                    applicationId: "app-a",
                    paymentAccountId: "another-merchant",
                    environment: "sandbox",
                    intentId: ready.intentId,
                    attemptId: "synthetic-foreign-attempt",
                  },
                };
              }
              const event = context.event("transaction.completed", data);
              await context.webhook(event);
              await context.apiEvents([event]);
              await context.flush();
              await context.restart();
              await context.webhook({ ...event, notification_id: identifier("ntf", 5000 + index) });
              await context.flush();
              const purchase = await context.payments.readPurchase("buyer-a", ready.intentId);
              assert.ok(purchase);
              assert.equal(purchase.transactions.length, 1);
              assert.equal(purchase.transactions[0]!.completion, undefined);
              assert.ok(purchase.transactions[0]!.flags.includes(scenario.flag));
              assert.equal((await context.credit.decisions()).length, 0);
              assert.equal((await context.access.decisions()).length, 0);
              assert.deepEqual(await context.effects(), []);
              assert.ok(
                (await context.inputs()).some(
                  (input) =>
                    input.source.eventId === event["event_id"] &&
                    input.source.kind === "verified_webhook",
                ),
              );
              assert.ok(
                (await context.inputs()).some(
                  (input) =>
                    input.source.eventId === event["event_id"] &&
                    input.source.kind === "authenticated_api",
                ),
              );
            }
            assert.equal(context.creates, 3);
            emulation.agent.assertNoPendingInterceptors();
          } finally {
            await context.close();
          }
        });
      }
    } finally {
      await emulation.close();
    }
  },
);
