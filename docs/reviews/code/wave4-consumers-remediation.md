# Wave 4 consumer remediation: independent exact-candidate recheck

## Verdict

**The wave-4 access snapshot qualification P2 is closed on the exact candidate reviewed. No additional material P0, P1 or P2 was found in this bounded recheck.**

Exact combined candidate: **`7e648f1674db14b6e1f7ee8b795516f38bdcb4a0`**.

The integrated consumer correction is `f5608180faa27ee7b0fd06f8dbc4ee37c3c9e689`; maintained public regressions are `560c75b2d58b8dbe34d27f18a2e704c768569013`. The primary historical finding remains documented in `wave4-consumers.md` without alteration.

Detached worktree: `/workspace/scratch/9e36ca3bbd13/implementation/review-w4-consumers`, switched to the exact combined candidate above. No production source was edited, no commit was created and nothing was pushed. The original independent `.ts` public probe remained unchanged from the first review and was rerun; its expected results do not call the new qualifier or derive their oracle from maintained consumer logic.

## Original public counterexample: now passes

The original review probe, `tests/review/wave4-access-probes.test.ts`, was run on **Linux Node 24.21.0 and 26.11.1**, against the authorized real PostgreSQL endpoint and the actual official Paddle SDK **3.10.0** synthetic HTTP transport. Both `node-http-factory` and `fetch-static-gm` pass on both floors.

The probe creates a monthly purchase through authenticated public HTTP, admits signed completed-transaction and active-subscription webhooks, sends full adverse and reversal observations through the same ingress, delivers and separately ACKs access and credit evidence, reconstructs the access owner and replays its current immutable messages. No rewritten completion, synthetic producer revision, cross-owner SQL or shared transaction is used to create the counterexample.

Observed outcomes are now the independently specified outcomes:

| Evidence, with active lifecycle and an unexpired paid period | Access newAction / expand | Access restriction | Credit result |
| --- | --- | --- | --- |
| No adjustment | true / true | none | Q issued |
| One approved full original credit | false / false | full adverse | allocation and eligibility zero |
| That original now reversed, with no matching reverse observed | **false / false** | **pending adjustment policy** | **held, eligibility zero** |
| Exact approved matching `credit_reverse` added | **true / true** | **none** | **Q=100 eligible after restoration** |

The incomplete state remains restricted after owner reconstruction, duplicate replay and completed access delivery ACK. `read`, `export` and `cancel` remain true. The exact complete pair is a positive control: the correction does not make every adjustment snapshot permanently held.

Each runtime reports **3/3 passing tests** for this retained probe: two host cases and their parent, zero failures and zero skips. Logs are `/tmp/wave4-consumer-remediation-node24.log` and `/tmp/wave4-consumer-remediation-node26.log`.

## Source inspection and ownership

The new `tests/fixtures/consumers/adjustments.ts` expresses only the shared nonproduction evidence qualification rule. It imports core types, performs no I/O, knows no owner schema, and takes only a completion fact plus the full adjustment set. It does not own access, credits, usage, a decision transaction or delivery ACK.

The implementation checks the complete narrow supported set:

- An empty adjustment set is explicitly unadjusted.
- A qualified adverse original is exactly one refund, credit or chargeback; it belongs to the completed transaction, is full, matches the completed total and currency, and has exactly one full allocation for the exact completed line with matching amount and currency.
- An approved original qualifies as full adverse only when it is the whole one-member set.
- A reversed original qualifies for restoration only when the whole snapshot contains exactly that original and one approved full reverse of its corresponding action. The reverse must match transaction and currency, negate the original amount, and have exactly one full allocation for the same line/currency negating the original allocation.
- A lone reversed original, orphan reverse, extra unexplained member, multiple originals, partial or pending member, mismatched transaction/currency/amount/allocation, or unsupported action cannot satisfy this rule and remains held.

Amounts are compared with exact integer arithmetic. The existing receive validation supplies exact bounded amount strings before this qualifier is used. The extraction preserves the former credit qualification rule while adding explicit full-set cardinality and transaction/allocation checks; it removes the access owner’s status-only bypass and its rejection of the supported pair.

