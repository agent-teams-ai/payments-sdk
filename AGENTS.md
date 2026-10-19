# Payments SDK contributor instructions

Implement the accepted `docs/implementation-plan.md` incrementally. Keep payment operations, commercial access, credit accounting and usage independently owned. Core must not import Paddle, PostgreSQL, Get Modular, HTTP frameworks or Engineering Foundation. Contract ownership and observable guarantees matter more than file counts.

## Language and tooling

Maintained runtime, tests and tooling use TypeScript `.ts` only. No `.mjs` or `.mts` source. TypeScript compiler/parser minimum is 7.0.2. Emit ESM JavaScript and declarations. Tests and tools belong to strict projects; packed NodeNext and Bundler consumers use skipLibCheck:false. Engineering Foundation is development-only. Runtime target Linux Node >=24.21.0 <25 || >=26.11.1 <27 and PostgreSQL 18, subject to explicit qualification.

## Scope and invariants

Four delivery packages: @agent-teams/payments-core, payments-paddle, payments-postgres and payments-get-modular. Initial profile: one no-trial monthly price quantity 1; independent one-time top-ups. Observe external unsupported changes without falsely confirming them.

Never auto-retry an external mutation after a durable dispatch marker. Preserve unknown outcomes, immutable facts, stable evidence revisions, causal grant identities, initial-intent guard and owner-local T1/T2/T3 boundaries. No cross-context SQL/UoW. Store and provider DTOs never escape into core public contracts. Hooks are optional read projections, never financial delivery.

Use official Paddle Node SDK. Test-only emulation may control the test process HTTP transport; production adapter must not patch global fetch, import private SDK paths or invent raw API custody. No live credentials or charges in automated tests.

## Verification and work

Prefer end-to-end fixture scenarios and real PostgreSQL integration over large shallow unit suites. Focus isolated tests on complex reducers, precision, concurrency and failure recovery. Expected results must be independent from the implementation. Use no fixed sleeps as correctness oracles.

Commit small coherent changes, review PRs with independent GPT-6.1 sol xhigh agents, fix material findings and merge. Do not modify upstream accepted ADRs or existing user projects. Keep CI fast with shared cached install/build artifacts, independent parallel gates and cancellation of obsolete PR runs. Do not disable a required gate to make CI green.

Q source: https://github.com/777genius/agent-rules/blob/5f1b5aefa96d64448d909ae9c04a823afe145ea8/skills/q/SKILL.md . Apply SRP/OCP/LSP/ISP/DIP and DRY by responsibility, dependency direction, contract and minimum useful boundary.
