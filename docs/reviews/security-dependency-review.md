# Supplemental independent security dependency review

## Exact subject and decision

- Repository: `agent-teams-ai/payments-sdk`.
- Merged baseline: **`01b90c7a6a902601c96856424b39f63fb5b9f9f2`**.
- Exact security correction reviewed: **`7762830fe904f95e3b6126aaad81be8366ba755a`** (`feat/security-undici`).
- Isolated detached reviewer worktree: `/workspace/scratch/9e36ca3bbd13/implementation/review-w4-platform`.
- Review date: 2026-10-19 UTC.

**Accept the bounded development-dependency correction. No additional actionable P0/P1/P2 was established in that three-file patch.** The change from npm Undici **7.24.0** to **7.30.1** is supported by current primary advisories, verified artifact integrity, a minimal lockfile delta and independent actual-SDK/packed-consumer checks.

This is a separate supplemental security review after the completed implementation review waves. It is **not** a claim that the qualified Node binaries' bundled HTTP implementation was patched by an npm development-dependency change. The remaining bundled-Node qualification below is material and has been explicitly handed to the coordinator for separate research/remediation.

No production source was edited, committed or pushed. This reviewer created or changed no remote release, tag, PR, alert, dependency graph or other API record, and did not publish a package or dismiss an alert.

## Concrete initial dependency finding

Read `/tmp/payments-sdk-dependabot-open.json`: the first default-branch analysis recorded **16 open alerts**, all for **development-scoped `undici`** in `pnpm-lock.yaml`: **3 high, 8 medium and 5 low**. The recorded patched 7.x floors are 7.28.0, 7.29.0 and 7.29.1. This establishes an outdated development dependency; it does not by itself establish a payment-runtime exploit or a production Undici package import.

The bot's 7.29.1 update would exceed those initial sixteen recorded advisory floors. However, it is an incomplete target relative to the newer primary advisories available on the review date.

## Why 7.30.1 rather than the bot's 7.29.1

