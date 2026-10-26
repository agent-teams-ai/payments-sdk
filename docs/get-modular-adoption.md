# Get Modular composition adoption

## Decision

Payments adopts the Get Modular Consumer Module Standard for the explicit
construction and resource ownership of its optional technical integration
package. The owner is `payments-sdk/composition`. The machine-readable
[profile](../architecture/get-modular-consumer-profile.json) and its
[blocking regression gate](../tools/test/get-modular-adoption.test.ts) define
the precise composition slice. The owner also adopts the full Feature Module
Standard topology for all production source in the four SDK packages through
[the feature ownership decision](feature-module-adoption.md). The current
composition layout has no technical-adapter exception. The two profiles own
different checks: FMS owns production ownership and layer/public boundaries;
CMS owns Get Modular descriptors, declarations, entries, inputs and groups.

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
[`081ae02b49123e14121e100eccfe99f2e74c3600`](https://github.com/agent-teams-ai/get-modular/commit/081ae02b49123e14121e100eccfe99f2e74c3600).
The profile pins the complete CMS document SHA-256
`3c5814ebf1ab1bd17688e49955aa0baa2ee91dd3a369adcea4d38aaccd53ba86`
and guide SHA-256
`9bdbc6a6eac511691cf429c7e7e12b4cf4fd86ec16a348fb3af7a46c989af144`.
The earlier reviewed delta replaced direct feature-map inheritance with complete
descriptor unions and separate `CapabilitiesOf` bases per source (ADR-0041).
It preserves unused and transitive entries, full revision metadata and early
conflict rejection. Custom maps with additional properties, signatures or
map-level polymorphic `this` retain their existing complete interfaces.
The shared mechanism stays in Assembly; Payments adds only a conformance example
using its actual descriptors, without a new local type framework or public API.
The earlier report-and-await shutdown obligations remain in force.
The current b70-to-081 content delta only changes four upstream producer command
examples to `bun run`; it changes no consumer normative rule or authoring guide
byte. The separately retained successor8305ea6409757da8e60dca074dce163d95c85e88
has identical CMS/guide bytes; it was not observed as main during this readback.
This explicit mutable profile/gate migration preserves all accepted decisions
and published qualification histories. The current organization delta adds
language/runtime, TS7 and universal-tool catalog guidance; no product or
composition scope is changed.
The profile accepts the repaired published artifacts and exact catalog/lock pins.
The isolated packed consumer passed on Linux ARM64 Node `24.22.1` and `26.12.1`
with PostgreSQL `18`, strict NodeNext/Bundler and identical four SDK archives.
These are official registry runs; earlier candidate evidence stays historical.

The organization quality source is retained at
[`c8f3e7ba220241f79292c84c72712653019aa1df`](https://github.com/agent-teams-ai/.github/blob/c8f3e7ba220241f79292c84c72712653019aa1df/docs/engineering-quality-standard.md),
SHA-256 `034ef5cb23a64c2210da81bee8b3403f6abdf0180775a6565959fee69c673b3a`.
These are reviewed source identities, not moving branch aliases. The retained
organization source does not silently replace accepted product decisions.

The qualified **published** artifacts are Core/Assembly `0.7.0`, Resources
`0.2.1`, Conformance `0.5.0` and Observation `0.2.0`. Their exact publication,
dependency, SHA-256 and SHA-512 identities are in the
[published artifact record](../qualification/observation/published-artifacts.json).
The source-bound [release workflow](https://github.com/agent-teams-ai/get-modular/actions/runs/39612969025)
completed prepare, publish, installed verification and latest promotion on
`7131d0d7a6bb5dd4c3e8906ccac065c0be0e0333`. Registry read-back on 2026-10-21
matched every archive against that release manifest. The profile pins the
artifact-record digest; the gate compares catalog versions and lock integrity.
The [October 20 record](../qualification/observation/published-artifacts-2026-10-20.json)
preserves the earlier train.

Engineering Foundation `3.0.0` supplies the shared source graph and development
quality profile described in [its adoption record](foundation-adoption.md).
The repository's FMS checker delegates structural rules to the published
Feature Module Standard kernel. This composition gate calls the real published
Get Modular `checkModuleLayout()` with Foundation's observed files, resolved
import edges and actual classified use-case exports. It rejects unsupported
export classification instead of pretending that a use-case file has no
exports. A separate TypeScript AST inventory checks authored GM declarations,
descriptors, entries, inputs and groups against this profile. No second source
graph, generator or quality scheduler is introduced.

The AST uses the published `typescript/unstable/sync` and
`typescript/unstable/ast` exports of the existing exact compiler `7.0.2`, not a
deep import or an extra parser. Because these public exports are unstable,
upgrading that compiler requires requalifying this small adapter; the gate
rejects an unreviewed compiler change. Native API snapshots and their compiler
process are disposed after every inventory.

## Feature and public boundary mapping

The package is an outer integration with two owned features and two curated
public entrypoints. Each feature has a flat `composition/` directory. Every
runtime entry imports its own separately declared module. Each entry belongs
to exactly one feature group; inputs import only their host declarations.

| Path below `packages/payments-get-modular/src/features/` | Responsibility                                                                                                                                |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `payment-runtime/application/ports/`                     | Explicit frozen payment capability facets and the managed root shape; no framework types                                                      |
| `payment-runtime/application/use-cases/`                 | Track admitted calls and retain physical core work through close                                                                              |
| `payment-runtime/composition/`                           | Named role contracts, configuration/runtime declarations, declared input, scoped entry, feature group and curated public facade               |
| `purchase-observation/application/models/`               | Finite readonly query and purchase display values                                                                                             |
| `purchase-observation/application/ports/`                | Borrowed purchase read only; no financial or lifecycle authority                                                                              |
| `purchase-observation/application/use-cases/`            | Validate/copy a query, derive loading state and detach finite purchase values                                                                 |
| `purchase-observation/composition/`                      | Observation/Resources integration, role contracts, independent declarations and entries, declared inputs, one group and curated public facade |

The package roots re-export only their feature public facades. The main entry
has no Observation import. Query/value semantics remain framework independent;
Observation owns scheduling, latest-only loading, subscription detachment and
physical load settlement. The Host retains resource controls. There are no
empty domain layers or inferred business contexts in this integration package.

`Read` and `Processing` are contract revision 2: public reads are detached,
readonly snapshots, and audited stream selection exchanges a target-bound
opaque `version`. Other descriptors remain revision 1. Capability function
properties are checked contravariantly, so a replacement that requires a
narrower buyer identifier or an extra checkout precondition is rejected.
The version is optimistic concurrency evidence, never operator authorization.

The CMS gate checks direct authored API calls, including aliased and namespace
imports, and compares names/paths with the profile. Its published layout check
observes real declaration/module imports and use-case exports. FMS separately
owns curated facades, source census, dependency direction and mirrored feature
tests. These checks do not infer financial policy or establish runtime behavior;
semantic ownership and lifecycle guarantees retain their scenarios and review.

The test-only [descriptor fragment example](../packages/payments-get-modular/test/module/descriptor-fragments.test.ts)
combines unions of the actual payment and observation descriptors through a
separate `CapabilitiesOf<SourceContracts>` clause per source. The strict test
project proves that the final concrete map retains every existing key and the
complete capability entry, including revision metadata. The ordinary adoption
test gate also requires TS2320 for an unused conflicting value or revision at
the final interface. The existing six-descriptor production maps already use
concrete descriptor unions and need no runtime or public API change. This
recipe concerns descriptor-derived maps; it makes no claim about arbitrary
polymorphic `this` or call-signature inheritance.

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

The successor Observation contract reports `observation.load.still-running` on
escalation while the original close keeps awaiting the loader and its finally
cleanup. The Host retains that patient Promise. Bounded abandon ends only the
caller's wait: it does not release the runtime, pool or pending cleanup. When
the read and cleanup settle, the original close completes without retry and
reverse ordering releases earlier dependencies. An unrelated genuinely failed
cleanup still follows Resources debt semantics and requires Host retention.

### Published Resources migration

Resources `0.2.0` has a synchronous abort-reentry ordering defect: a reentrant
close can miss an already aborted escalation signal. The existing upstream
repair is included in the target `0.2.1` release. The consumer regression now
closes its ancestor synchronously from an abort listener and checks detach and
cleanup order; it requires the repaired published bytes. No deferred-listener
workaround or private Resources fork is retained.

Public archive read-back, exact catalog/lock pins and both official packed
consumer gates now qualify this migration. Candidate success remains TEST
evidence only. The previous train and its limitations remain in the
[historical artifact record](../qualification/observation/published-artifacts-2026-10-20.json).

## Verification and remaining obligations

`pnpm test:modular:adoption` blocks pin/artifact drift, missing owned paths,
unknown authored GM boundaries, layout violations, added exceptions and removed/no-op command
chains. Its disposable mutations prove rejection while an owner-local helper
remains permitted by the composition inventory. The published checker also rejects an extra
use-case export and value imports replaced by type-only declaration/group imports. `architecture:features:check` runs this gate after the FMS checker
and is required by `check:fast`; the existing `test:boundaries` glob
also includes it in full checks and the quality CI lane. Existing source graph
rejection fixtures retain authority for unknown packages/files, forbidden
imports and public boundary bypasses.

`pnpm test:modular` exercises the real published Assembly/Resources/Conformance
packages, independent wiring/namespaces, inert preparation, facet isolation,
two runs, failed startup, cancellation and physical settlement. The new
non-database lifecycle cases use the actual SDK projection and runtime: an
escalated view reports unresolved work while a storage read is held; bounded
shutdown retains its runtime and pool through both read settlement and finally
cleanup, then the patient close completes. The reentrant shutdown case detaches
its real subscriber before dependency disposal. Barriers and public Observation waits replace sleep-based
oracles.

The packed [Observation consumer](../qualification/observation/README.md)
retains its separate NodeNext/Bundler, one-physical-peer, real PostgreSQL,
T1/T2/T3 and optional-main-import qualifications. These are concrete runtime
and artifact claims; the source inventory gate does not substitute for them.
Final source-bound command results belong in the delivery review record.
