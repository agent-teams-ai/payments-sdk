# SDK 0.4: current source qualification and review

This record qualifies a specific reconstructed source. It does not transfer
earlier 0.2/0.3 results or the retained distribution's old qualification to new
maintained TypeScript. The [delivery plan](plan.md) records that recovery boundary.

## Exact subject

| Coordinate | Observed value |
| --- | --- |
| Local clean source | `40b37351e3b3d40587a2a5aa7f1f4699682a9660` |
| Published source | [`8732e38bf66d427668ae8976ad9d1982b9a76ce4`](https://github.com/agent-teams-ai/payments-sdk/commit/8732e38bf66d427668ae8976ad9d1982b9a76ce4) |
| Complete tree, independently read back after publication | `d871e8f08bafe42f494e17568c4424630231c314` |
| Actual GitHub author and committer | Both `User/777genius`, ID `13103045` |
| Delivery | [PR #10](https://github.com/agent-teams-ai/payments-sdk/pull/10) |
| Complete hosted Checks | [Run 39881560719](https://github.com/agent-teams-ai/payments-sdk/actions/runs/39881560719), successful PR run associated with the published head |
| Actual hosted checkout | Synthetic PR merge `815ee0671f3d1e26fef7447d8b0fb91e03dd6c84`; its complete tree equals the source tree above |

The connector creates actual GitHub-account commits, so its commit identity
differs from the local checkpoint. Exact Git-tree equality binds their file
contents. Local commit IDs alone are not claims of published Git ancestry.
Later documentation or workflow commits must retain this subject explicitly;
each later head still needs its own required hosted checks.

The hosted workflow uses GitHub's default pull-request merge checkout. Logs and
the actual Git object independently bind the tested merge to parents
`dcfadb0c199e69654b0aa25280f1b2a828b6d04f` and the published head above. Its exact
tree equality establishes the same source contents; the run is not described
as a direct head checkout or a successful main-push run.

## Complete qualification

Both clean-source `pnpm check` runs completed with exit 0 on Linux x64, pnpm
11.25.0, TypeScript 7.0.2 and a disposable PostgreSQL 18.4 instance with durable
transaction settings. Node versions were **24.22.1** and **26.12.1**. The same
four package archives were qualified on both floors.

| Native route | Passing cases per Node floor |
| --- | ---: |
| Published Get Modular layout/adoption | 16 |
| Tooling and architecture boundaries | 49 |
| Core and reconciliation | 58 |
| Official Paddle SDK contract fixtures | 18 |
| Get Modular composition/lifecycle | 15 |
| Real PostgreSQL and queue integration | 52 |
| Connected provider/financial/recovery E2E | 81 |
| Packed optional Observation | 4 |
| Installed alternate-queue profile | 4 |
| Installed financial/pg-boss profile | 2 |

Counts are per command, not a count of unique independent scenarios: the
boundary route also reaches the adoption cases. Full checks additionally
passed strict production/development compilation, Foundation source ownership,
source coverage, suppression governance and typed lint; runtime-security
regression; Drizzle artifact/declaration qualification; strict NodeNext and
Bundler consumers; three production-only npm dependency profiles; and release
dry-run. `skipLibCheck` remains false.

The source-bound hosted run independently passed `build`, `quality`, both Node-floor
`scenarios` jobs and the aggregate `Required checks`. Its elapsed wall-clock
interval was approximately three minutes; this is one observed run, not a
performance guarantee. It builds once and distributes the resulting artifacts
to parallel gates. [Workflow](../../../.github/workflows/checks.yaml).

Compact machine-readable inputs, archive identities, local log hashes and
hosted job coordinates are in [qualification.json](qualification.json). Local
log hashes identify retained session evidence; the accessible hosted run and
its logs/artifacts are the independent remote result.

## Independent review and fixes

These are fresh scoped GPT-6.1-sol xhigh reviews of this source and its changes.
The earlier implementation plan's four-wave design journal remains historical;
it is not presented as a fresh four-wave implementation qualification.
Focused probe counts below summarize the independent reviewers' reported
executions; they are distinct from the reproducible native-suite counts above.

| Reviewed concern | Finding and resolution | Independent evidence |
| --- | --- | --- |
| Financial observation merge | Equal-version arrays were compared without order but partially merged by position. Reordered incomplete subscription items could certify an invented contradictory quantity and retain a false conflict. Shared stable-identity matching now merges only a bijection; ambiguous/missing/duplicate IDs accept exact semantic replay without guessing a partial match. | The critic reproduced the failure in the retained old oracle, ran 58 core/reconciliation cases and 2,304 mixed partial/permutation probes across transaction, subscription and adjustment arrays, and checked actual Paddle normalization. Four regressions fail against the old behavior. |
| Architecture and published Get Modular | The ambient-effect guard could accept `new Date(...([] as []))`, which reads the current clock despite a syntactic argument. A definite ordinary first argument is now required. | Seven FMS cases plus six independent probes reject empty spreads and retain explicit timestamp/date conversions. Public Assembly/Resources and real Observation lifecycle/drain paths were reviewed. |
| Release instructions | The maintained release guide still selected 0.3.0 while package manifests selected 0.4.0. | Eighteen current examples were updated and checked against all four manifests/archive names; historical release evidence stayed unchanged. |
| Paddle, PostgreSQL and interchangeable queues | No remaining P1/P2 was found in the independently reviewed uncertainty, signature/acquisition, transaction ambiguity, recovery, exact ACK, dependency isolation and connected subscription/credit paths. | Read-only semantic review of the exact clean tree and independent financial expectations. This reviewer did not claim to have rerun the parent's complete suites. |

The first array-regression draft imported a private helper. The full Foundation
gate rejected it. The final regression exercises the public store/provider
contracts instead, without weakening the boundary. Its old-behavior failure
and final passing behavior were independently verified.

The matching fix preserves genuine certified conflicts and immutable completed
financial facts. It does not automatically erase previously persisted false
certifications. [Migration 0.4](../../migrations/0.4.md) requires owner-audited
recovery from original receipts for such historical records.

## Architecture and dependency guarantees

Full immutable FMS v1.1 is adopted for every production source root in all four
packages, with no package exception. Application/domain boundaries do not
import Paddle, PostgreSQL, Drizzle, queues or Get Modular. Public application
snapshots are detached from custody records; provider and store SPIs have
separate public entrypoints. Selection versions are opaque, target-bound and
checked against current complete state; possession does not grant authority.

The PostgreSQL adapter remains PostgreSQL-specific. Private Drizzle schema and
query compilation do not make PostgreSQL transactions, locking, durable commit
behavior or migrations portable to another database. A different database
implements the core store contract and qualifies those guarantees separately.
The generic PostgreSQL root requires neither `pg` nor `pg-boss`; hosts opt into
the `/node-postgres` and `/pg-boss` adapters and install their optional peers.
Real production-only npm installations test that distinction.

Queue substitution uses the payment owner's transaction-bound enqueue and
worker contracts. The shipped pg-boss implementation and an independently
implemented durable SQL test transport exercise the same store/runner. A remote
broker would need an adapter-owned transactional outbox and equivalent recovery
semantics; changing an import alone does not create those guarantees.

Paddle-specific acquisition, authentication, SDK entities, errors and
normalization stay in `payments-paddle`. A different provider implements the
provider contract and its observation mapping. A foreign-vocabulary fixture
already drives initial purchase, renewal, one-time credits and durable replay
through the same core; it is not a production adapter for another provider.

## Production code size

The [complete measurement](production-loc.json) binds its inputs and each
included/excluded file to the source above. The explicitly defined TypeScript
7 AST method counts statements/declarations, module directives and type
signatures independently of formatting. It excludes tests, fixture owners,
tools, examples, generated output and declaration-only repair code.

| Package | Production files | Logical units | Physical noncomment lines |
| --- | ---: | ---: | ---: |
| payments-core | 34 | 2,514 | 2,826 |
| payments-paddle | 6 | 546 | 472 |
| payments-postgres | 22 | 2,247 | 2,530 |
| payments-get-modular | 29 | 271 | 388 |
| **Total** | **91** | **5,578** | **6,216** |

The logical total comprises 3,933 runtime statement/declaration units, 385
module directives and 1,260 type/signature units. It is a defined code-size
measurement, not a complexity or architecture-quality score. SQL inside
strings contributes physical lines but not extra TypeScript AST statements.

## Central activation and remaining admission

The owner accepts actual `777genius` associations for both source roles,
including the profile's Cyrillic display name. The old identity implementation
requires a raw name and is incompatible with those commits. Its replacement
also needs the live central policy to be installed; changing a consumer pin
alone does not activate that policy.

Central [PR #380](https://github.com/agent-teams-ai/.github/pull/380) owns the
association policy. [PR #381](https://github.com/agent-teams-ai/.github/pull/381)
owns bootstrap enforcement, compatible caller adoption and the integrated
pending registration from [PR #382](https://github.com/agent-teams-ai/.github/pull/382).
The separately reviewed [source successor](https://github.com/agent-teams-ai/.github/pull/383)
prepares the bounded protected transition. Its review branch does not install
a source lock, qualify hosted canaries or change active required checks.

Registration, `configured_not_qualified` observations, exact-head native CI,
protected-source admission and installed enforcement are different states.
Central administrative activation remains a prerequisite to completing this
rollout and merging the SDK with compatible automation. Existing protections
are retained. No fabricated status, skipped gate or merge bypass is evidence.

No real Paddle credentials/payment, npm publication, successful merged-main
run, production credit ledger, physical restore/PITR or deployment HA guarantee
is established by this record. The supported mock scenarios and separate
account/deployment gates remain in [qualification](../../qualification.md)
and the [subscription/credits matrix](../subscription-credits-e2e-matrix.md).
