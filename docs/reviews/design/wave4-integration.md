# Wave 4 independent review — integration, architecture and implementation readiness

## Subject, scope and verdict

Reviewed immutable `research/reviews/wave4-plan.md`, SHA-256 **`1cc43a1e8ed904e3f7dc1d85a496ff7769656173172be3a5bda5a5d4748713f9`**, in full. I also read the complete original Russian handoff, complete Q 1.1.2, `research/get-modular.md`, `research/platform-foundation-q.md`, and the authoritative newer `research/source-audit.md`. I did not read another critic's review or the review journal. Supplementary root-authored `research/editorial-additions.md` was reviewed separately; it is not part of the frozen subject.

**Verdict: no actionable P0, P1 or P2 finding in this review's assigned lens.** The plan is coherent enough to begin its proposed implementation stages. This is an architecture conclusion, not approval to publish, change accounts, modify existing applications or execute payments. The important guarantees remain explicitly subject to implementation and qualification.

| Severity | Findings | Required correction |
| --- | --- | --- |
| P0 | None | None |
| P1 | None | None |
| P2 | None | None |

This conclusion does not treat an unexecuted future test as a defect. In particular, it does not demand a second real payment provider, a production credit ledger, materialization of Commercial Access, a new HTTP service, or observation publication before work on the independent core can start.

## 1. Published Get Modular composition matches the proposed integration

**Trace:** plan §§2, 10–12; retained Assembly 0.5.0 `dist/index.d.ts`, construction `entry.d.ts` and `types.d.ts`; Resources 0.1.0 public declarations and scope implementation; published manifests.

The plan uses real exported construction names: owner descriptors through `defineContract`, inert `declareModule`, `implement`, static `group`, `assemblyFor().prepare`, and a prepared `run`. The retained overloads confirm that a context adapter is the third argument of `implement`, while per-run values belong to declared input entries and `RunInputs`. The factory receives a dependency record and context, and returns a Promise containing instance and capabilities. Nothing in this design needs an invented container API or lifecycle hook.

Resource ownership is equally concrete. The published Resources declarations expose a `Scope` containing sibling `resources` and `control`. `Resources` has no `control` property. R3 correctly creates an attempt scope before awaiting construction, passes only `attemptScope.resources` to `run`, and retains control in the Host. Borrowed pools stay externally owned. Assembly's construction journal is explicitly separated from the financial journal, and unsuccessful construction follows an explicit cleanup path rather than relying on automatic rollback or disposal.

The peer policy also corresponds to the artifacts. Published Assembly depends on exact Core 0.5.0; Conformance 0.3.0 declares compatible .5/.5/.1 peers. Resources uses package-local identity state, making a second physical copy relevant even when its version matches. R3 therefore correctly requires one compatible host-owned train and keeps Conformance in development tooling unless actually imported at runtime.

**Retain:** the separate `payments-get-modular` package and ordinary core factory. **Future gate:** packed consumer B must exercise real exports, declared inputs, concurrent runs and cleanup with one resolved Resources identity. A handwritten wiring oracle is useful evidence; successful graph construction alone cannot prove the selected payment semantics.

## 2. Pending observation is isolated and accurately constrained

**Trace:** plan §10 and P6; source audit §§1–2; pending PR195 `packages/observation/src/features/store/types.ts` and `load.ts` at `3f5f3b303e99e4b8f919486d91d954f7f78e204d`.

The fresh audit supersedes older status tables: main is `4609c2a…`; prerequisite #197 is merged; #154 is refreshed at `fc276a9…` but remains open; #195 remains open; published static versions remain unchanged. R3 preserves those distinctions. It does not mistake the completed tooling prerequisite for admitted observation or infer publication from a source manifest. Candidate .6/.2/.4/.1 versions remain a separate train requiring reconciliation of release, archive and peers.

The proposed observation use has the correct semantic limit. `watch` is synchronous registration with deferred, coalesced delivery. Its callback returns `undefined`, and it offers neither durable replay nor acknowledgement. `load` maintains one active run and one latest pending input, aborts superseded work, and waits for actual settlement before starting its replacement. The inspected implementation checks currentness before publishing results and again at delivery. Cancellation cannot retract an external effect.

R3 consequently routes checkout, refunds, grants and publication through explicit durable workflows. A mutable read view can be reconstructed after restart. Optional observation does not block mandatory static consumer B. This is a meaningful dependency boundary, not a missing mandatory integration.

**Retain:** independent static and optional observation gates. **Future gate:** test read-to-watch catch-up, callback errors, supersession and real cleanup after a compatible release exists. These tests must not become an invented payment delivery protocol.

## 3. Foundation adoption is proportionate and based on published artifacts

**Trace:** plan §11 and P1/P7; retained published EF1.10.0 and FMS0.1.1 manifests; Platform/Foundation research §§4–5; source audit §2.

The proposed EF1.10.0/FMS0.1.1 pair is compatible with the actual published optional peer `^1.10.0`. The newer main-source correction to `^1.8.0` is not substituted for archive content. Foundation's dependency on TypeScript 7.0.2 and its development engine range are accurately kept separate from product support claims.

