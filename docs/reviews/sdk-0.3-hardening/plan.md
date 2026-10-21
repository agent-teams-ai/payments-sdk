# SDK 0.3 hardening plan

Date: 2026-10-21. Baseline: `58441742d2f3743e4681f4bb02b2ff013023d652`
(released 0.2 source). This follow-up implements the owner's request to assess
integration growth, make the supplied worker independent of pg-boss, and add
connected Paddle failure/recovery evidence. The original accepted
[implementation plan](../../implementation-plan.md) remains unchanged.

## Decisions and scope

1. Keep the four existing delivery packages and the core-owned `PaymentStore`
   and provider contracts. Drizzle remains private to the PostgreSQL adapter.
   Its PostgreSQL dialect does not qualify another storage engine.
2. Introduce one authoritative infrastructure work identity, a transactional
   enqueue capability, and a worker transport contract inside
   `payments-postgres`. The host explicitly supplies the pg-boss implementation
   or another qualified implementation. The generic worker must not import
   pg-boss or query its schema.
3. Preserve payment obligation ownership, the pre-LIMIT exclusion of runnable
   wake-ups, T1/T2/T3, exact producer ACK, namespace fencing, repair, cooldown,
   quarantine, unknown-mutation fencing and physical shutdown drain. A trusted
   transport-owned PostgreSQL predicate is an adapter-local seam, not a new
   core SQL contract. A remote broker still requires a durable relay/outbox and
   its own failure qualification.
4. Replace the old implicit pg-boss composition in one step. Do not retain a
   legacy wrapper or a second default path. This pre-1.0 API change advances
   all four packages to 0.3.0 and requires explicit migration instructions.
   Existing payment records, evidence identities and pg-boss namespaces do not
   need a data migration merely because composition changes.
5. Preserve real Get Modular entries, Assembly, Resources and optional
   Observation. Improve startup diagnostics and qualify dependent-resource
   shutdown. Record a precise local consumer scope and executable pin/boundary
   checks using the existing test and Foundation inventories; do not claim
   repository-wide FMS or complete CMS enforcement from package installation.
6. Use the exact published Get Modular train unless a successor is explicitly
   qualified. Upstream Resources main contains an abort-reentry correction not
   present in published 0.2.0. Reproduce its relevance and record any remaining
   adoption prerequisite; do not silently patch or substitute upstream bytes.

## Implementation lanes

| Lane | Owned change | Required evidence |
| --- | --- | --- |
| Queue transport | PostgreSQL adapter contracts, generic runner, explicit pg-boss adapter, migrated hosts and fixtures | Same runner with a durable non-pg-boss test transport; existing real pg-boss suite remains required |
| Paddle custody | New connected official-SDK synthetic-transport E2E scenarios | Permanent lost mutation reply, restart, audited binding without redispatch; exact raw HTTP body, T1 rollback and successful redelivery through both hosts and both consumers |
| Modular integration | Consumer profile, retained startup causes, staged close and published-artifact lifecycle regressions | Existing wiring/isolation/smoke/packed checks plus rejecting profile mutations and honest physical-settlement behavior |
| Integration | Version/changelog, current architecture and qualification docs, existing CI gates | Strict source/declarations, Foundation, packed pnpm/npm consumers and complete checks on both admitted Node floors |

## Verification and delivery

- Use PostgreSQL 18.4 with `fsync=on` and `synchronous_commit=on` locally.
  Database-backed qualification is serialized in the shared disposable server.
- Use official Paddle SDK 3.10.0 with fixture-controlled HTTP transport. No live
  Paddle account, credentials or charges are part of this qualification.
- Give expected financial outcomes to independent credit/access fixtures;
  never compute the expected oracle with the production reducer.
- Review the integrated change independently with GPT-6.1-sol at xhigh across
  queue semantics, lifecycle/composition, Paddle custody and package/CI/public
  contracts. Resolve material findings before final qualification.
- Preserve small canonical commits. Publish a reviewable PR, wait for required
  exact-source checks and merge through the existing owner-identity guard when
  the authenticated write capability is available. Local completion is not a
  claim of a remote PR, hosted CI, merge or release.
- Report integration convenience with concrete limitations, the actual storage
  and transport boundaries, current production logical LOC and the scope of
  the new test results. Keep existing production-admission restrictions unless
  their separate evidence actually changes.
