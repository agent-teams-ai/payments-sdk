# Accepted plan implementation and review status

The [accepted plan](implementation-plan.md) is a frozen research/design record.
Its statements that checks were planned refer to that design snapshot. This page
maps its P0–P7 stages to maintained implementation and verification. The exact
commit's successful [Checks workflow](../.github/workflows/checks.yaml), logs and
artifacts remain authoritative qualification evidence.

## Plan traceability

| Stage | Delivered implementation | Maintained evidence |
| --- | --- | --- |
| P0 — sources, profile and hooks admission | Frozen reviewed plan, contributor boundaries, explicit unsupported commercial profiles and exact upstream qualification | [Design review reports](reviews/README.md#design-review), [upstream record](upstream-qualification.md), [Get Modular admission contract](../packages/payments-get-modular/README.md) |
| P1 — packages, ports and toolchain | Four independently consumable ESM/declaration packages; core-owned semantic contracts and factories; strict TypeScript and development-only Foundation | [Core exports](../packages/payments-core/src/index.ts), [boundary scenarios](../tools/test/boundaries.test.ts), [packed consumers](../tools/packed-consumers.ts) |
| P2 — local rules and exact evidence | Intent/request identity, mutation uncertainty and authority, immutable facts, source-aware identity/version conflicts, exact monetary/time values and bounded delivery | [Core scenarios](../packages/payments-core/test/core.test.ts), [reconciliation state scenarios](../packages/payments-core/test/reconciliation.test.ts) |
| P3 — durable storage, work and recovery | Explicit PostgreSQL migrations and owner-local T1/T2 commits; durable inbox, revisions, consumer targets and repair obligations; pg-boss wakeups; bounded SQL waits; explicit independent-owner restore protocol | [Durability/fault scenarios](../packages/payments-postgres/test/durability.test.ts), [worker lifecycle/repair](../packages/payments-postgres/test/jobs.test.ts), [bounded reclassification](../packages/payments-postgres/test/reclassification.test.ts), [owner restore](../tests/integration/recovery.test.ts) |
| P4 — official provider adapter | Public Paddle SDK 3.10.0, API1 requests, exact-byte official signature verification, retained raw versus mapped custody, supported commands/observations and bounded reconciliation | [Actual SDK contracts](../packages/payments-paddle/test/sdk-contract.test.ts), [SDK plus database reconciliation](../tests/integration/reconciliation.test.ts), [provider guide](../packages/payments-paddle/README.md) |
| P5 — complete public delivery path | Checkout → authenticated custody → fact/revision → per-consumer delivery → independent owner receipt/decision/effect → producer ACK; separate nonproduction access and credit policies | [Full-system scenarios](../tests/e2e/full-system.test.ts), [consumer protocol](../tests/e2e/consumer-protocol.test.ts), [separate fixture owners](../tests/fixtures/consumers) |
| P6 — two host compositions | Node HTTP with explicit factory, and Fetch with actual published static Get Modular Assembly/Resources; common public protocol and shared fixture owners | [Node host](../examples/node-http.ts), [Fetch/Get Modular host](../examples/fetch-modular.ts), [real modular runtime scenarios](../packages/payments-get-modular/test/modular.test.ts), both hosts in the full-system suite |
| P7 — reusable delivery and operations | Strict installed NodeNext/Bundler consumers, package archive audit, compiled durable-host example, integration/operations/qualification guides, optimized required CI and an exact-commit GitHub release candidate workflow | [Getting started](getting-started.md), [operations](operations.md), [qualification](qualification.md), [release process](releasing.md), [independent implementation reviews](reviews/README.md#implementation-review-status) |

The implementation is delivered through [PR #1](https://github.com/agent-teams-ai/payments-sdk/pull/1)
and the integration/release documentation through [PR #2](https://github.com/agent-teams-ai/payments-sdk/pull/2).
All four implementation review waves, their accepted corrections and four
independent remediation rechecks are complete. Their exact subjects, dispositions
and regression evidence live in the [review index](reviews/README.md).
The protected main branch requires successful up-to-date aggregate CI. Release
admission additionally requires a successful exact-commit main-push run; a green
feature-branch check cannot authorize the release.

## Explicit admission boundaries

The SDK 0.3 delivery is tracked in
[PR #6](https://github.com/agent-teams-ai/payments-sdk/pull/6). The
[current qualification and review record](reviews/sdk-0.3-portability/README.md)
binds driver and queue dependency isolation, the separate optional adapters,
connected subscription/credit scenarios, both complete local runtime-floor runs,
four additional critics and the resolved recovery-guide migration finding. This
extends the previously completed four implementation review waves; it does not
relabel those historical reviews as examinations of a newer snapshot.

The SDK 0.2 integration is delivered for review through
[PR #5](https://github.com/agent-teams-ai/payments-sdk/pull/5). Its
[final qualification record](reviews/sdk-0.2-completion/README.md) binds complete
local checks on both supported Node floors and successful exact-source hosted
CI to private Drizzle, published observation, provider vocabulary, worker
diagnostics, maximum-page IO corrections, direct node-or-bun tooling and the
complete selected Foundation profile. The earlier
[integration qualification](reviews/sdk-0.2/qualification.md) retains its own
historical subject. PR state and the exact main-push release manifest establish
subsequent merge and release delivery; a local result does not imply either.

The post-integration [dependency correction and Node runtime investigation](security-qualification.md) are separate from the completed four implementation review waves. The development HTTP harness is qualified on Undici **7.30.1**. Production runtime admission remains blocked by an independently reproduced built-in `fetch` defect in the current Node floors and latest same-major official releases. Functional GitHub prerelease delivery is available; a corrected official runtime and its consumer qualification are required before production deployment.

The P6 Get Modular host uses the coherent published Core/Assembly `0.6.0` and Resources `0.2.0` peer set. The optional public `payments-get-modular/observation` subpath now consumes Observation `0.1.0`; Conformance `0.4.0` remains development-only. The [registry record](../qualification/observation/published-artifacts.json) proves all five official artifacts match their original retained candidate bytes. Earlier candidate reports remain historical.

The [public purchase read projection](../qualification/observation/README.md) supplies real Assembly inputs/slots, readonly store facets, scoped display watches and latest-only loads. Its required isolated consumer imports the packed package export, checks strict NodeNext/Bundler declarations and one physical peer graph, and runs real PostgreSQL scenarios on both Node floors. The separate static consumer omits Observation. Hooks remain optional read projections and cannot replace financial delivery, consumer transactions or acknowledgements.

The official Paddle.js 1.6.5 browser example is blocked by its published
declarations under the required strict compiler profile, reproduced in both
resolver modes and recorded against official issue #127. The backend checkout
URL flow is available. No declaration suppression or unofficial wrapper is used
to present that browser gate as passed.

Real Paddle account/sandbox behavior, host authorization and product accounting
policy, physical backup/PITR and HA promotion require the selected deployment.
Automated tests use the actual SDK with network-disabled synthetic HTTP responses
and real PostgreSQL; logical independent-owner restore tests do not prove a
physical restore. See [deployment gates](qualification.md#deployment-and-credential-gates).

GitHub prerelease archives are the configured delivery channel. Manifest version
0.3.0 and a successful dry run do not establish npm publication; registry
ownership and trusted publishing remain the separately documented future setup.
