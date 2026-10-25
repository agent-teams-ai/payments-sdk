import assert from "node:assert/strict";
import test from "node:test";
import {
  AccessFixture,
  CreditFixture,
  canonical,
  hash,
  signFixtureMessage,
  sourceIdentity,
} from "../fixtures/consumers/index.ts";
import type { CreditDecision, Effect, HeldResolution } from "../fixtures/consumers/index.ts";
import {
  adjustment,
  consumers,
  fact,
  held,
  message,
  nextPeriod,
  period,
  producerNamespace,
  scope,
  subscription,
} from "./consumer-support.ts";

// Expected financial results are deliberately independent constants, never production reducers.
const Q = 100n,
  T = 25n;
async function onlyCredit(credit: CreditFixture): Promise<CreditDecision> {
  const rows = await credit.decisions();
  assert.equal(rows.length, 1);
  return rows[0]!.body;
}
async function effects(credit: CreditFixture): Promise<Effect[]> {
  return (await credit.owner.inspect<{ body: Effect }>("effects")).map((row) => row.body);
}

void test("independent credit owner preserves causal history across full-refund delivery permutations", async (t) => {
  for (const order of [
    [4, 3, 4],
    [3, 4, 4],
  ]) {
    await t.test(`producer revisions ${order.join("→")}`, async () => {
      const fixture = await consumers();
      try {
        const paid = message(3),
          refunded = message(4, fact(), [adjustment()]);
        for (const revision of order) {
          await fixture.credit.receive(revision === 3 ? paid : refunded);
        }
        let decision = await onlyCredit(fixture.credit);
        assert.equal(BigInt(decision.eligible), 0n);
        assert.equal(BigInt(decision.allocated), 0n);
        assert.equal(decision.status, "withheld");
        const history = await effects(fixture.credit);
        assert.equal(
          history.filter((effect) => effect.kind === "grant").length,
          order[0] === 3 ? 1 : 0,
        );
        assert.equal(
          history.filter((effect) => effect.kind === "correction").length,
          order[0] === 3 ? 1 : 0,
          "never reverse an unissued grant",
        );
        const reversed = adjustment({ status: "reversed", version: "2026-10-03T00:00:00Z" });
        const reverse = adjustment({
          adjustmentRef: "refund-reverse-A",
          action: "refund_reverse",
          amount: { currency: "USD", minorUnits: "-1000" },
          allocations: [
            {
              providerLineRef: "line-A",
              type: "full",
              amount: { currency: "USD", minorUnits: "-1000" },
            },
          ],
        });
        await fixture.credit.receive(message(5, fact(), [reversed, reverse]));
        await fixture.credit.receive(message(6, fact(), [reversed, reverse]));
        decision = await onlyCredit(fixture.credit);
        assert.equal(BigInt(decision.eligible), Q);
        assert.equal(decision.applied, order[0] === 3 ? "restored" : "issued");
        const final = await effects(fixture.credit);
        assert.equal(final.filter((effect) => effect.kind === "grant").length, 1);
        assert.equal(
          final.filter((effect) => effect.kind === "restoration").length,
          order[0] === 3 ? 1 : 0,
        );
        assert.equal(
          final
            .filter((effect) => effect.kind === "correction")
            .reduce((sum, effect) => sum + BigInt(effect.amount), 0n),
          order[0] === 3 ? -Q : 0n,
        );
        const original = final.find((effect) => effect.kind === "grant")!;
        assert.equal(decision.originalGrant, original.effectKey);
        assert.equal(original.sourceKey, sourceIdentity(paid));
      } finally {
        await fixture.close();
      }
    });
  }
});

