# Changelog

## 0.3.0 — explicit worker transport and custody qualification

The four SDK packages advance together for the deliberate pre-1.0 worker
composition change. Existing 0.2.0 artifacts and durable payment identities
remain unchanged. A source version is not evidence of publication or completed
qualification; see the [hardening plan](docs/reviews/sdk-0.3-hardening/plan.md).

### Queue composition

- Give the PostgreSQL store a transactional enqueue capability instead of a
  `PgBoss` instance. Keep payment obligations authoritative and allow the store
  to run without a queue.
- Require an explicit transport when constructing the existing PostgreSQL
  worker. Keep claim/settlement, replay, repair, receipt verification and drain
  in that worker; confine pg-boss options, subscriptions and schema knowledge
  to its implementation.
- Preserve repair's bounded selection and fairness by excluding runnable
  transport work before applying the batch limit.
- Keep cold pg-boss admission on the supplied bounded transaction, including
  vendor queue metadata reads. A retained terminal job no longer suppresses a
  replacement wake-up. Retry failed transport cleanup while preserving truthful
  shutdown status and waiting for admitted physical work.

### Custody and lifecycle qualification

- Exercise permanent lost checkout and cancellation responses through both
  HTTP hosts, real PostgreSQL and the official Paddle SDK's synthetic transport.
  Restart, repair and new request keys cannot bypass an unresolved mutation;
  independently justified audited binding resolves it without another dispatch.
- Exercise exact raw webhook bytes, signature rejection after reserialization,
  failed inbox commit and successful redelivery, duplicate consumer delivery and
  independent credit/access acknowledgements.
- Preserve structured Get Modular preparation causes and qualify staged host
  shutdown with a held public purchase read. Record the published Resources
  lifecycle limit without substituting unpublished upstream bytes.
- Add a scoped Get Modular adoption record and executable boundary/artifact
  checks using the existing Foundation source graph and pinned TypeScript AST.
  The record does not claim application-wide FMS or full semantic CMS checking.

### Migration from 0.2.0

Upgrade the four SDK packages together. Construct
`createPgBossPaymentTransport` at the host composition boundary, call its
explicit `bootstrap()` under the migration role, and pass the transport to
`createPostgresPaymentJobs`. Give the store the runner's narrow `queue`
capability. The generic worker no longer returns a raw `boss` or queue name,
and `bootstrapPostgresPaymentJobs` is replaced by the transport's own
bootstrap operation. There is one composition path, without a legacy wrapper.

This change does not turn a remote broker into part of a PostgreSQL transaction.
Another transport must preserve the documented transactional enqueue,
namespace, pending-work and lifecycle contracts. Another storage engine still
requires a separate `PaymentStore` implementation and durability qualification.
Core payment commands, evidence/receipt protocols and persisted identities do
not change.

## 0.2.0 — integration and fixture candidate

The four SDK packages advance together. Existing `v0.1.0` release artifacts
remain unchanged; this entry describes the next source release.

### Get Modular observation

- Add the optional `@agent-teams/payments-get-modular/observation` public
  entrypoint with purchase read projections, real `watch` / latest-only `load`,
  explicit commands and Assembly/Resources lifecycle ownership.
- Use the published coherent Get Modular release train. The Observation peer
  remains optional for applications using only the static integration.
- Qualify the actual packed public entrypoint with real PostgreSQL payment and
  lifecycle scenarios. Remove the duplicate prepublication implementation.

### Storage and provider contracts

- Compile private PostgreSQL schema/query operations with exact
  `drizzle-orm@1.0.0-rc.5-5935859`, preserving the existing transaction owner,
  physical schema version, recovery protocol and explicit concurrency SQL.
- Keep the small declaration correction in the maintainer workspace. Required
  artifact checks prove its scope; fresh npm consumers execute the original
  package without the patch, MySQL or ORM types in the SDK declaration graph.
- Own the existing canonical observation vocabulary in core and map Paddle
  values explicitly. A distinct synthetic provider verifies supported and
  unsupported semantics without changing serialized evidence or decoder versions.
- Report unexpected background handler failures with their original cause and
  bounded work identity/attempt through `PaymentJobHandlerError`. Failed error
  listeners cannot alter durable retry, quarantine or acknowledgement.

### Development quality and boundary validation

- Adopt the complete selected Engineering Foundation profile: shared Node and
  type-aware Oxlint presets, strict project discovery and all six public
  registry/local-source lifecycle commands. Keep tooling development-only.
- Use exact `node-or-bun` 0.2.2 for the existing captured-command tooling
  boundary, with explicit Node ownership, bounded per-stream capture, timeout
  and no retries. Runtime SDK consumers do not acquire this dependency.
- Validate runtime identifiers, scopes and provider outcomes from unknown data
  before typed use. Preserve uncertain mutation outcomes and exercise malformed
  successful proofs in the existing settlement scenario.
- Keep independent consumer fixture payload validation honest: malformed
  completion payloads are held after validated envelope custody. Credit/access
  decision types remain independently owned.
- Preserve hosted qualification evidence under the explicit artifact allowlist.

### Migration from 0.1.0

The Get Modular adapter's peer compatibility changes, so this is a minor
version change under the repository's 0.x policy. Upgrade all four SDK packages
together. Get Modular hosts must upgrade Core and Assembly to `0.6.0` and
Resources to `0.2.0`; hosts using Conformance need `0.4.0`.

Install Observation `0.1.0` only when importing the new `/observation`
entrypoint. Keep one physical peer instance in the host graph. See the
[integration guide](packages/payments-get-modular/README.md) for composition,
selection, refresh and shutdown.

Existing payment commands, evidence/receipt contracts and database schema do
not change because of this Get Modular update. Plain-core applications still
do not require Get Modular, Paddle or PostgreSQL. The existing runtime and
provider qualification limits remain in force.
