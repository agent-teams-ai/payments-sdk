# Wave 4 independent implementation review: consumer policy and public hosts

## Verdict

**Request changes: one material P2. No P0 or P1 found.** The access qualification owner accepts an unqualified reversed original as paid, and rejects the same history after its exact matching approved reverse arrives. The whole-snapshot policy must distinguish these two evidence sets correctly. This is one defect, with negative and positive controls; it is not two independent findings.

Primary frozen review subject: **`6a77cd11798c78ea7bec1b79a902f69cd6fd7617`**.

Detached review worktree: `/workspace/scratch/9e36ca3bbd13/implementation/review-w4-consumers`.

The subsequent integrated subject **`f07bc9fb31e9b75c1d89dda3e59ee1fa9627ed32`** was inspected for the consumer delta. `git diff 6a77cd1 f07bc9f -- tests/fixtures/consumers` is empty. In particular, both commits contain access source blob **`a7e2b055fb3084cf62c73b326cf5f4df7f55e02a`**. This report does not claim to have rerun the new provider-profile suite against that subsequent subject. The finding's affected source is unchanged there; remediation and a later integrated freeze require a fresh recheck.

No tracked production source was changed, no commit was created and nothing was pushed. The strict `.ts` review probe remains untracked at `tests/review/wave4-access-probes.test.ts` in the isolated worktree.

## P2 — Qualify the complete adjustment snapshot before restoring access

**Location:** `tests/fixtures/consumers/access.ts:42–48`, inside `AccessFixture.recompute()`.

The outer condition tests only whether **some adjustment has status other than `reversed`**. A snapshot containing a single original credit/refund/chargeback with `status=reversed` consequently bypasses the entire adjustment policy. Its paid period is added at line 48, restrictions become empty, and `newAction`/`expand` become true. No reverse identity, amount, currency, transaction or line correlation has been established.

When the corresponding approved reverse does arrive, the outer condition becomes true. The original is no longer approved, and the reverse action is outside the adverse-original list, so `full` is false and `pending_adjustment_policy` is added. The complete qualified pair therefore restricts access, while its incomplete predecessor permits it.

The accepted implementation plan, §12 “Explicit fixture policy,” requires an unqualified correlation to remain held and qualifies supported removal of an adverse state only with proven correlation. P5 additionally requires actual access capabilities/restrictions and final amounts, not merely original-grant row counts. The access owner remains independent and may own its own product policy, but its declared qualification policy cannot equate the absence of a required correlated member with successful qualification.

### Reachable actual public trace

The retained independent probe runs this complete sequence through **both** `node-http-factory` and `fetch-static-gm`:

1. Create a monthly purchase through the public authenticated `/purchases` handler. The adapter calls the actual official Paddle SDK 3.10.0 against its test-only synthetic HTTP transport.
2. Admit a signed `transaction.completed` and an active `subscription.activated` through the public webhook endpoint. Real PostgreSQL T1/T2 and separate access/credit T3 complete. Positive starting state: access allows new actions and the credit fixture has one Q=100 allocation.
3. Admit one full approved credit for 1000 USD and the exact transaction line. Both consumers receive and ACK their own immutable evidence. Access correctly restricts new actions; credit allocation becomes zero.
4. Admit a newer observation of the **same original credit** with `status=reversed`. There is still only one adjustment identity; **no `credit_reverse` has been observed**. Payment history retains the completed fact and this original adjustment, with `flags=[]`.
5. Reconstruct `AccessFixture` from its durable tables and replay every stored current source. Each replay returns `duplicate`. All producer access delivery targets are already ACKed.
6. As a positive control, admit the exact approved `credit_reverse`, for -1000 USD on the same transaction and line, and deliver it to both owners.

No payment-owner SQL, synthetic producer revision, rewritten immutable completion or cross-owner transaction is used to create this trace. The only SQL outside public SDK operations creates/removes each test's isolated schemas and reads the owner fixtures' public inspection capability.

Actual results are the same for both hosts on both Linux Node runtime floors:

| Complete evidence set, with active lifecycle and unexpired paid period | Expected access newAction / expand | Actual access newAction / expand | Actual restriction | Actual credit |
| --- | --- | --- | --- | --- |
| No adjustment | true / true | true / true | none | eligible 100 |
| One approved full original credit | false / false | false / false | full adverse | allocated 0, eligible 0 |
| Original credit now reversed; no matching reverse observed | **false / false** | **true / true** | **none** | held, eligible 0 |
| Reversed original plus exact approved matching `credit_reverse` | **true / true** | **false / false** | **pending adjustment policy** | restored, eligible 100 |

The unsafe third-row state survives reconstruction, duplicate replay and completed producer ACKs. The fourth row demonstrates why a correction must retain positive supported fulfillment: holding all adjustment histories would leave the mandatory supported restoration case broken.

`read`, `export` and `cancel` stay true throughout. This report does not request removal of those independently guaranteed capabilities.

### Impact and minimal correction

This is a P2 correctness defect in the mandatory nonproduction access qualification owner. It falsely declares access eligibility from incomplete adverse evidence, and rejects a supported complete restoration. It is not evidence of a production credit balance, AI spending or a deployed access integration.

Qualify **every member** of the adjustment snapshot under the fixture's deliberately narrow supported policy before deriving the access decision. Incomplete, orphaned, partial, pending, unsupported or mismatched correlation must remain a durable policy hold. The exact full original/reverse pair must remain a supported positive restoration. A small pure fixture-owned classifier may be reused by access and credit where it expresses identical qualification knowledge, while preserving each owner's separate data, transactions, product decision and audit. Do not share owner SQL or merge consumer authority.