void test("T3 is atomic before ACK, duplicate deliveries/restart preserve one effect and both owners are independent", async () => {
  const fixture = await consumers();
  try {
    assert.equal(
      (await fixture.pool.query<{ synchronous_commit: string }>("SHOW synchronous_commit")).rows[0]
        ?.synchronous_commit,
      "off",
    );
    await fixture.credit.owner.atomic(async (client) => {
      assert.equal(
        (await client.query<{ synchronous_commit: string }>("SHOW synchronous_commit")).rows[0]
          ?.synchronous_commit,
        "on",
      );
    });
    await fixture.access.owner.atomic(async (client) => {
      assert.equal(
        (await client.query<{ synchronous_commit: string }>("SHOW synchronous_commit")).rows[0]
          ?.synchronous_commit,
        "on",
      );
    });
    const paid = message(1);
    await assert.rejects(
      fixture.credit.receive(paid, {
        beforeCommit() {
          throw new Error("crash before T3 commit");
        },
      }),
      /crash before/u,
    );
    assert.equal((await fixture.credit.owner.inspect("receipts")).length, 0);
    assert.equal((await effects(fixture.credit)).length, 0);
    assert.equal((await fixture.credit.owner.inspect("outbox")).length, 0);
    const results = await Promise.all(
      Array.from({ length: 12 }, () => fixture.credit.receive(paid)),
    );
    assert.equal(results.filter((result) => result.outcome === "accepted").length, 1);
    const restarted = new CreditFixture({
      pool: fixture.pool,
      schema: fixture.credit.owner.options.schema,
      trust: fixture.trust,
    });
    assert.deepEqual(
      await restarted.receive(paid),
      { acknowledge: true, outcome: "duplicate" },
      "crash after commit before sender ACK replays custody only",
    );
    assert.equal(BigInt((await onlyCredit(restarted)).eligible), Q);
    assert.equal(
      (await fixture.access.owner.inspect("receipts")).length,
      0,
      "credit custody cannot ACK another independent owner",
    );
    await fixture.access.receive(paid);
    await fixture.access.receive(subscription(1));
    assert.equal((await fixture.access.decisions())[0]?.body.newAction, true);
    assert.equal((await effects(restarted)).filter((effect) => effect.kind === "grant").length, 1);
    assert.ok((await fixture.credit.owner.inspect("outbox")).length >= 2);
    const ownerTables = await fixture.pool.query<{
      schemaname: string;
      tablename: string;
      persistence: string;
    }>(
      `SELECT n.nspname AS schemaname,c.relname AS tablename,c.relpersistence AS persistence FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=ANY($1) AND c.relkind='r'`,
      [[fixture.credit.owner.options.schema, fixture.access.owner.options.schema]],
    );
    assert.ok(ownerTables.rows.length >= 16);
    assert.ok(
      ownerTables.rows.every((row) => row.persistence === "p"),
      "all correctness tables are WAL logged",
    );
  } finally {
    await fixture.close();
  }
});

void test("duplicate paid support is held in either order, resolved locally with whole-readset CAS and immutable issuance", async (t) => {
  for (const order of ["refunded-A-first", "paid-B-first"] as const) {
    await t.test(order, async () => {
      const fixture = await consumers();
      try {
        const a = message(4, fact(), [adjustment()]);
        const bFact = fact({
          factId: "completion-B",
          transactionRef: "transaction-B",
          providerSubscriptionRef: "subscription-B",
          lines: [{ ...fact().lines[0]!, providerLineRef: "line-B", period: nextPeriod }],
        });
        const b = message(1, bFact);
        for (const input of order === "refunded-A-first" ? [a, b] : [b, a]) {
          await fixture.credit.receive(input);
        }
        let row = (await fixture.credit.decisions()).find(
          (candidate) => candidate.body.period?.startsAt === nextPeriod.startsAt,
        )!;
        assert.ok(
          (await fixture.credit.decisions()).every(
            (candidate) => candidate.body.status === "held" && candidate.body.eligible === "0",
          ),
        );
        assert.equal(
          (await fixture.credit.decisions()).reduce(
            (sum, candidate) => sum + BigInt(candidate.body.held),
            0n,
          ),
          order === "paid-B-first" ? Q : 0n,
        );
        assert.equal(
          (await fixture.credit.owner.inspect("evidence_projection")).length,
          2,
          "both financial contributions survive",
        );
        const initialGrant = (await effects(fixture.credit)).find(
          (effect) => effect.kind === "grant",
        );
        const resolution: HeldResolution = {
          basisKey: row.basis_key,
          expectedDecisionRevision: Number(row.revision),
          expectedReadSet: row.body.readSet,
          selectedSource: sourceIdentity(b),
          actorId: "authorized-test-operator",
          approvalRef: `select-B-${order}`,
          policyVersion: "fixture-credit-policy-v1",
        };
        assert.equal(
          await fixture.credit.resolveHeldDecision({ ...resolution, expectedReadSet: [] }),
          "conflict",
        );
        assert.equal(await fixture.credit.resolveHeldDecision(resolution), "resolved");
        assert.equal(await fixture.credit.resolveHeldDecision(resolution), "duplicate");
        row = (await fixture.credit.decisions()).find(
          (candidate) => candidate.body.period?.startsAt === nextPeriod.startsAt,
        )!;
        assert.equal(BigInt(row.body.eligible), Q);
        assert.equal(row.body.supportSource, sourceIdentity(b));
        assert.equal(
          (await effects(fixture.credit)).filter((effect) => effect.kind === "grant").length,
          1,
        );
        assert.equal(
          row.body.originalGrant,
          initialGrant?.effectKey ??
            (await effects(fixture.credit)).find((effect) => effect.kind === "grant")?.effectKey,
        );
        const stale = { ...resolution, approvalRef: "stale-approval" };
        await fixture.credit.receive(
          message(2, bFact, [
            adjustment({
              adjustmentRef: "refund-B",
              transactionRef: "transaction-B",
              allocations: [
                {
                  providerLineRef: "line-B",
                  type: "full",
                  amount: { currency: "USD", minorUnits: "1000" },
                },
              ],
            }),
          ]),
        );
        assert.equal(await fixture.credit.resolveHeldDecision(stale), "conflict");
        assert.equal(
          (await fixture.credit.decisions()).reduce(
            (sum, candidate) => sum + BigInt(candidate.body.eligible),
            0n,
          ),
          0n,
        );
        assert.equal(
          (await effects(fixture.credit)).filter((effect) => effect.kind === "correction").length,
          1,
        );
        assert.equal(
          (await fixture.credit.owner.inspect("receipts")).length,
          3,
          "resolution creates neither fake producer revision nor receipt reset",
        );
      } finally {
        await fixture.close();
      }
    });
  }
});

