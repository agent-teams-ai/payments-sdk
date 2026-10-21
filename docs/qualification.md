# Qualification and deployment gates

This page describes reproducible evidence and its limits. A test file is not a recorded passing run. Use the exact commit's successful **Checks → Required checks** run and its logs/artifacts as the release evidence. Counts and dates are intentionally not copied here: the workflow result is authoritative, and a later commit needs its own qualification.

The current [SDK 0.3 local hardening record](reviews/sdk-0.3-hardening/README.md)
binds complete checks on both admitted Node floors, additional custody/transport
scenarios, independent reviews and exact production metrics. Remote branch/PR
creation is blocked by the current GitHub integration's write permission; local
results do not claim hosted checks or merge. The records below remain historical.

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

## Functional CI profile

| Component | Exact qualification inputs |
| --- | --- |
| Platform | Linux; Node `24.21.0` and `26.11.1` |
| Tooling | TypeScript `7.0.2`, strict projects, `skipLibCheck:false`, maintained `.ts` sources; pnpm `11.25.0` |
| Durable storage | PostgreSQL `18`, logged correctness tables, `fsync=on`, local `synchronous_commit=on` |
| Private storage query toolkit | Drizzle `1.0.0-rc.5-5935859`; exact [artifact and declaration correction](../qualification/drizzle/artifact.json), with original unpatched npm consumer qualification |
| Provider | Official `@paddle/paddle-node-sdk` `3.10.0`, API version 1 and separately versioned notification destination |
| Background transport | Explicit `PaymentJobTransport`; bundled `pg-boss` `12.38.0` uses one borrowed host pool, explicit bootstrap and a qualified runtime role; a separate durable SQL fixture exercises substitution |
| Get Modular | Core/Assembly `0.6.0`, Resources `0.2.0`, optional Observation `0.1.0`, Conformance `0.4.0` in tests; one coherent physical peer set |
| Engineering Foundation | `1.10.1`, development-only |
| Package consumers | ESM NodeNext and Bundler resolution, packed tarballs, strict declarations |

Manifest engine ranges describe runtime compatibility, and the two exact Node versions above are the functional CI matrix. They do not establish production security admission. Other operating systems, PostgreSQL majors, versions within a manifest range and deployment topologies require their own evidence. The [lockfile](../pnpm-lock.yaml) pins the actual dependency closure. The [current upstream record](upstream-qualification.md) identifies the Foundation patch scope, exact local qualification subject, current Get Modular publication gate and official browser blocker.

## Production runtime security admission: blocked

As of **2026-10-19**, the qualified Node floors and latest published same-major releases retain a built-in `fetch` defect covered by [GHSA-xjj6-f33q-929c](https://github.com/nodejs/undici/security/advisories/GHSA-xjj6-f33q-929c). Independent source comparison and a bounded local malformed-response probe establish that catching the fetch rejection does not prevent the tested Node process from terminating. No malicious Paddle response or live account exploit was demonstrated.

The development-only Undici **7.30.1** correction and clean npm scans do not patch Node's bundled implementation. GitHub prerelease artifacts remain available for integration and fixture evaluation. **Production deployment remains blocked** until an official corrected runtime passes the explicit [runtime security admission requirements](security-qualification.md#node-bundled-transport-scope), together with the deployment gates below. The announced future Node security release is not evidence that a fix is already published or qualified.

## What the automated gates establish

| Gate | Evidence exercised | Material limit |
| --- | --- | --- |
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
| `test:packed:npm` | Fresh production-only npm installation of all six public exports, complete strict compiler flags, original unpatched Drizzle, absent MySQL, and the real PostgreSQL financial oracle | Fixture-only consumer; no npm publication, live credentials or deployment qualification |

The Paddle harness disables unapproved network connections and restores its test dispatcher/globals in cleanup. Production uses the official SDK directly without a global fetch patch, private SDK seam or custom raw API client. Fixture coverage must include successful supported initial/renewal/top-up/API-only recovery, rather than declaring success because everything was conservatively held. Negative cases retain explicit uncertainty/hold and preserve financial facts.

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

The coordinated Core/Assembly `0.6.0`, Resources `0.2.0`, Conformance `0.4.0` and Observation `0.1.0` train is published. The [registry artifact record](../qualification/observation/published-artifacts.json) binds the exact official archives and confirms their byte identity with the retained upstream candidates. The SDK consumes those versions through ordinary registry dependencies and exposes its optional public `/observation` entrypoint. Each release must pass `test:observation` on both Node floors; historical candidate results do not qualify a new SDK archive. The [integration guide](../packages/payments-get-modular/README.md#optional-purchase-observation) owns composition, lifecycle and read-only hook contracts. The [growth assessment](get-modular-growth.md) records the separate unpublished Resources correction, physical-settlement limits and remaining adoption prerequisites.

The [accepted plan's review journal](implementation-plan.md#16-журнал-независимого-ревью) concerns the design snapshot. It does not establish a completed implementation review, a successful current CI run or completion of a new four-wave implementation review.
