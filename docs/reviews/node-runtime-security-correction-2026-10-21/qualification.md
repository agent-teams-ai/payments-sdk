# Complete local qualification of the queue and runtime correction

## Result and exact subject

On **2026-10-21**, canonical local commit
**6f348df2d345edf5270ade0daebf67cc834de2de**, Git tree
**8de7807f3fc4f1aa08d3a1df8fbeb661635d9832**, passed frozen installation, a
fresh forced TypeScript build and the complete **pnpm check** on official Linux
Node **24.22.1** and **26.12.1**. Both commands exited zero. The source commit
and tracked files remained unchanged throughout both runs.

Each run used its own fresh PostgreSQL **18.4** database with **fsync=on** and
**synchronous_commit=on**. The two complete runs were serialized; normal Node
test-file concurrency within every group remained enabled. No required check,
strict compiler option, timeout budget or failure oracle was disabled.
Both disposable databases were removed after successful qualification and a
zero-active-session check; the shared PostgreSQL server was preserved.

The source includes the queue fixture correction
**fa3144801a410aa9eb6b3e2d5a67de3e5fd89f0b** and the corrected-runtime commit
**6f348df2d345edf5270ade0daebf67cc834de2de**. Their local parent
**d7275165df42aa83623e280513c26c9721fa85ac** has exactly the tree of merged
[PR #6](https://github.com/agent-teams-ai/payments-sdk/pull/6), main commit
[17dde3d75ac1e4e3a3218b236fca3f8a4d1ada7b](https://github.com/agent-teams-ai/payments-sdk/commit/17dde3d75ac1e4e3a3218b236fca3f8a4d1ada7b):
**601be0a727b55a27fd851c49315ae0cc3477e236**. Local and remote commit identity
are not interchangeable; the prior plugin delivery verified tree equivalence.

This report is a subsequent documentation/evidence addition. It does not claim
that its own later commit executed these commands. The subsequent report changes
no runtime source, declaration, test, tool, manifest, workflow, lockfile or
packaged README. The retained package identities belong to the tested source;
final-head hosted qualification must establish its own result and archive identities.

## Complete gates

These are reported test case counts including parent/subtests. They are not
counts of unique customer stories. The 11 adoption cases also run inside the
32 boundary/tooling cases, and financial cases intentionally run again against
isolated installed package consumers.

| Gate | Node 24.22.1 | Node 26.12.1 |
| --- | --- | --- |
| Frozen installation and forced build | Pass | Pass |
| Toolchain, all strict projects, typed lint, selected complete Foundation profile | Pass | Pass |
| Unmodified built-in fetch regression, actual normal child exit | Pass | Pass |
| Scoped Get Modular adoption | 11/11 | 11/11 |
| Boundary/tooling rejection cases | 32/32 | 32/32 |
| Core | 49/49 | 49/49 |
| Official Paddle SDK adapter | 18/18 | 18/18 |
| Get Modular runtime | 13/13 | 13/13 |
| PostgreSQL integration/fault/recovery | 49/49 | 49/49 |
| Connected E2E | 81/81 | 81/81 |
| Packed Observation | 4/4 | 4/4 |
| Packed custom SQL queue without pg-boss | 4/4 | 4/4 |
| Packed financial oracle and explicitly selected pg-boss | 2/2 | 2/2 |
| Three npm profiles, strict NodeNext and Bundler | Pass | Pass |
| Packed pnpm consumers, Drizzle admission and release dry-run | Pass | Pass |

Every reported test group had zero failed, cancelled, skipped or todo cases.
The complete-check stages took **155.868 seconds** and **147.287 seconds** in
this local environment. These are observed durations, not promised CI bounds.

The npm profiles cover an ordinary production install of the generic PostgreSQL
root without pg, its declarations or pg-boss; an explicitly selected pg driver
with an independent durable SQL transport and no pg-boss; and all public
entrypoints with the explicitly selected optional peers. Both resolution modes
retain strict declarations and **skipLibCheck:false**. The consumers use the
original official unpatched Drizzle artifact.

The [subscription/credit matrix](../subscription-credits-e2e-matrix.md) owns the
five new connected stories through two host compositions. Those stories remain
part of the 81-case E2E group, rather than an extra unrecorded suite. The official
Paddle SDK uses network-controlled synthetic API replies and signed raw ingress;
the payment store and separate fixture access/credit consumers use real PostgreSQL.

## Retained evidence and reproduction

- [Machine-readable qualification and file digests](full-qualification.json).
- Node 24: [exact metadata](local-evidence/24.22.1/full-check-node-24.22.1.json)
  and [complete command log](local-evidence/24.22.1/full-check-node-24.22.1.log).
- Node 26: [exact metadata](local-evidence/26.12.1/full-check-node-26.12.1.json)
  and [complete command log](local-evidence/26.12.1/full-check-node-26.12.1.log).
- Each evidence directory also retains npm profile reports, ordinary package
  locks, strict compiler file graphs, Observation/Drizzle reports, package
  identity digests and the release dry-run result.
- [Official artifacts and source comparison](README.md),
  [actual positive/rejecting runtime probes](probe-results.json), and
  [independent runtime review](reviews.md).
- [Queue failure, controlled reproductions and exact correction](../main-ci-queue-fixture-correction-2026-10-21.md).

For each corrected official Node binary, use an otherwise unchanged clean
checkout of the tested source, pnpm 11.25.0 and a fresh disposable PostgreSQL 18
database. Set DATABASE_URL to that database and
AGENT_TEAMS_FOUNDATION_NODE_EXECUTABLE to the exact selected Node executable;
ensure PATH selects the same executable. Run:

```sh
pnpm install --frozen-lockfile
pnpm exec tsc -b --force
pnpm check
```

The retained logs identify the actual command chain and all required gates.
Local registry access used the existing environment proxy through
NODE_USE_ENV_PROXY=1; package registry URLs and integrity assertions were unchanged.
The local runner used TAR_OPTIONS=--no-same-owner for archive extraction. These
are execution-environment settings, not source or verification relaxations.
Separate fresh databases prevent the two qualification subjects from sharing
test state. Large reproducible package archives are represented by their retained
identity records; the evidence does not claim that an npm publication exists.

## Hosted and publication status

PR #6's [exact-head required checks](https://github.com/agent-teams-ai/payments-sdk/actions/runs/39597496949)
passed and the PR merged. Its subsequent
[main-push checks](https://github.com/agent-teams-ai/payments-sdk/actions/runs/39598027818)
failed in the Node 26 queue-loss fixture and remained at attempt 1. The
correction above does not rewrite that failed run or turn its skipped later
steps into passes.

**This follow-up is locally complete and reviewed; publication, its own
exact-head hosted Checks and a subsequent merged-main result remain pending.**
The prior explicit GitHub-plugin source-metadata/owner-merge exception was scoped
to PR #6. The connector cannot set canonical source author/committer metadata,
so a new PR needs the corresponding owner workflow decision. No branch
protection, required check or authorship policy has been changed to bypass that
boundary. A prepared patch and PR description do not establish a remote PR.

## Qualification limits

The [current runtime admission record](../../runtime-security-admission.md)
distinguishes the reproduced built-in fetch correction from complete Node
security certification. Independent review and these two full local runs are
complete; reviewed exact-commit hosted evidence and the separately owned
[account and deployment gates](../../qualification.md#deployment-and-credential-gates)
remain required. No live Paddle charge or account behavior, production credit
ledger, second production database/driver/broker, physical PITR/HA, npm
publication or production deployment is established by these fixture results.
