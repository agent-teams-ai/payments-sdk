# Independent architecture and implementation reviews

The design and implementation each receive four waves of four independent
GPT-6.1-sol reviewers at xhigh reasoning effort. Reviewers use isolated checkouts
and identify their exact frozen revision. Implementers fix accepted findings in
separate commits and retain meaningful regression scenarios.

Reports are historical evidence about their stated revisions. A request for
changes in an old report does not describe the current implementation; the
disposition below identifies its correction. Paths to scratch review worktrees
inside the original reports record how a probe was obtained. The maintained
regressions are in this repository's core, SDK, PostgreSQL and E2E suites.

## Design review

All four design waves are complete. Their accepted decisions are incorporated
in the frozen [implementation plan](../implementation-plan.md).

| Wave | Four independent reviews |
| --- | --- |
| 1 | [Architecture](design/wave1-architecture.md), [money](design/wave1-money.md), [provider](design/wave1-provider.md), [integration](design/wave1-integration.md) |
| 2 | [Contracts](design/wave2-contracts.md), [storage](design/wave2-storage.md), [consumers](design/wave2-consumers.md), [architecture](design/wave2-architecture.md) |
| 3 | [Money](design/wave3-money.md), [operations](design/wave3-operations.md), [provider and security](design/wave3-provider-security.md), [integration](design/wave3-integration.md) |
| 4 | [Money](design/wave4-money.md), [operations](design/wave4-operations.md), [provider](design/wave4-provider.md), [integration](design/wave4-integration.md) |

## Implementation review status

| Wave | Four independent reviews | Disposition |
| --- | --- | --- |
| 1 | [Core](code/wave1-core.md), [Paddle](code/wave1-paddle.md), [consumers](code/wave1-consumers.md), [platform](code/wave1-platform.md) | All ten accepted findings corrected |
| 2 | [Domain](code/wave2-domain.md), [consumers](code/wave2-consumers.md), [Paddle](code/wave2-paddle.md), [PostgreSQL and recovery](code/wave2-postgres.md) | All seven accepted findings corrected |
| 3 | [Domain](code/wave3-domain.md), [consumers](code/wave3-consumers.md), [platform](code/wave3-platform.md), [provider](code/wave3-provider.md) | All five accepted findings corrected |
| 4 | [PostgreSQL](code/wave4-postgres.md), [platform](code/wave4-platform.md), [consumers](code/wave4-consumers.md), [domain/provider](code/wave4-domain-provider.md) | All four accepted findings corrected and independently rechecked |

### Wave 1 corrections

| Accepted finding | Correction commits | Maintained regression |
| --- | --- | --- |
| A late old result released a newer operation's subscription lane | d17f0c3 | PostgreSQL durability: late old checkout and newer unresolved cancellation |
| An audited retry could change its provider subscription target | 6e2105b | Core cancellation and payment-update retries retain pinned subjects |
| A known customer ownership mismatch did not block mutations | b6cdb60, fbf3cd6, 77bca03 | Core authority acquisition and exact read-set CAS before dispatch |
| Refresh replaced the receipt's retained representation | 20f83e5 | Core and actual-SDK PostgreSQL refresh custody/digest tests |
| Raw/API receipts bypassed shared event identity contradictions | 096ac7d, dae818e | Core and actual-SDK PostgreSQL compatible-partial and both-route conflict tests |
| A first unrouted held message failed to fence an older complete message | e27281a | Both independent consumers retain source fences before routing |
| Initial and recurring transactions created separate grants for one paid period | efabb89, 0e605aa, ae4b656 | Shared exact-period basis plus initial-intent guard in both hosts |
| Packed adapters resolved a registry core instead of the current tarball | f2f66ce | Strict plain/adapters × NodeNext/Bundler installed consumers |
| Package license metadata disagreed with the archive contract | f2f66ce | All four Apache-2.0 archive audits |
| Get Modular omitted the audited stream-selection capability | d87a684 | Real released GM capability surface and lifecycle tests |

