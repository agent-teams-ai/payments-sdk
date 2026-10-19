# Qualification and deployment gates

This page describes reproducible evidence and its limits. A test file is not a recorded passing run. Use the exact commit's successful **Checks → Required checks** run and its logs/artifacts as the release evidence. Counts and dates are intentionally not copied here: the workflow result is authoritative, and a later commit needs its own qualification.

## Supported qualification profile

| Component | Exact qualification inputs |
| --- | --- |
| Platform | Linux; Node `24.21.0` and `26.11.1` |
| Tooling | TypeScript `7.0.2`, strict projects, `skipLibCheck:false`, maintained `.ts` sources; pnpm `11.25.0` |
| Durable storage | PostgreSQL `18`, logged correctness tables, `fsync=on`, local `synchronous_commit=on` |
| Provider | Official `@paddle/paddle-node-sdk` `3.10.0`, API version 1 and separately versioned notification destination |
| Background transport | `pg-boss` `12.38.0`; one borrowed host pool, explicit bootstrap, qualified runtime role |
| Get Modular | Core/Assembly `0.5.0`, Resources `0.1.0`, Conformance `0.3.0` in tests; one coherent physical peer set |
| Engineering Foundation | `1.10.0`, development-only |
| Package consumers | ESM NodeNext and Bundler resolution, packed tarballs, strict declarations |

Manifest ranges describe admitted runtimes; the two exact Node versions above are the CI matrix. Other operating systems, PostgreSQL majors, versions within a manifest range and deployment topologies require their own evidence. The [lockfile](../pnpm-lock.yaml) pins the actual dependency closure.

## What the automated gates establish

| Gate | Evidence exercised | Material limit |
| --- | --- | --- |
| `toolchain:check`, `typecheck`, `lint` | Runtime/compiler policy; strict ownership for every maintained source; actual compiled examples and declarations | Compilation cannot prove provider settlement or production authorization |
| Foundation checks and `test:boundaries` | Inward package dependencies, source ownership/exports, forbidden runtime imports and development-only tooling closure | Boundary checks complement behavioral tests |
| `test:core` | Request idempotency, exact values, evidence ordering/conflicts, commercial classification, immutable delivery, duplicate initial streams and unknown mutation handling | Memory store is a test fixture, not production durability |
| `test:paddle` | Actual SDK serializer/resources/entity mapping, error translation, exact-byte official signature verification, source-aware normalization and mapped pagination | Network-disabled synthetic API schema fixtures; no Paddle account behavior or charges |
| `test:modular` | Actual published Assembly/Resources/Conformance, static wiring, isolated runs, lifecycle/partial-startup cleanup, late provider settlement and hook-free delivery | No published Observation runtime is qualified |
| `test:postgres` | Real PostgreSQL migrations/concurrency, durable WAL settings, read-set conflicts, SQL fault/deadline cleanup, lost COMMIT replies, actual pg-boss work/repair and runtime grants | Logical recovery and transport fault probes do not establish physical PITR or HA RPO0 |
| `test:e2e` | Node HTTP plain factory and Fetch static Get Modular hosts; actual Paddle SDK synthetic transport; durable payment owner plus independent credit/access fixture owners | Test entitlement/credit policies are intentionally nonproduction, with no AI consumption model |
| Reconciliation scenarios within `test:e2e` | Fixed durable queries/cursors, positive missed-payment recovery, adjustment pages, API nullable trust and explicit gaps | SDK mapping/retention/visibility limits remain explicit |
| `test:packed`, `release:dry-run` | Real packed NodeNext/Bundler consumers; exports/declarations; no unresolved workspace/catalog dependency protocol; license/runtime-closure/archive checks | Does not publish to npm or perform an installed production deployment |

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

The accepted plan selected official `@paddle/paddle-js` `1.6.5` for a future browser example. Importing its exact published artifact under TypeScript `7.0.2` and required `skipLibCheck:false` currently raises `TS2430` in `types/checkout/checkout.d.ts`: `PaddleEventData` extends `Partial<CheckoutEventError>`, but its broad event-name union is incompatible with that error type's two-name union. This is a declaration compatibility blocker. The SDK does not weaken declaration checking, import private wrapper files or ship an unchecked substitute to claim qualification.

The core/Paddle server adapter remain independent of Paddle.js. Hosts can navigate to the saved provider checkout URL. A browser overlay example can be admitted after an official compatible artifact or an explicitly reviewed, identified declaration correction passes strict consumers. Then verify public client-token/environment handling, `Initialized` state, visible CDN/loader failures, server-created `transactionId` checkout, and UI-only browser event handling in a real sandbox/browser. The wrapper pins loader/types; provider-hosted Paddle.js CDN code is not pinned by the npm version.

## Future Observation admission

The pending source-pinned upstream PR #195 proposes Core/Assembly `0.6.0`, Resources `0.2.0`, Conformance `0.4.0` and Observation `0.1.0`. Those candidate versions are not this package's published static support profile. Publication, peer compatibility and hook behavior require a separate coherent-train qualification. The [integration guide](../packages/payments-get-modular/README.md#observation-hooks-explicit-release-gate) records the exact pending source and hook tests; no speculative local replacement is admitted.

The [accepted plan's review journal](implementation-plan.md#16-журнал-независимого-ревью) concerns the design snapshot. It does not establish a completed implementation review, a successful current CI run or completion of a new four-wave implementation review.
