# Engineering Foundation adoption

## Selected consumer profile

Payments uses the published **@agent-teams/engineering-foundation 3.0.0** as
development tooling and **@agent-teams/feature-module-standard 0.3.0** for the
owner-approved [full FMS adoption](feature-module-adoption.md). Every production
package is covered. Foundation, FMS, Stack, TypeScript, Oxlint and node-or-bun remain
absent from the SDK runtime dependency graph.

The [organization quality standard](https://github.com/agent-teams-ai/.github/blob/main/docs/engineering-quality-standard.md),
[AGENTS](../AGENTS.md), [developer stack](developer-stack.md), exact manifests
and frozen lockfile own the current adoption. Historical 1.10.1 review records
qualify their recorded sources; they do not describe the current profile.

| Surface                | Enforced scope                                                                                                                                                        |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript             | Shared strict Node preset; ordinary `.ts`; compiler 7.0.2; explicit projects; `skipLibCheck:false`                                                                    |
| Production lint        | Shared typed and maintainability presets, explicit function-property ports, no `any`; stricter Get Modular budgets                                                    |
| Development lint       | The same typed correctness baseline over tests, tools, examples and qualification; production size budgets do not constrain fixtures                                  |
| Source dependencies    | Schema v3, all four package source/test trees plus tools, root tests, examples and qualification                                                                      |
| Workspace dependencies | Exact catalog and workspace protocols; exact registry-only development pins for Foundation, FMS and Stack                                                             |
| Source coverage        | Repository census, FMS topology, owning compiler projects and actual production linter selection                                                                      |
| Suppression governance | A finite owned inventory of compiler rejection witnesses and bounded SQL generic exceptions; unknown or stale directives fail                                         |
| FMS                    | Exact standard digest, complete package/feature census, inward layers, curated facades, declared exports, mirrored feature tests and deterministic inner capabilities |
| Get Modular CMS        | Real published `checkModuleLayout()` plus authored declarations, inputs, entries, groups, actual export classification and exact artifact pins; no adapter exception  |
| Lifecycle              | Public status, attach, detach, check, assert-dev-only and assert-registry commands                                                                                    |

The current technical compiler/linter/formatter graph is owned by the single exact
root `stack-toolchain` development pin and its public manifest. The
[tooling artifact record](../qualification/tooling/artifacts.json) remains immutable
history for its recorded qualification, rather than a current version table.
[node-or-bun](node-or-bun-adoption.md) owns captured development commands; it
does not change the admitted Node-only SDK runtime profile.

## Source and test ownership

The root solution references four emitting source projects and strict no-emit
projects for ordinary checks and observation qualification. Their explicit
project references establish cold-build order. `pnpm build` first validates all
owned output paths, removes only package `dist` and the declared incremental
state, then invokes public `stack-toolchain compile --build tsconfig.json`. A linked package/output rejects before any
cleanup. Stale outputs cannot silently satisfy a later source deletion.

Package owner tests import declared source facades. Tests of fragile PostgreSQL
internals use a separate finite implementation boundary: only PostgreSQL
composition/testing and its owner tests may reach those files. Other packages
receive no private entrypoint permissions. Production package export maps stay
curated and unchanged by this test policy.

The development-only native source resolver follows relative `.js` spelling
inside owned package `src` directories to an existing regular `.ts` file.
It refuses linked/escaping paths and leaves bare package imports and compiled
`dist` identity untouched. Installed consumers and root E2E/qualification
continue to exercise public compiled artifacts. This resolver is not packaged
or required by applications.

Domain/application code cannot acquire infrastructure packages or ambient
network, environment, clock, randomness, scheduling or console capabilities.
The core's finite pure hashing capability is explicit. Real local domain values
may use familiar names; erased `declare` bindings cannot disguise ambient
access. Public runtime and declaration exports must reach the same declared,
curated module facade. These repository-owned checks complement the shared
FMS kernel; they do not replace semantic review.

## Stack and native tooling scope

`stack-toolchain` initially qualified at `0.1.1` owns technical presets and ordinary
checking/lint/format/compile commands. The current version comes from root
package.json, not a guard constant. The consumer resolves its public package.json,
bin and toolchain-manifest exports locally and rejects duplicate/range/tag/alias,
ancestor/global resolution, escaped files and mismatched metadata. Actual doctor
output binds package version, tool pins, required binaries and native typed-lint
artifact to that installed identity. Optional checker absence stays informational.

The existing core project is the standalone read-only checker scope: 43 production
sources at adoption. All 17 existing reference edges and all six source-owning
projects remain in the official compile/build path. Production quality retains
its supported v1 profile and four real compiler contexts (116 source files at
adoption); v4 would incorrectly use only the selected ordinary project here.
No reference-stripping overlay or whole-repository fallback qualification exists.
Stack also owns development typed lint through its configured roots. Production
lint retains Foundation's independent source census and consumer-owned budgets.

`check:fast` retains the native build/source/CMS/quality chains, then executes the
real Foundation `gate run fast` profile for doctor, core read-only checking and
format. Native CI runs this composed entry before uploading package outputs.
The literal quality routes remain because their static observer does not follow
gate DAGs. Gate removal, recursion/no-op substitution, missing contexts/reference
edges, build-script approval and CI bypass have rejecting fixtures. pnpm strict
build checking stays enabled; only Bun's postinstall is explicitly refused.

The existing direct TypeScript7.0.2 unstable semantic APIs and node-or-bun captured
process adapter are native tooling islands, with independent exact pins and
qualification. Foundation's public import graph cannot replace symbol/shadowing
checks. Ordinary tool upgrades use one Stack pin plus generated lock; this does
not promise that an unstable native API upgrade needs no consumer qualification.
No new shared semantic API, Docs Cohort, product runtime or composition is adopted.

## Commands and evidence

```sh
pnpm foundation:status
pnpm check:fast
pnpm lint
pnpm foundation:assert-dev-only
pnpm foundation:assert-registry
pnpm test:boundaries
DATABASE_URL=postgresql://postgres:test-only@127.0.0.1:5432/payments pnpm check
```

`status` is read-only. `attach`/`detach` expose the producer's development
lifecycle; required registry assertions reject an accidentally source-linked
merge candidate. Fixtures exercise actual rejecting behavior rather than
matching script names. The required CI aggregate depends on the build, quality
job and both supported Node scenario jobs.

The selected profile does not activate unrelated document/schema products or
invent a protected released-API baseline. Any future such adoption needs a real
owner and its own evidence. Full FMS, source coverage, suppression governance
and maintainability are active requirements here. PostgreSQL concurrency,
provider semantics, packed dependency isolation and physical shutdown retain
independent behavioral tests and reviews.

Fresh qualification belongs to the exact source and artifacts in
[qualification](qualification.md). Configuration, successful local execution,
hosted checks and active repository protection are distinct evidence.
