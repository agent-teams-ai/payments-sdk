# Public SDK hardening before adoption

Owner approval (2026-10-23): make deliberate breaking changes before consumer adoption; remove superseded APIs rather than retaining legacy shims. Preserve financial custody, evidence and independent product ownership even when public signatures change.

## Current slice: HTTP and Host safety

Fetch ingress now bounds streamed bytes before accumulating the complete body, has an absolute read deadline, handles caller cancellation and rejects unbounded zero-length fragmentation. The Node wrapper retains its earlier streaming limit and shares the same limit constant. Verification receives exact raw bytes. Invalid JSON, UTF-8 and non-object purchase commands return 400; the buyer always comes from host authentication. The HTTP handler receives only the two operations it actually needs.

The durable Host shares one close operation across concurrent callers. It attempts both stops, starts both physical drains even after cleanup errors, preserves all failures, retains a structured worker report and permits retry after failed cleanup. Failed construction preserves the original cause together with cleanup failures. No borrowed pool is closed by these helpers. Physical drain is not replaced with a timer or an asserted cancellation.

Eight connected boundary scenarios cover these conditions. These are HTTP/lifecycle fixtures, not a second claim to Paddle signature or production-store qualification. Existing official Paddle/PostgreSQL E2E remains required. The malformed-JSON case was also run against the exact previous handler and failed before the fix. Initial isolated smoke checks ran under the available Node 22 runtime; they do not admit that runtime. Exact-head hosted checks on the repository's supported Node 24/26 floors remain mandatory.

## Subsequent scope

- Separate buyer-scoped reads from explicit operator inspection and update Get Modular contract revisions and installed consumers together.
- Bound physically unfinished external operations, preserve neutral retry timing and never retry an uncertain mutation automatically.
- Separate provider cursors from event identities without weakening atomic page custody or replay/progress rejection.
- Version PostgreSQL migrations and qualify data/in-flight-work preservation during upgrade.
- Measure concurrency, hot-key contention and backlog recovery with disposable PostgreSQL and synthetic provider responses; publish actual limits, not inferred throughput.

Full FMS, Foundation and node-or-bun remain in their adopted scopes. Central account-identity/admission activation remains a distinct pending administrative track; a source PR does not install GitHub rulesets. No temporary environment-export workflow is part of this change.