void test("control overflow, unknown schema and conflicts hold monotonically; unknown/untrusted envelopes remain unacked", async () => {
  const fixture = await consumers();
  try {
    const paid = message(3);
    await fixture.credit.receive(paid);
    assert.equal((await fixture.credit.receive(held(4, paid))).outcome, "held");
    assert.equal((await fixture.credit.receive(paid)).outcome, "duplicate");
    assert.equal(BigInt((await onlyCredit(fixture.credit)).eligible), 0n);
    assert.equal(BigInt((await onlyCredit(fixture.credit)).held), Q);
    const { bodyDigest: _digest, ...body } = message(5);
    const future = signFixtureMessage({ ...body, schemaVersion: 9, futureBody: { opaque: true } });
    assert.equal((await fixture.credit.receive(future)).outcome, "held");
    assert.equal((await fixture.credit.receive(message(6))).outcome, "accepted");
    assert.equal(BigInt((await onlyCredit(fixture.credit)).eligible), Q);
    const { bodyDigest: _old, ...conflictBody } = message(6);
    assert.equal(
      (
        await fixture.credit.receive(
          signFixtureMessage({ ...conflictBody, flags: ["unsupported"] }),
        )
      ).outcome,
      "conflict",
    );
    assert.equal(BigInt((await onlyCredit(fixture.credit)).eligible), 0n);
    assert.equal(
      (await fixture.credit.receive({ ...paid, envelopeVersion: 8 })).acknowledge,
      false,
    );
    assert.equal(
      (await fixture.credit.receive({ ...paid, bodyDigest: "0".repeat(64) })).acknowledge,
      false,
    );
    for (const changedScope of [
      { ...scope, applicationId: "app-b" },
      { ...scope, environment: "production" as const },
      { ...scope, paymentAccountId: "other-account" },
    ]) {
      const aggregate = paid.aggregate,
        messageId = hash([producerNamespace, changedScope, aggregate, 7]);
      assert.equal(
        (
          await fixture.credit.receive(
            signFixtureMessage({ ...body, scope: changedScope, aggregate, messageId, revision: 7 }),
          )
        ).acknowledge,
        false,
      );
    }
    assert.equal((await fixture.credit.owner.inspect("quarantine")).length, 5);
    assert.ok(
      (await fixture.credit.owner.inspect<{ state: string }>("obligations")).some(
        (row) => row.state === "pending",
      ),
    );
  } finally {
    await fixture.close();
  }
});

