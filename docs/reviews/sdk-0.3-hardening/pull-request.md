# feat: decouple payment queue transport and harden custody

The PostgreSQL worker exposed pg-boss through its store admission API and
embedded vendor job queries in generic repair. That made transport replacement
require edits to payment processing. Integration growth also needed explicit GM
adoption enforcement and stronger connected evidence for lost Paddle responses.

## Changes

- Introduce namespace-bound transactional enqueue and worker transport contracts
  inside the PostgreSQL adapter. Select the bundled pg-boss implementation
  explicitly; keep core, generic store and runner independent of its types/client.
- Preserve same-transaction admission, pre-LIMIT repair fairness, durable
  obligation ownership, mutation fencing, independent consumer T3 and exact ACK.
  Prove substitution with a different durable SQL fixture and the same runner.
- Fix cold vendor metadata lookup acquiring another connection, terminal-job
  wake-up suppression and retry/drain after failed transport cleanup.
- Add connected official-SDK Paddle scenarios for lost checkout/cancellation
  responses, exact raw-body custody, failed admission, redelivery and audited
  recovery under both host compositions.
- Preserve structured GM startup causes, qualify staged physical shutdown, and
  add a scoped adoption profile using the existing Foundation graph/TS AST.

This deliberate 0.x composition break advances all four packages to 0.3.0.
Hosts construct `createPgBossPaymentTransport`, explicitly bootstrap it, pass it
to `createPostgresPaymentJobs`, and give the store `jobs.queue`. The old standalone
bootstrap and raw boss exposure are removed. Existing payment schemas, identities,
namespace bindings and in-flight obligations are preserved. No automatic live
transport or active-provider migration is supplied.

## Validation

Exact source `16a6a5038383e54d3c740adcf87487e113498847` passed a frozen install,
fresh forced build and complete `pnpm check` on Node 24.21.0 and 26.11.1 using
separate PostgreSQL 18.4 databases. Each floor passed boundary/tooling 32, core 49,
Paddle 18, GM 13, PostgreSQL 47, E2E 66, packed Observation 4 and npm financial 1;
all failures/skips/cancellations/todos are zero. Counts include parent/subtest nodes.
Strict NodeNext/Bundler consumers, original unpatched Drizzle, exact published
GM archives and release dry runs pass. All four archives match across floors.

Four independent GPT-6.1-sol xhigh implementation reviews and one claims review
are retained in `docs/reviews/sdk-0.3-hardening`. Both P2 findings were corrected
and independently re-reviewed. The qualification record keeps the first
DNS-interrupted attempt distinct from successful runs.

These are local results. Required hosted checks must qualify the actual PR head
before the existing owner guard merges it. No live Paddle credentials, physical
PITR/HA RPO0, additional production broker, npm publication or production runtime
admission is claimed.
