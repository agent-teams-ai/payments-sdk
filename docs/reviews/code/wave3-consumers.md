# Wave 3 independent implementation review: consumers and public hosts

## Verdict

**Request changes: one P2. No P0 or P1 found.** An unexplained supported reversal is ignored by the credit fixture whenever another original/reversal pair qualifies. This permits Q to remain eligible, or to be restored automatically, despite the accepted fixture policy requiring an unqualified reversal to remain held for review.

Frozen commit: `347040076ba245f0c07278423f84425f3ba52d58`.

Detached isolated worktree: `/workspace/scratch/9e36ca3bbd13/implementation/review-w3-consumers`.

No tracked source was changed and nothing was pushed. Review-only probes are untracked under `tests/review/` in that worktree. This review treats the four SDK packages as financial-fact producers and the Q=100/T=25 owners as explicitly nonproduction qualification fixtures without AI consumption. It does not propose a production ledger or an access/grace product policy.

## P2 — Account for every reversal before releasing or restoring an allocation

**Location:** `tests/fixtures/consumers/credit.ts:46–51`, `condition()`, especially the per-original filter at line 48 and unconditional `return 'paid'` at line 51. The resulting false `paid` classification enables eligibility at lines 148–149 and automatic restoration at lines 137–146.

The reducer first checks that each action belongs to the supported action whitelist. It then selects the original refund/credit/chargeback adjustments, and, for each reversed original, requires exactly one matching approved reverse. It never checks that **every remaining supported reverse belongs to that qualified pair**. A separate `chargeback_reverse` without a known chargeback original is consequently ignored if the snapshot also contains one reversed credit and its matching `credit_reverse`.

With only an unexplained reverse, the same function returns `held` at line 42. Adding an unrelated qualified pair changes that incomplete evidence into `paid`; the unrelated pair has supplied no correlation for the unexplained reverse. This violates the accepted fixture policy in `docs/implementation-plan.md:399–418`: ambiguous/unqualified reversals remain held, restoration requires proven correlation, and an unsupported monetary-netting rule is not inferred.

### Reachable public trace

`tests/review/wave3-consumer-probes.test.ts` reproduces through both `node-http-factory` and `fetch-static-gm`, with the official Paddle SDK 3.10.0, verified webhook ingress, real PostgreSQL T1/T2/T3, the public evidence-delivery protocol, and owner-local receipts/effects. It does not rewrite immutable completions, insert payment bindings, or create synthetic producer revisions.

1. A server-side monthly purchase is created by the public `/purchases` handler. Its verified completed transaction issues one Q=100 original grant.
2. A full approved `credit` for the transaction corrects the allocation to zero once.
3. That credit is observed as `reversed`, with an approved matching `credit_reverse` for `-1000 USD` and the same transaction line. In isolation, this pair qualifies for restoration under the existing narrow fixture policy.
4. A distinct approved `chargeback_reverse` for `-1000 USD` is observed on the transaction, but **no chargeback original is known**. This is a valid supported observation, not a manufactured unknown action. Its arrival is tested both before and after step 3 finishes.
5. The credit owner is reconstructed from its durable tables, and the latest producer message is replayed. The replay returns `duplicate`; the wrong eligible allocation persists.

The actual SDK producer retains all three adjustment identities with `flags=[]`:

| Adjustment | Status | Amount |
| --- | --- | ---: |
| Credit original | reversed | 1000 USD |
| Matching credit reverse | approved | -1000 USD |
| Unmatched chargeback reverse | approved | -1000 USD |

For both event orders and both hosts, the actual durable decision is:

```text
status=issued, allocated=100, eligible=100, held=0
```

The actual effect sequence is always `grant +100`, `correction -100`, `restoration +100`. There is still only one original grant, so an assertion that merely counts original grants misses this failure.

The independent expected results depend on the legitimate transition history:

| Unmatched reverse arrives | Expected allocated | Expected eligible | Expected held | Expected status/effect |
| --- | ---: | ---: | ---: | --- |
| After the qualified pair has already restored Q | 100 | 0 | 100 | Policy hold; no fabricated refund/correction |
| Before the pair is complete, while the original credit has reduced allocation to zero | 0 | 0 | 0 | Held; no automatic restoration while the complete snapshot remains unqualified |

This is a P2 defect in the mandatory qualification owner: an accepted evidence set bypasses the declared review policy and exposes/restores a symbolic benefit without the required correlation. It is not evidence of an actual production credit balance or AI spend.