Independently read the official [v7.29.1 release](https://github.com/nodejs/undici/releases/tag/v7.29.1), published **2026-09-04**, and [v7.30.1 release](https://github.com/nodejs/undici/releases/tag/v7.30.1), published **2026-10-15**. The latter is a security release with additional fixes after 7.29.1.

After the unauthenticated GitHub API began rate-limiting requests, read the official repository advisory API with the configured `gh` and its existing account configuration. Credentials were never read or printed. The following October 15 records were independently returned:

| Primary advisory | Severity | Affected npm Undici 7.x range | Patched 7.x version |
| --- | --- | --- | --- |
| [GHSA-qrxm-fqhp-jwvm — TLS renegotiation denial of service](https://github.com/nodejs/undici/security/advisories/GHSA-qrxm-fqhp-jwvm) | High | `>=7.0.0, <7.30.1` | 7.30.1 |
| [GHSA-2m5v-pch6-74hx — dropped TLS options in Agent](https://github.com/nodejs/undici/security/advisories/GHSA-2m5v-pch6-74hx) | High | `>=7.0.0, <7.30.1` | 7.30.1 |
| [GHSA-4w7w-5xrc-9h26 — cross-origin redirect cache poisoning/disclosure](https://github.com/nodejs/undici/security/advisories/GHSA-4w7w-5xrc-9h26) | High | `>=7.0.0, <7.30.1` | 7.30.1 |
| [GHSA-xjj6-f33q-929c — excessive content-encoding unhandled error](https://github.com/nodejs/undici/security/advisories/GHSA-xjj6-f33q-929c) | High | `>=7.18.0, <7.30.1` | 7.30.1 |
| [GHSA-55wc-3pg8-jfw6 — decompression interceptor unhandled exception](https://github.com/nodejs/undici/security/advisories/GHSA-55wc-3pg8-jfw6) | Medium | `>=7.15.0, <7.30.1` | 7.30.1 |
| [GHSA-f72v-6w45-q472 — mixed-case SRI algorithm bypass](https://github.com/nodejs/undici/security/advisories/GHSA-f72v-6w45-q472) | Medium | `>=7.15.0, <7.30.1` | 7.30.1 |
| [GHSA-4qv8-2p9j-2685 — unbounded EventSource parser state](https://github.com/nodejs/undici/security/advisories/GHSA-4qv8-2p9j-2685) | Medium | `>=7.0.0, <7.30.1` | 7.30.1 |
| [GHSA-9fm3-97px-rjf6 — unbounded automatic WebSocket PONG buffering](https://github.com/nodejs/undici/security/advisories/GHSA-9fm3-97px-rjf6) | Medium | `>=7.0.0, <7.30.1` | 7.30.1 |

Consequently, keeping the 7.x line and selecting **7.30.1** is a concrete security correction rather than an indiscriminate dependency upgrade. This comparison concerns affected versions, not a claim that every listed feature/exploit is reachable in the payment test harness.

## Exact artifact and minimal graph

Independently read [registry metadata for 7.24.0](https://registry.npmjs.org/undici/7.24.0), [7.29.1](https://registry.npmjs.org/undici/7.29.1) and [7.30.1](https://registry.npmjs.org/undici/7.30.1). Each declares `engines.node: >=20.18.1`; 7.30.1 has **no runtime dependencies**. Both qualified Linux Node floors satisfy that unchanged npm package engine.

Independently downloaded the [official 7.30.1 tarball](https://registry.npmjs.org/undici/-/undici-7.30.1.tgz), recomputed SHA-512 and matched the actual registry integrity and lockfile value:

```text
sha512-03KrMbjIFDWQR5RNPrSw3bd1r12JpyFQl9/yxjUbJtqkjmllqC5lFjZh6ujeuJCKr8EOQvRW872Oy/az+nLYxg==
```

Independent SHA-256:

```text
c98bd3881137c11341e8be8d2ec509ebf973b6f8b36d0a4c6d2afcda15e0d712
```

The downloaded evidence archive is `/tmp/payments-w4-undici-7.30.1-registry.tgz`. Its actual manifest identifies version 7.30.1, public `index.js`/declaration entry points, the unchanged engine and no dependencies.

The source delta contains exactly **three files**: `pnpm-workspace.yaml`, `pnpm-lock.yaml` and the new `docs/security-qualification.md`. Independent normalization of only the new lockfile's Undici version and integrity back to the baseline values produced the **byte-identical baseline lockfile**. No unrelated dependency, production implementation, manifest engine, Foundation pin, TS pin or release/CI policy was changed.

## Ownership, runtime closure and real test transport

Before and after the patch, actual `pnpm why -r undici` identifies only two importers: the root workspace and `payments-paddle`, both as **devDependencies**. Only one npm Undici version is installed; after the correction it is **7.30.1**.

The actual source imports are confined to the SDK test harness, reconciliation integration harness and E2E harnesses. None of the four delivery packages imports Undici in production source or lists it on a runtime/optional/required-peer edge. The actual official Paddle SDK **3.10.0** manifest has an empty runtime `dependencies` object, and its client calls the global `fetch`. The distinct `undici-types` package remains declaration tooling, not an imported Undici HTTP implementation.

Read the published 7.30.1 public implementation and declarations actually used by the harness: `MockAgent`, `disableNetConnect`, `close`, `getGlobalDispatcher`, `setGlobalDispatcher` and `install`. `install()` assigns the same ten globals that the maintained harness descriptor-saves and restores. No production global patch, raw provider HTTP client or private SDK import was added: the patch changes only the development package pin and security record.

The independently rerun SDK tests use the actual official SDK resources, serializers, entity constructors, errors and signature verifier. Their first test proves that an unmatched Paddle path and an unapproved origin fail with **`UND_MOCK_ERR_MOCK_NOT_MATCHED`**, while mock network connections are disabled. The harness's `finally` restores its retained dispatcher and original global property descriptors. These are meaningful transport checks across both approved Node floors, whose built-in Undici majors differ.

## Independent dynamic verification at the exact fix

Used the exact supported Node executable directories plus `/tmp/payments-sdk-tools`; pnpm **11.25.0**, TypeScript **7.0.2** and official Paddle SDK **3.10.0** remain unchanged.

| Actual command/check | Runtime | Result |
| --- | --- | --- |
| `pnpm install --offline --frozen-lockfile --ignore-scripts` | Node 24.21.0 | Passed; reused cached exact package, +1/-1 Undici replacement |
| `pnpm typecheck` | Node 24.21.0 | Passed; package build/declarations plus strict tests/tools/examples |
| Lockfile normalization against full baseline SHA | Local byte comparison | Passed; only Undici version/integrity differ |
| `pnpm why -r undici` | Node 24.21.0 | One 7.30.1 version; two development importers |
| `pnpm test:paddle` | Node 24.21.0 | **18 passed**, zero failed/skipped/cancelled |
| `pnpm test:paddle` | Node 26.11.1 | **18 passed**, zero failed/skipped/cancelled |
| `pnpm test:packed` | Node 24.21.0 | All **four** plain/adapters × NodeNext/Bundler profiles passed, strict with `skipLibCheck:false`; runtime imports and one physical Resources identity passed |

The packed gate creates current tarballs and installs fresh consumers. The production closure and source are unchanged by this development-only pin; no new runtime Undici edge appears.

The patch's security record also reports a complete `pnpm check` on both Node floors, real PostgreSQL and dated full/production audit results. Those broader runs belong to the correction implementer/coordinator. This reviewer independently ran only the bounded commands above and **did not resubmit a dependency graph or run either audit**. The coordinator states that the final production/full audit attempts were accepted and exited zero with zero advisory counts; an earlier automatic approval rejection does not make those later accepted runs a denied/unexecuted action. No claim of independent audit execution is made here.

## Material remaining boundary: Node's bundled Undici

Ran the actual approved binaries with `process.versions`:

| Binary | Reported bundled Undici |
| --- | --- |
| Linux Node **24.21.0** | **7.29.1** |
| Linux Node **26.11.1** | **8.11.2** |

The official [excessive content-encoding advisory](https://github.com/nodejs/undici/security/advisories/GHSA-xjj6-f33q-929c) includes both `>=7.18.0,<7.30.1` and `>=8.0.0,<8.12.2`; those reported bundled versions fall within its upstream affected ranges. The Node binaries themselves are not npm dependencies in this lockfile. Upgrading the harness's npm package does **not** upgrade global fetch in an ordinary production process, and a clean npm audit cannot establish that a bundled runtime implementation is fixed.

This is a **version-range qualification gap**, not a reproduced malicious-Paddle response, proof of exploit reachability, or an independent assessment of possible downstream Node backports. No process-crash exploit or source comparison of downstream Node security patches was performed. The coordinator explicitly accepted ownership of checking current official patched Node releases separately. Until that runtime qualification is complete, this npm patch must be described as a **development transport correction**, without claiming that all runtime HTTP/security concerns were fixed.

Production transport must remain the actual SDK using an admitted runtime; this review does not propose solving the separate Node question by patching production globals or adding a private SDK seam.

## Limits

This targeted review did not repeat PostgreSQL, recovery, financial reducer, consumer or full-system suites; those implementation semantics are unchanged by the three-file patch. It did not test live Paddle account behavior or real payments, publish npm/release assets, alter or dismiss Dependabot alerts, install unrelated upgrades, or establish absence of undisclosed vulnerabilities. Post-merge alert closure and the exact final commit's required CI remain separate read-backs. The supplemental npm pin correction is accepted subject to those normal gates and the explicitly separate bundled-Node follow-up.