### Wave 2 corrections

| Accepted finding | Correction commits | Maintained regression |
| --- | --- | --- |
| A newly retained stale ownership restriction was not published | 09f1de9 | Core acknowledged subscription receives a higher held revision |
| Newer watermarks hid contradictions in older exact versions | b1feb6c, 64242b3, e0e5d8c, 0d1078a | Core and PostgreSQL historical version evidence after restart and ACK |
| Audited payment-update success omitted its durable transaction purpose binding | ae7cadf | Shared successful-outcome proof and invalid-proof rejection |
| Equivalent timestamp spellings created two paid-period identities | 80f28a3 | Both hosts, both orders, exact fractional/offset aliases and distinct adjacent nanoseconds |
| A→B→A support transfer treated historical issuance as current allocation ownership | 86b7486, 4b4a398, 401e2fc | Actual SDK unknown outcome, accepted-risk retry and conserved reentrant allocation |
| Future unsupported financial event names lost known entity routes | bff9726 | Signed raw and actual GenericEvent receipts publish higher unsupported evidence |
| Partial worker startup forgot physically unresolved SDK work | 6064c53 | Real PostgreSQL delayed registration fault retains status/drain ownership |

The startup finding is a qualified fault-path lifecycle defect: the reproduction
injects a delayed second worker registration failure. It does not establish that
ordinary pinned pg-boss registration performs a database wait or automatically
duplicates an external charge.

Additional integration correction: 6a5d297 makes the PostgreSQL scan-page bound
match the supported 200-member Paddle/core page contract. Actual SDK pages of
101 and 200 members, rollback of all custody plus cursor, and 400 old/new routing
locks are covered. Ordinary storage batches remain bounded at 100.

### Wave 3 corrections

| Accepted finding | Correction commits | Maintained regression |
| --- | --- | --- |
| Changed duplicate-initial knowledge or stream selection left old renewal evidence stale | c4f1966, 596f5d8, 1b71f8b, a29ae94, 69f595a, b4048b8 | Durable bounded reclassification, 205 acknowledged renewals, restart, cursor/selection race and deleted queue jobs |
| An exact-version adjustment parent contradiction held only the new parent | 596f5d8, 1b71f8b, a29ae94, b4048b8 | Memory and real PostgreSQL load both parent read sets, reject stale CAS and retain immutable historical facts |
| A matching reversal pair hid an additional unmatched reverse | 5b34582 | Actual SDK, both hosts and both arrival orders retain a whole-snapshot correlation hold |
| Subscription normalization discarded quantity and collection mode, certifying unsupported or incomplete current profiles as clean | a4504f6, cc27a4b | Actual SDK plus PostgreSQL/access scenarios retain quantity, collection, cycle and trial presence; supported newer recovery preserves historical controls |
| An unknown transaction status republished an old immutable completion without an explicit current hold | a4504f6, cc27a4b | Closed neutral status meaning; signed raw and authenticated GET holds, stale/newer recovery and independent historical controls on both Node floors |

The original eight provider counterexamples pass unchanged on both Node floors.
The maintained `provider-profile.test.ts` suite adds positive known statuses and
supported lifecycle/recovery checks. An unknown future transaction status is a
decoder robustness scenario, not a claim about a currently emitted Paddle status.

The platform reviewer established no additional P0/P1/P2 at the documented
release candidate revision. Final merged-source and live CI qualification remain
separate gates.

### Wave 4 corrections

