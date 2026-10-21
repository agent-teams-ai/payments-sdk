# Connected subscription and credit scenario matrix

Date: 2026-10-21. Baseline: `2524d88`. Added coverage:
[`subscription-credits.test.ts`](../../tests/e2e/subscription-credits.test.ts),
with [`subscription-credits-fixture.ts`](../../tests/e2e/subscription-credits-fixture.ts).

## Scope and acceptance oracle

The accepted commercial slice remains one monthly recurring price, quantity 1,
automatic collection, no trial, plus separate intentional one-time purchases.
The payment owner confirms provider facts. Independent PostgreSQL-backed credit
and commercial access fixtures consume its durable evidence in their own T3s.
These fixtures are **not a production credit ledger or a production access service**.

The independent expected output is explicit: a supported completed monthly paid
period supplies 100 symbolic included units; a separate completed one-time
purchase supplies 25 purchased units. Provider price amounts do not calculate
these quantities. A failed, billed, paid-but-not-completed, unsupported,
incomplete, foreign-account or disallowed zero-total receipt supplies no grant.
Repeated evidence never creates another original grant. Full adverse evidence
corrects only its causal grant; the fixture's exact qualified reversal restores
that same grant. No consumption, debt, rollover, credit expiry, usage pricing,
grace period or arbitrary interval-overlap policy is added.

Access requires a supported active lifecycle and an unexpired paid subscription
period. Purchased credits do not extend that period or reopen a canceled
subscription. Read, export and cancel remain available. Local owner clock
refresh owns access expiry; replaying a payment does not advance that clock.

## Primary evidence and actual SDK inspection

Paddle documentation was read on 2026-10-21. These references establish provider
billing behavior; the symbolic credit amounts above remain separately owned
fixture policy.

