# Independent review: Paddle custody/recovery 0.3

Date: 2026-10-21. Review mode: read-only source analysis; no database lease,
installation, build, tests, remote access or implementation edits.

## Reviewed source

Repository: `/workspace/scratch/9e36ca3bbd13/implementation/payments-sdk`.
HEAD: `28ab08829d3c90094a2b2a846da05daa09c108c2`.
Base: `58441742d2f3743e4681f4bb02b2ff013023d652`.
The worktree was clean at the start and final source check.

| Source | Git blob |
| --- | --- |
| `tests/e2e/paddle-custody-recovery.test.ts` | `2666405df516d60ab114eca78d60c47debc1c147` |
| `packages/payments-core/src/runtime.ts` | `47caf720391a8faa2d0780925e81ab349590665a` |
| `packages/payments-postgres/src/store.ts` | `2a32a3595d189dde4e34cfb66197b842492123a6` |
| `packages/payments-paddle/src/provider.ts` | `0db6bbb5b2fa1c124cd1f65555d3c5b5c72a42e5` |
| `tests/fixtures/consumers/owner.ts` | `9e53f22e39c7f71344b09600c94e64bfb0c13e16` |
| `tests/fixtures/consumers/credit.ts` | `716b1d65b6a5918283eecf9103104a74754b9189` |
| `tests/fixtures/consumers/access.ts` | `5a9fe4337b788bf310f8d0ae1d539ecbb289ead5` |
| `examples/node-http.ts` | `c4365749920e4961076afc24db4e882dd54454c0` |
| `examples/fetch-modular.ts` | `8c1c2b530979adba63acb82f219b373aa8026b8c` |

Read `AGENTS.md`, `docs/developer-stack.md`, architecture/accepted implementation
plan, the Paddle adapter guide and retained organization Engineering Quality
Standard at `research/org-current/docs/engineering-quality-standard.md`. Applied
the root-provided pinned Q principles: narrow consumer-owned ports, inward
dependencies, minimum useful boundary and observable behavior over ceremony.

## Verdict

**No material correctness or architecture defect found in this slice.** No P0,
P1 or P2 finding, and no implementation change or additional test requested.
This is a source review, not a claim that the final runtime/database gates passed.

The three scenarios add connected behavior rather than shallow isolated cases:
official SDK transport, public host composition, durable payment state, and two
independently owned consumer decisions are linked in the same histories.

## Substantive counterevidence preserved

- **Official SDK seam.** Test lines 27-36 replace only the isolated process HTTP
  transport with official Undici `install()`/`MockAgent`, disable network and
  restore dispatcher/global descriptors. Production `provider.ts:73,79-83,
  110-112,121,159` uses the public Paddle constructor/resources/signature API.
  Inspected the installed SDK's `dist/esm/internal/api/client.js`, public
  transaction/subscription resources, webhook validator and `version.js`
  (`3.10.0`): actual request serialization, global fetch, response constructors
  on successful calls and signature validation remain in the exercised path.
  No production global-fetch patch, private SDK import or replacement client.
- **Permanent checkout reply loss.** Test lines 125-202 store the synthetic
  provider effect before throwing from transport. No delayed successful provider
  promise later heals the command. Restart, same-key replay, repair and explicit
  execute preserve one dispatch and one durable unknown attempt. A signed
  correlation hint remains non-granting before authoritative binding. The
  production classifier requires a saved binding (`reducer.ts:123-129`).
- **Audited recovery.** The create and cancellation histories bind through
  `resolveUnknownOperation`, supply expected revision and actor/audit/reason,
  preserve original attempt evidence, and reject stale replay. The runtime
  validates successful outcome ownership before binding (`runtime.ts:20-43,
  300-320`). The PostgreSQL commit locks operation/lane/binding identities and
  checks operation and lane revisions (`store.ts:156-217`). Binding schedules
  reclassification of already retained evidence instead of requiring another
  provider mutation or another completed event (`runtime.ts:208-211`).
- **Unresolved cancellation lane.** Test lines 313-348 verify unknown outcome,
  restart, same-key replay, read-only SDK recovery, fresh-key prepared operation
  with zero attempts, repair and the saved lane owner. The only mutation dispatch
  site requires a committed marker (`runtime.ts:123-159`); the store rejects a
  competing lane owner before dispatch (`store.ts:184-191`). Lifecycle evidence
  does not silently settle the original command. The audited resolution releases
  the lane and preserves the completed purchase and its original grant.
- **Exact raw custody.** Independent Node HMAC and SHA-256 helpers sign/hash the
  original pretty-printed UTF-8 string, including CRLF, combining/composed
  characters and escaped content. Reserialization fails authentication before
  admission; successful custody retains the original string and raw digest.
  Notification-only/body-format replay retains separate representations while
  preserving one stable event envelope and one completion fact (test 220-270).
- **Independent T3 and financial oracle.** Credit and access use separate schemas
  and owner-local transactions. Consumer receipt, decision/effect and outbox
  commit together (`owner.ts:90-99,123-169`), with no payment-owner SQL read.
  The test drops a credit ACK after its T3, reconstructs the credit consumer,
  observes duplicate receipt handling, and proves credit ACK does not discharge
  access (245-255). Expected 100-unit grant and access flags are explicit test
  answers (106-122); the fixture has independent fixed quota and policy
  (`credit.ts:9,95`, `access.ts:17-65`) rather than invoking the production
  reducer to compute the expectation. Replays preserve exactly one grant and
  its causal identity.

## Scenario limits / optional claim precision

These are **scope observations, not defects or merge blockers**:

1. **Cancellation uses the runtime API inside both host compositions.** Test
   313,321,341 calls `context.payments.requestCancellation` directly. The shared
   HTTP handler exposes purchases and webhook admission, with no cancellation
   route (`examples/node-http.ts:10-28`). Thus `CHANGELOG.md:28-31`'s “through both
   HTTP hosts” is defensible as composition coverage but should not be expanded
   into a cancellation HTTP endpoint claim. Reproduction is direct source
   inspection; no probe is needed. Clear wording would be “under both host
   compositions; checkout/webhooks through HTTP, cancellation through the public
   runtime API.”
2. **The injected custody fault is a write failure, not uncertain COMMIT.** Test
   229-236 installs a `BEFORE INSERT OR UPDATE` inbox trigger. The small write
   set is executed by one record upsert (`records.ts:87-113`), and obligation
   writes follow it (`store.ts:332-341`). The assertions genuinely establish
   failed admission with no durable state and successful redelivery, but do not
   independently exercise rollback after an obligation enqueue or loss of an
   actually successful COMMIT reply. The no-orphan-obligation assertion concerns
   an obligation that the failing path has not yet attempted. Keep the claim
   “T1 admission failure/rollback”; existing real lost-COMMIT coverage is
   separately present at `payments-postgres/test/durability.test.ts:67-83`.
3. **Restart reconstructs services over the same durable database and pool.** It
   proves no in-memory payment/consumer dedup requirement. It is not an OS crash,
   PostgreSQL restart/PITR, physical transport blackhole or live Paddle account
   qualification. Those broader guarantees remain in their existing gates and
   deployment prerequisites.
4. **The competing prepared cancellation intentionally remains undispatched
   after audited resolution** (368-370). The scenario proves lane release and no
   extra dispatch while unresolved; it does not promise that repair will never
   execute an explicitly admitted prepared command after the lane is released.

No proposed runtime probe remains necessary from this review. Root owns the
final strict, E2E and admitted Node/PostgreSQL qualification gates.
