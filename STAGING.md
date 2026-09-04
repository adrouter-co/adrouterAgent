# Staging validation artifacts

Only `.github/workflows/ci.yml` is approved for this source migration. It uses read-only
repository permissions and no hosted credentials. Release, deployment and promotion workflows
remain disabled. Published versions and release manifests are unchanged.

Successful CI jobs retain their tested package, native ZIP or archived build for seven days.
Artifact names include the workflow source SHA and platform/job. `staging-manifest.json`
records the exact checkout SHA, run/attempt and each file's SHA-256; `SHA256SUMS` also covers
the manifest. Verify both after download. A successful individual artifact does not make the
surface green: every required matrix job must pass on the same source SHA.

The macOS job rebuilds the normal universal app after E2E with `ADROUTER_E2E_BUILD=0` and
runs distribution verification before uploading the credential-free ZIP. The E2E inspector
must remain disabled in the exported application.

`STAGING_VERIFIED — live acceptance pending owner testing` requires all required CI jobs and
artifact/source/checksum verification. It does not assert deployment or live acceptance.

The migration validation found GHSA-jmr9-qjv8-65gv in Forge's transitive `extract-zip`.
Packager now resolves Electron's maintained `@electron-internal/extract-zip@1.0.5` through a
scoped npm override; Electron's existing internal extractor is pinned to the same version.
The regression test exercises Packager's real CommonJS import, valid extraction, and rejection
of an escaping ZIP symlink. The audit policy and public app/launcher versions are unchanged.