Retain a public regression for the sequence above, including the intermediate incomplete state, positive pair, reconstruction/replay and producer ACK. Assert access capability/restriction tuples independently, alongside final credit allocation and effect history. Do not derive expected access by calling the classifier under test.

## Other bounded verification

No further P0/P1/P2 was established in this scope. These observations come from source review and actually rerunning the existing 41 E2E cases on both runtime floors:

- The credit fixture's wave-3 orphan reverse correction now requires the whole single-original/two-member set. An unrelated supported reverse remains held before or after a valid pair, and no extra original grant is emitted.
- Initial intent guards are separate durable constraints from exact paid-period identities. Normalized RFC3339 instant identity covers initial, renewal and recovery contributions; policy version is metadata rather than a second issuance identity.
- Reentrant initial support A→B→A→B conserves Q. Current allocation ownership is separate from historical issuance; real transfers have distinct stable identities and original grant history is retained.
- Consumer source fencing occurs before product routing. First unrouted held or unknown-schema revisions fence older complete messages across restart. Current same-revision/different-digest input produces a durable conflict/hold; untrusted scope, malformed envelope identity or wrong digest remains unacknowledged.
- Higher malformed/changed-beneficiary payloads hold the original known contribution. The owner does not route it to another beneficiary or issue another grant. Stale and duplicate receipt paths do not create product effects.
- A per-buyer membership lock covers contributions, initial guards, resolution, lifecycle refresh and restrictions. Resolution validates decision revision plus the whole current evidence read set. Different beneficiaries can proceed independently.
- Consumer-local T3 commits receipts, source revisions, decisions/effects or held obligations, and outbox together. The before-commit crash rolls everything back; replay after committed T3 and lost ACK preserves one effect. `synchronous_commit=on` is applied inside both owners even when the borrowed pool inherits `off`; correctness tables are logged.
- Access lifecycle contributions serialize with paid evidence. Current cancellation/unknown lifecycle wins over an older completion, expiry has an explicit local refresh, and security restrictions remain independently effective. No read/export/cancel paywall bypass was introduced or requested.
- Both actual public hosts authenticate the beneficiary and ignore a body-supplied buyer. Each consumer has its own durable receipt and producer delivery target; one owner's ACK does not establish another's success.

This review applied the pinned Q 1.1.2 principles by ownership, observable contracts and dependency direction. It did not turn similar fixture policy syntax into a request for additional packages, generic frameworks or an AI ledger. The accepted plan, AGENTS, architecture/operations/qualification pages, consumer fixtures, both host implementations and relevant producer reducer/contracts were read. Prior consumer reports were used as historical context; their previously fixed findings were not reported again.

## Actual execution

Environment: Linux; official Paddle SDK **3.10.0**, API1; pnpm **11.25.0**; TypeScript **7.0.2**; authorized PostgreSQL test endpoint `postgresql://postgres@127.0.0.1:55432/postgres` (PostgreSQL 18.4 supplied for this review). Each probe creates random independent payment/credit/access schemas and removes them in `finally`.

Commands from the detached worktree:

```sh
PATH=/workspace/scratch/9e36ca3bbd13/implementation/node-v24.21.0-linux-x64/bin:/tmp/payments-sdk-tools:$PATH pnpm install --offline --frozen-lockfile --ignore-scripts
PATH=/workspace/scratch/9e36ca3bbd13/implementation/node-v24.21.0-linux-x64/bin:/tmp/payments-sdk-tools:$PATH pnpm build
PATH=/workspace/scratch/9e36ca3bbd13/implementation/node-v24.21.0-linux-x64/bin:/tmp/payments-sdk-tools:$PATH pnpm typecheck
DATABASE_URL=postgresql://postgres@127.0.0.1:55432/postgres /workspace/scratch/9e36ca3bbd13/implementation/node-v24.21.0-linux-x64/bin/node tools/run-tests.ts e2e
DATABASE_URL=postgresql://postgres@127.0.0.1:55432/postgres /workspace/scratch/9e36ca3bbd13/implementation/node-v26.11.1-linux-x64/bin/node tools/run-tests.ts e2e
DATABASE_URL=postgresql://postgres@127.0.0.1:55432/postgres /workspace/scratch/9e36ca3bbd13/implementation/node-v24.21.0-linux-x64/bin/node --test tests/review/wave4-access-probes.test.ts
DATABASE_URL=postgresql://postgres@127.0.0.1:55432/postgres /workspace/scratch/9e36ca3bbd13/implementation/node-v26.11.1-linux-x64/bin/node --test tests/review/wave4-access-probes.test.ts
```

Install, build and strict typecheck passed. The existing E2E suite passed **41/41 on each floor**, with zero skips. The independent access probe fails in both hosts on both floors, yielding two failed child cases plus their failed parent. It records both the incomplete and qualified-pair outcomes before making its independent assertion. Logs: `/tmp/wave4-consumer-probe-node24.log` and `/tmp/wave4-consumer-probe-node26.log`.

Synthetic HTTP is controlled only inside the test process; unauthorized network access is disabled and globals/dispatcher are restored. No live credential, customer or charge is used, and no fixed sleep is a correctness oracle.

### Limits

This focused review did not rerun physical backup/PITR, a live Paddle destination/account, a production commercial-access/credit integration, the packed-consumer release matrix or the entire SQL fault/reconciliation suite. It inspected the recovery owner-export boundary and logical restore tests, but did not claim a new complete recovery qualification run. The concurrent provider/SQL fixes and later final integrated candidate require their own exact-commit evidence; this report intentionally does not repeat accepted findings assigned to those owners.
