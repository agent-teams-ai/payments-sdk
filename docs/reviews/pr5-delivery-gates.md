# PR #5 delivery-gate correction

Read-back and focused validation: **2026-10-20 UTC**.

## Exact remote subject and failures

PR [#5](https://github.com/agent-teams-ai/payments-sdk/pull/5) head
`b6a4f616f4ce37b72a87acfaa1dcf18eb2fbca0d` was tested by Checks run
[39415147034](https://github.com/agent-teams-ai/payments-sdk/actions/runs/39415147034),
whose checkout was the merge commit
`8c58889b7ea26420e70a9ff83cf15336c97c1d00` against main
`1080854be73fc9e61f7a2b3f634c79c661fd1a55`.

Both scenario jobs completed every functional gate successfully:
core, exact Drizzle artifact and strict declarations, Paddle, Get Modular,
PostgreSQL, E2E, published observation consumer, and the production npm consumer
with its durable financial scenario. This is remote functional evidence for
that original subject; the scenario jobs as a whole failed.

The only failed step in jobs
[118602540682](https://github.com/agent-teams-ai/payments-sdk/actions/runs/39415147034/job/118602540682)
(Node 24.21.0) and
[118602540730](https://github.com/agent-teams-ai/payments-sdk/actions/runs/39415147034/job/118602540730)
(Node 26.11.1) was step 16, `actions/upload-artifact`.
Each reported no files for the four configured qualification path patterns.
Its logged `include-hidden-files` value was `false`. The report producers
write under `.artifacts`, and the pinned action explicitly excludes files in
directories beginning with a dot by default. See the
[pinned action documentation](https://github.com/actions/upload-artifact/blob/ea165f8d65b6e75b540449e92b4886f43607fa02/README.md#uploading-hidden-files).
There is no failed PostgreSQL oracle, timeout, or diagnostic-count gate in either
job. Expected fault-injection messages in the service log are not failed steps.

Separate [CodeQL check 118602397105](https://github.com/agent-teams-ai/payments-sdk/runs/118602397105)
failed with one new high-severity alert despite the successful Analyze jobs.
Its only annotation is `tools/qualify-observation.ts:50`, columns 64–84:
“Incomplete string escaping or encoding,” rule `js/incomplete-sanitization`,
because the literal `replace('/', '%2f')` replaces only the first slash.
The [PR review comment](https://github.com/agent-teams-ai/payments-sdk/pull/5#discussion_r4324418789)
and [alert 2](https://github.com/agent-teams-ai/payments-sdk/security/code-scanning/2)
identify the same expression. The approved manifest currently contains five
independently asserted scoped package names with one slash each; the alert does
not establish a changed registry destination for those existing inputs.

## Scoped correction

- Add `include-hidden-files: true` to the existing scenario qualification
  upload. Preserve exactly its four path patterns, per-Node artifact name,
  `if-no-files-found: error`, retention, and every prerequisite gate.
- Use `replaceAll('/', '%2f')` for the package-name registry path. Preserve the
  lowercase encoding and every byte of the five existing registry URL fixtures.
  No manifest, archive, package filename, or accepted expected result changes.

The changes were prepared from `7a3944a`. They do not change a runtime adapter,
database behavior, time budget, declaration diagnostic, or capture policy.

## Focused local verification and limits

On native Linux Node **24.21.0** and **26.11.1**:

- `node --check tools/qualify-observation.ts` passed.
- Parsing the updated workflow and comparing it with the parent revision proved
  that its sole structural change is the new scenario-upload input. The four
  allowlist patterns and failure-on-missing-evidence behavior remain exact.
- Executing the actual changed registry assertion against the existing
  `qualification/observation/published-artifacts.json` passed for all five
  approved archives, preserving their retained URLs.

`git diff --check` passed. No new permanent unit test was added for these
two simple corrections. A temporary probe initially hit the environment's
`spawnSync git EPERM`; reading a shell-retained parent workflow removed that
probe-only subprocess and both native validations then passed.

The original remote logs, job-step summaries, PR comments, CodeQL check,
annotation, alert, workflow-run metadata, validation results, and SHA-256
provenance are retained in the delivery workspace under
`research/continuation/ci-pr5/`. No database job, hosted rerun, PR comment,
push, dismissal, or merge was performed by this correction. Hosted upload
success and CodeQL clearance still require the integrated new-head checks.

