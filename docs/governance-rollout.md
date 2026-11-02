# SDK source delivery and central governance activation

Updated: 2026-11-02. SDK behavior, repository bootstrap configuration and remote
required-check enforcement have separate evidence boundaries.

## Installed source contract

SDK 0.5 source and its full FMS/native gates were delivered through
[PR #20](https://github.com/agent-teams-ai/payments-sdk/pull/20).
[PR #21](https://github.com/agent-teams-ai/payments-sdk/pull/21) installed the
canonical identity caller at `77a0f46cbfc7688cbabbe12ee819e50ba6f64234`.
The canonical owner email is `iliyazelenkog@gmail.com`; accepted raw names are
`iliya` and `Илия`. The broader account-association candidates from central
PRs #380/#383 are historical proposals, not the installed identity policy.

This delivery installs the canonical inputless Repository admission caller at
central `eb3a3af9d14c7b65387a0f6809c3f45a4300ff6a`, delivered through
[central PR #405](https://github.com/agent-teams-ai/.github/pull/405).
The reusable workflow checks out its own defining `job.workflow_sha`, binding
the wrapper, inspector and frozen central dependency graph to that immutable pin.
It reads consumer configuration as inert files and executes no consumer command.
It recognizes only the reviewed development-only Stack 0.1.1 presets and rejects
conflicting ordinary, optional or peer dependency declarations.

The central protected-source change was qualified through immutable source
`132e5b54218c6888f2fdaf671103aaba95d22f14`, protected by ruleset `26361080`.
Its [source qualification](https://github.com/agent-teams-ai/.github/actions/runs/41435060837),
[positive canary](https://github.com/agent-teams-ai/.github/actions/runs/41435827377)
and [protected-input negative canary](https://github.com/agent-teams-ai/.github/actions/runs/41435862709)
bind their exact source, target and run attempts. The negative was rejected for
changing the protected inspector. Both central canary PRs were closed without
merge. Required-check transitions retain a source requirement throughout and
never bypass the protected-source gate.

## Remote enforcement and observed qualification

The existing `Required checks` aggregator, strict native branch protection,
full FMS profile, source coverage, compiler settings and SDK scenarios remain
unchanged. Identity ruleset `26360970` was separately installed and read back
with GitHub Actions App `15368`, strict enforcement and no bypass actors.

Repository admission requires the exact check `admission / repository-admission`
from that same App. Its installation, positive and spoofed-preset negative
results, required blocking proof and post-merge main runs are recorded in the
Payments caller installation PR. A caller file alone is not evidence that the
remote requirement exists or that a hosted run succeeded.

The successful configuration result remains **configured_not_qualified**. It
establishes the supported configuration and gate wiring at the inspected bytes;
native SDK tests establish their own behavioral guarantees. Earlier trials stay
bound to their recorded revisions and are not reused as main installation proof.

## Remaining independent boundaries

Central pending registration observations, Docs Protocol/Cohort admission,
complete authenticated inventory, production deployment and npm publication
retain their own qualification records. This workflow installation does not
promote those records. Real Paddle-account qualification, commercial credit
policy, backup and restore gates are also separate. See
[qualification](qualification.md), [full FMS adoption](feature-module-adoption.md)
and the [0.5 migration guide](migrations/0.5.md).
