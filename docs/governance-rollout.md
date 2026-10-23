# SDK source delivery and central governance activation

Recorded: 2026-10-23. This document separates two independently testable delivery
boundaries; it does not waive the owner's full Feature Module Standard requirement.

## SDK source delivery

The reviewed 0.4 SDK implementation, complete FMS profile, explicit public
contracts, Foundation checks, dependency isolation, Get Modular lifecycle and
Paddle/PostgreSQL/queue scenarios can be integrated without changing GitHub
rulesets or depending on activation of the central identity successor.

The implementation and native check definitions are taken without modification
from source `5c8fde52f9e80410318af11c1e68dd7ed2ddeb38`, tree
`0ac938332a2582dcf192c05905f7ee351fe2e98a`, in
[PR #10](https://github.com/agent-teams-ai/payments-sdk/pull/10).
That source already includes current main
`68157bc492cadbd61d05ff087768fc5e9fd1c0b3` and its ReviewRouter workflow.
The source-delivery delta consists only of this explanation, README navigation,
and deferral of the two proposed central workflow callers below.

The active `checks.yaml`, its complete prerequisites and `Required checks`
aggregator are unchanged. No FMS/source root, fixture, assertion, native gate,
GitHub protection, permission or required status is removed or weakened. The
full source must pass fresh exact-head PR checks and independent main-push
checks after merge. Earlier results remain bound to their original revisions.

The owner has explicitly approved source author and committer account
associations with the actual human `777genius` account. This source delivery
uses that approved attribution and preserves external authorship. It does not
assert that the central raw-name policy has already been replaced.

## Central activation remains a separate open task

These two proposed callers are **not installed on the current main**:

- `.github/workflows/commit-author-identity.yml` at identity implementation
  `1f8dc7a2ee33e3cc3810f0c4c2d5e9f3f20241d0`;
- `.github/workflows/repository-admission.yml` at admission wrapper
  `5ad75e5f327603923ec8a3a8d71a91d24b5b50e9`.

Their exact reviewed bytes remain in PR #10; the source delivery does not install
a caller whose required central policy has not been activated. This is staged
installation of new checks, not removal of an existing protected-main gate.
The package's `repositoryAdmission: 1` opt-in remains, as do all native full-FMS
checks. A later central observer may correctly report missing activation until
the deployment below is completed; that finding must not be hidden or marked
qualified merely because the SDK source is merged.

Central [PR #380](https://github.com/agent-teams-ai/.github/pull/380) owns the
account-association policy. Central
[PR #381](https://github.com/agent-teams-ai/.github/pull/381) owns repository
bootstrap and pending registration, including the work from closed PR #382.
The review-only [source candidate #383](https://github.com/agent-teams-ai/.github/pull/383)
is bound to an older central base; it must not be activated unchanged or merged
into #380. Preserve its historical evidence.

Remaining deployment order:

1. Reconcile and review the central identity change against the then-current
   main; qualify a successor source for that exact tuple.
2. Use an explicitly authorized administrative connection to create and read
   back the immutable source lock, execute genuine positive and protected-input
   negative canaries, and perform the reviewed add-before-remove transition.
   Do not forge predecessor status, disable protection or use merge bypass.
3. Complete the central identity/bootstrap PRs, refresh their exact pins, then
   install both canonical Payments callers through a separate reviewed PR.
4. Observe the real identity status, admission result, registration and required
   checks before claiming organization-wide enforcement or admission.

The available source-writing connector does not expose ruleset administration.
No interactive token, unrelated service credential or workflow token is
repurposed to acquire that permission. Account approval is already given;
repeat consent is not the missing execution capability.

## Claims and release boundary

A merged and tested SDK source is not complete organizational admission,
production deployment qualification or npm publication. Pending registration,
Docs Protocol/Cohort, authenticated complete inventory and remote protection
remain explicit until supported by their own evidence. Real Paddle account
qualification, commercial credit policy and deployment/backup/restore gates
also remain unchanged. See [qualification](qualification.md),
[full FMS adoption](feature-module-adoption.md) and
[0.4 migration](migrations/0.4.md).
