# Changelog

## 0.2.0 — unreleased

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
