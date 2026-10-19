# Final upstream delivery read-back

**Official read-back window: 2026-10-19 20:59:42–21:00:05 UTC.** GitHub public REST API and live official npm registry metadata were read. This pass changed no production worktree, dependency pin, current/frozen documentation, commit, PR or publication, and ran no new builds.

## Delivery decision

**The existing explicit release and browser gates remain accurate. No new dependency release requires adoption.** Get Modular observation remains merged but unpublished; the SDK's static peer set remains the qualified profile. Engineering Foundation 1.10.1, FMS 0.1.2, Paddle Node 3.10.0 and Paddle.js 1.6.5 remain current published versions. Paddle.js's official declaration blocker remains open and unfixed in published artifacts.

## Exact npm state

| Official registry | `latest` | `next` | Intended observation version | Present? |
| --- | --- | --- | --- | --- |
| [Core](https://registry.npmjs.org/%40get-modular%2Fcore) | 0.4.0 | 0.5.0 | 0.6.0 | **No** |
| [Assembly](https://registry.npmjs.org/%40get-modular%2Fassembly) | 0.4.0 | 0.5.0 | 0.6.0 | **No** |
| [Resources](https://registry.npmjs.org/%40get-modular%2Fresources) | 0.1.0 | — | 0.2.0 | **No** |
| [Conformance](https://registry.npmjs.org/%40get-modular%2Fconformance) | 0.2.0 | 0.3.0 | 0.4.0 | **No** |
| [Observation](https://registry.npmjs.org/%40get-modular%2Fobservation) | — | — | 0.1.0 | **No; HTTP 404** |

[Engineering Foundation](https://registry.npmjs.org/%40agent-teams%2Fengineering-foundation) remains `latest:1.10.1`, published **2026-10-19 19:36:48.427 UTC**, with the same registry integrity as the qualified artifact. [FMS](https://registry.npmjs.org/%40agent-teams%2Ffeature-module-standard) remains `latest:0.1.2`, published **19:38:26.987 UTC**, optional Foundation peer `^1.8.0`. FMS remains unused by the SDK.

## Get Modular current source

Current main is now [`eef13520a0c7908ba6c764f8aac8a13862df671a`](https://github.com/agent-teams-ai/get-modular/commit/eef13520a0c7908ba6c764f8aac8a13862df671a), committed **20:30:09 UTC**. It advanced from the earlier `3e595957…` snapshot by one **installed-source/shutdown consumer-fixture qualification** commit. The [complete official comparison](https://github.com/agent-teams-ai/get-modular/compare/3e595957424ebc8b0211da7ec5926688f0dd41de...eef13520a0c7908ba6c764f8aac8a13862df671a) changes test fixtures, development tooling/profiles and their lock/manifest inputs; it changes no `packages/*/src` runtime source and no CMS or observation contract document.

Direct exact-main file reads also confirm the previously reviewed blobs are unchanged:

| File | Current Git blob |
| --- | --- |
| [watch.ts](https://github.com/agent-teams-ai/get-modular/blob/eef13520a0c7908ba6c764f8aac8a13862df671a/packages/observation/src/features/store/watch.ts) | `7653f0e588cf1acdbc294ab18b56cfb42e1d8474` |
| [load.ts](https://github.com/agent-teams-ai/get-modular/blob/eef13520a0c7908ba6c764f8aac8a13862df671a/packages/observation/src/features/store/load.ts) | `0dea3c8cb3c7d017dddd77626c9a01c593685a88` |
| [types.ts](https://github.com/agent-teams-ai/get-modular/blob/eef13520a0c7908ba6c764f8aac8a13862df671a/packages/observation/src/features/store/types.ts) | `14b4fbebbb37047842e82448a0ced694906be01b` |
| [values.ts](https://github.com/agent-teams-ai/get-modular/blob/eef13520a0c7908ba6c764f8aac8a13862df671a/packages/observation/src/features/store/values.ts) | `7eb5fcf934c992ee49c30404af920cdcfa4cbb92` |
| [CMS](https://github.com/agent-teams-ai/get-modular/blob/eef13520a0c7908ba6c764f8aac8a13862df671a/docs/architecture/common-assembly.md) | `ae6792543bd19acc948e177e8d55632c9d51134e` |

CMS SHA-256 remains `c2fe582a14ff6e79620b232ca7ffc914afb0474ec21fd43f208251dd7252f4a3`.

[PR #195](https://github.com/agent-teams-ai/get-modular/pull/195) remains **merged**, at **19:49:10 UTC**, head `aeeb71fe1c89e0ac390ddcb768cbaffc5d39d74a`. [Release PR #199](https://github.com/agent-teams-ai/get-modular/pull/199) remains **open**, head `9cabbd3892d2015056e8a83e6886674edb4ac298`. [Fixture correction #200](https://github.com/agent-teams-ai/get-modular/pull/200) remains **open**; its refreshed head is `9f96b3edcd34bd310e01ff3c420e5f1c14665440`, now based on `eef13520…`. These source advances do not establish package publication or SDK hook qualification.

## Paddle publication and official fix status

[Paddle Node registry](https://registry.npmjs.org/%40paddle%2Fpaddle-node-sdk) still identifies **3.10.0** as latest/newest published version. [Paddle.js registry](https://registry.npmjs.org/%40paddle%2Fpaddle-js) still identifies **1.6.5** as latest/newest published version, with `next:1.6.3-next.0`. Thus no newer fixed official browser artifact was published.

[Official issue #127](https://github.com/PaddleHQ/paddle-js-wrapper/issues/127) remains **open** with the exact `PaddleEventData` / `Partial<CheckoutEventError>` inheritance failure. Official wrapper main remains [`3217c8e0ee6f075a62440050ea8bbc9cba74a3ce`](https://github.com/PaddleHQ/paddle-js-wrapper/commit/3217c8e0ee6f075a62440050ea8bbc9cba74a3ce); a direct [checkout declaration](https://github.com/PaddleHQ/paddle-js-wrapper/blob/3217c8e0ee6f075a62440050ea8bbc9cba74a3ce/types/checkout/checkout.d.ts#L44) read retains the same inheritance and SHA-256 `64d6a5940a77d8bc67eeae31da62874e70e60fd22afa0cb881aa769098418129`. The sole open wrapper PR remains [#131 express settings](https://github.com/PaddleHQ/paddle-js-wrapper/pull/131), not a type fix.

The already reproduced strict TS7 NodeNext/Bundler browser blocker therefore remains an explicit gate. This final pass did not rerun that probe or change its qualification subject.

## Evidence and limits

Exact API URLs, times, heads, registry tags/version presence, current source blobs/SHA-256 and the main delta are retained in [the read-back record](final-upstream-delivery-status.json). The 20:25 research/documentation snapshot remains valid as a dated record; current main metadata is updated here. No optional new build, deployment, sandbox exercise or dependency adoption follows from this read-back.
