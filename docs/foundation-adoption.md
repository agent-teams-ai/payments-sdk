# Engineering Foundation adoption

## Selected consumer profile

Payments uses the published **@agent-teams/engineering-foundation 1.10.1** as
development tooling. The workspace owns its payment contracts, adapter choices
and qualification. Foundation supplies shared compiler/linter presets and two
explicit architecture checks; it never becomes a payment runtime dependency.

The profile follows the inspected producer
[consumer adoption contract](https://github.com/agent-teams-ai/engineering-foundation/blob/66984d7a71b469acfe557131f9a95295cc6b8553/docs/development/consumer-adoption.md)
and the maintained organization quality route in [AGENTS](../AGENTS.md).
The [initial independent audit](reviews/foundation-profile.md) records the
missing preset and lifecycle commands that prompted this completion.

| Surface | Adoption and actual scope |
| --- | --- |
| TypeScript | Shared Node preset; ordinary `.ts`; compiler 7.0.2; strict owning projects; `skipLibCheck:false` |
| Oxlint | Shared `presets/oxlint/type-aware.json`, including its Node/base presets; Oxlint 1.83.0 and exact compatible `oxlint-tsgolint` 7.0.2001 |
| Source dependencies | Schema v2, four runtime packages and their tests, eight explicit boundaries under `packages`; inward dependency rules and declared public entrypoints |
| Workspace declarations | Schema v1; central exact catalog, workspace protocol, development-only tooling and exact published Foundation pin |
| Lifecycle | Direct public `foundation:status`, `foundation:attach`, `foundation:detach`, `foundation:check`, `foundation:assert-dev-only` and `foundation:assert-registry` commands |
| Merge enforcement | Hosted `Required checks` aggregate requires build, quality and both scenario jobs to succeed; main protection requires that status with strict freshness and administrator enforcement |

The typed backend pairing matches the inspected Foundation/Oxlint profile.
Its exact archive and integrity are retained in
[the tooling qualification record](../qualification/tooling/artifacts.json).
The registry's newer backend dist tag alone does not establish compatibility
with this admitted Oxlint version. Node-or-bun has a separate
[tooling-only adoption](node-or-bun-adoption.md).

## Compiler ownership and lint discovery

The root solution references the four package source projects,
`tsconfig.checks.json`, and `qualification/observation/tsconfig.json`.
The checks project owns tools, root tests, examples and package tests; the
observation project owns its packed consumer sources. Source projects retain
their own declaration emission. TypeScript build mode accepts the two no-emit
projects, and the ordinary typecheck remains an independent required gate.
Both no-emit projects explicitly reference the four runtime projects they
consume, so build mode produces package declarations before checking their
consumers on a cold install. Listing the projects together in the root solution
does not establish those dependency edges.

This reference graph is also available to the typed linter's project discovery.
The lint command covers `packages tests tools examples qualification`; it does
not use an import-resolution flag as a substitute for strict project ownership.
Generated output and installed dependencies are excluded. The toolchain gate
independently rejects maintained JavaScript/alternate TypeScript extensions,
missing ownership, overlapping ownership, non-strict projects and disabled
declaration checking.

The root's Observation and Conformance dependencies are development inputs for
the actual qualification sources. The static packed consumer still proves that
the optional Observation package is absent, and the plain-core consumer proves
that the outer adapters and their infrastructure are absent. Root development
resolution does not widen an SDK package's runtime dependency contract.

## Source corrections required by the inherited preset

The shared rules apply without a findings baseline or blanket suppressions.
Control-flow braces are explicit. Test registrations use `void test(...)` to
retain Node's ownership and scheduling; operational promises remain awaited,
tracked or explicitly contained by their lifecycle owner.

At runtime boundaries, unknown input is validated before typed use. In
particular, identifiers/scopes, successful checkout proofs, provider options
and consumer envelopes retain their rejection or held-evidence behavior.
Compiler certainty is not a reason to delete a runtime guard. Database record
decoding remains private to the infrastructure owner. Promise-returning
diagnostic callbacks cannot change the settled payment/job outcome.

Copied/snapshot arrays use `toSorted` with the same ordering; intentional
in-place ordering retains its observers. The existing financial expectations,
scope fences, immutable evidence identities, read sets, transaction ordering,
reconciliation cursor atomicity and deadlines remain qualification obligations.
The expanded malformed-outcome table belongs to the existing fragile settlement
boundary; this change does not introduce a broad collection of shallow tests.

## Applicable commands and release state

```sh
pnpm foundation:status
pnpm check:fast
pnpm foundation:assert-dev-only
pnpm foundation:assert-registry
pnpm test:boundaries
pnpm check
```

`status` is read-only. `attach`/`detach` expose the producer's optional local
development lifecycle; adding the commands does not attach this repository to
source. Required registry assertions reject a source-linked merge state. The
frozen registry lock remains the installed/released dependency authority.

The full local command and hosted matrix must qualify the final source. A
previous successful run does not certify a later lint, source or dependency
change. Source-bound results belong to the review and qualification records;
configured gates, live protection and successful executions are distinct facts.

## Explicitly deferred capabilities

Full execution of the selected Foundation profile means its declared applicable
checks run. It does not mean every producer capability is activated.

| Capability family | Reason and adoption trigger |
| --- | --- |
| FMS and its source-coverage topology | This SDK has no adopted FMS model; strict source ownership already has a concrete compiler gate. A topology migration needs its own owner decision. |
| Source-dependency schema v3 | The selected v2 package universe covers the four published packages. A demonstrated need for a different graph scope requires a reviewed profile change. |
| Released public API compatibility and SDK growth | No protected release-owned API baseline process is adopted. Activate only with a real baseline, protected mutation workflow and explicit compatibility policy; do not invent historical evidence. |
| Gate runner and executable specifications | Existing scripts and CI already own concrete gates and independent fixtures. A second scheduler/catalog requires a real integration need. |
| Suppression governance and maintainability budgets | No lint-waiver baseline or numerical file/function budget is needed to complete this profile. These are optional owner policies, not substitutes for semantic review. |
| Agent workflow, document governance, scaffolding and tooling security profiles | Separate producer capabilities with their own adoption contracts; no implicit migration from installing Foundation. |
| Protobuf/JSON Schema release families | The SDK does not advertise such a released contract. |

The source graph check deliberately selects package runtime/test code. Root
tools, examples and qualification have strict compiler/linter ownership; this
document does not claim Foundation v2 proves their entire dependency graph.
SOLID, DRY, provider substitution and transaction semantics still require
independent review and real boundary scenarios.
