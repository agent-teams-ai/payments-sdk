# Scoped captured-command adoption evidence

Read-back and local execution: **2026-10-20 UTC**. The working subject was branch
`feat/node-or-bun-tools` from payments commit
`12303ff94a5c49c7d31de1409ef1441e66006cc3`, with the scoped adoption changes.
This records local tooling evidence, not hosted CI or final integrated admission.

The [adoption record](../node-or-bun-adoption.md) identifies the official API,
source revisions, artifact integrity, retained contract and direct-child limit.
The artifact record includes the exact node-or-bun and requested Oxlint companion
pins. Engineering Foundation's existing transitive node-or-bun 0.2.1 remains
unchanged; the direct tooling consumer selects 0.2.2.

| Executed check | Linux Node 24.21.0 | Linux Node 26.11.1 |
| --- | --- | --- |
| `pnpm check:fast` | Passed | Passed |
| Five native captured-command and four release-policy fixtures | 9 passed | 9 passed |
| Complete `pnpm test:boundaries` | 19 passed | Not separately repeated |
| `pnpm test:packed` | Four strict profiles passed | Four strict profiles passed |
| `pnpm release:dry-run` | Four archives passed | Four archives passed |
| `pnpm test:drizzle:admission` | Both strict resolvers passed; five invalid inputs rejected per resolver | Not separately repeated |
| `pnpm install --frozen-lockfile --ignore-scripts` | Passed | Not separately repeated |

The compiler was **TypeScript 7.0.2** and the package manager **pnpm 11.25.0**.
Packed profiles were plain core and all adapters under both NodeNext and Bundler,
with `strict:true`, `exactOptionalPropertyTypes:true`,
`noUncheckedIndexedAccess:true` and `skipLibCheck:false`. Plain-core runtime
resolution also rejected node-or-bun. Drizzle admission retained its independent
exit-1 diagnostic probes and verified unchanged runtime bytes.

No PostgreSQL jobs or ports were used. Database-backed Observation, production
npm financial consumer and complete SDK checks remain the integrated delivery's
required gates. No remote release verification/publication operation was run,
no npm package was published and no hosted CI success is asserted here.

Review the async call sites and the untouched inherited-stdio runner separately
from the library's own broad platform claims. This scoped evidence qualifies the
changed Node development command path; Bun, process-tree containment and
production runtime security admission remain outside it.
