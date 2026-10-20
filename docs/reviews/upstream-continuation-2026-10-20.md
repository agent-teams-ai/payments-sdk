# Upstream continuation — October 20, 2026

Official-source read-back: **2026-10-20 07:53–07:58 UTC**. This is a new dated
record; it does not rewrite the accepted implementation plan or prior reviews.
Three independent GPT-6.1-sol xhigh researchers checked runtime security,
Get Modular source/archive readiness, and the official Paddle browser/Node SDKs.

## Get Modular: exact candidate available, registry adoption pending

[Main c5c314ab98c57d2c73448f0c3c9860424a993d8a](https://github.com/agent-teams-ai/get-modular/commit/c5c314ab98c57d2c73448f0c3c9860424a993d8a)
contains the original release archives and owner handoff. [Release PR #199](https://github.com/agent-teams-ai/get-modular/pull/199)
merged on October 19 at 22:14:37 UTC, reviewed head
`2cd561688bb223f944425718cc093e55ff4bc20d`; [#200](https://github.com/agent-teams-ai/get-modular/pull/200)
merged at 21:16:51 UTC. Their source delta does not change the reviewed Observation
watch/load/types or common assembly contract.

Direct [Core](https://registry.npmjs.org/%40get-modular%2Fcore),
[Assembly](https://registry.npmjs.org/%40get-modular%2Fassembly),
[Resources](https://registry.npmjs.org/%40get-modular%2Fresources), and
[Conformance](https://registry.npmjs.org/%40get-modular%2Fconformance) metadata still
lack versions 0.6.0, 0.6.0, 0.2.0 and 0.4.0 respectively;
[Observation](https://registry.npmjs.org/%40get-modular%2Fobservation) returns 404.
The previously qualified published static train remains unchanged.

All five original archives were independently downloaded and hashed. The
[admitted archive manifest](../../qualification/observation/upstream-artifacts.json)
records exact sizes, SHA-256 values, package names, versions and actual packed
peer/dependency relationships. These agree with the upstream
[release handoff](https://github.com/agent-teams-ai/get-modular/blob/c5c314ab98c57d2c73448f0c3c9860424a993d8a/research/releases/observation-0.1.0/release-intent.md).
Assembly requires exact Core 0.6.0; Observation requires Resources ^0.2.0;
Conformance requires the coherent Core/Assembly/Resources set. The old static
payments adapter is excluded from the candidate graph rather than having its
published peer contract overridden.

Accepted upstream [ADR-0038 §7](https://github.com/agent-teams-ai/get-modular/blob/c5c314ab98c57d2c73448f0c3c9860424a993d8a/docs/decisions/0038-require-typescript-7-for-current-package-qualification.md)
permits preparation and testing of exact unpublished candidates. Accordingly the
SDK now maintains a [concrete read projection and consumer](../../qualification/observation/README.md)
against these archives. Candidate qualification does not prove npm publication,
change the four SDK packages' supported dependencies, or authorize production.
Final adoption requires exact published registry-byte qualification and a
coherent reviewed dependency change.

## Node: staged correction, no released repaired runtime

The official [release index](https://nodejs.org/dist/index.json) still lists
24.22.0 and 26.12.0 as the newest same-major releases. Their bundled Undici
versions remain 7.29.1 and 8.11.2, with fetch source hashes equal to the previously
[reproduced crashing binaries](node-runtime-security-research.md). No unchanged
binary was claimed as newly repaired or requalified.

New upstream progress is [Node commit 1d4c89ef879f3e9ab146784189ef6d91d833ea98](https://github.com/nodejs/node/commit/1d4c89ef879f3e9ab146784189ef6d91d833ea98),
October 19 at 21:42:51 UTC, updating the Node 24 staging branch to Undici 7.30.1.
The fetch implementation at staging head
`9243b105b6c944e0644f73170d7e8f797afd1334` is byte-identical to the corrected
Undici 7.30.1 source. Node 26 staging still contains 8.11.2. A staged correction
is not a released supported runtime.

The official [security announcement](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases)
still schedules releases on or shortly after October 21; it supplies no exact
fixed version/advisory mapping at this read-back. The SDK retains its explicit
[production admission blocker](../security-qualification.md#node-bundled-transport-scope).
A corrected official artifact must pass checksum/source review, the bounded
unmodified-fetch probe, the applicable advisory assessment, and normal
SDK/database/consumer qualification before that status changes.

## Paddle: exact published sources unchanged

Official [Paddle Node main](https://github.com/PaddleHQ/paddle-node-sdk/commit/651261beddfc65ba5f861729dca17044cbeffb5f)
and [npm](https://registry.npmjs.org/%40paddle%2Fpaddle-node-sdk) remain 3.10.0.
The integrity-verified public package still calls global fetch and exposes
only environment, log level and custom headers in its transport configuration.
There is no newly supported fetch/dispatcher injection seam.

Official [Paddle.js main](https://github.com/PaddleHQ/paddle-js-wrapper/commit/3217c8e0ee6f075a62440050ea8bbc9cba74a3ce)
and [npm](https://registry.npmjs.org/%40paddle%2Fpaddle-js) remain 1.6.5.
[Issue #127](https://github.com/PaddleHQ/paddle-js-wrapper/issues/127) is open.
The exact published checkout declaration is byte-identical to current official
source, SHA-256 `64d6a5940a77d8bc67eeae31da62874e70e60fd22afa0cb881aa769098418129`.
The integrity-verified TS 7.0.2 compiler reproduces TS2430 in both NodeNext and
Bundler with strict:true and skipLibCheck:false on both Node 24.21.0 and 26.11.1.
The inheritance broadens PaddleEventData.name beyond the names allowed by
Partial<CheckoutEventError>. No declaration suppression or private patch is
admitted. The backend checkout-URL integration remains available.

## Delivery scope

The existing [v0.1.0 GitHub prerelease](https://github.com/agent-teams-ai/payments-sdk/releases/tag/v0.1.0)
continues to identify commit `1080854be73fc9e61f7a2b3f634c79c661fd1a55`
and its successful exact main-push Checks run. Its public release API reports
`immutable:false`; exact-commit provenance and tag protection must not be
misrepresented as GitHub-enforced immutable-release mode. This continuation does
not overwrite its artifacts, publish npm packages or execute live payments.