The plan makes Foundation operationally useful through source dependency and dependency declaration checks, negative boundary fixtures and required CI execution. It avoids claiming that installation or script connectivity proves the checks ran. Source-dependencies v2 is sufficient for ordinary workspace packages; strict ownership of root tooling is explicitly accounted for. V3 availability as a schema is not treated as blanket qualification. FMS remains opt-in rather than a forced directory model, and there is no fabricated API history before the first actual publication.

The two packed typecheck profiles, NodeNext and Bundler with `skipLibCheck:false`, address a real distribution risk that workspace aliases cannot expose. Maintained tests and tools belong to strict projects. A nominal dependency version does not excuse an older executed TypeScript compiler closure.

**Retain:** development-only Foundation and the selected minimum capabilities. **Future gate:** prove permitted imports succeed and prohibited core-to-adapter, runtime-to-development and deep cross-package imports fail using the installed artifact. Do not widen this into an unrelated Platform upgrade.

## 4. Packaging and two independent consumers are sufficient for the stated claim

**Trace:** plan §§1–3, 10–12 and 14; original handoff §§4–6 and 12; Q Clean Architecture, ISP and economy guidance.

Four distribution points protect four actual dependency surfaces: neutral payment policy, Paddle, PostgreSQL infrastructure and optional composition. Core owns policy-facing ports; adapters depend inward. Neither the dependency diagram nor the stated public contracts make consumers install Get Modular, Paddle or storage merely to import core. The plan avoids a package per operation and avoids exposing SDK, ORM or framework DTOs at its public neutral boundary.

A plain Node HTTP Host and a Node Fetch-handler Host composed through published Get Modular exercise different wiring and transport integration while remaining within one declared server-runtime matrix. That satisfies the requested two disposable integrations; the handoff does not require testing two JavaScript engines or implementing a second UI/server framework. Both Hosts use public delivery contracts and the same small nonproduction fixtures, rather than separate ledger implementations.

The plan honestly limits the evidence. Fake capability profiles demonstrate core isolation and unsupported-operation behavior; they cannot prove another real provider preserves every guarantee. Replacing an adapter does not migrate live subscriptions. Runtime compatibility, exact lower bounds and packed installation remain release gates.

**Retain:** the package count and two-consumer design. **Future gate:** import and typecheck actual tarballs in isolated consumers, with no optional GM installation in A and no reliance on monorepo path aliases. Keep sample code small, but retain meaningful receipt/effect assertions.

## 5. Platform ownership and the bounded envelope remain internally consistent

**Trace:** plan §§2, 5–6, 9 and P5; retained Platform context map, ADR-0007 and Commercial Access dossier at `83d761b…`; Q SRP/DRY.

The plan preserves the accepted strategic Commercial Access boundary while recognizing that only Project Management has a materialized slice. Commercial Accounting is unreserved. A technical provider subscription projection therefore does not become a competing product Subscription authority. Payment evidence, commercial decisions, credit effects and operational usage remain separately owned. Separate consumer transaction boundaries respect Platform's prohibition on cross-context SQL, repository reuse and shared Unit of Work.

The detailed credit/access fixtures verify that trustworthy facts can produce coherent independent effects. They do not require a production accounting context, approved commercial pricing, consumption model or new Platform package. Their symbolic Q/T quantities, hold policy and limited no-consumption scope are explicit. Complexity here protects documented payment invariants rather than introducing an unsupported product subsystem.

The revised size protocol also closes the previously plausible service creep. A complete snapshot cannot silently truncate, but overflow can commit a bounded held/incomplete control message with identity, revision, digest and reason. The consumer advances source revision and retains old contributions only as last-known, so stale complete evidence cannot remove the hold. Version-one envelope handling also allows custody of an unsupported payload schema without pretending omitted details are absent.

No chunk generator, download endpoint, mutable reference service or cross-owner database access is required. Exact byte limits and validation code belong to implementation. Permanent overflow may require explicit review or a qualified later protocol, which is an honest availability limitation rather than an undocumented promise of automatic progress.

**Retain:** bounded control, independently recoverable obligations and consumer-owned restrictions. **Future gate:** overflow, schema mismatch, stale replay, deleted jobs, restart and resolution must produce the planned hold and recovery behavior without reading payment-owner SQL.

## Supplementary editorial note and conclusion

The classifier navigation table is consistent with R3's existing initial/renewal/top-up guards, payment-method exclusion, recovery of the original period and policy-authorized zero-value purchase. It adds navigation, not authority. The pending watch example correctly renders the initial snapshot explicitly and registers with that source snapshot and subscriber resources. One wording improvement was sent to the root: say load results are ordinary values with temporary resources released before settlement, rather than requiring the values themselves to be “temporary.” This is not a severity finding.

No architectural correction is required from this review. Preserve the stated boundaries and stage gates during implementation; do not convert this review's absence of findings into evidence that the planned SDK, SQL, packed-consumer or sandbox checks have already passed.
