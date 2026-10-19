# Node runtime security admission for Payments SDK v0.1.0

**Research snapshot:** 2026-10-19, approximately 21:19–21:23 UTC. **Repository inspected read-only:** `implementation/payments-security-deps`, security work based on `7762830fe904f95e3b6126aaad81be8366ba755a`. No repository source, toolchain, global transport, credential, external payment operation, release, or API state was modified by this investigation.

## Decision

**An official patched Node 24.x or 26.x runtime for the confirmed excessive-content-encoding fetch vulnerability is unavailable in the published releases checked at this snapshot.** Upgrading only to the newest same-major Node releases does not fix this issue. Upgrading the development-only npm Undici dependency to 7.30.1 fixes that dependency's implementation; it does not replace Node's bundled global `fetch`, which the official Paddle SDK 3.10.0 calls in production.

This conclusion is supported by exact tagged-source comparison **and by reproducing the process crash on the official binaries**, not merely by matching `process.versions.undici` against an advisory range. The current floors and latest releases all crash in the local probe after the fetch rejection has already been caught.

Recommended release admission: retain functional qualification evidence, but **do not describe this snapshot as production security qualified**. If the owner proceeds with an evaluation/prerelease distribution, prominently disclose the unresolved runtime security limitation and the pending upstream qualification. A stable production admission should wait for a published corrected runtime (or an explicitly accepted, independently verified supported transport change); then update and test the exact accepted floors. A GitHub prerelease label does not itself remediate the runtime defect.

## Published runtime status and binary evidence

