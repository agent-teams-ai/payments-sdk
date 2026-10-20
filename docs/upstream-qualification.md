# Current upstream qualification

This record separates admitted upstream source, published dependencies and local consumer qualification. Official-source read-back: **2026-10-19 20:25:36 UTC**. The accepted implementation plan and earlier review records retain their original snapshots; this record owns subsequent dependency and release-status updates.

Final delivery read-back completed at **2026-10-19 21:00:05 UTC**; the
[official-source follow-up](reviews/upstream-delivery-status.md) confirms the
same dependency versions and publication/browser gates. Get Modular main advanced
to [`eef13520a0c7908ba6c764f8aac8a13862df671a`](https://github.com/agent-teams-ai/get-modular/commit/eef13520a0c7908ba6c764f8aac8a13862df671a)
through one installed-source/shutdown fixture qualification commit. The complete
delta changes no package runtime source, CMS or observation contract document;
direct watch/load/types/values/CMS reads retain the same blobs. The dated source
and dependency qualification below remains its original reproducible snapshot.

## October 20 published observation adoption

A fresh official registry read-back on **2026-10-20** confirms the coordinated release is published. This supersedes the unpublished-train statements in the historical sections and [earlier continuation record](reviews/upstream-continuation-2026-10-20.md).

| Official package | Version | Published UTC | Packed dependency / peers |
| --- | --- | --- | --- |
| [Core](https://registry.npmjs.org/@get-modular%2fcore/0.6.0) | `0.6.0` | 08:18:30.311 | none |
| [Assembly](https://registry.npmjs.org/@get-modular%2fassembly/0.6.0) | `0.6.0` | 08:15:50.750 | exact Core `0.6.0` dependency |
| [Resources](https://registry.npmjs.org/@get-modular%2fresources/0.2.0) | `0.2.0` | 08:17:18.249 | none |
| [Conformance](https://registry.npmjs.org/@get-modular%2fconformance/0.4.0) | `0.4.0` | 08:18:54.515 | Core/Assembly `^0.6.0`, Resources `^0.2.0` peers |
| [Observation](https://registry.npmjs.org/@get-modular%2fobservation/0.1.0) | `0.1.0` | 08:17:26.586 | Resources `^0.2.0` peer |

All five official archives were downloaded freshly and checked against registry SHA-512 SRI and SHA-1. Their sizes and SHA-256 values exactly match the [original retained manifest](../qualification/observation/upstream-artifacts.json). Packed manifests agree with registry dependencies and peers. The [published artifact record](../qualification/observation/published-artifacts.json) retains exact registry URLs, hashes and read-back time. Archive equality establishes unchanged published runtime/declaration bytes, including `watch`, `load`, values and resource identity semantics; it does not relabel earlier tests as runs against npm.

Official GitHub API read-back confirms [release preparation #199](https://github.com/agent-teams-ai/get-modular/pull/199) merged at **2026-10-19 22:14:37 UTC**, merge `10bb2de2880e38398c836f6660244fd4cb665822`. [Migration fixture correction #200](https://github.com/agent-teams-ai/get-modular/pull/200) merged at **21:16:51 UTC**, merge `f1a81300881eed64ac1d18e2f36423a24e6ecc34`; it changes historical migration test inputs, with no runtime contract change. Publication is established independently through the official registry above.

The SDK adopts the exact coordinated pins and exports an optional public `@agent-teams/payments-get-modular/observation` subpath. Observation is an optional peer; the main static entry has no Observation import. The [maintained isolated consumer](../qualification/observation/README.md) now installs exact public versions beside all four packed payments packages, checks registry/archive identity, strict TypeScript `7.0.2` NodeNext/Bundler declarations and physical peer identity, and exercises the unchanged four scenario oracles against real PostgreSQL. The custom prepublication archive cache and duplicate qualification-source implementation are removed. Original candidate manifests, accepted ADRs and previous review/log evidence remain unchanged.

Paddle.js declaration and Node bundled-transport qualification retain their separately owned gates; this dependency adoption grants no additional production or live-account claim.

## Historical October 19 qualification

The following dated sections record their original source and dependency snapshots. The published adoption above owns current Get Modular status.

## Qualified dependency change

The workspace pins development-only `@agent-teams/engineering-foundation` to **1.10.1**. Its [official release](https://github.com/agent-teams-ai/engineering-foundation/releases/tag/%40agent-teams/engineering-foundation%401.10.1), published to [npm](https://registry.npmjs.org/%40agent-teams%2Fengineering-foundation) at 2026-10-19 19:36:48.427 UTC, fixes API extraction staging to exclude the generated `.worker-tmp` runtime-profile projection. [The source correction](https://github.com/agent-teams-ai/engineering-foundation/pull/414) prevents duplicated source trees and staged-entry budget exhaustion; it adds no payment runtime capability.

The dependency diff from `b4048b8` changes only the exact Foundation root development pin, its lockfile importer/package/snapshot key and archive integrity. Its transitive dependency versions are unchanged. The downloaded official archive matched registry SHA-512 integrity; SHA-256 is `966884cb3a2a2bbe43f13622f291f2c22a202e2d2365a44be9fc2dfd3c5e7551`.

| Dependency or tool | Current exact qualification pin |
| --- | --- |
| Engineering Foundation | **1.10.1**, development-only |
| TypeScript | **7.0.2**, strict with `skipLibCheck:false` |
| Linux Node | **24.21.0** and **26.11.1** |
| pnpm | **11.25.0** |
| Get Modular Core / Assembly | **0.5.0 / 0.5.0** |
| Get Modular Resources / test-only Conformance | **0.1.0 / 0.3.0** |
| Paddle Node SDK | **3.10.0** |

The separately published [FMS 0.1.2](https://github.com/agent-teams-ai/engineering-foundation/releases/tag/%40agent-teams/feature-module-standard%400.1.2) corrects its optional Foundation peer to `^1.8.0`. FMS is not used by this workspace and was not added. Package engines, runtime dependencies, Get Modular peers and TypeScript/Node pins are unchanged.

## Get Modular: merged implementation, unpublished release train

Official [main `3e595957424ebc8b0211da7ec5926688f0dd41de`](https://github.com/agent-teams-ai/get-modular/commit/3e595957424ebc8b0211da7ec5926688f0dd41de) now includes the observation implementation. The following merges were verified directly through the official GitHub API:

| PR | Merged at 2026-10-19 UTC | Reviewed head |
| --- | --- | --- |
| [#197 native TypeScript prerequisite](https://github.com/agent-teams-ai/get-modular/pull/197) | 17:01:34 | `42778e67cef3a6a82818cf5d8373d8d8a731591b` |
| [#154 observation ADR](https://github.com/agent-teams-ai/get-modular/pull/154) | 17:47:01 | `fc276a99707c5fccf4f99fec572c4b812ee48109` |
| [#185 implementation plan](https://github.com/agent-teams-ai/get-modular/pull/185) | 18:36:29 | `338621624306681db0cfe72cfac8bb5a2e28ed32` |
| [#195 runtime implementation](https://github.com/agent-teams-ai/get-modular/pull/195) | 19:49:10 | `aeeb71fe1c89e0ac390ddcb768cbaffc5d39d74a` |

The exact [source comparison](https://github.com/agent-teams-ai/get-modular/compare/3f5f3b303e99e4b8f919486d91d954f7f78e204d...aeeb71fe1c89e0ac390ddcb768cbaffc5d39d74a) leaves the previously reviewed `watch.ts` and `load.ts` implementations unchanged. Follow-up corrections enforce ordinary non-Proxy state on supported Node, preserve `unknown` in `Frozen<T>`, tighten limit/timeout validation, bound diagnostics and honor testing wait abort/deadline before quiet. The [current ownership contract](https://github.com/agent-teams-ai/get-modular/blob/3e595957424ebc8b0211da7ec5926688f0dd41de/packages/observation/README.md) keeps Host lifecycle, subscriber resources, coalesced state and latest-only loads separate from durable commands and financial delivery.

The [current CMS](https://github.com/agent-teams-ai/get-modular/blob/3e595957424ebc8b0211da7ec5926688f0dd41de/docs/architecture/common-assembly.md) SHA-256 is `c2fe582a14ff6e79620b232ca7ffc914afb0474ec21fd43f208251dd7252f4a3`, identical to the earlier reviewed observation-branch CMS, now admitted to main.

Actual npm publication remains a separate gate. The [Core](https://registry.npmjs.org/%40get-modular%2Fcore) and [Assembly](https://registry.npmjs.org/%40get-modular%2Fassembly) registry tags remain `latest:0.4.0`, `next:0.5.0`; [Resources](https://registry.npmjs.org/%40get-modular%2Fresources) remains `latest:0.1.0`; [Conformance](https://registry.npmjs.org/%40get-modular%2Fconformance) remains `latest:0.2.0`, `next:0.3.0`. The intended Core/Assembly **0.6.0**, Resources **0.2.0**, Conformance **0.4.0** versions are absent and [Observation](https://registry.npmjs.org/%40get-modular%2Fobservation) returns HTTP 404. [Release PR #199](https://github.com/agent-teams-ai/get-modular/pull/199) remained open at `9cabbd3892d2015056e8a83e6886674edb4ac298`.

This SDK qualifies only its installed static profile. Optional observation adoption still requires actual coherent release artifacts, exact peer identities, strict packed consumers and the hook behavior tests in the [integration guide](../packages/payments-get-modular/README.md#observation-hooks-explicit-release-gate). No unpublished version was installed and no peer range was widened.

## Paddle.js browser example: blocked strict declarations

The official [Paddle Node main](https://github.com/PaddleHQ/paddle-node-sdk/commit/651261beddfc65ba5f861729dca17044cbeffb5f) and [npm latest 3.10.0](https://registry.npmjs.org/%40paddle%2Fpaddle-node-sdk) are unchanged. Browser [wrapper main](https://github.com/PaddleHQ/paddle-js-wrapper/commit/3217c8e0ee6f075a62440050ea8bbc9cba74a3ce) and [npm latest 1.6.5](https://registry.npmjs.org/%40paddle%2Fpaddle-js) are also unchanged. Browser `next` is the older `1.6.3-next.0`; GitHub's release label `v1.7.1` is not a published npm 1.7.1 package.

The exact published browser declaration is byte-identical to [current official source](https://github.com/PaddleHQ/paddle-js-wrapper/blob/3217c8e0ee6f075a62440050ea8bbc9cba74a3ce/types/checkout/checkout.d.ts#L44): `PaddleEventData extends Partial<CheckoutEventError>` broadens `name` to all checkout names, beyond the two error names allowed by `CheckoutEventError`. Official [issue #127](https://github.com/PaddleHQ/paddle-js-wrapper/issues/127) remains open and reports the same TS2430 inheritance failure.

An isolated consumer of the exact published **1.6.5** package was checked with TypeScript **7.0.2**, Node **26.11.1**, `strict:true`, `skipLibCheck:false` and both **NodeNext** and **Bundler** resolution. Both fail with **TS2430 at `types/checkout/checkout.d.ts:44`**, naming `PaddleEventData` and `Partial<CheckoutEventError>`. This is an upstream declaration blocker, not a successful browser qualification. The wrapper was not installed into the SDK, and no private SDK patch or declaration suppression was introduced. A browser checkout example requires an actual fixed official artifact and its own qualification.

## Local qualification of Foundation 1.10.1

The isolated dependency graph at `b4048b8` plus the exact Foundation/doc changes above was installed with `pnpm install --frozen-lockfile --ignore-scripts`. These results qualify that patch subject; later source integrations require their own normal gates. The following actual repository commands ran against the installed **1.10.1** public package on both supported Linux Node versions; commands were not replaced by script-name or metadata checks.

| Gate | Node 24.21.0 | Node 26.11.1 |
| --- | --- | --- |
| `pnpm typecheck` | passed | passed |
| `pnpm toolchain:check` | passed; TS7.0.2 and 54 strictly owned `.ts` sources | passed; TS7.0.2 and 54 strictly owned `.ts` sources |
| `pnpm lint` | passed | passed |
| `pnpm foundation:check` | passed; both configured capabilities, zero diagnostics | passed; both configured capabilities, zero diagnostics |
| `pnpm foundation:assert-dev-only` | passed | passed |
| `pnpm foundation:assert-registry` | passed | passed |
| `pnpm test:boundaries` | 10 passed, zero skips/failures | 10 passed, zero skips/failures |
| `pnpm test:packed` | four strict consumer profiles passed | four strict consumer profiles passed |

Boundary probes verify a permitted same-owner import and reject core imports of Paddle/storage/Get Modular/Foundation, unowned sources/packages, cross-package deep/source bypasses and runtime imports of development-only dependencies. Packed checks cover plain-core and complete-adapter consumers under NodeNext and Bundler, runtime imports, absence of optional dependencies from the plain-core closure and one physical Resources identity for the Host and integration.

This patch's qualification covers the dependency/tooling and packed boundaries above. It does not independently rerun the financial, database or end-to-end scenario suites, qualify an unpublished observation runtime, or perform live Paddle sandbox checkout. Those release gates keep their own exact source and environment evidence.
