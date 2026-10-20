# Drizzle adapter admission

## Selected artifact and authority

The user approved Drizzle inside the PostgreSQL adapter and explicitly allowed the
latest unstable release. The organization Engineering Quality Standard delegates
technology selection to the product repository. No accepted upstream ADR changed.
The payment core, Paddle adapter and Get Modular public contracts retain their
existing ownership and dependencies.

The selected exact artifact is **`drizzle-orm@1.0.0-rc.5-5935859`**, the official
`rc5` prerelease snapshot published on **2026-09-09**. The complete npm version/time
and dist-tag read-back on **2026-10-20** found no newer published 1.0 preview.
`latest` is `0.45.4`, published later on 2026-10-08 on the older 0.x line; it is not
represented as the selected 1.0 release or as declaration-compatible.

Primary provenance:

- [Exact registry metadata](https://registry.npmjs.org/drizzle-orm/1.0.0-rc.5-5935859)
  and [official archive](https://registry.npmjs.org/drizzle-orm/-/drizzle-orm-1.0.0-rc.5-5935859.tgz).
- npm SRI:
  `sha512-PkVjyxhamD7IOVfpDMn3BmV9afyvj3eeLvIPind3NmPv+cfv6/jh6GN0fHP0zzgrprGx/jGE4mkE0ttRFlzHwA==`.
- npm provenance payload binds that archive to source commit
  [`59358596b5be6a79f9cc1a2a20d39d276f6ab4b5`](https://github.com/drizzle-team/drizzle-orm/commit/59358596b5be6a79f9cc1a2a20d39d276f6ab4b5)
  and GitHub Actions run `34338818201`. Reading the payload and matching its archive
  digest is not a claim that this repository independently validated an attestation signature.
- [Artifact and permitted-change record](../../qualification/drizzle/artifact.json)
  contains the original/patched declaration hashes, exact official package manifest
  hash, runtime manifest and patch hash. This is the shared record used by maintainer
  and packed npm consumer qualification.

## Unmodified artifact failure and the bounded correction

The actual maintainer profile uses TypeScript `7.0.2` (the current stable compiler
at the read-back), NodeNext, `strict:true`, `skipLibCheck:false`,
`exactOptionalPropertyTypes:true`, `noUncheckedIndexedAccess:true` and the remaining
Engineering Foundation preset. Unmodified `0.45.4` and `1.0.0-rc.4` fail numerous
upstream declaration contracts under this profile. Unmodified `1.0.0-rc.5-5935859`
reduces those failures to four `TS2420` errors in PostgreSQL/Cockroach policy and
role classes implementing their optional config interfaces.

The source declares each class field using the indexed optional config type, for
example `readonly as: PgPolicyConfig['as']`. The runtime class owns the field and
permits its value to be `undefined`. An exact optional config field without an
explicit undefined union instead permits omission while rejecting a present
undefined value. The mismatch exists in the official source as well as the npm
declarations. See the pinned [PostgreSQL policy source](https://github.com/drizzle-team/drizzle-orm/blob/59358596b5be6a79f9cc1a2a20d39d276f6ab4b5/drizzle-orm/src/pg-core/policies.ts)
and [role source](https://github.com/drizzle-team/drizzle-orm/blob/59358596b5be6a79f9cc1a2a20d39d276f6ab4b5/drizzle-orm/src/pg-core/roles.ts).
Two independent decision critics checked that the fifteen fields already admit
this runtime behavior before the maintainer correction was authorized.

The exact-version pnpm patch adds `| undefined` to these fields only:

| Interface | Fields | Declaration counterparts |
| --- | --- | --- |
| `PgPolicyConfig` | `as`, `for`, `to`, `using`, `withCheck` | `.d.ts`, `.d.cts` |
| `PgRoleConfig` | `createDb`, `createRole`, `inherit` | `.d.ts`, `.d.cts` |
| `CockroachPolicyConfig` | `as`, `for`, `to`, `using`, `withCheck` | `.d.ts`, `.d.cts` |
| `CockroachRoleConfig` | `createDb`, `createRole` | `.d.ts`, `.d.cts` |

This is thirty one-line declaration replacements across eight files. Class
`implements` clauses remain checked. No JavaScript, CommonJS runtime, package
metadata, query/session behavior, SQL dialect, transaction implementation or
financial protocol changes. The patch SHA-256 is
`c0ac842c102d0e7a339e79a1676c02fa0dd803a11f6cc82e4b42007c8e153efb`.
The 1,743 official `.js`/`.cjs` files remain byte-identical; their sorted manifest
SHA-256 is `b55c1e931df5efbcae510e60fd12b6018b75fa13b5f0431286fb67195ef10292`.

The maintainer build also installs exact development-only `mysql2@3.24.6` because
the official Drizzle declaration closure imports MySQL types across dialects.
The adapter imports no MySQL runtime and declares no MySQL runtime dependency.
This peer supplies real official types; no ambient replacement or compiler
suppression substitutes for those declarations.

## Adapter responsibility and schema compatibility

Private runtime schema bindings describe the existing `configuration`, `records`
and `obligations` tables. Typed builders own record reads and conditional upserts,
guard increments, obligation state transitions, configuration updates and bounded
keyset/work queries. They use the public connection-free node-postgres
`drizzle.mock().toSQL()` API. The existing `PaymentSqlTransaction.query` executes
each compiled statement through the checked-out `pg@8.23.1` connection.

`withPaymentTransaction` remains the sole BEGIN/COMMIT/deadline owner and retains
its `commit_unknown` classification. The custom pg-boss transport, pool ownership,
ordered transaction-scoped advisory locks, repair row locks and necessary
PostgreSQL JSON operations remain unchanged. There is no new repository contract,
cross-owner transaction, ORM transaction wrapper, hidden pool or provider I/O
inside SQL ownership.

Explicit bootstrap DDL remains authoritative. `schemaVersion:1`, existing tables,
indexes, stored bodies and metadata do not require a generated ORM migration or
baseline rewrite. Query bindings always qualify the configured namespace,
including the previously supported `public` schema, independently of a host
connection's `search_path`. Revision columns retain exact pg int8 text until the
existing safe-integer check. JSON `null` is distinct from SQL `NULL`; equal jsonb
bodies leave both revision and update time unchanged.

## Reproducible gates and current limits

Run the ordinary strict build, Foundation/lint/boundary checks and the existing
real PostgreSQL/E2E suites. `node tools/qualify-drizzle.ts` separately retrieves the
exact official archive, verifies SRI, compares every installed package file and
rejects any modification outside the eight declared corrections. A cached exact
archive may be supplied through `DRIZZLE_ARCHIVE`; the same SRI check still runs.
The gate tests valid optional-undefined config inputs and rejects five invalid
policy/role inputs under both NodeNext and Bundler with the complete inherited
strict profile. The PostgreSQL package's compile-only type probes independently
retain those acceptance/rejection requirements without error suppressions.

The report is written to
`.artifacts/drizzle-admission-node-<exact-node-version>.json`. The source gate's
successful report does not substitute for a successful full current CI run or for
the separate packed production-only npm consumer proof. That proof must install
the SDK packages without this workspace's patch configuration or development
dependencies, verify the official unpatched Drizzle bytes, keep the SDK public
type graph free of Drizzle/MySQL declarations and exercise the existing durable
financial oracle.

The initial adapter candidate passed all 41 PostgreSQL and 52 E2E scenarios on
Node `24.21.0`. An overlapping Node `26.11.1` run recorded a large-page transaction
timeout and a cancellation projection hold. The exact affected reconciliation
and full-system files subsequently passed in isolation with unchanged timeouts.
Those reruns do not prove a shared-load cause or erase the earlier failures. Final
qualification belongs to the integrated current release commit on both Node
floors, with its successful full scenario gates and retained logs.

Any Drizzle upgrade requires a fresh official artifact/source read-back,
maintainer and packed-consumer type qualification, unchanged-runtime comparison
and real PostgreSQL concurrency/failure/recovery tests. Remove this patch when an
official compatible release supplies the correction. Do not carry it to a new
version by weakening checking, changing the original SRI or silently broadening
the permitted declaration scope.