void test("a first unrouted held or unknown-schema source fences older complete evidence across restart in both owners", async (t) => {
  for (const controlKind of ["held", "unknown-schema"] as const) {
    await t.test(controlKind, async () => {
      const fixture = await consumers();
      try {
        const paid = message(3),
          active = subscription(3);
        function control(previous: typeof paid) {
          if (controlKind === "held") {
            return held(4, previous);
          }
          const complete4 =
            previous.aggregate.type === "transaction" ? message(4) : subscription(4);
          const { bodyDigest: _digest, ...body } = complete4;
          return signFixtureMessage({ ...body, schemaVersion: 9 });
        }
        const creditControl = control(paid),
          accessControl = control(active);
        assert.equal((await fixture.credit.receive(creditControl)).outcome, "held");
        await fixture.access.receive(message(1));
        assert.equal((await fixture.access.receive(accessControl)).outcome, "held");
        const credit = new CreditFixture({
          pool: fixture.pool,
          schema: fixture.credit.owner.options.schema,
          trust: fixture.trust,
        });
        const access = new AccessFixture({
          pool: fixture.pool,
          schema: fixture.access.owner.options.schema,
          trust: fixture.trust,
          now: () => "2026-10-15T00:00:00Z",
        });
        assert.equal((await credit.receive(paid)).outcome, "stale");
        assert.equal((await access.receive(active)).outcome, "stale");
        assert.equal((await credit.receive(creditControl)).outcome, "duplicate");
        assert.equal((await access.receive(accessControl)).outcome, "duplicate");
        const creditSource = (
          await credit.owner.inspect<{ revision: string; held: boolean }>("evidence_projection")
        )[0]!;
        const accessSource = (
          await access.owner.inspect<{ revision: string; held: boolean; source_key: string }>(
            "evidence_projection",
          )
        ).find((row) => row.source_key === sourceIdentity(active))!;
        assert.deepEqual([Number(creditSource.revision), creditSource.held], [4, true]);
        assert.deepEqual([Number(accessSource.revision), accessSource.held], [4, true]);
        assert.equal((await credit.decisions()).length, 0);
        assert.equal((await effects(credit)).length, 0);
        const accessDecision = (await access.decisions())[0]!.body;
        assert.equal(accessDecision.newAction, false);
        assert.equal(accessDecision.expand, false);
        assert.ok(
          (await credit.owner.inspect<{ state: string }>("obligations")).some(
            (row) => row.state === "pending",
          ),
        );
        assert.ok(
          (await access.owner.inspect<{ state: string }>("obligations")).some(
            (row) => row.state === "pending",
          ),
        );
        assert.equal((await credit.receive(message(5))).outcome, "accepted");
        assert.equal((await access.receive(subscription(5))).outcome, "accepted");
        assert.equal(BigInt((await onlyCredit(credit)).eligible), Q);
        assert.equal((await access.decisions())[0]!.body.newAction, true);
        await credit.receive(message(5));
        await access.receive(subscription(5));
        assert.equal((await effects(credit)).filter((effect) => effect.kind === "grant").length, 1);
      } finally {
        await fixture.close();
      }
    });
  }
});

void test("initial stream guard, distinct renewal periods and intentional top-ups preserve separate stable benefit identities", async () => {
  const fixture = await consumers();
  try {
    const initial = message(1);
    await fixture.credit.receive(initial);
    const renewalFact = fact({
      factId: "renewal-completion",
      transactionRef: "renewal-A",
      classification: "renewal",
      lines: [{ ...fact().lines[0]!, providerLineRef: "renewal-line", period: nextPeriod }],
    });
    await fixture.credit.receive(message(1, renewalFact));
    const {
      subscriptionBasisId: _basis,
      providerSubscriptionRef: _stream,
      ...oneTime
    } = fact({
      factId: "topup-completion",
      transactionRef: "topup-A",
      intentId: "intent-topup-A",
      classification: "one_time",
      offer: { ...fact().offer, profile: "one_time" },
      lines: [
        {
          providerLineRef: "topup-line",
          benefitSlotId: "purchased",
          amount: { currency: "USD", minorUnits: "1000" },
          quantity: 1,
        },
      ],
    });
    const topup = oneTime;
    await fixture.credit.receive(message(1, topup));
    const secondTopup = {
      ...topup,
      factId: "topup-completion-B",
      transactionRef: "topup-B",
      intentId: "intent-topup-B",
    };
    await fixture.credit.receive(message(1, secondTopup));
    let decisions = await fixture.credit.decisions();
    assert.equal(
      decisions
        .filter((row) => row.body.bucket === "included")
        .reduce((sum, row) => sum + BigInt(row.body.eligible), 0n),
      2n * Q,
    );
    assert.equal(
      decisions
        .filter((row) => row.body.bucket === "purchased")
        .reduce((sum, row) => sum + BigInt(row.body.eligible), 0n),
      2n * T,
    );
    const rival = fact({
      factId: "rival-initial",
      transactionRef: "initial-B",
      providerSubscriptionRef: "subscription-B",
      lines: [{ ...fact().lines[0]!, providerLineRef: "rival-line", period: nextPeriod }],
    });
    await Promise.all([
      fixture.credit.receive(message(1, rival)),
      fixture.credit.receive(message(2, renewalFact)),
    ]);
    decisions = await fixture.credit.decisions();
    assert.ok(
      decisions
        .filter((row) => row.body.bucket === "included")
        .every((row) => row.body.eligible === "0"),
      "initial guard holds both initial and stream-dependent renewal periods",
    );
    const guard = (await fixture.credit.initialGuards())[0]!.body;
    assert.equal(guard.status, "held");
    assert.ok(guard.originalGrant !== undefined && guard.originalGrant !== "");
    assert.equal(
      (await effects(fixture.credit)).filter(
        (effect) => effect.effectKey === guard.originalGrant && effect.kind === "grant",
      ).length,
      1,
    );
    const legitimate = fact({
      factId: "legitimate-initial",
      transactionRef: "initial-C",
      intentId: "intent-legitimate",
      subscriptionBasisId: "binding-c",
      providerSubscriptionRef: "subscription-C",
    });
    await fixture.credit.receive(message(1, legitimate));
    assert.equal(
      (await fixture.credit.decisions()).find(
        (row) => row.body.initialGuardKey?.includes("intent-legitimate") === true,
      )?.body.eligible,
      Q.toString(),
    );
  } finally {
    await fixture.close();
  }
});

