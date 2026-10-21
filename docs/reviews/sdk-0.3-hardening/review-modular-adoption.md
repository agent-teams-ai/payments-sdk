# Independent review 03: Get Modular consumer adoption

## Reviewed source and scope

Reviewed 2026-10-21, read only, against payments-sdk HEAD
`28ab08829d3c90094a2b2a846da05daa09c108c2`, base
`58441742d2f3743e4681f4bb02b2ff013023d652`. The worktree was clean during
inspection. The review focused on the new consumer profile and gate, lifecycle
proof and startup diagnostics, and the source-backed integration/growth claims.

Read `AGENTS.md`, `docs/developer-stack.md`, the applicable accepted plan and
architecture, the retained maintained organization quality source, the changed
GM documentation/tests, package ownership/dependency profiles, runtime adapter
and projection implementation, and relevant pinned upstream source. The
organization source SHA-256 was
`a65fb5150837b010a71abe36cefd26c32709eb9b9e89f3938498a647e72f5587`.

Pinned upstream checkout:
`/workspace/scratch/9e36ca3bbd13/research/get-modular-current`, HEAD
`ddf1e0b0053f546f12ca70190b237b4f7e78d09d`, clean. Verified the CMS and
module-authoring guide SHA-256 values against the profile:
`c2fe582a14ff6e79620b232ca7ffc914afb0474ec21fd43f208251dd7252f4a3` and
`8d9e6ced096c3259ec8d7a35a1ee3c2f15e5832ba23c95da57f8cfc4c8622cfd`.

No installation, build, test process, database operation, upstream edit or
remote action was performed. Findings below distinguish source-established
logic from executed reproduction. The coordinating agent owns actual focused
and final command execution on both admitted Node floors with PostgreSQL 18.4.

## Finding

### P2 — Required runtime/packed scripts can become no-ops without the adoption gate rejecting them

**Location:** `tools/test/get-modular-adoption.test.ts:113-119`, especially
lines 115-119; `docs/get-modular-adoption.md:154-158`.

The gate asserts exact executable script bodies for `test:modular:adoption`,
`test:boundaries` and `foundation:check`. It verifies `test:modular` and
`test:observation` only by finding their invocation names in the `check` string.
It never reads the bodies of either script. Consequently, replacing either
body with a successful no-op preserves every adoption-gate assertion while
removing the actual runtime or packed qualification from the full and hosted
scenario chains.

This matters to this delivery because physical-drain behavior and the exact
published optional peer/packed contract are the behavioral qualifications that
the profile advertises alongside its source inventory. The pinned CMS's
`Scoped acceptance and evidence` explicitly requires rejecting removed/no-op
command chains, and local documentation claims that guard. Guarding only the
script names is weaker than that advertised requirement.

**Reproduction from source, not executed by this reviewer:** Start with the
gate's disposable `fixture()`. Set
`manifest.scripts['test:modular'] = 'node -e "process.exit(0)"'` and write the
manifest back, leaving `scripts.check` unchanged. `check(root)` encounters no
assertion that rejects this change. Repeat independently for `test:observation`.
The actual archived identities, AST inventory and command membership remain
unchanged. A valid rejecting regression must assert the specific command-body
failure instead of treating an unrelated fixture error as evidence.

**Minimum useful fix:** Pin the admitted runtime and packed script bodies in
the existing gate and add one disposable rejecting mutation per script. The
current admitted bodies are `node tools/run-tests.ts modular` and
`node tools/qualify-observation.ts`. Reuse the current gate, owner and command
structure. No second scheduler or generalized command interpreter is needed.

**Disposition: closed after independent source reread.** Sent promptly to the
coordinating agent, who accepted the finding and implemented commit
`e2226890d269ec4e783657583206a95cddc09a40` in
`/workspace/scratch/9e36ca3bbd13/implementation/payments-modular-adoption`.
I independently read its exact six-line diff and the resulting clean HEAD. It
pins both admitted bodies and adds separate successful-no-op mutations with
specific rejection-message oracles. Updated gate SHA-256:
`d49772201c7ae681eb5ac28b6bac56773e90796b08f1f77e93fe65af78e7668f`.
This is the minimum useful fix and addresses the identified loophole. The
coordinator reports the real Node 24 focused gate passed 11/11; I did not execute
that command and do not independently certify the reported run.

## Counterevidence and accepted limits

### Source enforcement is narrow and accurately described

The gate discovers direct authored calls to `declareModule`, `defineContract`,
`implement`, `input` and `group` through Foundation's inventory and the pinned
compiler AST; it handles named-import aliases and namespace imports. It compares
the actual names and paths against a closed authored inventory, requires owned
paths, and rejects unknown exception IDs and changed exception paths. Existing
Foundation gates retain package ownership, source entrypoints, inward imports,
forbidden dependencies and dependency declarations. Boundary fixtures exercise
unowned source/packages and cross-package bypasses.

This is not whole-program ownership inference or automatic discovery of a
capability hidden behind another function or indirect import. The record
explicitly says that direct-call scope and retains semantic review
(`docs/get-modular-adoption.md:92-100`). The technical-layout exception names
four exact files with owner/rationale/review trigger. Ordinary helpers remain
permitted; the policy does not turn every function into a graph node. The four
SDK packages are not falsely presented as an application FMS topology. I found
no material current ownership violation that would justify a new generic
framework or a product architecture migration.

### Current payment draining has substantial concrete protection

