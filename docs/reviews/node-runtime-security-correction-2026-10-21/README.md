# October 21 corrected-runtime candidate evidence

This evidence supports the [current runtime admission candidate](../../runtime-security-admission.md). It records local official artifact verification and regression behavior, not final production admission or successful exact-head hosted CI.

- [artifacts.json](artifacts.json): downloaded official Linux x64 archive SHA-256 comparison, manifest identity and actual binary Node/Undici/OpenSSL versions.
- [source-comparison.json](source-comparison.json): authorized GitHub plugin reads, selected exact Node-tag source hashes, corresponding patched Undici releases and eight byte-equality comparisons.
- [advisories.json](advisories.json): current official patched floors and inspected Paddle path prerequisites for all eight October 15 transport advisories.
- [probe-results.json](probe-results.json): actual maintained parent-gate output on corrected Node 24.22.1/26.12.1 and rejecting affected Node 24.21.0/26.11.1 controls. The parent uses the admitted captured-command helper; success requires the child process to exit normally.
- [reviews.md](reviews.md): independent GPT-6.1-sol / xhigh review, exact reviewed blobs, actual probes and the two resolved documentation findings.
- [qualification.md](qualification.md) and [full-qualification.json](full-qualification.json): subsequent complete local gates on clean source `6f348df2d345edf5270ade0daebf67cc834de2de` under both corrected floors, with retained raw logs, package identities and compiler/install evidence. Hosted exact-commit qualification remains pending.

Large official binaries and upstream source downloads are reproducible from the URLs and remain outside the repository. The older [runtime evidence](../node-runtime-security-evidence/README.md), reports, probes and released artifacts keep their original dates and results. The successor does not rewrite their failures as passes. Full current-source SDK/PostgreSQL/E2E/packed-consumer checks and reviewed exact-commit hosted CI retain their separate owner and subject.