| Primary source | Consequence for scenarios |
| --- | --- |
| [Subscription created scenario](https://developer.paddle.com/webhooks/simulator/subscription-created/) | A no-trial initial checkout can activate a subscription before transaction processing reaches `completed`. Activation alone is not a paid-period grant. |
| [Subscription renewed scenario](https://developer.paddle.com/webhooks/simulator/subscription-renewed/) | Renewal advances subscription billing dates and creates a `subscription_recurring` transaction. `billed`, `paid` and `completed` are distinct stages. The new monthly sequence tests that distinction. |
| [Subscription past due](https://developer.paddle.com/webhooks/subscriptions/subscription-past-due/) | Automatic collection failure makes the subscription past due. Recovery returns it to active; exhausted recovery may pause or cancel according to account settings. No synthetic test claims to run Paddle's recovery scheduler. |
| [Payment method transaction](https://developer.paddle.com/api-reference/subscriptions/get-subscription-update-payment-method-transaction/) | The active-state GET creates a zero transaction; the past-due GET returns the most recent unpaid transaction. The connected suite keeps the management and commercial recovery purposes separate. |
| [Cancel a subscription](https://developer.paddle.com/build/subscriptions/cancel-subscriptions/) | A period-end cancellation preserves current status with a scheduled change until its effective time; immediate cancellation changes status immediately. Canceled subscriptions cannot be reinstated. |
| [Pause a subscription](https://developer.paddle.com/build/subscriptions/pause-subscriptions/) | Pausing stops billing. Pausing an automatically collected past-due subscription cancels unpaid recurring transactions. Pause/resume commands remain outside the accepted public API. |
| [Webhook delivery](https://developer.paddle.com/webhooks/about/respond-to-webhooks/) | Delivery order is not guaranteed; retries may repeat an event. Notification replay can retain the event identity. Independent receipt custody and stable financial effects must coexist. |
| [Adjustment creation schema](https://developer.paddle.com/api-reference/adjustments/create-adjustment/) and [adjustment statuses](https://developer.paddle.com/api-reference/adjustments/list-adjustments/) | Refund approval and chargeback/reverse observations are distinct evidence. Tests do not initiate live refunds or disputes. |
| [Service unavailable](https://developer.paddle.com/errors/shared/service_unavailable/) | A documented 503 read failure can be surfaced without manufacturing a new subscription observation or erasing historical payment evidence. |

Inspected the actual installed official `@paddle/paddle-node-sdk@3.10.0`
artifact, pinned by the frozen lockfile, rather than assuming that TypeScript
enums validate runtime payloads. The inspected files are under that package's
`dist/esm/` directory:

| Actual file | Observed mechanism |
| --- | --- |
| `internal/api/client.js` | SDK headers, environment URL selection, request-body snake-case conversion, JSON response parsing and global `fetch` calls. Its GET method performs one fetch without a retry loop. |
| `resources/subscriptions/index.js` | Public `get`, `cancel` and `getPaymentMethodChangeTransaction` use the documented resource paths and construct SDK entities. |
| `resources/transactions/index.js` | Public create/get paths construct `Transaction` instances after response handling. |
| `internal/base/base-resource.js` | Provider error envelopes become SDK `ApiError`, including `Retry-After` when present. |
| `entities/subscription/subscription.js` and `entities/transaction/transaction.js` | Wire snake-case fields become mapped properties. Several absent/falsy nullable fields collapse to `null`, so mapped API custody cannot claim original wire presence. Raw signed webhook custody remains distinct. |

For reproducible source read-back, SHA-256 of the inspected `client.js` is
`c8c54eff3364f31eb002151a70e360afda5520f8e321476222176abc085dc331`;
`resources/subscriptions/index.js` is
`c8bf6e8c179ddc9c481562ccb28c151ee27e80634691276290df09ed6e027409`;
`entities/subscription/subscription.js` is
`116b7c911d2de50e20dfacc606e3f83e7d9a887ccd4b3be973ef41e0f18e2324`.

Test transport uses Undici `MockAgent` only in the isolated test process. Real
public Paddle adapter calls, official SDK resources/entity constructors, signed
raw HTTP ingress, payment PostgreSQL state, independent consumer PostgreSQL
transactions and public host lifecycle run together. Network connections are
disabled in the mock dispatcher, credentials are synthetic, and assertions
require all declared interceptors to be consumed. Production does not patch
`fetch`, import SDK private paths or acquire raw API custody through this fixture.

## Coverage matrix

“Connected” means the official SDK and durable PostgreSQL-backed owners run in
one scenario. “Consumer-only” means it does not qualify the Paddle mapping and
ingress chain. “Unsupported” is an explicit retained/fail-closed outcome, not
feature support. “Real-account-only” identifies a remaining provider qualification
step, not an omitted automated credential requirement.

New stories in `subscription-credits.test.ts`:

- **N1:** Three paid adjacent months and cross-channel replay.
- **N2:** Top-ups across lifecycle restrictions, own refund and chargeback reversal.
- **N3:** Explicit payment-update recovery of the original unpaid recurring transaction.
- **N4:** Scheduled cancellation cutoff, transient read, buyer ownership.
- **N5:** Zero, incomplete and foreign-account financial evidence denied.

| Risk / scenario | Before this addition | Current coverage and limit |
| --- | --- | --- |
| Initial monthly checkout and paid grant | Connected in `full-system` | Retained; all N1–N4 begin with one paid initial period and one 100-unit grant. Checkout readiness and activation do not prove payment. |
| Recurring billed/paid stages | Paid recovery existed; this precise longer-stage sequence missing | **N1 connected:** advancing lifecycle and billed/paid renewal create no new grant; completed November creates exactly one. |
| Several successful monthly renewals | One renewal connected | **N1 connected:** October, November, December have three exact adjacent period identities, three stable grants, immutable initial fact and no extra checkout mutation. |
| Failure, recovery and original exact period | Connected simple failure/recovery | **N3 connected:** public `openPaymentUpdate` returns the existing unpaid recurring transaction, purpose `recovery`; completion issues November once and creates no purchased bucket. Request replay and restart do not call the mutation-capable GET again. |
| Exhausted dunning / external pause / cancellation | Limited lifecycle observations | **N2 connected:** unpaid November then paused observation and canceled recurring transaction produce no grant. Paused provider status is retained with `unsupported`; the access fixture reports unknown/incomplete lifecycle and denies new actions. Account recovery timing remains real-account-only. |
| Webhook first then API evidence | Receipts covered in shorter stories | **N1 connected:** same initial/November events arrive through signed ingress and the public SDK Events resource, without financial duplication. |
| API first then webhook evidence | API-only catch-up existed | **N1/N3 connected:** December/recovery facts arrive via SDK Events first; subsequent signed receipts and new notification IDs preserve the grant/fact identities. |
| Late older transaction/lifecycle evidence | Core and profile coverage | **N1 connected:** old billed and past-due snapshots cannot regress newer completed/active state after restart. |
| Different transactions for one exact/equivalent period | Connected in `full-system` equal-period scenarios | Retained: distinct initial/renewal transactions for equivalent RFC3339 instants are held without issuing duplicate quota. N1 adds repeated receipt coverage, not a new duplicate-payment policy. |
| Partially overlapping but unequal periods | No overlap policy | **Policy-unqualified:** exact period identity does not define arbitrary interval overlap. No partial-overlap, resume or proration allocation rule is invented. Requires an owning policy before production qualification. |
| Competing initial subscription streams | Connected duplicate-risk retry and reentrant allocation in `full-system`; richer consumer CAS cases | Retained. User/operator selection, initial-intent guard and causal transfers are independently tested; N1 does not claim automatic stream selection. |
| Active/past-due/paused/canceled top-ups | Top-up connected only in narrower state context | **N2 connected:** four separate purchases each issue 25 once; lifecycle restriction and subscription paid-until are unchanged; restart/replay preserve each grant. Paused remains unsupported/fail-closed. |
| Pending refund then approved full refund | Connected initial refund | **N2 connected:** pending top-up refund holds only its purchased allocation without correction; approved refund corrects that original grant by 25 once; monthly and three other purchased grants remain unchanged. |
| Approved original chargeback and matching reversal | SDK mapping and unmatched reversal connected, no original-chargeback lifecycle | **N2 connected:** full chargeback corrects a different purchased grant once; reversed original alone cannot restore; a matching `chargeback_reverse` restores exactly 25 to the same original grant after API/raw replay/restart. Canceled access stays closed. |
| Overlapping/unmatched adjustments | Connected `full-system` whole-snapshot credit/reverse/unmatched-reverse cases | Retained fail-closed whole-snapshot qualification. An unexplained extra reverse cannot restore eligibility, even after owner restart or a fresh approval. This is the fixture's deliberately narrow policy. |
| Partial refund and consumption/debt effect | Consumer-only partial hold and explicit local policy resolution | **Consumer-only / policy-unqualified:** no production partial-refund arithmetic or already-spent-credit policy is claimed. |
| Period-end cancellation and cutoff without final webhook | Command/scheduled observation connected; local expiry consumer-only | **N4 connected:** exact SDK request is `next_billing_period`; local clock after boundary closes access before canceled webhook, preserves paid history, and keeps reads/export/cancel. Old paid evidence/top-up cannot reopen access. |
| Immediate cancellation with lost reply | Connected in `paddle-custody-recovery` | Retained: unknown mutation lane stays fenced through restart; read-only canceled observation restricts access and preserves completed credits until audited resolution. |
| Zero payment-method transaction | Connected in `full-system` | Retained: active-state method-change checkout is management evidence and grants no units. N3 separately proves real paid recovery is commercial for its original period. |
| Wrong buyer read/refresh/cancel | Narrow connected read assertion plus core tests | **N4 connected:** wrong buyer cannot read either local projection, refresh either owned object or cancel; no SDK interceptor is available for these forbidden calls. |
| Foreign merchant correlation | SDK-only mapping checks | **N5 connected:** a validly signed bound transaction with wrong account metadata remains unsupported, has no completion and gives no consumer effect through API/raw replay. This does not establish live API-key account membership. |
| Scope/environment envelope and beneficiary mutation | Consumer protocol trust and core scope checks | **Consumer-only/core plus N5 metadata:** full multi-account live configuration isolation is not claimed. Credential-to-account proof is real-account-only. |
| Unapproved zero total / missing financial lines | Core/adapter qualification; permitted free purchase already connected | **N5 connected:** ordinary top-up catalog rejects zero; missing financial lines remain incomplete. Both retain receipts and no completion or grant across restart. Permitted zero commercial purchases remain separately covered by `full-system`. |
| Unknown lifecycle/status, seats, trials, manual collection, profile conflict | Connected `provider-profile` raw/API acquisition | Retained fail-closed. No new public plan-change, pause/resume, trial, seat, manual invoice or usage-billing support. |
| Transient authenticated read failure | Adapter-level errors and some recovery coverage | **N4 connected:** real SDK `ApiError` from 503 maps to unavailable, leaves subscription evidence/input count and credit decisions unchanged; later read acquires scheduled cancellation successfully. |
| Invalid signature, raw bytes, durable custody failure | Connected `paddle-custody-recovery` | Retained: reserialized bytes fail original signature; failed T1 returns 503 without orphan state; later retry succeeds. |
| Lost consumer ACK, T3 atomicity, independent targets | Connected `full-system`/custody and consumer protocol | Retained: receiver restart/redelivery yields one effect; credit ACK does not discharge access. N1–N5 use independent consumer schemas and drain both targets. |
| Live checkout/card collection, true provider renewal, notification scheduler, dispute creation, credential authority | Not run automatically | **Real-account-only:** authorized sandbox qualification remains required in `docs/qualification.md`. No live credentials, charges or portal sessions are used here. |

## Validation and limits

The new file executes five bounded stories through both Node HTTP factory and
Fetch/static Get Modular hosts. Assertions are on independent expected grant
quantities, causal effect references, exact period identities, access decisions,
immutable facts and dispatch counts. There are no fixed sleeps or elapsed-time
correctness oracles. Every test uses new random payment/credit/access schemas;
the run database is a separate local PostgreSQL 18.4 database, not another
agent's shared database.

All 15 targeted TAP cases passed on Node 24.21.0 with the official SDK 3.10.0.
The complete package build and strict checks project passed with TypeScript
7.0.2 and `skipLibCheck:false`, and type-aware lint passed for both new source
files. After applying driver/queue commits `e7aed84`, `2aa2e38`, `3f2bd52` and
`69a2c0e`, the new fixture uses the explicit `/node-postgres` driver entrypoint.
No checks-project exclusion or compiler relaxation is used. The owning
integration must run the complete E2E and release gates on its final integrated
tree; this focused addition does not replace those gates.

Reproduce the targeted runtime gate with a dedicated PostgreSQL 18 database:

```sh
DATABASE_URL=postgresql://postgres@127.0.0.1:55438/payments_subscription_matrix_20261021 node --test tests/e2e/subscription-credits.test.ts
```

No accepted ADR, production reducer, payment adapter, consumer policy or catalog
scope is changed by these additions.
