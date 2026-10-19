# Historical Node runtime investigation evidence

This is the public evidence subset for the [2026-10-19 runtime investigation](../node-runtime-security-research.md). It preserves actual execution results, source comparison hashes, official retrieval URLs/timestamps and the historical local probe. The report is retained unchanged; its original local inventory also included downloaded official binaries, archives, upstream source diffs and full source/HTML snapshots. Those reproducible large downloads are not committed here.

`content-encoding-runtime-probe.ts.txt` preserves the exact historical TypeScript probe as evidence text. It was executed as `content-encoding-runtime-probe.ts` in isolated research storage. It is not a maintained SDK tool, CI gate or deployment workaround; its absolute comparison-import path records the original experiment. The loopback-only experiment used no credentials and contacted no external payment service. Execution JSON records the four global-fetch failures and four patched-fetch comparison successes.

The decision summary and [current security qualification](../../security-qualification.md) distinguish functional prerelease delivery from blocked production runtime admission. The latter owns future corrected-runtime admission; these historical results must not be rewritten as though a future binary had already been tested.
