# Archived command evidence

Historical command output from three superseded qualification records is
available at immutable commit
[`17dde3d75ac1e4e3a3218b236fca3f8a4d1ada7b`](https://github.com/agent-teams-ai/payments-sdk/commit/17dde3d75ac1e4e3a3218b236fca3f8a4d1ada7b),
Git tree `601be0a727b55a27fd851c49315ae0cc3477e236`. The archived bytes were
verified against that tree before removal from the current checkout.

| Historical record | Archived files | Bytes | Scope |
| --- | ---: | ---: | --- |
| [SDK 0.2 completion](https://github.com/agent-teams-ai/payments-sdk/tree/17dde3d75ac1e4e3a3218b236fca3f8a4d1ada7b/docs/reviews/sdk-0.2-completion) | 33 | 185,499 | Command logs, including cold-build, interrupted-run and release-bootstrap evidence |
| [SDK 0.3 hardening](https://github.com/agent-teams-ai/payments-sdk/tree/17dde3d75ac1e4e3a3218b236fca3f8a4d1ada7b/docs/reviews/sdk-0.3-hardening) | 13 | 290,226 | 7 command logs, 4 compiler file graphs and 2 disposable consumer locks |
| [SDK 0.3 portability](https://github.com/agent-teams-ai/payments-sdk/tree/17dde3d75ac1e4e3a3218b236fca3f8a4d1ada7b/docs/reviews/sdk-0.3-portability) | 28 | 480,882 | 10 command logs, 12 compiler file graphs and 6 disposable consumer locks |
| **Total** | **74** | **956,607** | Only `.log`, `.files.txt` and `.package-lock.json` files in those records |

Open the original relative filename in its linked historical folder to inspect
the raw evidence. These links identify repository objects rather than expiring
Actions artifacts. The archive commit is the retention location; each report's
recorded source revision remains the subject of its qualification.

Compact qualification and admission reports, package identities, source hash
manifests, exact patches, failure records and substantive reviews remain in the
current tree. Existing `logSha256`, `lockSha256`, `listFilesSha256` and other
execution fields retain their original values and resolve to the archived bytes.
No qualification outcome, failure or incomplete run has been relabeled.

The unchanged [SDK 0.2 evidence manifest](sdk-0.2-completion/evidence-manifest.json)
binds the original archived copies of its listed files. Its hashes for
`README.md` and `release-bootstrap-independent.md` identify those original
report copies, before later navigation edits; they do not assert that the edited
current copies have the same bytes. Use the SDK 0.2 historical folder above to
inspect all original manifest entries.

The [October 21 corrected-runtime evidence](node-runtime-security-correction-2026-10-21/qualification.md)
remains complete in the current tree. Active qualification fixtures, accepted
architecture records and review conclusions are outside this cleanup's scope.
