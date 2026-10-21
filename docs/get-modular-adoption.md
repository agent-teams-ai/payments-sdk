# Scoped Get Modular adoption

## Decision

Payments adopts the Get Modular Consumer Module Standard for the explicit
construction and resource ownership of its optional technical integration
package. The owner is `payments-sdk/composition`. The machine-readable
[profile](../architecture/get-modular-consumer-profile.json) and its
[blocking regression gate](../tools/test/get-modular-adoption.test.ts) define
the precise admitted slice. This decision accepts the exact layout mapping
below; it does not adopt an application Feature Module Standard topology for
the four SDK packages.

The payment domain and application runtime stay in `payments-core`, without
Get Modular, provider SDK, PostgreSQL or ORM dependencies. `payments-paddle`
and `payments-postgres` remain separately owned adapters to core's public
contracts. Installing Get Modular does not turn their private helpers into
composition graph nodes. Their existing source-dependency profile and
rejecting [boundary fixtures](../tools/test/boundaries.test.ts) remain in force.

The package publishes inert `paymentsModule`, `purchaseProjectionModule` and
`purchaseProjectionDisplayModule` entries, groups and declared inputs. A
product Host owns the actual production root, authorized configuration and
resource controls. [fetch-modular.ts](../examples/fetch-modular.ts) is the
materialized reference Host, rather than an SDK-owned application service.
Runtime and optional observation roots have independent wiring/type/lifecycle
tests; the main entry still imports without Observation installed.

## Reviewed authorities and actual artifacts

