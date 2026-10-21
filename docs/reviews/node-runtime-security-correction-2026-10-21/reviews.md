# Independent review of the corrected-runtime candidate

## Exact reviewed subject and scope

Independent critic: **GPT-6.1-sol / xhigh**, task `main_ci_failure_critic`. The review was read-only and covered the corrected runtime candidate integrated in canonical local commit **`6f348df2d345edf5270ade0daebf67cc834de2de`**, tree **`8de7807f3fc4f1aa08d3a1df8fbeb661635d9832`**, following the separate queue correction **`fa3144801a410aa9eb6b3e2d5a67de3e5fd89f0b`**. The critic reported final approval before the canonical commit; the reviewed critical file blobs below match that committed source. This record summarizes the actual review messages and probes; it does not invent a GitHub approval or claim a later documentation successor was tested.

| Reviewed file | Git blob |
| --- | --- |
| `tools/runtime-security-probe.ts` | `4cb760580da1b43719e8dd9cfee23ed3d578ddce` |
| `docs/runtime-security-admission.md` | `83ca58794ad249f9a090f26c8dae178adc46d7b4` |
| `docs/qualification.md` | `fcc21fbed5b4741430057b90931b86eddfda76a1` |
| `tools/release-candidate.ts` | `438457581d9dc53bf52a3c648672bfba09713f27` |

Probe SHA-256: `242fd494b2b65c7fc9288fdf0ed19c9afe4d7e5e1f396df0bd0492745a21422d`. The reviewed scope also includes exact workflow runtimes and the narrow probe gate, all five workspace/package engine ranges, toolchain floor enforcement, current guides/status/navigation and artifact/source/advisory/probe evidence.

## Findings and resolutions

Two precision issues were identified and resolved before final approval:

1. **Historical local qualification was ambiguous after raising floors.** The qualification opening still called the earlier portability record current and said it bound both admitted Node floors, while the new table named 24.22.1 / 26.12.1. The correction names the earlier record's actual 24.21.0 / 26.11.1 floors and PR #6 subject, and explicitly separates the new corrected-floor candidate and its pending complete/hosted gates. Earlier passing evidence was not relabeled.
2. **Release-template claims and link could be wrong for admitted ancestors.** Trusted latest-main release tools can intentionally select an older successful ancestor's immutable artifacts. Linking the new admission document under that older artifact commit could return 404, and the old manifests may admit affected engines. The correction links maintained main runtime guidance, requires corrected host Node as current guidance, and explicitly states that current evidence does not retroactively qualify an older artifact or change its engine declarations. The linked Checks run remains evidence for that artifact commit and its actual recorded runtime inputs. The existing explicit ancestor release policy was preserved.

The critic's final disposition was **no remaining material findings**. No issue severity labels or unreported review counts are assigned here.

## Independent verification actually performed

The critic independently read the official October 21 Node announcement and release pages; compared official archive checksums with the downloaded Linux x64 archives; checked actual Node/Undici versions and Node-tag bundled manifests; verified all eight selected Node-tag/Undici-tag source equalities through the GitHub plugin; and checked all eight relevant advisory patched floors, 7.30.1 / 8.12.2.

They independently invoked the maintained parent probe on all four actual binaries:

| Runtime | Bundled Undici | Observed parent result |
| --- | --- | --- |
| Node 24.22.1 | 7.30.1 | Exit 0; expected rejection caught, server closed, parent observed normal child exit |
| Node 26.12.1 | 8.12.2 | Exit 0; same boundaries |
| Node 24.21.0 | 7.29.1 | Exit 1; late unhandled `ResponseContentLengthMismatchError`, `UND_ERR_RES_CONTENT_LENGTH_MISMATCH` |
| Node 26.11.1 | 8.11.2 | Exit 1; same rejecting behavior |

They inspected that the child imports only Node built-ins, uses unmodified global fetch and a loopback ephemeral listener, owns its five-second watchdog/socket/server cleanup, and does not catch process-level exceptions. The parent reuses the admitted `node-or-bun` command helper and requires actual zero process exit after possible late stream errors. No sleep is used as a success oracle. No live Paddle operation or production transport patch was performed.

The implementation owner separately completed frozen offline installs on both corrected floors with no lockfile delta, complete strict project typecheck, focused typed lint, both toolchain gates and the selected full Foundation profile. Foundation's restricted-sandbox subprocess identity check failed before validation; the same gate passed with the exact corrected executable under approved escalation, with zero diagnostics and no source workaround.

## Qualification and delivery limits

The independent critic did **not** run the complete repository suite. Root owns the subsequent serial complete `pnpm check` runs on clean frozen source `6f348df2d345edf5270ade0daebf67cc834de2de` with fresh PostgreSQL databases. Both runs subsequently passed, with their exact-source logs and metadata retained in the [complete local qualification](qualification.md). Those are root-observed results, not an additional full-suite run by the independent critic.

The critic then independently reviewed the retained final evidence without
rerunning the suites. Both metadata/log subjects, stage exit codes, actual command
chains, source cleanliness, distinct database names and observed durations matched.
All 46 retained file sizes and SHA-256 values matched, as did the metadata's log
digests. Both floors reported the same ten test groups and zero failures,
cancellations, skips or todo cases. Both package identity maps matched, and the
critic rehashed all four current archives against them. The three npm-profile
reports supported the stated dependency-absence and strict-consumer claims.
The final evidence review found no material remaining issue and confirmed the
separation of unique stories, repeated test cases, observed local results and
pending hosted/publication/deployment outcomes.

A report-only successor may describe these results but must keep the tested source identity, log digests and archive subjects intact. Successful final exact-commit hosted Checks, any new-PR metadata authorization, publication and live-account/deployment admission remain separate. This review establishes neither a production credit/access ledger nor another production engine/provider/broker, and it does not clear physical recovery, account authority, commercial policy or browser declaration gates.