void test("initial, renewal and recovery share one exact paid-period decision in either order across restart", async (t) => {
  for (const classification of ["renewal", "recovery"] as const) {
    for (const initialFirst of [true, false]) {
      for (const alias of [false, true]) {
        await t.test(
          `${classification}, ${initialFirst ? "initial first" : "recurring first"}, ${alias ? "equivalent RFC3339 spellings" : "identical spellings"}`,
          async () => {
            const fixture = await consumers();
            try {
              const initial = message(1);
              const recurringPeriod = alias
                ? {
                    startsAt: "2026-10-01T01:00:00.123456000+01:00",
                    endsAt: "2026-11-01T00:00:00.123456000+00:00",
                  }
                : period;
              const recurringFact = fact({
                transactionRef: "same-period-recurring",
                factId: "same-period-completion",
                classification,
                lines: [
                  {
                    ...fact().lines[0]!,
                    providerLineRef: "same-period-line",
                    period: recurringPeriod,
                  },
                ],
              });
              const recurring = message(1, recurringFact);
              await fixture.credit.receive(initialFirst ? initial : recurring);
              const credit = new CreditFixture({
                pool: fixture.pool,
                schema: fixture.credit.owner.options.schema,
                trust: fixture.trust,
              });
              await credit.receive(initialFirst ? recurring : initial);
              let row = (await credit.decisions())[0]!;
              assert.equal((await credit.decisions()).length, 1);
              assert.ok(row.basis_key.startsWith('["period"'));
              assert.equal(row.body.status, "held");
              assert.equal(row.body.eligible, "0");
              assert.equal(BigInt(row.body.held), initialFirst ? Q : 0n);
              assert.equal((await credit.owner.inspect("evidence_projection")).length, 2);
              assert.equal(
                (await credit.initialGuards()).length,
                1,
                "initial guard is a separate durable constraint, not a second grant basis",
              );
              const original = (await effects(credit)).find((effect) => effect.kind === "grant");
              assert.equal(
                (await effects(credit)).filter((effect) => effect.kind === "grant").length,
                initialFirst ? 1 : 0,
              );
              for (const input of [recurring, initial]) {
                assert.equal((await credit.receive(input)).outcome, "duplicate");
              }
              const resolution: HeldResolution = {
                basisKey: row.basis_key,
                expectedDecisionRevision: Number(row.revision),
                expectedReadSet: row.body.readSet,
                selectedSource: sourceIdentity(recurring),
                actorId: "authorized-period-owner",
                approvalRef: `same-period-${classification}-${initialFirst}`,
                policyVersion: "fixture-credit-policy-v1",
              };
              assert.equal(await credit.resolveHeldDecision(resolution), "resolved");
              assert.equal(await credit.resolveHeldDecision(resolution), "duplicate");
              row = (await credit.decisions())[0]!;
              assert.equal(BigInt(row.body.eligible), Q);
              assert.equal(
                row.body.originalGrant,
                original?.effectKey ??
                  (await effects(credit)).find((effect) => effect.kind === "grant")?.effectKey,
              );
              assert.equal(
                (await effects(credit)).filter((effect) => effect.kind === "grant").length,
                1,
              );
              const next = fact({
                transactionRef: "genuine-next-period",
                factId: "next-period-completion",
                classification: "renewal",
                lines: [
                  { ...fact().lines[0]!, providerLineRef: "next-period-line", period: nextPeriod },
                ],
              });
              await credit.receive(message(1, next));
              assert.equal((await credit.decisions()).length, 2);
              assert.equal(
                (await credit.decisions()).reduce(
                  (sum, decision) => sum + BigInt(decision.body.eligible),
                  0n,
                ),
                2n * Q,
              );
              assert.equal(
                (await effects(credit)).filter((effect) => effect.kind === "grant").length,
                2,
                "one original issuance per genuine paid period",
              );
              if (alias) {
                const neighbor = fact({
                  transactionRef: "neighboring-nanosecond",
                  factId: "neighboring-nanosecond",
                  classification: "renewal",
                  lines: [
                    {
                      ...fact().lines[0]!,
                      providerLineRef: "neighboring-line",
                      period: {
                        startsAt: "2026-10-01T00:00:00.123456001Z",
                        endsAt: "2026-11-01T00:00:00.123456001Z",
                      },
                    },
                  ],
                });
                await credit.receive(message(1, neighbor));
                assert.equal(
                  (await credit.decisions()).length,
                  3,
                  "a genuine neighboring nanosecond stays distinct",
                );
                assert.equal(
                  (await credit.decisions()).reduce(
                    (sum, decision) => sum + BigInt(decision.body.eligible),
                    0n,
                  ),
                  3n * Q,
                );
                const retained = await credit.owner.inspect<{ body: typeof recurring }>(
                  "evidence_projection",
                );
                assert.ok(
                  retained.some(
                    (source) =>
                      source.body.kind === "complete" &&
                      source.body.completion?.lines[0]?.period?.startsAt ===
                        recurringPeriod.startsAt,
                  ),
                  "custody retains the exact original spelling",
                );
              }
            } finally {
              await fixture.close();
            }
          },
        );
      }
    }
  }
});