Access still decides its own restrictions, paid validity, lifecycle, security policy and capabilities. Credit still decides its Q/T allocation, initial guard, causal grants, corrections, restoration, held resolution and effect identities. Each fixture retains a separate `ConsumerOwner`, schema, receipts, projections, decisions/effects, obligations, audits and T3 transaction. `tests/fixtures/consumers/owner.ts` is unchanged by the remediation. Sharing this pure qualification knowledge introduces no owner SQL, repository or Unit-of-Work coupling.

The source flags remain checked by each owner before or alongside this classification. Their intentionally different duplicate-payment policies were not merged. Initial intent guards, exact recurring basis identity, allocation transfer handling, complete-read-set resolution, source revision/digest fencing and durable ACK protocol are not altered by the consumer correction.

## Integrated regression execution

The exact candidate’s **entire maintained E2E suite passed 52/52 on each runtime floor**, with zero failures or skips. This is an actual independent rerun, not reliance on the implementation owner’s test count.

The expanded maintained public reversal regression covers both hosts and both orphan-reverse orders. It checks the lone reversed original after restart, ACK and replay; the exact positive pair; an unexplained reverse before or after qualification; stable Q issuance/correction/restoration effects; persistent held obligations; and stale whole-read-set operator rejection. It also confirms that a separate security restriction continues to prohibit new actions during an otherwise qualified restoration and can be removed only by its own authorized control, without changing credit eligibility.

The same E2E run retains the previously qualified initial/renewal/recovery exact-period cases, reentrant A→B→A→B conservation, source monotonicity and malformed/unrouted/digest tests, owner-local T3-before-ACK, and both public host compositions. The integrated provider-profile cases additionally pass their current-hold/recovery access effects.

The concurrent PostgreSQL delta was read for its relevant consumer effects: adverse admission now includes previously certified dependent parents in its payment-owner T1 read/lock set, and work claims/settlements carry a durable generation revision rather than resetting unchanged fanout work. These changes remain within the payment owner and its transport. They do not read independent consumer SQL or alter T3 authority. The detailed PostgreSQL race/fault remediation is independently owned by its assigned critic; this report does not replace that review.

## Commands and environment

From the detached worktree, after switching to `7e648f1674db14b6e1f7ee8b795516f38bdcb4a0`:

```sh
PATH=/workspace/scratch/9e36ca3bbd13/implementation/node-v24.21.0-linux-x64/bin:/tmp/payments-sdk-tools:$PATH pnpm typecheck
DATABASE_URL=postgresql://postgres@127.0.0.1:55432/postgres /workspace/scratch/9e36ca3bbd13/implementation/node-v24.21.0-linux-x64/bin/node --test tests/review/wave4-access-probes.test.ts
DATABASE_URL=postgresql://postgres@127.0.0.1:55432/postgres /workspace/scratch/9e36ca3bbd13/implementation/node-v26.11.1-linux-x64/bin/node --test tests/review/wave4-access-probes.test.ts
DATABASE_URL=postgresql://postgres@127.0.0.1:55432/postgres /workspace/scratch/9e36ca3bbd13/implementation/node-v24.21.0-linux-x64/bin/node tools/run-tests.ts e2e
DATABASE_URL=postgresql://postgres@127.0.0.1:55432/postgres /workspace/scratch/9e36ca3bbd13/implementation/node-v26.11.1-linux-x64/bin/node tools/run-tests.ts e2e
```

`pnpm typecheck` passed, running the build and the strict checks project under TypeScript **7.0.2**, including the retained independent probe. The frozen dependency graph is unchanged from the installed review worktree. The E2E logs are `/tmp/wave4-consumer-remediation-e2e-node24.log` and `/tmp/wave4-consumer-remediation-e2e-node26.log`.

The supplied PostgreSQL instance is 18.4 at the authorized disposable endpoint. Each scenario creates random isolated payment, credit and access schemas and removes them in cleanup. Test-process HTTP emulation disables unapproved network access and restores its globals/dispatcher. There are no live credentials, customers, charges or timing sleeps used as correctness oracles.

## Limits

This is a bounded independent remediation recheck of the consumer issue and relevant integrated effects at the exact candidate above. It does not claim a live Paddle account/destination qualification, production commercial-access or AI ledger policy, physical PITR/HA, full SQL fault-suite rerun, packed release qualification, or qualification of later commits. No material risk remained in the reviewed correction requiring additional scope or another approval step.
