# Independent Drizzle implementation review

## Subject and verdict

Reviewed source: `payments-observation-candidate` commit
`ffdcb20c13886151747d7685f5c3fd1e19e62ccc`, with the Drizzle-related changes
compared against `1080854`. The reviewed surface includes PostgreSQL schema,
records, store/recovery call sites, exact dependency catalog/lock, the eight-file
declaration patch, artifact admission tool, and packed consumer isolation tools.
Current AGENTS.md, developer-stack.md, accepted-plan constraints and the maintained
organization Engineering Quality Standard were read; the Q source was read during
the preceding independent admission assessment.

**No actionable P0–P2 findings in the reviewed Drizzle implementation.** The
change uses meaningful typed PostgreSQL schema/query construction while retaining
the existing transaction, locking, pool, deadline and recovery owners. The
declaration correction is explicit, narrowly verified and does not alter runtime
bytes. Final release admission remains conditional on the current source build,
full required PostgreSQL/E2E suites and production-only npm consumer proof.

The root worktree had unrelated in-progress edits to getting-started.md and
PostgreSQL index/jobs/job-transport files during review. These are excluded from
this source-diff verdict. No repository source was edited by this reviewer.

## Behavior and architecture assessment

- `packages/payments-postgres/src/schema.ts:8–40` models the existing revision
  representation and tables. A custom bigint column retains raw pg int8 text;
  the existing safe-integer check remains responsible for rejecting unsupported
  revisions. Explicit `PgSchema` construction preserves configured qualification,
  including `public`, rather than relying on host search_path. Existing bootstrap
  DDL and schemaVersion 1 remain unchanged.
- `schema.ts:44–62` compiles queries through the official connection-free
  `drizzle.mock().toSQL()` surface and passes the statements to the existing
  checked-out transaction. It introduces no ORM transaction or connection owner.
  All current selects use raw-compatible names and representations (`id`, int8
  text revision and JSON body), so bypassing Drizzle result mapping does not
  introduce a mapping discrepancy in this delivery.
- `records.ts:66–105` preserves record upsert semantics: JSON null is bound as a
  JSON string with an explicit jsonb cast; equal jsonb bodies do not advance the
  revision or updated_at; membership guards always advance. Obligation upserts
  preserve state-change/reset revision rules, attempts, issue and cooldown logic.
- `records.ts:108–126` and its store/recovery call sites preserve configuration
  revision increments, bounded keyset scans, cursor advancement and pending-work
  ordering. Existing row/advisory locks and owner checks remain at their existing
  call sites. No cross-owner SQL or provider operation was introduced.
- JSON body assertions in `configuration`/`read<T>` retain the pre-existing generic
  record-store trust boundary. They do not claim that Drizzle validates domain
  record bodies. The schema explicitly uses unknown for JSON values.
- The public PostgreSQL index exports no schema, builder, inferred record or
  transaction object from Drizzle. Fresh public declarations do not reach the
  internal schema/records declaration graph. Core remains ORM-free.

**Architecture subscore: 8.8/10.** Dependency direction, semantic ownership,
transaction isolation and the minimum useful schema/query boundary are strong.
The adapter deliberately supports only raw-compatible selections through its
private execution helper, and the prerelease declaration correction creates a
small ongoing maintenance obligation. Those limits are explicit rather than
hidden behind a general ORM abstraction. The score is scoped to the reviewed
change, not a certification of the full SDK or deployment.

## Exact patch and qualification review

The patch changes only the 15 optional fields in four role/policy config
interfaces, mirrored in `.d.ts` and `.d.cts`: 30 replacements across eight files.
It preserves class implements clauses, literal unions and all runtime files.
Adding explicit undefined corresponds to current class own-field/runtime
behavior; it is not a blanket declaration suppression.

`tools/qualify-drizzle.ts` compares the installed package's complete file set and
bytes with the SRI-verified official archive. For the eight exceptions it
independently constructs the permitted optional-field transformation, checks
original/patched hashes and checks the retained patch hash. All other files must
match exactly. Positive and negative compiler probes inherit the repository's
full strict profile for NodeNext and Bundler. No provenance-scope loophole was
found for the reviewed record and patch.

`tools/packed-npm.ts` creates a separate npm installation without workspace patch
configuration or dev dependencies, binds the four packages to exact packed
archives, checks their lock entries/integrity, verifies untouched official
Drizzle manifest/runtime/declarations, rejects mysql2/Foundation resolution and
uses TypeScript listFiles to reject reachable ORM/MySQL declarations. It invokes
the existing independently asserted financial scenario using installed public
exports. Success evidence is removed before the run and written after all gates.
The additional fixture dependencies are explicit runtime entries of this test
consumer; the proof does not imply that the final host requires those fixtures.

The selected exact `1.0.0-rc.5-5935859` is the newest published 1.0 preview in the
complete official version/time map inspected during admission. Older rc5 hashes
169397b and ab785fc are August publications. Stable 0.45.4 is chronologically
newer (October 8) on the older release line; selected rc5 was published September
9. The admission document states this distinction accurately. Prerelease use is
explicitly owner-authorized and does not waive strict compilation or E2E gates.

## Independent checks performed

1. Compiled the current PostgreSQL source into isolated
   `/tmp/drizzle-implementation-critic/compiled` with TypeScript 7.0.2 using its
   actual package project and inherited full strict profile. Compiler exited 0;
   no shared dist/build-info files were modified. The reviewed Drizzle source
   paths matched the reviewed head; unrelated current job edits were not assessed.
2. Used that fresh isolated output with a fake transaction, without PostgreSQL,
   to inspect eight real compiled statement shapes: JSON-null record upsert,
   guard increment, reset obligation upsert, configuration update, null/non-null
   keyset cursor, pending work and record read. Parameters, qualifiers, conflict
   clauses and ordering match the prior SQL's observable semantics.
3. Independently compared the installed Drizzle package against the freshly
   downloaded, official-registry-SHA512-verified rc5 archive retained from the
   preceding admission investigation. Exactly the eight recorded declaration
   files differed; all other bytes, including runtime, matched. Installed patched
   file hashes and the retained patch hash matched artifact.json.
4. Compiled a consumer of the freshly emitted PostgreSQL public index under both
   NodeNext and Bundler with the inherited exactOptionalPropertyTypes,
   noUncheckedIndexedAccess and skipLibCheck:false profile. Both passed. Their
   actual compiler file graphs contained 270 files and no Drizzle/MySQL
   declaration. This focused check is supplementary and does not replace the
   separate packed, unpatched npm consumer gate.

## Limits and required completion evidence

No real PostgreSQL suite or full E2E suite was run by this reviewer, because a
separate consumer qualification agent owns the test database. No final passing
claim for those suites is made here. The root's existing dist was stale during
the initial read; the root confirmed it would force a fresh build before final
qualification. Review conclusions rely on source and isolated fresh emission,
not that stale dist.

Future selections requiring aliases, joins, timestamp conversion, mapWith or
other Drizzle codecs must revisit the private raw-result helper: its inferred
builder result type alone does not execute a mapper. This is a current scope
limit, not a defect in any current call site.

The prerelease's unmodified declarations remain incompatible with the maintainer
profile. Reports must continue to identify the local declaration correction and
must not label upstream's unpatched declarations as generally qualified. The
successful official runtime/unpatched-public-consumer proof is a separate claim.
