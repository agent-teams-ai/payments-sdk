# Get Modular integration and growth assessment

Assessment date: 2026-10-21. This is an engineering assessment of the payments
consumer and inspected upstream source, not a throughput guarantee or a
repository-wide conformance certificate. The initial assessment is **7/10 for
integration convenience and 8/10 for architectural direction**. Explicit
capabilities and lifecycle ownership are useful; contract coordination and
Host shutdown remain work the integrator must understand.

The source reference is Get Modular
[`ddf1e0b0053f546f12ca70190b237b4f7e78d09d`](https://github.com/agent-teams-ai/get-modular/commit/ddf1e0b0053f546f12ca70190b237b4f7e78d09d).
Payments consumes the exact published versions in the
[artifact record](../qualification/observation/published-artifacts.json), not
unpublished main. The [consumer adoption record](get-modular-adoption.md)
defines the narrower local enforcement scope.

## What is already useful

| Integration task | Current mechanism and practical effect |
| --- | --- |
| Add an independent provider/store implementation | Supply the core-owned ports at the Host. Domain code and payment commands remain independent of GM. |
| Give a module the operations it needs | Checkout, read, management, processing and delivery are separate capabilities. A read projection receives no financial mutation or delivery authority. |
| Assemble many modules | Static entries keep declaration and factory together; groups collect stable entries; Assembly checks the graph before construction. |
| Reuse one setup across tenants/accounts | Prepare once and provide declared per-run inputs and a separate attempt scope. Credentials and tenant IDs do not become module identities. |
| Add optional UI/status observation | The separate `/observation` entrypoint uses real `watch` and latest-only `load` over a finite copied purchase view. Financial delivery remains durable and independent. |
| Test composition | The existing independent wiring oracle, namespace checks, isolation, smoke and packed-consumer tests exercise public artifacts. |

The concrete implementation and setup remain in the
[package guide](../packages/payments-get-modular/README.md). Capability
segregation limits coupling; it does not authenticate callers or replace
application authorization.

## Constraints that matter before module counts grow

### Graph size and type-checking are bounded

The current preparation envelope admits **4,096 module-entry occurrences plus
group nodes in total**, up to 1,024 roots and a group depth of 16. Other limits
on slots, bindings and provider occurrences can be reached first. For example,
1,000 modules and 100 group nodes fit the node limit; 4,000 modules and 100 group
nodes do not. These are admission bounds for one root, not measured runtime
capacity. See the
[CMS preparation envelope](https://github.com/agent-teams-ai/get-modular/blob/ddf1e0b0053f546f12ca70190b237b4f7e78d09d/docs/architecture/common-assembly.md#preparation-and-resource-envelope)
and [actual group counter](https://github.com/agent-teams-ai/get-modular/blob/ddf1e0b0053f546f12ca70190b237b4f7e78d09d/packages/assembly/src/features/construction/group.ts).

Upstream already addressed a quadratic capability-map type construction. Its
fixtures measure 100, 200, 500 and 1,000 modules; the checked budget is for
500 modules. This is useful compiler evidence, but it does not prove editor
responsiveness for a real multi-package graph of several thousand modules.
Use feature-owned interface maps and interface extension, preserve the
existing type fixture, and measure the real consumer graph when it grows.
Sources: [ADR-0035](https://github.com/agent-teams-ai/get-modular/blob/ddf1e0b0053f546f12ca70190b237b4f7e78d09d/docs/decisions/0035-complete-composition-profiles-in-prepare-and-make-capabilitiesof-linear.md),
[type-scale budget](https://github.com/agent-teams-ai/get-modular/blob/ddf1e0b0053f546f12ca70190b237b4f7e78d09d/tests/assembly/type-scale-budget.json).

Many independently composed services do not add their module counts into one
Assembly graph. Conversely, creating many concurrent runs does not provide
resource admission, connection pooling or workload limits. Those remain Host
responsibilities under the existing
[system boundary](https://github.com/agent-teams-ai/get-modular/blob/ddf1e0b0053f546f12ca70190b237b4f7e78d09d/docs/architecture/system-boundary.md).

### Contract changes require coordinated adoption

The current CMS requires a revision change for every capability value-type
change, including additive changes. Provider and consumer revisions match
exactly. The capability keeps its permanent ID; current guidance does not
permit parallel `/v2` identities as an ordinary migration escape. This makes
incompatibility explicit, while a broad capability shared by many independently
released modules creates a broad upgrade obligation. See
[module-package and contract rules](https://github.com/agent-teams-ai/get-modular/blob/ddf1e0b0053f546f12ca70190b237b4f7e78d09d/docs/architecture/common-assembly.md#module-packages-and-contracts)
and the [in-place upgrade guide](https://github.com/agent-teams-ai/get-modular/blob/ddf1e0b0053f546f12ca70190b237b4f7e78d09d/docs/guides/module-authoring.md#16-change-a-contract-in-place-upgrades-with-codemods).

Keep capability ownership and consumer roles narrow now. Avoid a shared
`ApplicationServices` dependency bag. A genuinely independent publisher that
needs old and new capability revisions in one Host may justify a successor
compatibility protocol later; accepting it would require a reviewed contract
and failure/upgrade evidence. Silently accepting revision mismatches would
remove the current guarantee.

### One physical peer set is part of the contract

Entries, groups and Resources scopes use package-local identity checks.
Two installed copies with equal version strings are not interchangeable.
Reusable module packages must use the intended peer relationship, and the
packed Host must demonstrate one coherent physical peer set. Payments already
qualifies its public entrypoints that way. See
[ADR-0036 consequences](https://github.com/agent-teams-ai/get-modular/blob/ddf1e0b0053f546f12ca70190b237b4f7e78d09d/docs/decisions/0036-compose-roots-from-module-entries-and-static-groups.md#consequences).

### Expensive factories add startup latency

Factory construction is sequential in dependency order. The existing
[runner](https://github.com/agent-teams-ai/get-modular/blob/ddf1e0b0053f546f12ca70190b237b4f7e78d09d/packages/assembly/src/features/construction/run.ts)
does not run independent factories concurrently. Keep ordinary factories
passive and share Host-owned infrastructure through explicit capabilities.
If actual startup becomes slow, measure factory I/O and dependency depth.
A concurrent scheduler changes failure, cancellation and cleanup ownership;
module count alone is not evidence that it should be introduced.

## Lifecycle and diagnosis need deliberate Host code

Retain structured preparation/run causes for the Host's diagnostic path.
Reducing a preparation failure to its code discards module, slot and candidate
details just when a larger graph makes them most useful. Do not blindly log
opaque factory causes or configuration: they can contain secrets. An additive
upstream discriminated type for known preparation causes would improve
navigation without changing the composition model. Public result types are in
[construction/types.ts](https://github.com/agent-teams-ai/get-modular/blob/ddf1e0b0053f546f12ca70190b237b4f7e78d09d/packages/assembly/src/features/construction/types.ts).

Resources continues releasing earlier entries after a child reports failed
cleanup. Observation escalation can report a still-running loader as debt.
Therefore a Host must not infer from LIFO ordering that a single parent close
will retain every borrowed dependency until all child work physically settles.
Close dependent scopes, inspect completion, retain their runtime/pool while
debt remains, then retry/join and close the dependencies. Payments' runtime
also tracks actual in-flight work; preserve that ownership instead of racing
the work against a cancellation signal. Sources:
[Resources child release](https://github.com/agent-teams-ai/get-modular/blob/ddf1e0b0053f546f12ca70190b237b4f7e78d09d/packages/resources/src/features/scope/scope.ts),
[Observation loader drain](https://github.com/agent-teams-ai/get-modular/blob/ddf1e0b0053f546f12ca70190b237b4f7e78d09d/packages/observation/src/features/store/load.ts).

The separate abort-reentry ordering defect was corrected in upstream main but
is absent from the published Resources 0.2.0 artifact. The local adoption record
distinguishes its counterexample from the exercised payments shutdown path.
Merged source is not proof that an installed release contains the repair.

Observation notifications may coalesce. A slow uncancellable load delays the
latest requested load. Keep finite projections, short-lived subscriber scopes
and explicit refresh after durable changes. Do not use these hooks as a queue,
financial event log or proof of consumer receipt. These are deliberate
[Observation semantics](https://github.com/agent-teams-ai/get-modular/blob/ddf1e0b0053f546f12ca70190b237b4f7e78d09d/packages/observation/README.md),
not missing payment guarantees.

## Refactoring risk

No observed issue requires replacing the composition architecture. The current
boundaries keep future changes local to adapters, contract owners and Host
composition. They cannot promise that arbitrary future module growth will
require zero refactoring. Before a specific limit or independent-versioning
requirement is reached, qualify the real graph and adopt the smallest successor
that preserves its guarantees. Do not build an unrelated scheduler, service
locator or universal event bus preemptively.