`packages/payments-get-modular/src/module.ts:25-56` exposes explicit frozen
role facets, refuses calls after the resource signal closes, tracks every
admitted promise, stops core admission, awaits admitted work and drains actual
core/provider settlement. It borrows the provider/store and never disposes their
resources. Tests separately cover admitted reads, deadline-expired external
work, separate runs/sibling scopes, failed downstream startup, late cancelled
acquisition, immutable financial delivery and closure of each attempt.

The added staged-shutdown test uses the actual SDK projection and payment
runtime over a deliberately held store read. The assertion distinguishes
`complete:false, settled:true` failed Observation debt from physical read
settlement, retains the runtime and pool, releases the read, retries the
dependent close and then closes the runtime and infrastructure. The second
test observes actual `liveSubscriptions()` and defers an ancestor-close request
through a microtask before borrowed renderer disposal. Public Observation
waits and explicit barriers are meaningful oracles, not fixed sleeps.

Resources deliberately continues earlier cleanup after failed child debt.
Staged close is an operational requirement when protecting borrowed work; the
documentation now states it. The static source does not establish a broken
normal payment path. In particular, a read through the tracked payment facet
also benefits from the runtime's own drain ownership. I did not recast a generic
Resources counterexample as a demonstrated payment data-loss incident.

### Published/source limitation is kept honest

The pinned source includes the abort-reentry ordering repair, but the installed
published Resources 0.2.0 bytes do not. The adoption and growth records state
that distinction and keep a release identity/read-back/consumer-regression gate
for eventual adoption. They do not claim the installed release is fixed, and
they distinguish the focused synchronous-reentry counterexample from the
exercised normal projection/watch ordering. Avoiding synchronous self/ancestor
close from an abort listener is a concrete Host constraint. This review did not
run a new reentry probe and makes no new claim about its measured behavior.

### Startup diagnostics retain useful causes

`examples/fetch-modular.ts:11-25` retains the structured preparation error and
Core diagnostics as the Error cause, then retains run outcome and cleanup report
on failed/cancelled construction. The package guide follows that pattern and
warns against serializing opaque factory/configuration data. The added missing
input oracle names the exact consumer, slot, capability, cardinality, group path
and empty candidates while preserving separate Core diagnostics. These are
useful diagnostics for a larger graph without making the root own payment
policy or adding a logging framework.

### Growth assessment is source-grounded and proportionate

The 7/10 integration and 8/10 architectural-direction scores are declared
engineering judgments, not benchmark results. Their stated costs match the
inspected architecture: 4,096 total module occurrences plus group nodes per
preparation, group depth 16, at most 1,024 roots, other slot/binding ceilings;
sequential factory construction; exact capability revision matching and
coordinated contract upgrades; package-local identity/one physical peer set;
and Host-owned admission, pooling and shutdown. Upstream `group.ts` counts
entries and group nodes together, and `run.ts` awaits each dependency-ordered
factory. The type budget gates 500 modules and is not proof of editor behavior
at several thousand modules. The document makes that limit explicit.

Narrow core-owned ports and separately exposed GM facets keep provider/store
and read-only observation changes local. No current evidence calls for a
service locator, universal event bus, concurrent factory scheduler, remote
broker abstraction or parallel contract revision framework. Real multi-package
growth needs measurement and an owning contract decision when a concrete limit
is approached.

## Exact reviewed file identities

| File in payments-sdk | SHA-256 at reviewed HEAD |
| --- | --- |
| `architecture/get-modular-consumer-profile.json` | `0d3b6b6f1d11333e6346c3156e48c0ff422b2137f609f29d8f2dc79f40e87bee` |
| `tools/test/get-modular-adoption.test.ts` | `6cad70381a61cf908814c345143aa3b0b0875ac1c9dbded210b834577541d1dd` |
| `docs/get-modular-adoption.md` | `1f87361035a0549c18782511420da07ee55430e2d83293d58beb146db2975ad6` |
| `docs/get-modular-growth.md` | `55d316e4317b63018a0ff004b9a9d636d053c623b6421e5215f6d7a9786bfc4f` |
| `packages/payments-get-modular/test/lifecycle.test.ts` | `6e752f8676eb146b8b2a41d772216b69bf4ac90c55fc43b4c1d0ee0ef153778b` |
| `packages/payments-get-modular/src/module.ts` | `62b6240f8d17c1e3b285c076c48d347b013ccad82605d755eafb3bb6f4160410` |
| `packages/payments-get-modular/src/observation/projection.ts` | `1ff860fb6309cab483ee3fdf3778f2f004d5cc974969cc67dc8718763bb49dbd` |
| `packages/payments-get-modular/README.md` | `c06906208aea3d4880aa5053c9bcae57668690f6b43911b00aee421c62fec52f` |
| `examples/fetch-modular.ts` | `d592aa6dabc46eafbd9fbd35a63decf0058e786123515a6063c8f0e68fb5e1fe` |
| `package.json` | `e243841e714fba89025907fe4191d5193946df93f9d6a5877d5ea381937cc391` |
| `qualification/observation/published-artifacts.json` | `d7f7335f50a40a2e1afb47f5cc5d851ce7347ebb6875851f162b18b4fef88559` |

## Review conclusion

One concrete P2 enforcement gap was identified and is closed by independently
reviewed fix `e2226890d269ec4e783657583206a95cddc09a40`. No remaining material
findings, demonstrated P0/P1 or new normal-path payment/lifecycle defect in this
scope. Final source-bound full checks remain with the coordinating agent; this
report does not substitute for them. The coordinator reported that the earlier
28ab088 full run reached E2E 66 before an environment DNS failure at the public
artifact download, so that interrupted run must not be represented as a complete
qualification of either source revision.