The CMS and module-authoring guide were reviewed together at Get Modular
[`ddf1e0b0053f546f12ca70190b237b4f7e78d09d`](https://github.com/agent-teams-ai/get-modular/commit/ddf1e0b0053f546f12ca70190b237b4f7e78d09d).
The profile pins the complete CMS document SHA-256
`c2fe582a14ff6e79620b232ca7ffc914afb0474ec21fd43f208251dd7252f4a3`
and guide SHA-256
`8d9e6ced096c3259ec8d7a35a1ee3c2f15e5832ba23c95da57f8cfc4c8622cfd`.
The organization quality source is retained at
[`a34ecc6bc9bb165771f3962dccd25970dd5c0d98`](https://github.com/agent-teams-ai/.github/blob/a34ecc6bc9bb165771f3962dccd25970dd5c0d98/docs/engineering-quality-standard.md),
SHA-256 `a65fb5150837b010a71abe36cefd26c32709eb9b9e89f3938498a647e72f5587`.
These are reviewed source identities, not moving branch aliases. The retained
organization source does not silently replace accepted product decisions.

The current qualified **published** artifacts are Core/Assembly `0.6.0`,
Resources `0.2.0`, Conformance `0.4.0` and Observation `0.1.0`. Their exact
publication, dependency, archive SHA-256 and SHA-512 identities remain in the
[published artifact record](../qualification/observation/published-artifacts.json).
Its own SHA-256 is pinned by the profile; the gate compares each archive's
version/integrity with the workspace catalog and frozen lockfile. Registry
read-back on 2026-10-21 found those versions still latest. A source commit,
candidate archive or open upstream pull request is not an installed release.

Engineering Foundation `1.10.1` remains the independently qualified development
dependency described in [its existing adoption profile](foundation-adoption.md).
The newer producer `2.1.0` release and current capability catalog were checked
for a CMS adoption checker. They add other concerns, not such a checker; an
unrelated major upgrade is unnecessary here. The gate reuses Foundation's
public `observeSourceGraph()` inventory/resolver, followed by a small TypeScript
AST inventory of authored GM declarations, descriptors, entries, inputs and
groups. Foundation remains the authority for package ownership, public import
edges and forbidden dependencies. No second source graph, CLI, generator or
quality scheduler is introduced.

The AST uses the published `typescript/unstable/sync` and
`typescript/unstable/ast` exports of the existing exact compiler `7.0.2`, not a
deep import or an extra parser. Because these public exports are unstable,
upgrading that compiler requires requalifying this small adapter; the gate
rejects an unreviewed compiler change. Native API snapshots and their compiler
process are disposed after every inventory.

## Exact technical adapter mapping

The package is an outer technical adapter with two public entrypoints. Its
current small layout differs from the default application feature layout:

| Exact path under `packages/payments-get-modular/src/` | Role and accepted mapping |
| --- | --- |
| `contracts.ts` | Explicit payment role facets, descriptors and capability map; no provider/store implementation |
| `module.ts` | Inert configuration/runtime declarations, declared input, inline scoped runtime entry and static group |
| `observation/composition.ts` | Inert observation descriptors/declarations, declared inputs, inline projection/display entries and static group |
| `observation/projection.ts` | Public resource-aware read projection; finite copied display data and explicit refresh/selection commands |

These four paths are the exact `technical-adapter-layout` exception. They may
combine declarations and entries, keep descriptors outside a `composition/`
directory, and implement the optional technical projection through public
Resources/Observation APIs. The adapter holds no financial authority of its own;
payment policy remains in core. This exception is not a directory exemption.
A new authored module or descriptor triggers review of the mapping and the
profile inventory. New helpers inside an existing owner need no inventory row.
A future product application feature or changed CMS layout contract also
triggers review. No accepted upstream ADR is edited by this mapping.

The gate does not interpret every function as a module, infer business contexts,
or prove that a capability hidden inside a closure has the right owner. It
observes direct authored API calls, including aliased and namespace imports,
and compares their names/paths with the profile. Semantic ownership and intent
remain review obligations. Full application FMS adoption, application layout
enforcement and independently deployed plugin lifecycle are outside this
scope; they require an explicit owner decision and qualification. The profile's
`scoped-active` status describes this adapter record and its executed guards.
It is not a claim of complete application CMS/FMS conformance.

## Startup and shutdown guarantees

Preparation remains inert. Failed binding selection reports the exact consumer,
slot, capability, group path and candidate providers; Core diagnostics remain
separate. Host examples retain these details as an error cause instead of
throwing the code alone. Factory failures and created capabilities are private
Host data; do not serialize their opaque contents into logs or HTTP responses.
Every failed/cancelled run still closes its reserved attempt and retains its
cleanup report.

The Host owns provider connections, storage, ingress, workers and pools. The
payment module stops command admission, waits every admitted facet call and
drains actual core/provider work. An SDK deadline does not terminate a physical
promise. The optional projection borrows only a read port and cannot deliver
financial evidence, grant benefits or acknowledge durable delivery.

Resources reverse ordering does **not** mean stop-on-debt. It intentionally
continues earlier cleanup after a child reports failed debt. Observation may
report `observation.load.still-running` on escalation while a borrowed read
still runs. Therefore the Host first closes dependent views/attempts and
examines their complete reports, retaining the runtime/pool while debt remains.
After actual read settlement it retries/joins the dependent close, then closes
the runtime and finally the shared pool. A single parent close with escalation
must not be the only guard protecting borrowed infrastructure. This is accepted
upstream cleanup behavior, not a reason to change Resources semantics locally.

### Published Resources limitation

Published Resources `0.2.0` has an upstream synchronous abort-reentry ordering
defect. A focused public API counterexample on Linux Node `24.21.0` creates a
scope with registered cleanup, adds an abort listener that calls that scope's
`close()` synchronously, then closes with an already aborted escalation signal.
The two callers join the same flight, but cleanup observes
`escalate.aborted === false`; close still reports complete. Upstream main
`ddf1e0b` repairs this ordering and contains public regressions. Its
[pending patch changeset](https://github.com/agent-teams-ai/get-modular/blob/ddf1e0b0053f546f12ca70190b237b4f7e78d09d/.changeset/fix-resource-close-reentry.md)
does not make the repaired implementation part of the published `0.2.0` bytes.

Normal payment module construction/drain installs no reentrant close listener
and does not shorten physical drain because escalation occurred. An actual
public projection/watch probe with borrowed dependencies registered before
the subscriber child observed zero subscriptions at dependency release for
both ordinary and reentrant close; no failure of that normal ordering is
claimed. The delivered Host rule avoids synchronous ancestor/self-close inside
abort listeners: request shutdown after the current notification, for example
with `queueMicrotask`. Staged close also protects the separate failed-debt case.
No private runtime patch, vendored Resources implementation or unpublished
dependency is used. Adopting the repaired release remains pending its actual
publication, identity read-back and consumer regression.

## Verification and remaining obligations

`pnpm test:modular:adoption` blocks pin/artifact drift, missing owned paths,
unknown authored GM boundaries, changed exceptions and removed/no-op command
chains. Its disposable mutations prove rejection while an owner-local helper
remains permitted. It runs in `check:fast`; the existing `test:boundaries` glob
also includes it in full checks and the quality CI lane. Existing source graph
rejection fixtures retain authority for unknown packages/files, forbidden
imports and public boundary bypasses.

`pnpm test:modular` exercises the real published Assembly/Resources/Conformance
packages, independent wiring/namespaces, inert preparation, facet isolation,
two runs, failed startup, cancellation and physical settlement. The new
non-database lifecycle cases use the actual SDK projection and runtime: an
escalated view retains failed debt while a storage read is held; staged Host
shutdown retains its runtime and pool until the read settles and the dependent
close succeeds. The deferred shutdown case detaches its real subscriber before
dependency disposal. Barriers and public Observation waits replace sleep-based
oracles.

The packed [Observation consumer](../qualification/observation/README.md)
retains its separate NodeNext/Bundler, one-physical-peer, real PostgreSQL,
T1/T2/T3 and optional-main-import qualifications. These are concrete runtime
and artifact claims; the source inventory gate does not substitute for them.
Final source-bound command results belong in the delivery review record.
