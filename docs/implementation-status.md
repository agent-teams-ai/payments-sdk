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

The platform delivery documents and release workflow are in the stacked
documentation/release PR. Four implementation review waves and the final exact
commit's CI are required before merging the integrated candidate. The first
four review waves and their accepted corrections are complete; independent
remediation rechecks and the final integrated CI are in progress. Their dispositions and
regression evidence live in the [review index](reviews/README.md).

## Explicit admission boundaries

The required P6 Get Modular host uses the qualified published static peer set.
The upstream observation implementation has merged, but the coordinated new
registry train was unpublished at the [recorded read-back](upstream-qualification.md).
Hooks remain optional read projections; they cannot replace financial delivery,
consumer transactions or acknowledgements. The future hook consumer admission
contract is retained without inventing an unavailable runtime API.

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
0.1.0 and a successful dry run do not establish npm publication; registry
ownership and trusted publishing remain the separately documented future setup.