void test("reentrant initial support A→B→A→B conserves one allocation across restart, replay and partial adverse evidence", async () => {
  const fixture = await consumers();
  try {
    const a = message(1),
      bFact = fact({
        factId: "initial-B",
        transactionRef: "initial-B",
        providerSubscriptionRef: "subscription-B",
        lines: [{ ...fact().lines[0]!, providerLineRef: "initial-B-line", period: nextPeriod }],
      }),
      b = message(1, bFact);
    await fixture.credit.receive(a);
    const original = (await effects(fixture.credit)).find((effect) => effect.kind === "grant")!;
    await fixture.credit.receive(b);
    assert.ok((await fixture.credit.decisions()).every((row) => row.body.eligible === "0"));
    const select = async (
      input: typeof a,
      startsAt: string,
      approvalRef: string,
      transition: number,
    ) => {
      const credit = new CreditFixture({
        pool: fixture.pool,
        schema: fixture.credit.owner.options.schema,
        trust: fixture.trust,
      });
      const target = (await credit.decisions()).find(
        (row) => row.body.period?.startsAt === startsAt,
      )!;
      const command: HeldResolution = {
        basisKey: target.basis_key,
        expectedDecisionRevision: Number(target.revision),
        expectedReadSet: target.body.readSet,
        selectedSource: sourceIdentity(input),
        actorId: "authorized-initial-owner",
        approvalRef,
        policyVersion: "fixture-credit-policy-v1",
      };
      assert.equal(await credit.resolveHeldDecision(command), "resolved");
      assert.equal(await credit.resolveHeldDecision(command), "duplicate");
      const decisions = await credit.decisions(),
        history = await effects(credit),
        guard = (await credit.initialGuards())[0]!.body;
      assert.equal(
        decisions.reduce((sum, row) => sum + BigInt(row.body.eligible), 0n),
        Q,
      );
      assert.equal(
        decisions.reduce((sum, row) => sum + BigInt(row.body.allocated), 0n),
        Q,
      );
      assert.equal(
        decisions.reduce((sum, row) => sum + BigInt(row.body.held), 0n),
        0n,
      );
      assert.equal(
        history.reduce((sum, effect) => sum + BigInt(effect.amount), 0n),
        Q,
      );
      for (const decision of decisions) {
        assert.equal(
          history
            .filter((effect) => effect.basisKey === decision.basis_key)
            .reduce((sum, effect) => sum + BigInt(effect.amount), 0n),
          BigInt(decision.body.allocated),
          "per-period effect net equals durable allocation",
        );
      }
      assert.equal(
        decisions.find((row) => row.basis_key === target.basis_key)?.body.originalGrant,
        original.effectKey,
      );
      assert.equal(guard.allocationOwner, target.basis_key);
      assert.equal(guard.allocationRevision, transition);
      assert.equal(guard.originalGrant, original.effectKey);
      assert.equal(history.filter((effect) => effect.kind === "grant").length, 1);
      assert.equal(
        history.filter((effect) => ["correction", "restoration"].includes(effect.kind)).length,
        0,
        "changing support is neither a refund nor restoration",
      );
      assert.equal(
        history.filter((effect) => effect.kind === "support_transfer_out").length,
        transition,
      );
      assert.equal(
        history.filter((effect) => effect.kind === "support_transfer_in").length,
        transition,
      );
      assert.equal(new Set(history.map((effect) => effect.effectKey)).size, history.length);
    };
    await select(b, nextPeriod.startsAt, "select-B-first", 1);
    await select(a, period.startsAt, "select-A-again", 2);
    await select(b, nextPeriod.startsAt, "select-B-again", 3);
    const partial = adjustment({
      adjustmentRef: "partial-B",
      transactionRef: "initial-B",
      type: "partial",
      amount: { currency: "USD", minorUnits: "333" },
      allocations: [
        {
          providerLineRef: "initial-B-line",
          type: "partial",
          amount: { currency: "USD", minorUnits: "333" },
        },
      ],
    });
    await fixture.credit.receive(message(2, bFact, [partial]));
    assert.equal(
      (await fixture.credit.decisions()).reduce((sum, row) => sum + BigInt(row.body.eligible), 0n),
      0n,
    );
    assert.equal(
      (await fixture.credit.decisions()).reduce((sum, row) => sum + BigInt(row.body.allocated), 0n),
      Q,
    );
    assert.equal(
      (await effects(fixture.credit)).filter((effect) => effect.kind === "correction").length,
      0,
      "partial uncertainty never compensates an unqualified amount",
    );
    await select(a, period.startsAt, "select-A-after-partial-B", 4);
  } finally {
    await fixture.close();
  }
});

