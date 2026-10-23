# Current upstream qualification

## October 21 official Node security correction candidate

The [current runtime qualification](runtime-security-admission.md) supersedes the historical Node-floor snapshot below: official Node **24.22.1 LTS** / **26.12.1** contain corrected Undici **7.30.1** / **8.12.2**, with verified archive checksums, exact tagged source comparisons and successful bounded unmodified-fetch process completion. Manifest/toolchain floors and exact CI versions use those releases, and the [reviewed hosted baselines](qualification.md#reviewed-hosted-baselines) passed. Each later revision requires its own checks; dependency pins and separate live-account/deployment gates are unchanged.

This record separates admitted upstream source, published dependencies and local consumer qualification. Official-source read-back: **2026-10-19 20:25:36 UTC**. The accepted implementation plan and earlier review records retain their original snapshots; this record owns subsequent dependency and release-status updates.

Final delivery read-back completed at **2026-10-19 21:00:05 UTC**; the
[official-source follow-up](reviews/upstream-delivery-status.md) confirms the
same dependency versions and publication/browser gates. Get Modular main advanced
to [`eef13520a0c7908ba6c764f8aac8a13862df671a`](https://github.com/agent-teams-ai/get-modular/commit/eef13520a0c7908ba6c764f8aac8a13862df671a)
through one installed-source/shutdown fixture qualification commit. The complete
delta changes no package runtime source, CMS or observation contract document;
direct watch/load/types/values/CMS reads retain the same blobs. The dated source
and dependency qualification below remains its original reproducible snapshot.

## October 23 descriptor-map guidance adoption

The current CMS/guide pin advances to reviewed Get Modular main commit
[`b70ba39304ac71964175c42a77309406a7c30ca2`](https://github.com/agent-teams-ai/get-modular/commit/b70ba39304ac71964175c42a77309406a7c30ca2).
Official source read-back verified CMS blob `bf6c64f5057c18cb3439c6b0e1a97b60428b0c53`,
SHA-256 `11a389b223506dc303fa986a7a37350b847013d85beb2de9d74cb8c97363e824`,
and guide blob `2500f71f56ef113d930d2e55840a5f96c4923ac7`, SHA-256
`9bdbc6a6eac511691cf429c7e7e12b4cf4fd86ec16a348fb3af7a46c989af144`.
The [adoption record](get-modular-adoption.md) reviews ADR-0041's complete
descriptor-union representation and its scope. A strict test using both actual
six-descriptor Payments maps proves all keys and complete entries; the normal
adoption gate rejects unused value and revision conflicts with TS2320.
The profile and rejecting adoption gate pin these exact document bytes.

This source-guidance migration changes no published dependency, production map,
runtime API or historical qualification claim. Full application FMS remains
adopted with an empty exception list. Required CI still qualifies the delivery's
exact source and both supported Node floors, including PostgreSQL integration.

## October 21 published Get Modular adoption

The reviewed source is Get Modular
[`fe4a2fdc878b46feebaececa3b0172b4534be935`](https://github.com/agent-teams-ai/get-modular/commit/fe4a2fdc878b46feebaececa3b0172b4534be935).
It supplies the Resources close-reentry repair, Observation report-and-await
load drain, typed preparation failures and bounded `formatFailure` text. The
[consumer profile](../architecture/get-modular-consumer-profile.json) pins CMS
SHA-256 `a6dac5d303adf80be3151c6703c919b715fd880a941a4ad68e927c87a7ee5882`;
the module-authoring guide remains byte-identical at SHA-256
`8d9e6ced096c3259ec8d7a35a1ee3c2f15e5832ba23c95da57f8cfc4c8622cfd`.

| Published package | Version | Consumer role |
| --- | --- | --- |
| Core / Assembly | `0.7.0` | Static composition |
| Resources | `0.2.1` | Resource ownership |
| Conformance | `0.5.0` | Development-only |
| Observation | `0.2.0` | Optional peer |

The [release workflow](https://github.com/agent-teams-ai/get-modular/actions/runs/39612969025)
completed prepare, publish, installed verification and latest promotion on
[`7131d0d7a6bb5dd4c3e8906ccac065c0be0e0333`](https://github.com/agent-teams-ai/get-modular/commit/7131d0d7a6bb5dd4c3e8906ccac065c0be0e0333).
Official registry read-back at **2026-10-21 14:14:57 UTC** confirmed all five
`latest` versions and matched every downloaded archive against the release
manifest. The [current artifact record](../qualification/observation/published-artifacts.json)
retains their exact registry, dependency, peer and integrity identities; its
SHA-256 is `6f6190afcfcee4d0fec1d9bbba210b12fc678ded4777e0664aba406517fee5ea`.

The isolated official packed consumer passed on Linux ARM64 Node `24.22.1` and
`26.12.1` with PostgreSQL `18`, strict TypeScript `7.0.2` NodeNext/Bundler,
physical peer identity and all four observation test files. Both reports record
`npmPublicationProven:true`, the same official manifest digest and identical
SHA-256 values for all four SDK archives. The
[consumer gate](../qualification/observation/README.md#qualification-boundary)
retains the report/log artifact names. The profile is `scoped-active` for this
technical composition adapter; full application FMS remains **not adopted**.
The complete `pnpm check` also passed on native ARM64 Node `26.12.1`.
[Hosted Checks](https://github.com/agent-teams-ai/payments-sdk/actions/runs/39616581734)
passed all five jobs on SDK source `2d11e4241de76eea3500c61ae0495ebd8691c70e`,
including both floors on native AMD64. Later source changes still require their
own exact-commit CI and independent review before merge. Production runtime security, Paddle account and deployment admission
retain the restrictions above and in the [qualification guide](qualification.md).

The local ARM64 Node archives matched the official SHA-256 manifests: `24.22.1`
`dbabf7a1cbf947e6059ffad2c27b80041db97dea1e553b62afdee7f13fca336e`;
`26.12.1` `42aa04922591ee5d4dbc7740d452621acf28508239daa512f5ee8c47ee224fdb`.
Earlier local AMD64-emulated results were invalidated after a numeric-conformance
probe failed; they do not own the qualification claim.

## Historical October 20 published observation adoption

A fresh official registry read-back on **2026-10-20** confirms the coordinated release is published. This supersedes the unpublished-train statements in the historical sections and [earlier continuation record](reviews/upstream-continuation-2026-10-20.md).

| Official package | Version | Published UTC | Packed dependency / peers |
| --- | --- | --- | --- |
| [Core](https://registry.npmjs.org/@get-modular%2fcore/0.6.0) | `0.6.0` | 08:18:30.311 | none |
| [Assembly](https://registry.npmjs.org/@get-modular%2fassembly/0.6.0) | `0.6.0` | 08:15:50.750 | exact Core `0.6.0` dependency |
| [Resources](https://registry.npmjs.org/@get-modular%2fresources/0.2.0) | `0.2.0` | 08:17:18.249 | none |
| [Conformance](https://registry.npmjs.org/@get-modular%2fconformance/0.4.0) | `0.4.0` | 08:18:54.515 | Core/Assembly `^0.6.0`, Resources `^0.2.0` peers |
| [Observation](https://registry.npmjs.org/@get-modular%2fobservation/0.1.0) | `0.1.0` | 08:17:26.586 | Resources `^0.2.0` peer |

All five official archives were downloaded freshly and checked against registry SHA-512 SRI and SHA-1. Their sizes and SHA-256 values exactly match the [original retained manifest](../qualification/observation/upstream-artifacts.json). Packed manifests agree with registry dependencies and peers. The [October 20 published artifact record](../qualification/observation/published-artifacts-2026-10-20.json) retains exact registry URLs, hashes and read-back time. Archive equality establishes unchanged published runtime/declaration bytes, including `watch`, `load`, values and resource identity semantics; it does not relabel earlier tests as runs against npm.

Official GitHub API read-back confirms [release preparation #199](https://github.com/agent-teams-ai/get-modular/pull/199) merged at **2026-10-19 22:14:37 UTC**, merge `10bb2de2880e38398c836f6660244fd4cb665822`. [Migration fixture correction #200](https://github.com/agent-teams-ai/get-modular/pull/200) merged at **21:16:51 UTC**, merge `f1a81300881eed64ac1d18e2f36423a24e6ecc34`; it changes historical migration test inputs, with no runtime contract change. Publication is established independently through the official registry above.

At that checkpoint the SDK adopted the exact coordinated pins and exported an optional public `@agent-teams/payments-get-modular/observation` subpath. Observation remained an optional peer; the main static entry had no Observation import. The [maintained isolated consumer](../qualification/observation/README.md) installed exact public versions beside all four packed payments packages, checked registry/archive identity, strict TypeScript `7.0.2` NodeNext/Bundler declarations and physical peer identity, and exercised the four scenario oracles against real PostgreSQL. The custom prepublication archive cache and duplicate qualification-source implementation were removed. Original candidate manifests, accepted ADRs and previous review/log evidence remain unchanged.

Paddle.js declaration and Node bundled-transport qualification retain their separately owned gates; this dependency adoption grants no additional production or live-account claim.

## Historical October 19 qualification

The following dated sections record their original source and dependency snapshots. The October 21 section above owns the current successor status.

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

## Historical Get Modular: merged implementation before publication

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

This SDK qualifies only its installed static profile. Optional observation adoption still requires actual coherent release artifacts, exact peer identities, strict packed consumers and the hook behavior tests in the [integration guide](../packages/payments-get-modular/README.md#optional-purchase-observation). No unpublished version was installed and no peer range was widened.

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