The [official release index](https://nodejs.org/dist/index.json) lists Node **24.22.0** and **26.12.0**, both dated October 14, as the newest releases in the supported majors. Both entries have `security: false`. The release notes identify [24.22.0 as LTS](https://nodejs.org/en/blog/release/v24.22.0) and [26.12.0 as Current](https://nodejs.org/en/blog/release/v26.12.0).

| Runtime | Role | Actual bundled Undici | Official exact fetch source | Local global-fetch probe |
|---|---|---:|---|---|
| 24.21.0 | Current project floor | 7.29.1 | Byte identical to upstream Undici 7.29.1 | Exit 1; unhandled response-content-length error |
| 24.22.0 | Latest published Node 24 | 7.29.1 | Byte identical to upstream Undici 7.29.1 | Exit 1; same error |
| 26.11.1 | Current project floor | 8.11.2 | Byte identical to upstream Undici 8.11.2 | Exit 1; same error |
| 26.12.0 | Latest published Node 26 | 8.11.2 | Byte identical to upstream Undici 8.11.2 | Exit 1; same error |

The two latest Linux x64 archives were downloaded from `nodejs.org/dist`, their SHA256 values compared successfully with the official release manifests, and only their `bin/node` members extracted into the isolated research directory. No existing toolchain was replaced. SHA256 verification checks equality with the HTTPS-served manifests; this investigation did not perform independent OpenPGP signature verification.

| Archive | Verified SHA256 |
|---|---|
| `node-v24.22.0-linux-x64.tar.xz` | `cc2f601cee82d9a5a233302fe307abc600727035fd7d2c3a3571755989e95008` |
| `node-v26.12.0-linux-x64.tar.xz` | `fd47865ecd6391ebb431fc815e01b9135bf83ded5cf373247e9331e196b7aded` |

Primary manifests: [24.22.0 SHASUMS256.txt](https://nodejs.org/dist/v24.22.0/SHASUMS256.txt), [26.12.0 SHASUMS256.txt](https://nodejs.org/dist/v26.12.0/SHASUMS256.txt). Local execution output is retained in `node-runtime-security-evidence/actual-runtime-versions.json`.

### Backport check and reproduction

For each of the four exact Node release tags, `deps/undici/src/lib/web/fetch/index.js` was compared with the relevant official Undici tag. All four were byte identical to the unpatched versions. The old code creates the internal body stream before checking whether the encoding chain exceeds five tokens, then rejects without aborting the response. The [7.30.1 fetch code](https://github.com/nodejs/undici/blob/v7.30.1/lib/web/fetch/index.js) moves stream creation after that check and aborts; [8.12.2](https://github.com/nodejs/undici/blob/v8.12.2/lib/web/fetch/index.js) has the corresponding correction. Exact differences and hashes are saved locally.

Official Node sources: [24.21.0](https://github.com/nodejs/node/blob/v24.21.0/deps/undici/src/lib/web/fetch/index.js), [24.22.0](https://github.com/nodejs/node/blob/v24.22.0/deps/undici/src/lib/web/fetch/index.js), [26.11.1](https://github.com/nodejs/node/blob/v26.11.1/deps/undici/src/lib/web/fetch/index.js), [26.12.0](https://github.com/nodejs/node/blob/v26.12.0/deps/undici/src/lib/web/fetch/index.js). The latest tags' actual bundled `deps/undici/undici.js` were also retained, including the same vulnerable ordering.

The bounded probe creates a loopback TCP server, sends one HTTP response with six gzip coding tokens and a declared one-byte body, then closes without a body. It uses no credentials and contacts no remote payment endpoint. Each runtime is executed in its own child process, with a watchdog only as a failure timeout. Every global-fetch run catches `TypeError: fetch failed` with the too-many-content-encodings cause, then terminates with an unhandled `UND_ERR_RES_CONTENT_LENGTH_MISMATCH`. The same probe using an explicitly imported npm Undici 7.30.1 `fetch` exits successfully on each runtime. That comparison demonstrates the fix and isolates the bundled-fetch problem; it is not a production mitigation or a Paddle adapter test.

Files: `content-encoding-runtime-probe.ts`, `content-encoding-runtime-probe-results.json`, `source-comparison.json`, `fetch-fix-7.29.1-to-7.30.1.diff`, and `fetch-fix-8.11.2-to-8.12.2.diff` in the evidence directory.

## Official Node guidance and scheduled security release

The [official October 2026 security announcement](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases), last updated October 14, says new Node 26.x, 24.x, and 22.x releases will be available **on or shortly after Wednesday, October 21, 2026**. Each line has HIGH as its highest issue severity. At this snapshot the announcement does **not** identify the future version numbers or explicitly map the planned fixes to these Undici advisories. Therefore the scheduled release is a concrete next qualification opportunity, not proof of a currently available repair or a guarantee that these particular issues will all be resolved.

The [Node release guidance](https://nodejs.org/en/about/previous-releases) recommends Active LTS or Maintenance LTS for production. The [official schedule](https://github.com/nodejs/Release/blob/main/schedule.json) places Node 24 in LTS, with Maintenance starting October 20, 2026, and Node 26's LTS transition on October 28, 2026. As of this investigation Node 26 support is a functionally supported Current-line option; Node 24 is the LTS production line. Neither available line is security qualified for the confirmed fetch defect.

## Paddle 3.10.0 applicability and public configuration

The official [Paddle v3.10.0 client source](https://github.com/PaddleHQ/paddle-node-sdk/blob/v3.10.0/src/internal/api/client.ts) calls unqualified global `fetch` for GET, POST, PATCH, and DELETE. Its [published package metadata](https://github.com/PaddleHQ/paddle-node-sdk/blob/v3.10.0/package.json) has `dependencies: {}`. The [public PaddleOptions](https://github.com/PaddleHQ/paddle-node-sdk/blob/v3.10.0/src/internal/types/config.ts) expose only `environment`, `logLevel`, and `customHeaders`; there is no supported per-instance fetch, dispatcher, TLS, redirect, or decompression control.

The SDK's [environment mapping](https://github.com/PaddleHQ/paddle-node-sdk/blob/v3.10.0/src/internal/api/constants.ts) uses `https://api.paddle.com` and `https://sandbox-api.paddle.com`. The payments adapter validates the scope and selects these enums itself; it does not expose a user-supplied API base URL. This narrows the initial remote peer to the official Paddle service. It does not prove all possible responses or infrastructure are benign, and a malicious/compromised reached endpoint remains within the advisories' threat model. No live Paddle vulnerability or compromise is claimed.

Paddle does not set `redirect`, so the actual bundled [Node fetch implementation](https://github.com/nodejs/node/blob/v24.22.0/deps/undici/undici.js) applies its default `follow` mode. Ordinary fetch automatically negotiates and decodes content codings; the Node source adds the normal supported encodings when the request has no explicit encoding header. Fixed initial origins therefore do not establish that every hop remains at the initial origin. This investigation did not make live API calls or test real Paddle redirects/TLS behavior.

The adapter's error translation catches a rejected promise, but that cannot catch the independently emitted unhandled internal stream error demonstrated above. Changing request headers to ask for `Accept-Encoding: identity` would not force a hostile peer to obey and is not an official workaround; the excessive-codings advisory explicitly lists no workaround. An externally installed or development-only npm package does not automatically replace Node's built-in fetch. [Node's fetch documentation](https://nodejs.org/api/globals.html#fetch) documents the bundled implementation and `process.versions.undici`. A global dispatcher changes the transport, not the vulnerable bundled fetch response-processing code; it is not sufficient evidence of repairing this issue. No global monkey patch, private Paddle import, raw-provider client, or undocumented option was introduced or recommended as an SDK fix.

## All security advisories in the official Undici 7.30.1 release

The [official 7.30.1 release notes](https://github.com/nodejs/undici/releases/tag/v7.30.1) enumerate eight issues. The following is a concise independent assessment against the inspected adapter's ordinary SDK transport. The negative applicability assessments concern this adapter's configured path, not every use in a host process. A host that changes global dispatchers or uses other global web APIs needs its own assessment.

| Advisory | Severity / impact | Published affected 7.x / 8.x ranges | Assessment for inspected Paddle path |
|---|---|---|---|
| [GHSA-xjj6-f33q-929c](https://github.com/nodejs/undici/security/advisories/GHSA-xjj6-f33q-929c), CVE-2026-109869 | High; process DoS from excessive content codings and early close | `>=7.18.0 <7.30.1`; `>=8.0.0 <8.12.2` | **Relevant fetch path; runtime crash independently reproduced.** Malicious/compromised reached endpoint prerequisite. Official workaround: none. |
| [GHSA-qrxm-fqhp-jwvm](https://github.com/nodejs/undici/security/advisories/GHSA-qrxm-fqhp-jwvm), CVE-2026-87018 | High; TLS1.2 certificate-changing renegotiation can cause process assertion failure | `>=7.0.0 <7.30.1`; `>=8.0.0 <8.12.2` | **Relevant conditional HTTPS transport risk.** Exact latest Node HTTP1/HTTP2 sources retain the implicated `ERR_TLS_CERT_ALTNAME_INVALID` assertions. No TLS repro performed. Requires a malicious/compromised TLS1.2 peer with the described valid certificates. Official workaround restricts connections to TLS1.3; Paddle public options provide no such per-instance control. This would not repair the excessive-codings issue. |
| [GHSA-2m5v-pch6-74hx](https://github.com/nodejs/undici/security/advisories/GHSA-2m5v-pch6-74hx), CVE-2026-109383 | High; Agent drops function-valued custom `tls` verification options | `>=7.0.0 <7.30.1`; `>=8.0.0 <8.12.2` | Adapter sets no custom Agent or TLS verification callback, so the specific custom-verification prerequisite is absent. Host global Agent configuration may introduce it. Official workaround is to pass such options through `connect` (or relevant proxy TLS options). This is not a general default certificate-chain/hostname validation bypass. |
| [GHSA-4w7w-5xrc-9h26](https://github.com/nodejs/undici/security/advisories/GHSA-4w7w-5xrc-9h26), CVE-2026-109829 | High; cross-origin redirect shared-cache poisoning/disclosure | `>=7.0.0 <7.30.1`; `>=8.0.0 <8.12.2` | Adapter does not compose originless Agent `redirect(), cache()` with a shared cache; stated prerequisites absent in the inspected path. Host modifications need review. |
| [GHSA-55wc-3pg8-jfw6](https://github.com/nodejs/undici/security/advisories/GHSA-55wc-3pg8-jfw6), CVE-2026-87029 | Medium; asynchronous decompress-interceptor downstream-handler exception DoS | `>=7.15.0 <7.30.1`; `>=8.0.0 <8.12.2` | Adapter does not compose the `decompress` interceptor with `dump` or another throwing handler; normal fetch decoding is not evidence that this distinct interceptor prerequisite exists. |
| [GHSA-f72v-6w45-q472](https://github.com/nodejs/undici/security/advisories/GHSA-f72v-6w45-q472), CVE-2026-109841 | Medium; mixed/uppercase SRI algorithm-token integrity bypass | `>=7.15.0 <7.30.1`; `>=8.0.0 <8.12.2` | Paddle requests do not supply fetch `integrity` metadata; stated prerequisite absent. Official workaround uses lowercase tokens. |
| [GHSA-4qv8-2p9j-2685](https://github.com/nodejs/undici/security/advisories/GHSA-4qv8-2p9j-2685), CVE-2026-109924 | Medium; unbounded EventSource parser state memory DoS | `>=7.0.0 <7.30.1`; `>=8.0.0 <8.12.2` | Adapter does not create EventSource connections. The host's separate use is outside this adapter qualification. |
| [GHSA-9fm3-97px-rjf6](https://github.com/nodejs/undici/security/advisories/GHSA-9fm3-97px-rjf6), CVE-2026-109932 | Medium; unbounded automatic WebSocket PONG buffering memory DoS | `>=7.0.0 <7.30.1`; `>=8.0.0 <8.12.2` | Adapter does not create WebSocket connections. The advisory explicitly includes Node global WebSocket, relevant to host applications that use it. |

All eight are patched in Undici 7.30.1 and 8.12.2; some also have the published 6.29.1 fix. The exact Node fetch reproduction above establishes the important unresolved production path without asserting that every advisory is exploitable by the payments adapter.

## Concrete next gate

1. Keep the npm development dependency correction and normal SDK functional/build/consumer/E2E gates as distinct work. Passing those gates does not confer runtime security admission.
2. Disclose the confirmed bundled-fetch DoS and conditional TLS1.2 risk in the release/security posture, with the official advisory links, affected qualified runtimes, and lack of a currently published corrected same-major runtime.
3. Recheck official Node release metadata after the announced security release. Do not guess version numbers, announce unpublished fixes, or silently move floors to 24.22.0/26.12.0 as a purported repair.
4. Once a corrected official runtime is available, verify its exact source/backports and official artifact checksum, rerun the bounded global-fetch probe plus meaningful SDK end-to-end qualification, assess all relevant advisories, and set exact floors based on that evidence. Prefer the LTS line for the production recommendation according to Node guidance.

## Evidence inventory and limits

`node-runtime-security-evidence/` contains raw official HTML/JSON/source, stripped human-readable security pages, retrieval manifests with URLs and UTC timestamps, release archive hashes, source comparison/diffs, exact runtime execution output, and the isolated local probe/output. Unauthenticated GitHub API advisory/release reads returned 403 for two requests; official repository HTML pages and exact tagged raw sources were successfully retrieved instead. No credentials were needed or inspected. The signed-in GitHub CLI was not used.

The report establishes a confirmed local runtime vulnerability and the adapter's relevant transport path. It does not assert a live exploit against Paddle, test live TLS renegotiation, certify every other host transport configuration, or independently certify the whole SDK. The future Node security release's particular fixes remain unpublished at this snapshot.