| Accepted finding | Correction commits | Maintained regression or verification |
| --- | --- | --- |
| Ordinary renewal processing reopened unchanged reclassification quarantine and bypassed its persisted cooldown | 91138aa, e7803e3, 4d468eb | Exact persisted disposition/deadline, audited redrive, direct new-generation replacement and overlapping claims with the same attempt number |
| Historical adjustment reparenting omitted the original parent's T1 fence before its already prepared publication T2 | 91138aa, e7803e3, bb5376c, 054a20b | Both-parent T1 and cleanup, first-certification lock race, 200-member page with enforced lock bound/rollback, pending duplicate enrichment and processed duplicate idempotency |
| The documented unpublished tarball installation tried to resolve internal packages from npm | 70db2ef in the documentation/release PR | Both fresh hosts install using the documented commands/configuration directly; runtime imports and strict NodeNext/Bundler pass on both Node floors |
| Access accepted an uncorrelated reversed adjustment and rejected the later qualified restoration pair | f560818, 560c75b | Pure fixture-owned whole-snapshot qualifier shared by independent owners; actual SDK in both hosts, restart/replay, positive restoration and independent security restriction |

The domain/provider reviewer established no additional P0/P1/P2 at its frozen
revision. The original reports retain their own exact subjects and boundaries.

### Independent remediation rechecks

All four reviewers independently rechecked the integrated correction candidate
`7e648f1674db14b6e1f7ee8b795516f38bdcb4a0`. Each retained its historical report and
recorded new execution evidence separately. All accepted findings are closed;
the bounded follow-ups established no new actionable P0/P1/P2.

| Reviewer | Independent correction evidence |
| --- | --- |
| [PostgreSQL](code/wave4-postgres-remediation.md) | Original three fault/admission oracles, eight maintained correction cases and memory parity on both Node floors; runtime-role check |
| [Consumers](code/wave4-consumers-remediation.md) | Original public SDK regression through both hosts and complete 52-test E2E group on both Node floors |
| [Platform](code/wave4-platform-remediation.md) | Fresh current archives installed using the guide verbatim, public runtime imports, eight strict consumer combinations and one physical Resources identity |
| [Domain/provider](code/wave4-domain-provider-remediation.md) | Independent pending/processed admission, exact custody/cardinality and retained-control probes plus existing SDK/profile/late-outcome compatibility on both Node floors |

The subsequent report and status commits before the supplemental dependency correction update documentation only. CI still qualifies
each exact release candidate independently. The [final upstream read-back](upstream-delivery-status.md)
records official publication/source status through 2026-10-19 21:00:05 UTC.

## Supplemental dependency and runtime security qualification

The post-merge dependency analysis identified development-scoped Undici alerts.
The [independent security dependency review](security-dependency-review.md)
accepts correction `7762830fe904f95e3b6126aaad81be8366ba755a` to **7.30.1**
after actual SDK checks on both Node floors, strict installed consumers and an
unchanged production dependency closure. It supplements the completed four waves.

The separately retained [Node runtime investigation](node-runtime-security-research.md)
establishes that the development package correction does not patch the built-in
production transport. Production runtime admission remains blocked; the
[current security record](../security-qualification.md) owns the dated evidence,
functional prerelease boundary and requirements for admitting an official fix.

An additional [independent release-admission review](prerelease-security-admission-review.md)
accepts exact disclosure/generator revision
`ad3f8bcf5125904beb3cf416e2ff266fb2b558db` for merging and functional GitHub
prerelease delivery through the required exact-commit CI gates. It explicitly
rejects production runtime/security admission until the upstream correction is
published and qualified. This report/index-only successor preserves that
decision and still needs its own final main-push CI.

## Qualification boundaries

Tests use the real pinned SDK's public HTTP mapping with synthetic responses and
no live Paddle credentials, real PostgreSQL, and the real published Get Modular
runtime. A physical Paddle sandbox checkout, payment and account configuration
remain deployment qualification. Logical independent-owner restore fixtures do
not establish physical WAL/PITR or an HA promotion guarantee.

The user authorized repository creation, PRs, independent agent reviews and
merges. Main requires the final aggregate CI check and an up-to-date PR; force
push and deletion are disabled. Independent agent reports are the requested
review process, without inventing human GitHub approvals.