void test("a resolution of one initial period invalidates a stale competing period decision through their shared guard", async () => {
  const fixture = await consumers();
  try {
    const a = message(1),
      b = message(
        1,
        fact({
          factId: "initial-B",
          transactionRef: "initial-B",
          providerSubscriptionRef: "subscription-B",
          lines: [{ ...fact().lines[0]!, providerLineRef: "initial-B-line", period: nextPeriod }],
        }),
      );
    await fixture.credit.receive(a);
    await fixture.credit.receive(b);
    const rows = await fixture.credit.decisions();
    const commands = rows.map((row) => ({
      basisKey: row.basis_key,
      expectedDecisionRevision: Number(row.revision),
      expectedReadSet: row.body.readSet,
      selectedSource: sourceIdentity(row.body.period?.startsAt === nextPeriod.startsAt ? b : a),
      actorId: "authorized-initial-owner",
      approvalRef: `concurrent-${row.body.period?.startsAt}`,
      policyVersion: "fixture-credit-policy-v1",
    }));
    const outcomes = await Promise.all(
      commands.map((command) => fixture.credit.resolveHeldDecision(command)),
    );
    assert.deepEqual(outcomes.toSorted(), ["conflict", "resolved"]);
    assert.equal(
      (await fixture.credit.decisions()).reduce((sum, row) => sum + BigInt(row.body.eligible), 0n),
      Q,
    );
    assert.equal(
      (await effects(fixture.credit)).filter((effect) => effect.kind === "grant").length,
      1,
    );
  } finally {
    await fixture.close();
  }
});

void test("access lifecycle serializes with paid evidence, preserves known periods and never paywalls read/export/cancel", async () => {
  const fixture = await consumers();
  try {
    await fixture.access.receive(message(1));
    await fixture.access.receive(subscription(1));
    let decision = (await fixture.access.decisions())[0]!.body;
    assert.equal(decision.newAction, true);
    assert.equal(decision.paidUntil, period.endsAt);
    await fixture.access.restrict({
      buyerId: "buyer-a",
      restricted: true,
      actorId: "security-owner",
      approvalRef: "restrict-1",
    });
    assert.equal((await fixture.access.decisions())[0]!.body.newAction, false);
    await fixture.access.restrict({
      buyerId: "buyer-a",
      restricted: false,
      actorId: "security-owner",
      approvalRef: "restrict-2",
    });
    await fixture.access.receive(subscription(2, { scheduled: true }));
    assert.equal((await fixture.access.decisions())[0]!.body.newAction, true);
    fixture.setNow("2026-11-01T00:00:01Z");
    await fixture.access.refresh("buyer-a");
    assert.equal((await fixture.access.decisions())[0]!.body.newAction, false);
    fixture.setNow("2026-10-15T00:00:00Z");
    await Promise.all([
      fixture.access.receive(subscription(4, { status: "canceled" })),
      fixture.access.receive(message(2)),
    ]);
    await fixture.access.receive(subscription(1));
    decision = (await fixture.access.decisions())[0]!.body;
    assert.equal(decision.status, "canceled");
    assert.equal(decision.newAction, false);
    assert.equal(decision.expand, false);
    assert.deepEqual([decision.read, decision.export, decision.cancel], [true, true, true]);
    assert.deepEqual(decision.knownLastPeriod, period);
    await fixture.access.receive(subscription(5, { unknown: true }));
    decision = (await fixture.access.decisions())[0]!.body;
    assert.equal(decision.status, "unknown");
    assert.equal(decision.newAction, false);
    assert.ok(decision.restrictions.includes("incomplete_lifecycle"));
    const restarted = new AccessFixture({
      pool: fixture.pool,
      schema: fixture.access.owner.options.schema,
      trust: fixture.trust,
      now: () => "2026-10-15T00:00:00Z",
    });
    assert.equal(
      (await restarted.receive(subscription(2, { scheduled: true }))).outcome,
      "duplicate",
    );
    assert.equal((await restarted.decisions())[0]!.body.status, "unknown");
    assert.equal(canonical((await fixture.access.owner.inspect("receipts")).length), "6");
  } finally {
    await fixture.close();
  }
});

