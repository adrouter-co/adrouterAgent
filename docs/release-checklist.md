# Public beta release checklist

Use this checklist after the `release-tag` workflow creates a draft GitHub
prerelease. Do not publish artifacts copied from a local `out/` directory.

## Automated gates

- [ ] The requested version matches `package.json` and `CHANGELOG.md`.
- [ ] Production dependency audit, lint, typecheck, unit, integration, packaged E2E, and canonical
      platform-auth compatibility checks passed without an inference credential in automation.
- [ ] The workflow produced `darwin-universal`, `linux-x64`, and `win32-x64`
      ZIPs, the exact npm tarball, `SHA256SUMS`, per-target and launcher
      CycloneDX SBOMs, and schema-3 `artifact-manifest.json`.
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
- [ ] Repeat npm installation, OS-encrypted installation approval, signed profile/turn, refresh,
      revocation, sandbox boundaries, and launch on clean Ubuntu 24.04 x64 and Windows 11 x64 hosts.
- [ ] If Gatekeeper blocks the app, confirm the launcher shows the documented
      Open Anyway guidance and never changes quarantine or Gatekeeper settings.
- [ ] Cover macOS 12 as the oldest supported system and one current macOS
      release across the two machines.
- [ ] Confirm invalid approval URL, denial, expiry, revoked/lost installation, unsafe storage,
      unavailable router, required upgrade, and unavailable model states are understandable and
      recoverable.
- [ ] Confirm reinstalling the same build preserves local SQLite history and
      the OS-encrypted router configuration.

## Publication and rollback

- [ ] Release notes label the build as a public beta and list supported OS/CPU
      targets, unsigned portable artifacts, Windows alpha sandbox setup,
      single-active-run, manual-update, and router-required limitations.
- [ ] GitHub private security advisories are enabled for the repository.
- [ ] Publish the existing draft prerelease without replacing its tag or
      assets.
- [ ] Dispatch `phase=publish-candidate`, verify the GitHub prerelease and npm `candidate`, and
      confirm `beta`/`latest` remain on the previous accepted version.
- [ ] Generate the exact public-safe `authentication-acceptance.json` from a primary operator device
      and distinct second OS cohort, validate it against `artifact-manifest.json`, and attach it to
      the matching draft/prerelease before channel promotion.
- [ ] Install `@adrouter/agent@candidate` anonymously on every supported
      OS/CPU target; confirm it selects the correct public ZIP, validates the
      platform bundle, and creates the documented per-user installation before
      moving `beta` and `latest`.
- [ ] Dispatch `phase=finalize-release` only after acceptance is attached; confirm it rechecks all
      public installs, moves the intended final channels, and removes `candidate` without rebuilding.
- [ ] Delete `NPM_DIST_TAG_TOKEN` from `npm-publish` and revoke the short-lived granular npm token
      after final verification.
- [ ] If a defect is found after publication, mark the release withdrawn,
      remove its downloadable assets, and publish a higher patch version. Never
      retarget an existing release tag.
- [ ] Confirm future stable promotion moves `latest` only and leaves `beta` on the newest accepted
      beta.
