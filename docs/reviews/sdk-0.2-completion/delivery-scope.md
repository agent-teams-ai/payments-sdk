# Independent final delivery scope and production LOC audit

## Disposition and exact subject

Reviewed read-only on 2026-10-20 at clean source **`d303f2a36774555bd885df63e536b97428c200a0`**, repository `/workspace/scratch/9e36ca3bbd13/implementation/payments-delivery`, delivery PR **[payments-sdk #5](https://github.com/agent-teams-ai/payments-sdk/pull/5)**.

**No concrete P0, P1 or P2 contradiction established in the assigned final-delivery scope.** The implemented and documented scope supports describing the accepted SDK profile as functionally complete, with exact-source final local/hosted checks still owned by the delivery agent at this audit checkpoint. It does not support an unconditional production-readiness claim, a qualified second production provider, Bun support, a completed browser overlay, npm publication, or automatic migration of existing subscriptions.

This reviewer changed no tracked file, installed nothing, built nothing, ran no tests or database operation, and performed no Git/GitHub write. The sole executable analysis was the explicitly authorized read-only TypeScript source metric, plus source/Git inventory and hash comparisons. Its output went to a private `/tmp` JSON file. This requested research memo is the only deliverable written by the reviewer.

## Authority and inspected evidence

Read repository `AGENTS.md`, `docs/developer-stack.md`, relevant accepted implementation-plan contracts and P0–P7 acceptance requirements, `docs/architecture.md`, `docs/implementation-status.md`, `docs/qualification.md`, `docs/releasing.md`, current Foundation/node-or-bun/Get Modular guides, the SDK 0.2 review index and qualification/evidence/delivery reports, public package manifests, strict compiler/linter/Foundation configurations, required CI and release-policy sources, core contracts/reconciliation/vocabulary, Get Modular static/projection implementation, captured-command helper, and the foreign-provider fixture. Read the four separate current research reviews of typed core/provider, storage/consumers, modular/provider, and final Foundation adoption.

Applied the retained exact Q source `sources/q-5f1b5aef.md` and organization Engineering Quality Standard `sources/org-quality-5499550.md`. The coordinator identified current organization main as `5499550a2c8937303e1e0c7bc50570c72598ca8e`. A local diff confirms its retained baseline differs from retained `3a203362` only by a trailing blank line. Generic web opens of the organization/Q pages returned `DisabledError`; this reviewer therefore does not claim an independent fresh network retrieval. The retained policies establish the relevant obligations without inventing a missing rule.

Prior reviews are scoped evidence for their named subjects, rather than a substitute for inspecting the current integration. In particular, `docs/reviews/sdk-0.2/qualification.md` and its evidence review correctly name **`fb9baa1d463d5b1ab5760aad72fe3fb1ee361f33`**. Their successful historical runs must not be relabeled as executions of `d303f2a`. At report completion, the coordinator reported exact-`d303f2a` hosted Checks **39420493065** and CodeQL **39420489316** successful, the complete local Node24 run passed, and the complete Node26 run still in progress. These are explicitly coordinator-supplied execution results; this source/metric audit does not independently attest their raw proof chains or treat the unfinished floor as passed.

The coordinator's subsequent official read-back advanced organization main to **`a34ecc6bc9bb165771f3962dccd25970dd5c0d98`**. I inspected `org-merge-a34ecc6/readback.json`: it records the quality standard, AGENTS, owner merge guard and identity policy as byte-identical to their previously inspected retained files. The quality standard's recorded SHA-256 is `a65fb5150837b010a71abe36cefd26c32709eb9b9e89f3938498a647e72f5587`. This changes the live navigation coordinate without changing the applicable retained rules.

## Selected complete Foundation adoption

The current claim is accurate when phrased as **complete adoption of the selected consumer profile**. Sources: `docs/foundation-adoption.md`, `.oxlintrc.json`, root scripts/catalog/lock, `foundation.config.yaml`, both `architecture/foundation/*.yaml`, the owning tsconfigs, `tools/toolchain.ts`, and `.github/workflows/checks.yaml`.

The concrete profile has shared Node TypeScript and real type-aware Oxlint presets, compatible exact `oxlint-tsgolint` 7.0.2001 beside Oxlint 1.83.0, strict project ownership with `skipLibCheck:false`, the selected source-dependency/declaration policies, and six direct public lifecycle scripts. Foundation remains a development dependency. The source-dependency universe is the four runtime packages and four package-test boundaries; root tooling/examples/qualification have compiler/linter ownership, without a false claim that Foundation v2 checks their entire dependency graph.

The final independent Foundation review closes the original two P2 omissions: missing inherited typed lint and missing direct lifecycle commands. It records actual-backend permitted/rejecting witnesses and strict-owner controls. The `d303f2a` delta adds explicit runtime-project references to the two no-emit consumer projects and documents build ordering. Inspection finds no removed strict option, governed root, financial oracle or required gate in that delta. Those explicit dependencies address cold build ordering; successful current execution still belongs to the ongoing full qualification.

The deferred-capability table is appropriate. FMS/source topology, schema v3, protected released-API baselines and SDK growth, another gate runner, numerical maintainability budgets, governance/scaffolding/security tooling profiles and unrelated schema release families are not automatic requirements of installing Foundation. The accepted plan selected the two useful architecture capabilities and made FMS opt-in. Enabling all producer features would require additional owner decisions and prerequisites. The first real protected public API baseline remains a future adoption trigger, rather than a reason to fabricate historical compatibility evidence now.

CI is fail closed in source: quality depends on build, retains complete lint/Foundation/registry/dev-only/boundary/packed gates, and the final `Required checks` job runs under `always()` and requires every prerequisite result to equal `success`. This establishes configured behavior. Live protection and actual final hosted success remain separate delivery evidence.

## Meaningful published Get Modular integration

The integration is substantive and respects the accepted owner boundaries. Sources: `packages/payments-get-modular/src/{contracts,module}.ts`, `src/observation/{projection,composition}.ts`, its package manifest/guide, `qualification/observation/README.md`, identity/lifecycle/financial fixtures and `tools/qualify-observation.ts`.

Static composition uses actual `defineContract`, `declareModule`, declared `input`, required slots, `implement`, `group`, prepared runs and Resources ownership. Per-run configuration avoids global mutable account/environment state. One ordinary core runtime is constructed and exposed through frozen checkout/read/management/processing/delivery facets. The integration does not implement another payment service or tenant authorization system.

Cleanup is meaningful: calls reject once resource closure begins, already admitted facet promises are tracked and joined, core admission stops, and actual core/provider settlement drains before borrowed dependencies may be released. The Host owns its attempt control, provider, store, pool and workers. Failed startup uses the same explicit close path. A caller timeout or abandoned close can leave honest physical debt; it cannot prove an SDK promise ended or authorize disposal of a shared pool.

The optional `/observation` entrypoint has a narrow `readPurchase` dependency and a finite detached summary. Selection synchronously clears the prior ready value before replacing its request. The loader awaits the complete borrowed read rather than racing it against cancellation, then rejects stale publication. Display reads/renders an initial authentic snapshot and registers `watch` against that snapshot. Real later-task/coalesced watches, one active/latest-pending load, subscriber/source ownership and failure attribution are documented accurately. No financial mutation, grant, durable evidence publication or delivery ACK runs from a hook. Explicit refresh is required after relevant persistent changes; this is not advertised as an automatically current financial cache.

The qualified published train is coherent: Core/Assembly **0.6.0**, Resources **0.2.0**, optional Observation **0.1.0**, and development-only Conformance **0.4.0**. The static entry can omit Observation. The isolated packed gate validates official manifests/archive digests, strict NodeNext/Bundler declarations, and one physical peer graph before meaningful real-PostgreSQL financial/lifecycle scenarios. I inspected those enforcing sources and the retained evidence, but did not independently download or execute the train in this audit. It is fair to describe real published Assembly/Resources/watch/load adoption; it would overstate the evidence to call it universal Get Modular/CMS conformance or a production deployment.

## node-or-bun scope

`tools/package-artifacts.ts` selects `createNodeProcessAdapter()` explicitly and uses `node-or-bun` **0.2.2** only for the existing captured development-command seam. Literal executable/argv, explicit cwd, a 120,000 ms timeout, zero-exit assertion, separate captured streams, native runtime errors and no retry are preserved. The adoption guide explicitly acknowledges the deliberate change from a combined 4 MiB capture budget to **4 MiB per stream / at most 8 MiB payload**, and direct-child rather than descendant-tree containment.

This code does not replace the streaming test runner or the intentional negative compiler probe. It adds no SDK runtime dependency, Bun qualification, production transport correction, or payment mutation cancellation. Package archive/consumer rejection sources preserve that boundary. The source and documentation justify saying **development tooling adoption**; they do not justify saying that payments supports Bun.

## Provider replacement: localized architecture, substantive qualification

The dependency direction is sound. Core owns `PaymentProvider`, `PaymentStore`, evidence and operation results. The runtime accepts those ports and validates trusted scope/capability configuration. Paddle DTOs, signature acquisition, SDK requests, provider errors, IDs and mapped pagination remain in `payments-paddle`; PostgreSQL and Get Modular import no Paddle implementation. Product grants/access/usage retain their own authorities and T3 boundaries. The official SDK is used directly in production, without a hidden global transport patch or private raw API seam.

For **new purchases** that fit the selected one-time/monthly quantity-one no-trial semantics, a provider addition is architecturally localized to its adapter, authenticated ingress, reconciliation source, catalog/provider-price bindings and Host composition. It must prove commercial classification, exact periods/money/line identity, cancellation/management capability semantics, custody, unsupported/unknown outcomes, duplicate/out-of-order evidence and actual SDK/account behavior. Core/storage/composition should remain unchanged if those observable contracts are preserved. This is an architectural expectation supported by inspected dependencies, not a promise that an arbitrary vendor will fit without contract evolution.

The foreign-provider E2E is meaningful counterevidence to accidental raw-vocabulary coupling: it uses unrelated wire origins/statuses, maps canonical meanings deliberately, checks one-time/initial/renewal/noncommercial maintenance, retains unknown evidence including strings colliding with reserved `api`/`subscription_recurring`, and checks independent durable grant replay. Expected facts, 225-credit allocation, three effects and mutation counts are explicit constants. It is a disposable fixture, not a production adapter. It does not qualify another real SDK, webhook signature system, pagination model, retention policy, account portal, cancellation/refund matrix or deployment.

A concrete portability limit must stay in the final explanation. `payments-core/src/reconciliation.ts` requires **strictly increasing lexical string IDs**, checks each supplied page identity against its observation identity where present, and requires `lastId` to describe the final acquired input. This suits the selected Paddle scan. A provider with opaque, unordered, non-string or differently ordered resumable cursors may need a reviewed reconciliation contract change and new qualification. Sorting one page would not prove cross-page safety. This pre-existing limitation is not a newly established P2 requiring speculative refactoring during final delivery.

Existing-subscription migration is materially harder and expressly deferred. Saved scopes, provider prices, transaction/subscription/customer refs, immutable evidence/revisions, unresolved attempts, old late adjustments and dedup history remain bound to the old provider. Replacing a constructor does not transfer active subscriptions or payment methods. A migration needs explicit continuity/termination/startup policy and preservation of causal grants and old recovery obligations. Do not overwrite old scope or relabel old identifiers. No migration toolkit or qualified transfer protocol is delivered here.

## Production logical LOC: independently reproduced

Ran only the authorized parser, using the already installed TypeScript **7.0.2** native synchronous API, under Node **24.21.0**:

```sh
/tmp/payments-cont-toolchain/node24/bin/node \
  /workspace/scratch/9e36ca3bbd13/research/continuation/production-loc.ts \
  /workspace/scratch/9e36ca3bbd13/implementation/payments-delivery \
  /tmp/payments-scope-loc-d303.json \
  d303f2a36774555bd885df63e536b97428c200a0
```

| Shipping package | Files | Runtime statement/declaration units | Module directives | Runtime + module units | Type/signature units | Combined logical units | Physical noncomment SLOC |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| payments-core | 7 | 1,349 | 17 | 1,366 | 635 | 2,001 | 1,208 |
| payments-paddle | 5 | 463 | 17 | 480 | 58 | 538 | 464 |
| payments-postgres | 9 | 1,601 | 59 | 1,660 | 238 | 1,898 | 1,783 |
| payments-get-modular | 6 | 101 | 18 | 119 | 63 | 182 | 271 |
| **Total** | **27** | **3,514** | **111** | **3,625** | **994** | **4,619** | **3,726** |

Use **3,625 production runtime/module logical units**, plus **994 production type/signature units**, or **4,619 combined custom AST logical units**. Calling 4,619 emitted-runtime lines would be inaccurate. The separate physical noncomment SLOC is **3,726**, not the logical count.

The method counts selected nonblock statements/declarations recursively, module directives once each, and type declarations/signatures separately; for-loop declaration lists count when not already wrapped by a variable statement. It does not count every expression, parameter or property assignment. Type-only imports count in module units. SQL inside a template adds physical lines but no additional TypeScript AST statements. Thus the method is explicit and formatting-insensitive within those choices, not a universal LLOC standard, complexity score, emitted-JavaScript count, or line-count budget.

The physical counter masks parsed string/regex/template tokens while preserving whitespace/newlines, then removes compiler-scanned comments before counting nonblank lines. This prevents comment-like literal text from deleting actual code. Embedded nonblank SQL lines remain represented physically. Package inventory contains no separately maintained production SQL/code language omitted from the stated TypeScript scope.

Excluded maintained source is explicit:

| Exclusion | Reason | Logical AST units | Physical noncomment SLOC |
| --- | --- | ---: | ---: |
| `packages/payments-core/src/memory.ts` | Exported `./testing` store; no production durability | 377 | 244 |
| `packages/payments-postgres/src/pg-boss-declarations.ts` | Declaration-only vendor augmentation | 27 | 30 |

Generated `dist`, dependencies, tests, fixtures, examples, tools, qualification, documentation and archives are outside production scope. The testing subpath is shipped but deliberately excluded from the production-runtime measure; disclose that distinction rather than pretending no excluded maintained code exists.

### Input/hash audit

The current parser output exactly matches `production-loc-95e996f.json` in production totals, all package rows, all included per-file rows and both excluded rows. **All 29 retained input SHA-256 values match the current files.** Git confirms no `packages/*/src` delta from `95e996ff0bbe8edb003fcd42ab66c6aa429a7253` to `d303f2a36774555bd885df63e536b97428c200a0`. The only intervening changes are the two strict consumer tsconfig reference graphs and the Foundation guide paragraph, which do not change the metric input bytes.

- Metric script SHA-256: `fea37296ac2eeb4a99e816bc8168f4b90e58bef5e89a727001e2de152e3bb6f7`.
- Retained `production-loc-95e996f.json` SHA-256: `629bd9fd9128b95d7b25d87cca0c48657909622e181a3cf25ed3757c6caf8202`.
- Independent `/tmp/payments-scope-loc-d303.json` SHA-256: `25e4ced87407cb3b3195cc73d464c5ddd9da6578aca1252e29fa1ffefc9f051c`.
- Parser package: TypeScript `7.0.2`, git identity `2bd066d87f5bafd315be9f40889d0a60b9e58e0b`.

The old `pr-modular-provider-review.md` count of 3,595 runtime/module units and 4,585 combined units belongs to its earlier `12303ff` source. Preserve that historical report, but use the new numbers in final delivery. The later typed validation/refactoring changed counts without expanding the supported commercial profile.

## Admission and remaining delivery claims

The accepted plan intentionally limits the supported commercial profile to one monthly no-trial price, quantity one, plus separate one-time top-ups. Plan changes/proration, seats/mixed baskets, trials/pause, manual invoicing, off-session charging, usage billing, refund initiation, production credit consumption and active provider migration are explicit deferrals. Unsupported external observations still need retained/held evidence; deferral does not mean dropping them. The current contracts/guides preserve this distinction. There is no concrete reason in this audit to reopen those accepted product limits as unfinished SDK functionality.

Current release source requires a full main-ancestry SHA, coherent four-package versions/tag, the authoritative latest **exact-SHA main-push** Checks run and successful final aggregate, then re-audits that run's tarballs and hashes before immutable GitHub prerelease assets. PR CI is necessary for merge but cannot replace that main-push release gate. The workflow does not invoke `npm publish`; a manifest version or dry-run success cannot prove npm publication. A release manifest/checksum is a source/CI/byte binding, not an independently verified signing or npm provenance attestation.

The final public report should wait for and cite the new actual local two-floor results and hosted result, name their real subjects, and describe any later commit through an honest delta. This audit does not clear gates still running. Historical SDK 0.2 reports that mention blocked authentication describe their named checkpoint; the new delivery report should record actual subsequent remote coordinates rather than alter that history or repeat it as current status.

Production-specific gates are separate from SDK code defects: corrected official Node bundled-fetch admission; actual Paddle sandbox/account/filter behavior; browser-wrapper strict declarations and real browser qualification; Host authentication/portal/administrative authority; real production accounting/access policy; physical backup/PITR/HA and deployment shutdown. The guides explicitly retain these limits. The backend checkout-URL flow is available while the optional browser overlay remains blocked. Passing functional suites or delivering a GitHub prerelease does not clear production admission. No security exploit against a live Paddle account is established by the documented malformed-response runtime probe.

## Architecture and maintainability assessment

The four packages protect real changing dependencies and owners, rather than multiplying layers mechanically. Payment invariants stay in the core; Paddle, PostgreSQL/query details, optional composition and product consumers have distinct change reasons. T1/T2/T3, dispatch uncertainty, causal identities, immutable evidence and borrowed resource lifetime are explicit protocols. Narrow composition facets and the read-only projection demonstrate useful ISP; provider/store ports and contained translations demonstrate DIP; truthful unsupported/unknown outcomes and replay tests address behavioral substitution. The independent consumer fixtures legitimately retain separate policy/receipt/effect data and independent expected outcomes, rather than sharing a financial transaction or deriving the oracle from the reducer.

Maintainability is strongest at those ownership and protocol boundaries. The complex reducer/runtime/store/recovery modules still require careful semantic review: bounded read-set validation, JSON-backed record decoding, lock order, history identities and lost-COMMIT behavior cannot be inferred from strict types or import graphs alone. The current focused fault/concurrency/replay/maximum-page evidence directly targets that risk. Larger files or a lower LOC total would not establish either a defect or a cure. No new speculative adapter framework, generic event bus, universal lifecycle manager, cursor abstraction or arbitrary file budget is justified by this audit.

The defensible delivery assessment is **a cohesive, reusable SDK for a deliberately bounded billing profile, with strong failure/recovery and package-boundary evidence, subject to the final current-source checks and explicit deployment admission gates**. A symbolic 10/10 or a production-capacity certification would conceal the genuine remaining qualification work.
