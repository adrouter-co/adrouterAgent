# Public beta release checklist

Use this checklist after the `release-tag` workflow creates a draft GitHub
prerelease. Do not publish artifacts copied from a local `out/` directory.

## Automated gates

- [ ] The requested version matches `package.json` and `CHANGELOG.md`.
- [ ] Production dependency audit, lint, typecheck, unit, integration, packaged
      E2E, and staging-router smoke checks passed.
- [ ] The workflow produced one universal ZIP, the exact npm
      tarball, `SHA256SUMS`, application and launcher CycloneDX SBOMs, and
      `artifact-manifest.json`.
- [ ] Ad-hoc signature integrity, the absence of an Apple Team Identifier,
      production fuses, transport policy, legal resources, and both CPU slices
      passed distribution verification.
- [ ] No workflow logs or release artifacts contain router/provider secrets,
      absolute developer paths, or test-only hooks.
- [ ] GitHub attestations verify for every checksummed release asset.

## Downloaded-artifact acceptance

- [ ] Download the ZIP from the draft release rather than from Actions and
      confirm its SHA-256 digest matches `SHA256SUMS`.
- [ ] On Apple Silicon, install `@adrouter/agent@candidate`, run
      `adrouter-agent`, confirm `~/Applications/AdRouter Agent.app` exists, and
      complete the manual acceptance test.
- [ ] Repeat npm installation and the core router/edit/approval flow on Intel.
- [ ] If Gatekeeper blocks the app, confirm the launcher shows the documented
      Open Anyway guidance and never changes quarantine or Gatekeeper settings.
- [ ] Cover macOS 12 as the oldest supported system and one current macOS
      release across the two machines.
- [ ] Confirm invalid URL, bad token, unavailable router, and unavailable model
      states are understandable and recoverable.
- [ ] Confirm reinstalling the same build preserves local SQLite history and
      the Keychain-backed router configuration.

## Publication and rollback

- [ ] Release notes label the build as a public beta and list macOS-only,
      single-active-run, manual-update, and router-required limitations.
- [ ] GitHub private security advisories are enabled for the repository.
- [ ] Publish the existing draft prerelease without replacing its tag or
      assets.
- [ ] Install `@adrouter/agent@candidate` anonymously on Apple Silicon and
      Intel; confirm it downloads the public ZIP, validates the ad-hoc bundle,
      and creates the real per-user Applications bundle before moving `beta`
      and `latest`.
- [ ] If a defect is found after publication, mark the release withdrawn,
      remove its downloadable assets, and publish a higher patch version. Never
      retarget an existing release tag.
