# LOC and portability claims review

Reviewed candidate `16a6a5038383e54d3c740adcf87487e113498847` read-only on 2026-10-21. Scope: LOC definitions and source binding, provider/store/queue replacement claims, and the Get Modular growth assessment. Read repository instructions, the retained organization quality standard in `research/org-current`, developer stack, accepted plan's relevant ownership/provider sections, architecture and adapter guides. No install, build, test, database or remote action was performed.

## Result

No new blocking inaccuracy found in the inspected repository documentation. Preserve the following material qualifications when answering the user; compressing them into “fully portable” or “3,657 executable lines” would overstate the evidence.

### 1. LOC totals are consistent; name the measure accurately

`/tmp/payments-hardening-loc.json` reports **28 production source files; 3,542 runtime statement/declaration units + 115 module-directive units + 1,015 type/signature units = 4,672 combined AST units; 3,797 physical noncomment SLOC**. The runtime/module subtotal is **3,657**. All 30 maintained source hashes (28 included plus two explicit exclusions) match the candidate. The method is identical to the historical `docs/reviews/sdk-0.2-completion/production-loc.json`; independent JSON comparison confirmed that 22 unchanged historical production files match every reported count field. Source inventory and report inventory both contain 30 files.

The method and implementation in `research/production-loc.ts` agree. This is a custom TypeScript AST statement/declaration measure, not a universal LLOC definition, emitted-JavaScript count or complexity measure. **Do not label 3,657 as literally executable code:** the 115 module units explicitly include erased type-only imports and exports; e.g. the new `work-transport.ts` has three `import type` directives. Use “runtime and module logical units,” as the historical README already does. Expressions, property assignments, arrow expressions and multi-declarator details are not separate units; nested selected statements are.

The two maintained-source exclusions are meaningful and disclosed: exported `./testing` memory-store source (377 combined AST units / 244 physical lines), and declaration-only pg-boss augmentation (27 / 30). Tests, independent consumer fixtures, examples, tools, qualification, generated output and dependency implementations are outside the count. The small count therefore describes the shipping payment mechanism, not the whole integration/reliability effort or a full billing/access/credit product. Official Paddle SDK, pg-boss, pg, Drizzle and GM work also lives outside this count. Embedded SQL contributes physical lines but no separate TypeScript logical statements; neither measure establishes SQL complexity or a count of SQL operations.

The preliminary JSON still names commit `28ab08829d3c90094a2b2a846da05daa09c108c2`, despite matching the current source hashes. Root confirmed final regeneration at the qualification subject is planned. Do not present the preliminary metadata as already exact-head evidence; regenerate or explicitly bind unchanged source hashes and any later documentation-only commit.

### 2. Provider replacement is an extension boundary, not a completed migration product

Core's `PaymentProvider`/`PaymentStore` contracts and optional GM composition do support independently supplied adapters without introducing vendor SDK/ORM imports into core. The foreign-provider fixture demonstrates mapping and consumer-contract behavior, not another admitted production provider (`docs/architecture.md`, provider vocabulary section).

A new production provider still needs ingress verification, retained receipt custody, catalog/profile mappings, exact money/periods, uncertainty/retry semantics, management authorization and real-provider qualification. Current reconciliation also requires increasing lexical string IDs and a final-input cursor (`payments-core/src/reconciliation.ts:39-56`); opaque or differently ordered provider cursors can require an explicit contract evolution. Thus “new purchases can use a qualified compatible adapter” is supported; “any provider is a drop-in replacement” is not. Active subscriptions, saved payment methods and in-flight operations are not transferred by replacing an adapter. The accepted plan and historical completion README already distinguish this separate migration problem.

### 3. Database and transport portability have different scopes

The public core `PaymentStore` contract is SQL/ORM-free. Another durable store is possible only if it independently preserves confirmed commits, bounded read-set/CAS and concurrency rules, replay, recovery fencing and unknown-COMMIT behavior (`payments-core/src/contracts.ts:98-139`). Drizzle is a private PostgreSQL query/schema toolkit here; its other dialects do not qualify another payment database. Existing PostgreSQL locks, SQL, transaction ownership and recovery requirements remain material.

The new queue port is specifically a **transactional PostgreSQL wake-up boundary**, owned by `payments-postgres`. `PaymentJobEnqueuer` accepts the existing `PaymentSqlTransaction`; `PaymentJobTransport` supplies a PostgreSQL runnable-work predicate applied before LIMIT. Implementations cannot acquire another connection, commit independently or send to an external broker from `enqueue` (`src/work-transport.ts`; `docs/queue-transport.md`). The alternate SQL fixture shows substitution through the same store/runner/core, not a second production queue. A remote broker needs an independently designed durable relay and receipt protocol; none is supplied or qualified by this port. Transport substitution also supplies no automatic live migration of active obligations/namespace bindings.

The abstraction removes pg-boss types and vendor schema knowledge from the generic store/runner contract, **not pg-boss from the installed package**. `packages/payments-postgres/package.json` still declares pg-boss as a runtime dependency, and the package index re-exports the bundled factory from `job-transport.ts`, which imports pg-boss. Describe this as vendor isolation/selection, not a pg-boss-free artifact or a generic broker plugin system.

### 4. GM scores remain engineering judgments with stated limits

The 7/10 integration convenience and 8/10 architectural direction ratings are explicitly subjective, scoped to this consumer and inspected upstream `ddf1e0b...`, not throughput evidence or a conformance certificate. The documented growth qualifications are supported by the retained exact upstream source: 4,096 entries **plus group nodes**, 1,024 roots, depth 16, other earlier limits, a 500-module checked compiler budget, sequential construction, exact capability revisions and one physical peer identity. Do not translate the admission ceiling into tested capacity for thousands of real modules or a promise of no refactoring. Host workload admission, staged shutdown and borrowed-resource custody remain Host work. The published Resources 0.2.0 abort-reentry defect is explicitly distinguished from its repaired upstream source; do not imply the shipped artifact contains that repair.

## Evidence boundary

This memo is a claims/source review. It does not independently attest current full-gate results; exact-head two-floor qualification remains with root. Source files were not modified.
