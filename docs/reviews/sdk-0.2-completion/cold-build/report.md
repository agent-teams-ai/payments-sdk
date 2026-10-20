# Cold build dependency repair

## Result and source identity

The CI failure is reproduced on the exact clean source at
`95e996ff0bbe8edb003fcd42ab66c6aa429a7253` (tree
`975754efb236ba0552144a6d6e41ba056d18a573`). The ordinary `pnpm typecheck`
passes from zero `dist` directories and zero `.tsbuildinfo` files with only the
attached three-file patch applied. The shared working copy has the patch but
was neither built nor committed by this task.

The source archive SHA-256 is
`67bc9eabb363be9f6d6684e570edb62f6fcb4108118ecdae96acb584a56abbcc`.
The exact patch SHA-256 is
`538dc9b01661af58a85afc86838f91cae72fcbafec85eead2295535defc2eccf`.
`source-manifest.json` hashes all 212 tracked fixture inputs before and after;
its changed-path set is exactly the two consumer configs plus the scoped
Foundation adoption explanation. This is source bound evidence for the baseline
plus patch, rather than a claim about a future commit or hosted CI run.

## Cause and smallest repair

The root solution listed four runtime projects and two no-emit consumer projects
as siblings. The checks and Observation projects resolve published package
exports and relative `dist` imports, yet had no references to the producers.
TypeScript 7.0.2 exposes concurrent project builders (`--builders`; see retained
installed CLI help). Root reference order therefore did not establish that the
runtime declaration artifacts existed before consumer checking began.

Both `tsconfig.checks.json` and `qualification/observation/tsconfig.json` now
explicitly reference the four runtime projects that their sources consume.
The existing root solution discovery is preserved. No compiler option, include
root, source, dependency, lockfile, lint rule, emission behavior or architecture
policy changed. Both consumers remain no-emit; runtime source projects retain
composite declaration emission and their inward references to core.

## Isolated reproduction

The fixture is `/tmp/payments-cold-build-pmt69gqn/source`. It was extracted from
`git archive` of the exact baseline, without untracked files or generated outputs.
It has its own frozen workspace install, its own
`/tmp/payments-cold-build-pmt69gqn/store`, and copied registry dependencies.
The successful install downloaded all 91 packages with zero packages reused.
Every payments workspace symlink resolves into this fixture, as recorded in
`installed-isolation.json`; no link resolves to the warm shared working copy.
The workspace lockfile hash stayed unchanged.

The environment retained the session HOME unchanged. Explicit empty npm user
and global configuration files were used, and credential environment variables
were excluded. Only required system proxy/certificate settings were retained
for registry access. No user configuration or credentials were copied.

The first install omitted those proxy settings and failed to download packages;
that attempt was terminated and retained separately as `install-missing-proxy`.
It is installation evidence only. `install-frozen` is the successful independent
frozen install used for both compiler outcomes.

## Verification

| Input and command | Result |
| --- | --- |
| Baseline, zero generated outputs: `pnpm typecheck` | Failed, exit 1; 30 TS2307 missing-module errors plus cascading errors |
| Baseline plus patch, all prior `dist` and build info removed: `pnpm typecheck` | Passed, exit 0, 8.819 seconds |
| Fixed fixture: `pnpm toolchain:check` | Passed; Node 24.21.0, TypeScript 7.0.2, 78 strictly owned `.ts` sources |
| Fixed fixture: `pnpm lint` | Passed; 78 files, 195 rules, zero warnings/errors |
| Fixed fixture: `pnpm foundation:check` outside sandbox with explicit admitted Node | Passed; Foundation 1.10.1, full selected coverage, source-dependencies and dependency-declarations, zero diagnostics |
| Fixed fixture: `tsc -b --dry --verbose` | Passed; retained project discovery and all six non-root projects |
| Shared patch: `git diff --check` | Passed |

The two initial sandbox Foundation invocations stopped at runtime admission.
A direct probe found the sandbox returned `spawnSync ... EPERM` for the Node
identity subprocess, even with an explicit admitted Node executable. The same
existing check passed outside the sandbox. Raw unsuccessful and successful logs
are retained; no gate or policy was weakened.

## Scope and limits

This task ran no database scenario, full `pnpm check`, packed-consumer suite,
remote mutation or shared-root build. The changed contract is project build
ordering, and the retained focused checks cover that contract plus strict source
and lint discovery. The parent owns the independent review, commit and hosted CI
verification.