### Minimal fix and regression

Before returning `paid` for reversed adverse evidence, ensure the **whole adjustment set** is explained by the narrow supported correlation policy. For the current single-original policy, the qualifying set must contain exactly that original and exactly its one matching reverse, with no unexplained additional reversals. Unknown, partial, pending or otherwise unqualified members must produce a durable hold. Preserve the existing original issuance, correction and restoration identities; a review hold must not synthesize a new provider correction.

Keep the valid two-member pair as a positive regression. Add the third unmatched supported reverse before and after it, reconstruct the owner, replay the last immutable message, and assert status, allocated/eligible/held amounts and causal effect history independently. A later authorized resolution must use the current complete read set; it must not silently acquire authority to ignore a newly observed member.

## Verified boundaries and prior fixes

The following checks produced no additional P0/P1/P2 finding in this review:

- The wave-1 source fence is authoritative before buyer routing. A first held/unknown-schema revision cannot be erased by an older complete message, including restart and replay.
- The per-buyer membership lock covers transaction/subscription additions, decisions, credit resolution, access refresh and security restriction writes. Whole-read-set resolution validation remains in place; unrelated buyers proceed independently.
- Current same-version/different-digest input produces durable conflict/hold; wrong producer/scope/environment and invalid envelope identities remain unacknowledged. Before-T3-commit failure rolls back receipts and effects together.
- Exact timestamp aliases share one normalized recurring basis across initial/renewal/recovery facts. Original provider spelling remains in financial evidence. The code retains nanosecond precision in the identity rather than converting it to milliseconds.
- Initial allocation ownership is independent of historical original-grant metadata. A→B→A→B conserves Q and emits distinct real transfer transitions. The actual-SDK unknown-outcome/authorized-duplicate-risk trace passes.
- Partial evidence remains a durable obligation after ACK and restart. The narrow reviewed policy redrives using current decision revision/read set without creating a producer revision or deleting a receipt.
- Access restriction does not remove read/export/cancel. Its lifecycle writer shares the same buyer guard as payment contributions and refresh. No new material access-capability bypass was established.
- Both public hosts authenticate buyer identity and ignore a body-supplied buyer. The fixed full-system promise barrier reserves the correlated intent before overlapping seven duplicate SDK-pending checks; it passes on both runtime floors.

These are bounded verification observations, not a proof of every possible policy or process failure. Conservative access policy choices and lower-impact projection observations are not elevated to P2 findings.

## Execution and limits

The worktree was installed with `pnpm install --offline --frozen-lockfile` using the cached frozen dependency graph, then built successfully with TypeScript 7.0.2. The existing **36 E2E tests pass on Linux Node 24.21.0 and Node 26.11.1**, against PostgreSQL 18 at the authorized local test endpoint.

The focused independent reversal oracle fails in all four host/order cases on **both runtime floors**, with the actual values described above. Its four failing subtests plus their parent are reported as five failures by Node's test runner. The final review probe explicitly compares the independently specified status and allocated/eligible/held tuple rather than calling consumer code to derive an expected value.

Reproduction, from the frozen detached worktree:

```sh
DATABASE_URL=postgresql://postgres@127.0.0.1:55432/postgres node tools/run-tests.ts e2e
DATABASE_URL=postgresql://postgres@127.0.0.1:55432/postgres node --test tests/review/wave3-consumer-probes.test.ts
```

Select either `/workspace/scratch/9e36ca3bbd13/implementation/node-v24.21.0-linux-x64/bin/node` or the sibling Node 26.11.1 binary. Concise final probe logs are `/tmp/wave3-consumer-node24.log` and `/tmp/wave3-consumer-node26.log`.

Each SDK probe creates random independent payment/credit/access schemas and removes them in `finally`. The official SDK's HTTP transport is controlled only inside the test process with MockAgent and external network disabled. No live credential, customer, request or charge is used. There are no timing sleeps as correctness oracles. No other reviewer's wave-3 findings were used.

This focused review did not rerun physical crash/PITR, real Paddle sandbox destination qualification, production ledger/access integration, the packed-consumer/release matrix, or the full reconciliation/worker/SQL fault-injection suites. It read the pinned Q 1.1.2 instructions, repository AGENTS, accepted plan sections 5–9 and fixture policy, prior consumer report, independent consumer sources, both host examples and the relevant producer observation/reduction contracts. Those limitations are not additional findings.
