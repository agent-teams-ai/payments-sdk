# Independent review: captured-command `node-or-bun` adoption

Review date: 2026-10-20 UTC. Original reviewed change:
`b6a4f616f4ce37b72a87acfaa1dcf18eb2fbca0d`, based on
`12303ff94a5c49c7d31de1409ef1441e66006cc3`, branch
`feat/node-or-bun-tools`, checkout
`implementation/payments-node-or-bun`. The reviewer did not author the change.

## Disposition

**No remaining actionable P0/P1/P2 finding at reviewed final head
`7a3944aee8d3863730e3b3997f6393f671fb61b2`.** The original change had one P2
finding, reproduced below. The root coordinator explicitly accepted the
development-tool policy change to independent 4 MiB stream limits. The reviewer
then independently inspected the correction and reran its actual fixtures on
both qualified Node floors. The finding is closed by an honest adopted contract
and distinguishing acceptance/rejection tests, without a helper implementation
change.

## P2 — Capture-policy parity claim hides an aggregate-limit change

Locations: `tools/package-artifacts.ts:38–41` and
`docs/node-or-bun-adoption.md:45–49` in the original change.

The replaced helper passes `maxBuffer: 4 * 1024 * 1024` to Node `spawnSync`.
On both qualified Linux runtimes this enforces an aggregate captured-output
limit. The new official executor bounds stdout and stderr independently. A
successful child producing 3 MiB on each stream therefore changes from rejected
to accepted, despite the adoption record saying that the helper “retains the
existing command policy” with 4 MiB per stream.

The independently executed reproduction used exactly this child body:

```js
process.stdout.write(Buffer.alloc(3 * 1024 * 1024, 97));
process.stderr.write(Buffer.alloc(3 * 1024 * 1024, 98));
```

The old-path comparator used `spawnSync(process.execPath, ['-e', source],
{ cwd: process.cwd(), env: process.env, encoding: 'utf8', timeout: 120_000,
maxBuffer: 4 * 1024 * 1024 })`. The new path called the actual exported
`await command(process.execPath, ['-e', source])` from the reviewed checkout.

| Runtime | Old helper mechanism | New actual helper |
| --- | --- | --- |
| Node 24.21.0 | `ENOBUFS`, status `null`, `SIGTERM`; stdout 2,162,688 bytes and stderr 2,046,464 bytes | Success, returned stdout 3,145,728 bytes |
| Node 26.11.1 | `ENOBUFS`, status `null`, `SIGTERM`; stdout 2,031,616 bytes and stderr 2,192,640 bytes | Success, returned stdout 3,145,728 bytes |

The exact retained-prefix split is scheduling dependent; the two deterministic
observations are old-path rejection and new-path success.

Impact: a newly accepted command can produce up to 8 MiB of raw combined capture
instead of approximately 4 MiB. This is a bounded development-tool behavior
change, not an SDK runtime or payment mutation defect. Its risk and scope are
small enough for P2, but the false parity claim obscures the actual admission
boundary and leaves the distinguishing case untested.

Requested fix: either preserve the aggregate limit when strict parity is
required, or deliberately adopt and document the official independent limits.
The coordinator selected the latter: state the previous aggregate bound and
new maximum combined payload explicitly; add a successful 3 MiB + 3 MiB fixture
and ensure overflow on either individual stream rejects. A custom parallel
process facade is unnecessary for that selected policy.

### Closure at `7a3944a`

The reviewer read the complete three-file correction against `b6a4f61`:
`docs/node-or-bun-adoption.md`, `docs/reviews/node-or-bun-adoption.md` and
`tools/test/captured-command.test.ts`. The owning policy now explicitly identifies
the old 4 MiB combined limit, new independent 4 MiB limits, maximum 8 MiB captured
payload and reason for using the official capture/cleanup mechanism. The new
positive case actually writes 3 MiB on each stream and compares returned stdout
with an independent exact string. Separate stdout and stderr overflow cases
require an `output-limit` runtime failure, capture initiating cause, bounded
output and complete custody. The correction changes no production helper,
deadline, native-error projection, retry or process-lifetime behavior.

Fresh reviewer execution on final head: **11 passed, 0 failed, 0 skipped on
Node 24.21.0; 11 passed, 0 failed, 0 skipped on Node 26.11.1**, running the seven
native captured-command fixtures plus four release-policy fixtures. No remaining
actionable issue was found in the correction.

## Source and architectural review

Read the local `AGENTS.md`, `docs/developer-stack.md`, accepted implementation
plan/architecture, the retained current organization quality/navigation sources
`research/continuation/sources/org-quality-5499550.md` and
`org-agents-5499550.md`, and the complete pinned Q text
`research/continuation/sources/q-5f1b5aef.md`. The baseline/Q distinction between
concrete contract violations and aesthetic layering preferences guided this
review.

The adoption has one appropriate mechanism owner: the existing
`tools/package-artifacts.ts` boundary constructs
`createProcessExecutor(createNodeProcessAdapter())` and keeps the local
zero-exit policy. No second command framework, speculative interchangeability
interface, custom supervisor or domain dependency was added. The dependency
stays at the tooling composition edge; core and the four package runtime
sources do not import it. This is consistent with SRP, DIP and DRY by actual
responsibility.

Reviewed the official preserved process contract, executor, Node adapter,
errors and request declarations under `research/continuation/sources/`, and the
actual installed 0.2.2 implementation of input validation/snapshotting, capture,
decoding, cleanup and outcome classification. Official source identity:
`2a0bbac6f80705e0b06e7eaeddf47439465b5646`; upstream read-back identity recorded
by the adoption: `3e6a1c44195680761787e4377fc560dd0f22e223`.

