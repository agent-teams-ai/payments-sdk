# Captured development commands

The workspace uses **`node-or-bun` 0.2.2** as a development dependency in the
existing `tools/package-artifacts.ts` helper. The Node adapter is selected
explicitly at that tooling boundary. Packaging, archive admission, strict
consumer qualification and release preparation await that one helper; no
second command abstraction or runtime auto-detection was introduced. Engineering
Foundation already carried its own transitive 0.2.1 pin; that dependency remains
unchanged, and this adoption adds payments-owned direct use of 0.2.2.

This is a tooling adoption. None of the four published SDK packages imports or
declares `node-or-bun`. Archive admission rejects it in published dependency or
peer dependency declarations, and packed plain-core and production npm consumer
probes require it to be absent. The SDK's qualified Linux Node versions,
TypeScript minimum and [production runtime security blocker](security-qualification.md#node-bundled-transport-scope)
remain unchanged. No Bun runtime qualification is claimed.

## Selected artifact and source

The official [npm version metadata](https://registry.npmjs.org/node-or-bun/0.2.2)
and [registry channels](https://registry.npmjs.org/node-or-bun) were read on
**2026-10-20**. Both `latest` and the newest published stable version were
**0.2.2**, published at **10:26:38.805 UTC**. The exact archive matched its
registry SHA-512 integrity. Its byte count, SHA-256, SRI and source identity are
retained in [the tooling artifact record](../qualification/tooling/artifacts.json).
The actual manifest has zero runtime dependencies and admits both qualified
Node floors through `^24.18.0 || ^26.0.0`.

The artifact identifies
[source commit `2a0bbac6f80705e0b06e7eaeddf47439465b5646`](https://github.com/agent-teams-ai/node-or-bun/commit/2a0bbac6f80705e0b06e7eaeddf47439465b5646).
The npm provenance statement payload names that same commit, the official
repository's release workflow and the downloaded archive's SHA-512 digest.
This read-back compared the payload; it did not independently verify the
attestation signatures. The inspected current main revision was
[`3e6a1c44195680761787e4377fc560dd0f22e223`](https://github.com/agent-teams-ai/node-or-bun/commit/3e6a1c44195680761787e4377fc560dd0f22e223).
The [source comparison](https://github.com/agent-teams-ai/node-or-bun/compare/2a0bbac6f80705e0b06e7eaeddf47439465b5646...3e6a1c44195680761787e4377fc560dd0f22e223)
changes release infrastructure, tests and release documentation; it changes no
library source or package manifest. The official repository returned no
[open pull requests](https://github.com/agent-teams-ai/node-or-bun/pulls)
and no [GitHub release objects](https://github.com/agent-teams-ai/node-or-bun/releases)
at this read-back; npm publication is established separately above.

## Command policy and limits

The helper retains the existing command policy: an executable plus literal argv,
current environment and explicit working directory; no shell; captured stdout
returned only after a successful zero exit; nonzero and signaled exits rejected;
**120,000 ms** deadline; **4 MiB per stream** capture bounds; no automatic retries.
The library's replacement UTF-8 decoding matches the previous helper policy.
Successful stderr remains separate from returned stdout. Nonzero exit assertions
retain both bounded streams and the observed signal for diagnostics.

The [upstream process contract](https://github.com/agent-teams-ai/node-or-bun/blob/2a0bbac6f80705e0b06e7eaeddf47439465b5646/docs/process-contract.md)
owns lifecycle coordination and bounded capture. Native `ProcessRuntimeError`
values propagate unchanged, preserving the initiating cause, observed exit,
late failure codes, incomplete custody and nullable bounded output. A timeout,
output overflow or cleanup failure cannot become a partial success. The helper
does not log runtime-error output or retry a failed command.

The default Node adapter cleans up its **direct child**, including TERM/KILL
escalation; it does not promise descendant-tree or detached-child containment.
The deadline initiates cleanup rather than proving immediate process-tree
termination. Capture reaching forced close after the EOF deadline rejects with
an honest cleanup error. These are development command guarantees, not payment
mutation cancellation or production runtime guarantees.

`tools/run-tests.ts` keeps inherited stdio and signal forwarding because its
streaming contract is outside this captured-command API. The intentional
`spawnSync` negative compiler probe in `tools/qualify-drizzle.ts` keeps its
independent expectation of exit 1 and exact diagnostics. No cancellation option,
new CLI surface, supervisor or platform abstraction is added.

## Qualification

The native fixture suite exercises literal shell metacharacters, cwd and
inherited environment, separate captured streams, numeric nonzero exit, signal
termination, missing-executable cause preservation and bounded overflow. Archive
fixtures also reject development tooling in public runtime declarations.

The strict `.ts` tooling project compiles with **TypeScript 7.0.2** and
`skipLibCheck:false`. Focused local evidence and actual packaging results are
recorded in [the scoped review record](reviews/node-or-bun-adoption.md); the final integrated commit still
requires its owning full Checks run. This evidence does not qualify Bun,
other platforms, a production deployment or an npm publication of payments.

The same [artifact record](../qualification/tooling/artifacts.json) also retains
**oxlint-tsgolint 7.0.2001**, the exact compatible lint-tooling pin requested for
Engineering Foundation and installed Oxlint 1.83.0. The registry's `latest` was
**7.0.2004** at read-back; the selected profile is deliberate and is not described
as the newest stable release. Its official archive also matched registry SRI.
