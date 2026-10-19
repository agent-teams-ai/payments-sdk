# GitHub prerelease and production runtime admission review

Date: 2026-10-19 UTC.

## Subject and decision

Final exact subject: **`ad3f8bcf5125904beb3cf416e2ff266fb2b558db`**, branch `feat/security-undici`, repository `implementation/payments-security-deps`. Initial decision/disclosure review was against `01099feecb555ca037019665f2acb12cd028eeb9`; blocker documentation was committed in `7b08a59`, followed by the generated-release-notes correction in the final subject. The worktree was clean at final readback.

**GO for merging this correction/disclosure subject and proceeding through the existing exact-commit gates to the authorized GitHub-only functional prerelease. NO-GO for production runtime/security admission. No outstanding material finding in this bounded review.** The development-only Undici correction and honest functional artifact delivery are separable from production admission. A GitHub prerelease is a useful deliverable, but neither its label nor absence of npm publication mitigates the runtime fault. This decision does not authorize npm publication or claim that production readiness has been achieved.

The final release must select a commit that itself contains the conspicuous blocker documentation, obtain that exact commit's successful main-push Checks result, and publish the admitted CI tarballs through the existing immutable prerelease workflow. An earlier main commit without the blocker is outside this approval.

## Evidence and limits

- Independently opened the [official Undici advisory GHSA-xjj6-f33q-929c](https://github.com/nodejs/undici/security/advisories/GHSA-xjj6-f33q-929c). It describes process termination following a malformed excessive-content-encoding response and premature body close, including when the caller catches the fetch rejection; it identifies corrected 7.x/8.x versions and lists no workaround.
- Independently opened the [Node October security-release announcement](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases). It promises releases on or shortly after October 21, 2026; it does not yet establish an available corrected runtime, exact version, or mapping of that release to this advisory.
- Read the researcher's captured official release index, source files, binary manifests, runtime metadata, local-only probe source and eight child-process outcomes in `node-runtime-security-evidence`. Independently recomputed both latest Linux archive SHA-256 values against the captured official checksum manifests and all four fetch-source hashes against affected Undici tags. Node 24.21.0/24.22.0 contain Undici 7.29.1; Node 26.11.1/26.12.0 contain 8.11.2. The latest captured releases are dated October 14. All four captured global-fetch child probes exit 1 after catching rejection; explicit development Undici 7.30.1 controls exit 0.
- This is a concrete built-in-fetch availability defect. The probe uses a local HTTP server. It does **not** establish malicious Paddle behavior, exploitation against configured HTTPS Paddle origins, a way for an arbitrary inbound webhook sender to select the outbound response, data corruption, or a comprehensive security audit.
- Inspected the captured official Paddle 3.10.0 public options and client: outbound requests use global `fetch`; the public options expose environment, logging and headers, without a supported custom fetch/transport, AbortSignal or redirect override. Installing patched development Undici does not correct this production path. Global patches, private SDK paths and substitute raw API custody remain contrary to the accepted adapter design.

## Disclosure corrections: resolved

At the initial subject, `docs/qualification.md` still described manifest ranges as admitted runtimes, and generated release notes omitted the concrete runtime blocker. Exact final readback confirms these material issues are resolved:

1. Dated warnings appear near the beginning of the root README, qualification guide, Paddle package README, getting-started guide and release instructions. Generated GitHub release notes start with the production blocker before describing artifacts and functional Checks. They link the detailed evidence/admission requirements, with exact target-commit URLs in release notes.
2. The qualification table is explicitly a functional CI profile, and engine compatibility is distinguished from security admission. The functional matrix remains unchanged while latest available versions have the same defect; a cosmetic version bump would not be a fix.
3. The security record explicitly explains that synthetic SDK/integration/E2E transport uses the patched development fetch. Passing suites and zero npm advisory findings cannot establish the security of Node's bundled production fetch.
4. The detailed warning bounds the trigger to an affected response reaching built-in fetch, explains process termination despite caught rejection, and does not claim demonstrated live Paddle exploitation or an inbound webhook attack.
5. The future production gate requires an officially published corrected Node artifact, source and binary verification, and renewed meaningful actual-SDK, PostgreSQL, E2E and strict packed-consumer qualification on retained supported Node lines. Existing account/deployment gates remain separate.

## Release workflow readback

Read `AGENTS.md`, `tools/release-policy.ts`, `tools/release-candidate.ts`, shared archive/packing tools, release-policy checks, `.github/workflows/release.yaml` and Checks workflow. The release path requires the latest successful exact-commit authoritative main-push Checks run and successful Required checks aggregate; downloads its unexpired named artifact by run ID; requires/audits four versioned tarballs; copies rather than rebuilds them; records hashes/source/CI identity; rechecks package hashes and remote tag; and invokes `gh release create --prerelease` without overwrite or npm publication. Existing releases fail visibly. No workflow relaxation is needed for this decision.

No SDK source, tests, remote state, release assets or authentication configuration was changed by this review. No redundant tests were run; this is a bounded decision, disclosure and release-path review, relying on the recorded full dual-Node qualification and independent runtime research for their stated scopes.

## Final bounded readback and scope

Read back the final commit's release generator, public entry-point warnings, security/admission record, status/index updates and retained evidence. The published researcher report and source-comparison/runtime-outcome JSON are byte identical to the independent research originals. The historical probe is retained as evidence text, not a maintained SDK tool or a production workaround. The disclosed TLS 1.2 issue is separately conditional and explicitly not reproduced.

Compared the final subject with the initial review subject: no runtime package source, manifest, CI workflow, release-admission policy or archive/consumer mechanics changed; the release tool change is the warning text only. `git diff --check` passes. The implementer additionally reports post-edit Node 24 strict fast checks and 14 boundary checks passing; this reviewer did not rerun those gates or relabel the earlier dual-Node functional results as new final-SHA CI.

The main-push Checks/release workflow must still qualify the actual selected release SHA, including any report/index-only successor. Review approval is not evidence that the merge, main Checks, tag or GitHub release has already happened. Production remains blocked until the documented corrected-runtime and deployment gates are actually satisfied.
