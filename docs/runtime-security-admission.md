# Corrected Node runtime qualification

Official-source and binary read-back: **2026-10-21 UTC**. This successor records a concrete correction to the [October 19 runtime investigation](reviews/node-runtime-security-research.md) and its [security qualification](security-qualification.md#node-bundled-transport-scope). Historical reports, failure results and previously released artifacts keep their original subjects.

## Result and current admission

The official October 21 security releases provide **Node 24.22.1 LTS** with bundled **Undici 7.30.1**, and **Node 26.12.1 Current** with **Undici 8.12.2**. Fresh official Linux x64 archives match their SHA-256 manifests. Actual binaries report those exact versions and both complete the bounded malformed-response experiment through **unmodified global fetch** with normal process exit. The same maintained gate rejects the two formerly qualified affected floors, 24.21.0 and 26.11.1, after their late unhandled stream error. This demonstrates a corrected candidate beyond a release announcement or version-range inference.

**Repository qualification passed; deployment admission remains separate.** Independent review and the complete local repository gates passed on source `6f348df2d345edf5270ade0daebf67cc834de2de` with corrected Node **24.22.1 / 26.12.1**; the [exact-source qualification record](reviews/node-runtime-security-correction-2026-10-21/qualification.md) retains the logs, source identity and limits. The subsequent reviewed deliveries passed their [exact-commit hosted Checks](qualification.md#reviewed-hosted-baselines); each later revision needs its own run. Authorized Paddle account qualification, real host authorization, production commercial/credit policy owners, backup/restore and deployment recovery retain their [separate gates](qualification.md#deployment-and-credential-gates). Prefer the corrected LTS line for production planning; Node 26 remains Current at this read-back.

## Official artifacts and exact source

| Official runtime | Bundled Undici observed from the binary | Linux x64 `.tar.xz` SHA-256 |
| --- | --- | --- |
| [24.22.1 LTS](https://nodejs.org/en/blog/release/v24.22.1/) | 7.30.1 | `6c172a9ab6718f7b801fb5a7bd486af2ee5e32758086a04b84fcce2aa77095e6` |
| [26.12.1 Current](https://nodejs.org/en/blog/release/v26.12.1/) | 8.12.2 | `6170b2d474e1c626f43cff3adc118df9fe3b573258a4fc3d850c8dbc6b079bbd` |

The [official announcement](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases) now states that security releases are available. The release pages and their official `SHASUMS256.txt` manifests agree with the downloaded bytes. This comparison uses official HTTPS artifacts and checksums; detached release signatures were not independently verified. [Artifact evidence](reviews/node-runtime-security-correction-2026-10-21/artifacts.json) retains URLs, archive sizes/digests, manifest digests and actual `process.versions` output.

Through the authorized GitHub plugin, the exact Node tags were read at `deps/undici/src/package.json`, `lib/web/fetch/index.js`, `lib/dispatcher/client-h1.js`, `client-h2.js` and `agent.js`. The four selected source files in each Node tag are byte-identical to the corresponding patched official Undici tag, **v7.30.1** / **v8.12.2**. [Source comparison evidence](reviews/node-runtime-security-correction-2026-10-21/source-comparison.json) retains exact URLs, hashes, release source commits and eight comparisons.

The fetch correction checks the coding chain before allocating the body stream and aborts an excessive chain. Both HTTP/1 and HTTP/2 dispatcher sources remove the certificate-hostname-error assertion implicated by the TLS 1.2 advisory. The Agent source preserves TLS options outside its JSON clone. These are selected relevant-source inspections, not an independent audit of all Node code or a reproduced TLS exploit.

## Transport advisory assessment

The official [Undici 7.30.1](https://github.com/nodejs/undici/releases/tag/v7.30.1) and [8.12.2](https://github.com/nodejs/undici/releases/tag/v8.12.2) releases identify the same eight security corrections. Fresh reads of each advisory confirm **7.30.1** and **8.12.2** as patched versions. The inspected Paddle adapter path and its prerequisites remain as recorded in the historical investigation; the host's other global web APIs/configuration need their own assessment.

| Official advisory | Relevance and verification in this candidate |
| --- | --- |
| [GHSA-xjj6-f33q-929c](https://github.com/nodejs/undici/security/advisories/GHSA-xjj6-f33q-929c), excessive content codings | Relevant ordinary fetch path. Corrected source matches the patched tags; normal process completion is reproduced on both new binaries, with both old floors as rejecting controls. |
| [GHSA-qrxm-fqhp-jwvm](https://github.com/nodejs/undici/security/advisories/GHSA-qrxm-fqhp-jwvm), TLS 1.2 renegotiation | Conditional relevant HTTPS path. Both corrected dispatcher files match patched tags and remove the implicated assertions. No TLS renegotiation attack is reproduced. |
| [GHSA-2m5v-pch6-74hx](https://github.com/nodejs/undici/security/advisories/GHSA-2m5v-pch6-74hx), dropped custom TLS options | Adapter supplies no custom Agent/TLS callback. Corrected Agent source matches patched tags; host custom verification remains separately owned. |
| [GHSA-4w7w-5xrc-9h26](https://github.com/nodejs/undici/security/advisories/GHSA-4w7w-5xrc-9h26), redirect/shared-cache composition | Adapter does not configure the affected shared-cache interceptor composition. Fixed release/advisory mapping verified; no cache exploit is exercised. |
| [GHSA-55wc-3pg8-jfw6](https://github.com/nodejs/undici/security/advisories/GHSA-55wc-3pg8-jfw6), decompress interceptor | Adapter does not compose the affected interceptor and throwing handler. Fixed release/advisory mapping verified. |
| [GHSA-f72v-6w45-q472](https://github.com/nodejs/undici/security/advisories/GHSA-f72v-6w45-q472), SRI algorithm casing | Paddle requests supply no fetch integrity metadata. Fixed release/advisory mapping verified. |
| [GHSA-4qv8-2p9j-2685](https://github.com/nodejs/undici/security/advisories/GHSA-4qv8-2p9j-2685), EventSource memory | Adapter creates no EventSource. Fixed release/advisory mapping verified; other host use is outside this path. |
| [GHSA-9fm3-97px-rjf6](https://github.com/nodejs/undici/security/advisories/GHSA-9fm3-97px-rjf6), WebSocket PONG buffering | Adapter creates no WebSocket. Fixed release/advisory mapping verified; other host use is outside this path. |

These official Node security releases also carry other Node/dependency corrections listed on their release pages. This bounded candidate does not claim independent exploitation tests or complete security certification for those fixes. No live Paddle response, account compromise or external payment is used.

## Maintained gate and migration

All five workspace/package manifests now require **`>=24.22.1 <25 || >=26.12.1 <27`**. The toolchain gate enforces the same floors; Checks and Release candidate workflows select exact **24.22.1**, with both **24.22.1 / 26.12.1** scenario jobs. Existing engine ranges admitted affected binaries, so raising the host runtime is part of this deliberate prerelease compatibility change. No package dependency pin, database schema, payment API or durable identity changes.

`pnpm test:runtime-security` runs [the maintained strict-owned TypeScript probe](../tools/runtime-security-probe.ts). Its parent reuses the admitted `command()` helper from `tools/package-artifacts.ts`, requiring the actual child to exit zero after processing. The fresh child imports only Node built-ins, binds one ephemeral **127.0.0.1** server, returns six coding tokens and closes before the declared body, requires the expected fetch rejection, and closes its server. It never installs Undici, changes a dispatcher/global, catches process-level exceptions or calls Paddle.

A five-second child watchdog destroys owned sockets, closes its server and exits nonzero; normal cleanup also destroys owned sockets. The shared `node-or-bun` helper retains its bounded capture and outer direct-child timeout/TERM/KILL cleanup contract. There are no sleeps or elapsed-time success oracles. A process that crashes after its fetch rejection fails the parent gate. The gate runs in complete `pnpm check` and both CI scenario jobs.

[Probe evidence](reviews/node-runtime-security-correction-2026-10-21/probe-results.json) retains exact binaries, source hash, exit codes and output for the two new successes and two old failures. Reproduce the positive gate with an official corrected host runtime:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm test:runtime-security
```

Normal SDK suites still install the admitted development-only MockAgent transport in isolated processes. They separately qualify actual official SDK serializers/resources/entity constructors/signatures, real PostgreSQL, host lifecycle and independent consumers. They cannot substitute for this unmodified built-in fetch gate. The [complete local qualification](reviews/node-runtime-security-correction-2026-10-21/qualification.md) records the exact tested source `6f348df2d345edf5270ade0daebf67cc834de2de` separately from this successor documentation. The [reviewed hosted baselines](qualification.md#reviewed-hosted-baselines) bind the subsequent successful deliveries; the separate deployment gates remain applicable before final admission.