void test("partial and unqualified reversal evidence stays held; authorized owner policy redrives after ACK/restart without a fake payment revision", async () => {
  const fixture = await consumers();
  try {
    const partial = adjustment({
      type: "partial",
      amount: { currency: "USD", minorUnits: "333" },
      allocations: [
        {
          providerLineRef: "line-A",
          type: "partial",
          amount: { currency: "USD", minorUnits: "333" },
        },
      ],
    });
    const input = message(1, fact(), [partial]);
    assert.equal((await fixture.credit.receive(input)).acknowledge, true);
    assert.equal((await onlyCredit(fixture.credit)).status, "held");
    assert.equal((await effects(fixture.credit)).length, 0);
    const restarted = new CreditFixture({
      pool: fixture.pool,
      schema: fixture.credit.owner.options.schema,
      trust: fixture.trust,
    });
    assert.ok(
      (await restarted.owner.inspect<{ state: string }>("obligations")).some(
        (row) => row.state === "pending",
      ),
    );
    const row = (await restarted.decisions())[0]!;
    const command: HeldResolution = {
      basisKey: row.basis_key,
      expectedDecisionRevision: Number(row.revision),
      expectedReadSet: row.body.readSet,
      selectedSource: sourceIdentity(input),
      actorId: "authorized-policy-owner",
      approvalRef: "partial-reviewed",
      policyVersion: "fixture-credit-policy-v1",
      reviewedPartialPolicy: "retain_full_symbolic_benefit",
    };
    assert.equal(await restarted.resolveHeldDecision(command), "resolved");
    assert.equal(await restarted.resolveHeldDecision(command), "duplicate");
    assert.equal(
      BigInt((await onlyCredit(restarted)).eligible),
      Q,
      "explicit symbolic policy; never divide refund money into credits",
    );
    assert.equal((await restarted.owner.inspect("receipts")).length, 1);
    assert.equal((await restarted.receive(input)).outcome, "duplicate");
    assert.equal((await effects(restarted)).filter((effect) => effect.kind === "grant").length, 1);
    await restarted.receive(message(2, fact(), [adjustment({ status: "reversed" })]));
    assert.equal(
      (await onlyCredit(restarted)).eligible,
      "0",
      "unqualified reversal cannot reuse prior policy approval",
    );
    assert.equal((await onlyCredit(restarted)).held, Q.toString());
    assert.equal(
      (await effects(restarted)).filter((effect) => effect.kind === "correction").length,
      0,
      "policy hold does not invent a provider refund",
    );
  } finally {
    await fixture.close();
  }
});

void test(
  "a buyer membership guard covers phantom contributions without serializing independent beneficiaries",
  { timeout: 5000 },
  async () => {
    const fixture = await consumers(),
      blocker = await fixture.pool.connect();
    let waiting: Promise<unknown> | undefined;
    try {
      await blocker.query("BEGIN");
      await fixture.credit.owner.lockBuyer(blocker, "buyer-a");
      waiting = fixture.credit.receive(message(1));
      const other = fact({
        buyerId: "buyer-b",
        intentId: "intent-b",
        transactionRef: "transaction-b",
        subscriptionBasisId: "binding-b",
        providerSubscriptionRef: "subscription-b",
      });
      assert.equal(
        (await fixture.credit.receive(message(1, other))).outcome,
        "accepted",
        "different buyer must commit while buyer-a is locked",
      );
      assert.equal((await fixture.credit.decisions()).length, 1);
      await blocker.query("COMMIT");
      await waiting;
      assert.equal((await fixture.credit.decisions()).length, 2);
      assert.equal(
        (await fixture.credit.decisions()).reduce(
          (sum, row) => sum + BigInt(row.body.eligible),
          0n,
        ),
        2n * Q,
      );
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
      await waiting?.catch(() => {});
      await fixture.close();
    }
  },
);

void test("new higher revision with malformed payload or changed beneficiary holds the original contribution without routing it elsewhere", async () => {
  const fixture = await consumers();
  try {
    const paid = message(1);
    await fixture.credit.receive(paid);
    const malformed = message(2);
    const { bodyDigest: _digest, ...body } = malformed;
    assert.equal(
      (await fixture.credit.receive(signFixtureMessage({ ...body, completion: { invalid: true } })))
        .outcome,
      "held",
    );
    assert.equal((await onlyCredit(fixture.credit)).eligible, "0");
    assert.equal((await onlyCredit(fixture.credit)).held, Q.toString());
    assert.equal(
      (
        await fixture.credit.receive(
          message(3, fact({ buyerId: "victim-b", intentId: "intent-other" })),
        )
      ).outcome,
      "held",
    );
    const original = await onlyCredit(fixture.credit);
    assert.equal(original.buyerId, "buyer-a");
    assert.equal(original.eligible, "0");
    assert.equal(
      (await effects(fixture.credit)).filter((effect) => effect.kind === "grant").length,
      1,
    );
    await fixture.credit.receive(message(4));
    assert.equal((await onlyCredit(fixture.credit)).eligible, Q.toString());
  } finally {
    await fixture.close();
  }
});
