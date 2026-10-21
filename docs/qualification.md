# Qualification and deployment gates

This page describes reproducible evidence and its limits. A test file is not a recorded passing run. Use the exact commit's successful **Checks → Required checks** run and its logs/artifacts as the release evidence. Counts and dates are intentionally not copied here: the workflow result is authoritative, and a later commit needs its own qualification.

The [SDK 0.3 driver/queue and subscription record](reviews/sdk-0.3-portability/README.md)
binds earlier complete checks on the then-admitted Node **24.21.0 / 26.11.1**
floors, production-only package isolation, connected monthly/top-up scenarios,
four additional reviews and exact production metrics.
[PR #6](https://github.com/agent-teams-ai/payments-sdk/pull/6) owns that remote
delivery and its own hosted result. It does not qualify the subsequent
[corrected-runtime qualification](runtime-security-admission.md) on **24.22.1 / 26.12.1**;
its [complete local gates](reviews/node-runtime-security-correction-2026-10-21/qualification.md)
subsequently passed on the exact `6f348df` source, followed by the reviewed
hosted deliveries recorded below. The earlier
[local hardening record](reviews/sdk-0.3-hardening/README.md), including its then
blocked write access, remains historical.

The [SDK 0.2 complete local qualification](reviews/sdk-0.2/qualification.md)
records the exact two-floor integration subject, logs and package hashes. It
preserves prior failures and explicitly separates local evidence from hosted
CI, publication and production admission.

The subsequent [Foundation profile completion](foundation-adoption.md) activates
the shared typed lint baseline and corrects source validation/types accordingly.
The [final tooling and delivery record](reviews/sdk-0.2-completion/README.md)
binds both complete local Node-floor runs and successful hosted CI to the new
source, with raw logs, archive hashes, independent reviews and production code
metrics. The earlier qualification remains historical. Each later delivery
commit still requires its own exact-head hosted checks.

## Reviewed hosted baselines

These successful main-push runs bind the delivered source to the repository's
required checks. Each later PR and merge still needs its own successful run;
the deployment and credential gates below remain separate.

| Delivery | Exact merged source | Successful main-push Checks |
| --- | --- | --- |
| [PR #7](https://github.com/agent-teams-ai/payments-sdk/pull/7): corrected Node floors and repository cleanup | [`b4b29bb065a609f6886fd48a4b01412135fbb6ec`](https://github.com/agent-teams-ai/payments-sdk/commit/b4b29bb065a609f6886fd48a4b01412135fbb6ec) | [Run 39611581129](https://github.com/agent-teams-ai/payments-sdk/actions/runs/39611581129) |
| [PR #8](https://github.com/agent-teams-ai/payments-sdk/pull/8): published Get Modular lifecycle and diagnostics | [`89322945546658720d374096b77bd94f0b759837`](https://github.com/agent-teams-ai/payments-sdk/commit/89322945546658720d374096b77bd94f0b759837) | [Run 39620389645](https://github.com/agent-teams-ai/payments-sdk/actions/runs/39620389645) |

## Functional CI profile

| Component | Exact qualification inputs |
| --- | --- |
| Platform | Linux; Node `24.22.1` and `26.12.1` |
| Tooling | TypeScript `7.0.2`, strict projects, `skipLibCheck:false`, maintained `.ts` sources; pnpm `11.25.0` |
| Durable storage | PostgreSQL `18`, logged correctness tables, `fsync=on`, local `synchronous_commit=on` |
| PostgreSQL driver | Adapter-owned exclusive-session contract; explicit `/node-postgres` wrapper, qualified with text-mode `pg` `8.23.1` pools and default exact-int8/JSON decoding; custom codecs require separate qualification |
| Private storage query toolkit | Drizzle `1.0.0-rc.5-5935859`; exact [artifact and declaration correction](../qualification/drizzle/artifact.json), with original unpatched npm consumer qualification |
| Provider | Official `@paddle/paddle-node-sdk` `3.10.0`, API version 1 and separately versioned notification destination |
| Background transport | Explicit `PaymentJobTransport`; optional `/pg-boss` with explicitly installed `pg-boss` `12.38.0` uses one borrowed host pool, explicit bootstrap and a qualified runtime role; a separate durable SQL fixture exercises substitution without installing pg-boss |
| Get Modular | Published Core/Assembly `0.7.0`, Resources `0.2.1`, optional Observation `0.2.0`, Conformance `0.5.0` in tests; [official packed consumers](upstream-qualification.md#october-21-published-get-modular-adoption) passed on both Node floors. |
| Engineering Foundation | `1.10.1`, development-only |
| Package consumers | ESM NodeNext and Bundler resolution, packed tarballs, strict declarations |

Manifest engine ranges describe runtime compatibility, and the two exact Node versions above are the functional CI matrix. They do not establish production security admission. Other operating systems, PostgreSQL majors, versions within a manifest range and deployment topologies require their own evidence. The [lockfile](../pnpm-lock.yaml) pins the actual dependency closure. The [current upstream record](upstream-qualification.md) identifies the Foundation patch scope, exact local qualification subject, current Get Modular publication gate and official browser blocker.

## Production runtime security admission

Official security releases published on **2026-10-21** provide Node **24.22.1 LTS** with Undici **7.30.1**, and Node **26.12.1** with Undici **8.12.2**. The [current runtime qualification](runtime-security-admission.md) records official archive checksums, actual binary versions, exact corrected-source comparisons and successful unmodified global-fetch process completion. The earlier affected runtime results remain in the [historical security record](security-qualification.md#node-bundled-transport-scope).

The corrected floors are enforced by manifests, the toolchain gate and CI. Independent review and complete local qualification passed on source `6f348df2d345edf5270ade0daebf67cc834de2de` under both corrected floors, as retained in the [qualification record](reviews/node-runtime-security-correction-2026-10-21/qualification.md); the subsequent reviewed deliveries passed their [exact-commit hosted Checks](#reviewed-hosted-baselines). This establishes repository qualification for those sources. The separate account, policy, backup and deployment gates below remain applicable before production admission. Development-only Undici and clean npm scans do not update a host's built-in fetch.

## What the automated gates establish

| Gate | Evidence exercised | Material limit |
| --- | --- | --- |
| `test:runtime-security` | Fresh child, unmodified built-in fetch, bounded loopback malformed response and normal process exit through the shared captured-command helper | This regression probe is not a complete transport security certification |
| `toolchain:check`, `typecheck`, `lint` | Runtime/compiler policy; strict ownership for every maintained source; actual compiled examples and declarations | Compilation cannot prove provider settlement or production authorization |
| Foundation checks and `test:boundaries` | Inward package dependencies, source ownership/exports, forbidden runtime imports and development-only tooling closure | Boundary checks complement behavioral tests |
| `test:modular:adoption` within fast/boundary checks | Reviewed CMS/artifact pins, actual authored boundaries from the Foundation inventory and TypeScript AST, owned exceptions, rejecting drift fixtures and required command reachability | Scoped composition-adapter checks; semantic ownership and application-wide FMS remain separate review responsibilities |
| `test:core` | Request idempotency, exact values, evidence ordering/conflicts, commercial classification, immutable delivery, duplicate initial streams and unknown mutation handling | Memory store is a test fixture, not production durability |
| `test:paddle` | Actual SDK serializer/resources/entity mapping, error translation, exact-byte official signature verification, source-aware normalization and mapped pagination | Network-disabled synthetic API schema fixtures; no Paddle account behavior or charges |
| `test:modular` | Actual published Assembly/Resources/Conformance, static wiring, isolated runs, lifecycle/partial-startup cleanup and late provider settlement | Optional Observation has its own packed consumer gate |
| `test:drizzle:admission` | Official archive SRI, exact declaration-only maintainer patch, byte-identical runtime, positive and negative strict compiler contracts | Does not qualify another Drizzle version or relax the public SDK type boundary |
| `test:postgres` | Real PostgreSQL migrations/concurrency, durable WAL settings, read-set conflicts, SQL fault/deadline cleanup, lost COMMIT replies, actual pg-boss work/repair and runtime grants | Logical recovery and transport fault probes do not establish physical PITR or HA RPO0 |
| `test:e2e` | Node HTTP plain factory and Fetch static Get Modular hosts; actual Paddle SDK synthetic transport; durable payment owner plus independent credit/access fixture owners; alternate transactional transport with the same runner | Test entitlement/credit policies are intentionally nonproduction; the alternative transport is a durable fixture, not a shipped remote broker |
| Foreign-provider scenario within `test:e2e` | Distinct raw provider vocabulary, canonical normalization, initial/renewal/top-up, noncommercial method update, unknown evidence and durable grant replay | A disposable contract fixture does not establish another production provider adapter |
| Reconciliation scenarios within `test:e2e` | Fixed durable queries/cursors, positive missed-payment recovery, adjustment pages, API nullable trust and explicit gaps | SDK mapping/retention/visibility limits remain explicit |
| `test:packed`, `release:dry-run` | Real packed NodeNext/Bundler consumers; exports/declarations; no unresolved workspace/catalog dependency protocol; license/runtime-closure/archive checks | Does not publish to npm or perform an installed production deployment |
| `test:observation` | Published artifact integrity and peer identity; packed public projection, real `watch`/`load`, lifecycle and PostgreSQL financial oracles | Read projections do not replace durable delivery or grant product authorization |
| `test:packed:npm` | Three production-only npm profiles: generic PostgreSQL root without pg/pg-boss, explicitly selected host pg with custom SQL queue and no pg-boss, and all public exports with explicitly selected peers; strict NodeNext/Bundler, original unpatched Drizzle, absent MySQL, real PostgreSQL financial/queue oracles | Only node-postgres is an executed production driver; the alternative queue is a fixture. No npm publication, live credentials or deployment qualification |

The Paddle harness disables unapproved network connections and restores its test dispatcher/globals in cleanup. Production uses the official SDK directly without a global fetch patch, private SDK seam or custom raw API client. Fixture coverage must include successful supported initial/renewal/top-up/API-only recovery, rather than declaring success because everything was conservatively held. Negative cases retain explicit uncertainty/hold and preserve financial facts.

The [connected subscription/credit matrix](reviews/subscription-credits-e2e-matrix.md)
maps supported initial payment, multiple renewals, past-due recovery, independent
top-ups, cancellation cutoff, refund/chargeback causality, API/webhook replay and
rejecting evidence to actual scenarios. It separately identifies unsupported
pause/resume, product-owned spending/rollover/partial-refund policy and live-account
behavior; test fixture credit amounts do not choose those production policies.

The [workflow](../.github/workflows/checks.yaml) builds once, shares compiled package artifacts, runs independent quality/scenario gates and requires their aggregate success. Run the same commands locally as described in the [README](../README.md#examples-and-development). Integration/E2E gates require a disposable PostgreSQL URL and fail visibly without it.

## Deployment and credential gates

These require the selected host/account/deployment and are **not established by fixture or package qualification**:

1. Configure an authorized Paddle sandbox account, supported price/catalog entries, notification destination API1 and endpoint secret. Exercise first null-customer checkout, payment collection, renewal/failure/recovery, both cancellation timings, payment method update, adjustment notifications and customer-wide portal authorization. Record real provider identifiers in protected evidence. No live credentials are present in automated tests.
2. Verify account-side event filters, exclusive window bounds, pagination, adjustment access and current visibility/retention behavior with the declared SDK/API profile. A successful serializer probe does not prove account acceptance of every filter.
3. Implement and review real authentication, buyer ownership, authorization for administrative reads/resolution/recovery, CSRF policy, request/body-read limits, secret handling and sensitive log retention. Adopt separate account authority if account-wide shared-key holders must be isolated.
4. Name the production commercial access and credit accounting owners, immutable historical policies, single-subscription policy if desired, grant sizes, expiry/grace/rollover, partial-refund and consumption/debt rules. Fixture Q/T policies do not settle those choices.
5. Qualify the actual PostgreSQL storage/backup configuration and connection limits. Exercise the external fence, real restore/PITR, consumer exports/backfill, surviving external effects, archive import and audited resume. A claimed HA path needs a tested RPO0 promotion preserving every acknowledged correctness commit; ordinary automatic lossy failover is outside this profile.
6. Verify host shutdown, forced termination and restart with real transport/provider latency and borrowed resource ownership. Local deadlines must not be mistaken for physical cancellation.

No npm publication, real Paddle payment, physical backup restoration, production ledger or deployment HA guarantee is claimed by this repository's local fixture results.

## Browser wrapper admission

The accepted plan selected official `@paddle/paddle-js` `1.6.5` for a future browser example. Importing its exact published artifact under TypeScript `7.0.2` and required `skipLibCheck:false` currently raises `TS2430` in `types/checkout/checkout.d.ts`: `PaddleEventData` extends `Partial<CheckoutEventError>`, but its broad event-name union is incompatible with that error type's two-name union. Official [issue #127](https://github.com/PaddleHQ/paddle-js-wrapper/issues/127) remains open with this same failure. Both isolated strict NodeNext and Bundler consumers reproduced it; see the [exact source and current artifact record](upstream-qualification.md#paddlejs-browser-example-blocked-strict-declarations). This is a declaration compatibility blocker. The SDK does not weaken declaration checking, import private wrapper files or ship an unchecked substitute to claim qualification.

The core/Paddle server adapter remain independent of Paddle.js. Hosts can navigate to the saved provider checkout URL. A browser overlay example can be admitted after an official compatible published artifact passes strict consumers. Then verify public client-token/environment handling, `Initialized` state, visible CDN/loader failures, server-created `transactionId` checkout, and UI-only browser event handling in a real sandbox/browser. The wrapper pins loader/types; provider-hosted Paddle.js CDN code is not pinned by the npm version.

## Observation release and consumer admission

The published Core/Assembly `0.7.0`, Resources `0.2.1`, Conformance `0.5.0` and Observation `0.2.0` train passed the isolated official packed gate on Linux ARM64 Node `24.22.1` and `26.12.1` with PostgreSQL `18`. Both runs passed strict NodeNext/Bundler declarations and all four observation test files, proved official publication against the same manifest digest and used identical four SDK archives. The [current upstream record](upstream-qualification.md#october-21-published-get-modular-adoption) binds the release and evidence. The adoption profile is `scoped-active` for the technical composition adapter; full application FMS is not adopted. The full local check passed on native ARM64 Node `26.12.1`; each SDK revision still requires exact-head hosted CI and independent review before merge.

The [current artifact record](../qualification/observation/published-artifacts.json) retains the new official bytes. The [October 20 registry record](../qualification/observation/published-artifacts-2026-10-20.json) preserves the earlier train and its equality with the original retained candidates. Each release must pass `test:observation` on both Node floors; earlier candidate or registry results do not qualify a new SDK archive. The optional `/observation` entrypoint and one coherent physical peer set remain required. The [integration guide](../packages/payments-get-modular/README.md#optional-purchase-observation) owns the report-and-await lifecycle contract; the [growth assessment](get-modular-growth.md) records the remaining limits and adoption gates. Production security, live-account and deployment gates above remain separate.

The [accepted plan's review journal](implementation-plan.md#16-журнал-независимого-ревью) concerns the design snapshot. It does not establish a completed implementation review, a successful current CI run or completion of a new four-wave implementation review.