Primary source references:

- [Exact official process contract](https://github.com/agent-teams-ai/node-or-bun/blob/2a0bbac6f80705e0b06e7eaeddf47439465b5646/docs/process-contract.md)
- [Exact official executor](https://github.com/agent-teams-ai/node-or-bun/blob/2a0bbac6f80705e0b06e7eaeddf47439465b5646/src/executor.ts)
- [Exact official Node adapter](https://github.com/agent-teams-ai/node-or-bun/blob/2a0bbac6f80705e0b06e7eaeddf47439465b5646/src/adapters/node.ts)
- [Exact official capture mechanism](https://github.com/agent-teams-ai/node-or-bun/blob/2a0bbac6f80705e0b06e7eaeddf47439465b5646/src/internal/capture.ts)
- [Official npm version metadata](https://registry.npmjs.org/node-or-bun/0.2.2)

The current shell does not expose `gh`; attempted search-service opens of exact
raw official URLs returned `DisabledError`. This reviewer therefore used the
retained official source/metadata and the exact locally retained archive rather
than claiming an independent live upstream lookup. The coordinator separately
confirmed the current organization source.

## Independently verified properties

All `command`, `pnpm` and `auditPackageArchive` consumers were searched and read,
including release candidate verification/assembly/publication, packing, npm
consumer qualification, Observation/Drizzle qualification, toolchain inspection
and fixtures. All migrated asynchronous work is awaited or returned to its
awaiting caller. No launch-and-forget release/qualification path was found.

The helper passes literal argv and cwd; the explicit default Node adapter
inherits a snapshot of current environment and spawns without a shell. It
returns stdout only after successful capture/cleanup and observed numeric zero
exit. Numeric nonzero and signal exits remain assertion failures with bounded
stdout/stderr. The helper does not catch, reclassify or retry library runtime
errors, so native cause, initiating failure, late facts, nullable output and
incomplete custody remain available.

The 120,000 ms timeout is explicitly supplied. Direct-child TERM/KILL cleanup,
possible cleanup latency beyond the initiation deadline, EOF closure rejection
and lack of descendant-tree containment are documented accurately. The helper
exposes no cancellation option and makes no payment cancellation guarantee.
The independent inherited-stdio runner and intentional exit-1 Drizzle probe
were unchanged. No production/Bun/runtime-security admission was broadened.

Independent byte-output comparisons on Node 24.21.0 matched the old helper for
a leading UTF-8 BOM (`EF BB BF 61`), invalid bytes (`FF C0 AF 61`) and an
incomplete UTF-8 suffix (`E2 82`). Both mechanisms preserve the BOM and use the
same observed replacement decoding for these malformed inputs. Binary output
has never been the helper's contract; the wrapper continues to return text.

## Independently executed checks and inspected artifacts

The reviewer executed the following command on each of
`/tmp/payments-cont-toolchain/node24/bin/node` (**24.21.0**) and
`/tmp/payments-cont-toolchain/node26/bin/node` (**26.11.1**):

```text
node --test tools/test/captured-command.test.ts tools/test/release-policy.test.ts
```

Original-head result: **9 passed, 0 failed, 0 skipped on each runtime**. These
were fresh reviewer executions of the original five native captured-command and
four release-policy fixtures, including archive identity/version, prohibited
dependencies and development-file rejection. Final-head result after the
capture-policy correction: **11 passed, 0 failed, 0 skipped on each runtime**,
using the same command. Builds, installs, full SDK tests and database jobs were
not run by this reviewer. Author-reported broader evidence in
`docs/reviews/node-or-bun-adoption.md` is not represented here as reviewer-run.

The default sandbox initially prevented meaningful child spawning (`EPERM`
with empty captures). Those outputs were discarded as execution-restriction
artifacts. The successful independent fixture and parity/byte probes above ran
under auto-reviewed escalation, without network/database/build/install work.

Fresh read-only hashing of `/tmp/payments-node-or-bun-0.2.2.tgz` found **34,406
bytes**, SHA-256
`2d357d1feca8413acf9cba27fe1818a2abb357d283493541314a94246f572e39`,
and the recorded registry SHA-512 SRI. All **52 installed package files** were
byte-identical to corresponding tar members. The preserved registry `gitHead`
and decoded provenance payload both identify source commit `2a0bbac…`; both
attestation subject digests match the archive. Signature verification was not
performed and is not claimed.

Read all four pre-existing `.artifacts/packages/*-0.2.0.tgz` archives without
extracting or executing them. No `node-or-bun` occurs in their dependency,
peer, optional or development dependency declarations; no `node-or-bun`
reference occurs in their emitted JavaScript/declarations. This is inspection
of existing archives, not a fresh packing run. Source/package manifests also
have no runtime leak. Archive checks and packed consumer probes reject the
new dependency in the scopes they explicitly govern.

The frozen lockfile adds the direct exact 0.2.2 root development dependency and
leaves Foundation's independent transitive 0.2.1 unchanged. The extra exact root
development `oxlint-tsgolint` 7.0.2001 declaration and its optional platform
artifacts match the separately requested Foundation tooling profile; there is
no unrelated runtime dependency movement.

## Remaining admission

Independent re-review of the capture-policy correction is complete at
`7a3944aee8d3863730e3b3997f6393f671fb61b2`. Full integrated strict/type-aware
checks, packed consumers, real PostgreSQL
and financial/Observation gates belong to the coordinator's final delivery.
This memo does not replace hosted CI, qualify a production deployment, certify
Bun, or authorize a release.
