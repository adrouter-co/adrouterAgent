# Plan: Credential-free AdRouter Agent npm release

## Goal

Publish AdRouter Agent as the dependency-free `@adrouter/agent` npm launcher,
which installs and launches the credential-free universal macOS app at
`~/Applications/AdRouter Agent.app` without a DMG or Apple release credentials.

## Context

- The public identities remain `adrouter/adrouterAgent`, `@adrouter/agent`, and
  `adrouter-agent`.
- The repository has not yet been committed or pushed, and the npm package has
  not yet been published.
- The existing protected validation, staging canary, draft release, candidate
  smoke, and dist-tag promotion sequence is preserved.
- The router backend deployment and its provider credentials are unchanged.

## Research Summary

- Electron supports distributing unsigned applications but warns that macOS
  users may need advanced manual approval.
- Ad-hoc signing provides local bundle integrity without an Apple identity; it
  does not provide Developer ID or notarization trust.
- `~/Applications` is the standard per-user application location on macOS.
- npm trusted publishing covers `npm publish`, while dist-tag operations still
  require traditional authenticated access.

## Constraints

- Preserve desktop behavior, router contracts, user data, and Keychain-backed
  configuration.
- Keep the launcher dependency-free and free of lifecycle scripts.
- Never remove quarantine metadata or modify Gatekeeper settings.
- Preserve immutable GitHub tags, release checksums, SBOMs, attestations, and
  fail-closed download/archive validation.
- Keep the first release at `0.1.0-beta.1` because it is not yet public.

## Out of Scope

- Backend deployment changes.
- Windows or Linux desktop distribution.
- Apple Developer ID signing, notarization, the Mac App Store, or auto-update.
- Unrelated product refactors or UI redesign.

## Reversibility

- Code and workflow changes remain reversible until the GitHub release and npm
  version are public.
- Application updates stage beside the destination and restore the prior bundle
  if activation or receipt writing fails.
- A defective public version must be replaced with a higher beta version; tags
  and npm versions are never reused.

---

## Step A: Build ZIP-only credential-free release artifacts

### Status

`done`

### Objective

Remove DMG, Developer ID, and notarization requirements while retaining a
verified universal ad-hoc-signed application.

### Tasks

- [x] Remove the DMG maker and Apple credential/notarization configuration.
- [x] Retain universal slice handling and final ad-hoc signing.
- [x] Make release preparation and verification ZIP-only.
- [x] Add manifest schema 2 and the explicit credential-free distribution mode.

### Relevant Files

- `forge.config.ts`
- `scripts/verify-dist.mjs`
- `scripts/prepare-release-assets.mjs`
- `scripts/verify-release-assets.mjs`

### Expected Changes

- modify: macOS packaging, release inventory, and artifact validation
- delete: no source files; DMG output is no longer produced by clean builds

### Do Not Modify

- Desktop product behavior under `src/`
- Bundle identifier or public version

### Commands

```bash
npm run make:mac
npm run verify:dist
node scripts/prepare-release-assets.mjs 0.1.0-beta.1
node scripts/verify-release-assets.mjs out/release
```

### Acceptance Criteria

- [x] The app contains arm64 and x86_64 slices.
- [x] The bundle passes strict code-signature integrity checks as ad-hoc with no
      Apple Team Identifier.
- [x] The release directory contains one ZIP, the npm tarball, two SBOMs,
      checksums, and the artifact manifest, with no DMG.

### Validation Results

- `npm run make:mac`: passed
- `npm run verify:dist`: passed
- release asset preparation and verification: passed for four checksummed assets

### Findings / Notes

- An ignored DMG from the earlier local build may remain under `out/make`; clean
  builds no longer create it and it is never copied into `out/release`.

---

## Step B: Install and manage the real per-user application

### Status

`done`

### Objective

Make the globally installed command safely install, update, diagnose, and open
the real application in `~/Applications`.

### Tasks

- [x] Replace the versioned cache with the canonical per-user Applications path.
- [x] Store an ownership/version/checksum receipt in Application Support.
- [x] Verify archive layout, bundle identity, versions, architectures, ad-hoc
      signature, and sealed resources before activation.
- [x] Refuse root execution and unmanaged destination collisions.
- [x] Implement staged updates with backup restoration on failure.
- [x] Report Gatekeeper diagnostically and provide Open Anyway guidance without
      modifying system security settings.

### Relevant Files

- `packages/agent-launcher/lib/`
- `packages/agent-launcher/test/`
- `packages/agent-launcher/README.md`

### Expected Changes

- modify: launcher install paths, receipt schema, doctor JSON, and tests

### Do Not Modify

- Electron user-data path
- Router configuration or model behavior
- npm lifecycle scripts or runtime dependencies

### Commands

```bash
npm run test:launcher
npm run check:launcher-package
```

### Acceptance Criteria

- [x] First invocation creates `~/Applications/AdRouter Agent.app`.
- [x] Repeat invocation reuses an intact matching installation.
- [x] Unmanaged collisions fail closed and interrupted updates restore the prior
      managed bundle.
- [x] `doctor --json` reports schema 2 receipt, integrity, ad-hoc signature, and
      Gatekeeper assessment fields.

### Validation Results

- `npm run test:launcher`: passed, 11 tests
- `npm run check:launcher-package`: passed

### Findings / Notes

- Gatekeeper rejection is allowed for this distribution mode and is never used
  as evidence of archive or bundle integrity.

---

## Step C: Final verification and cleanup

### Status

`done`

### Objective

Preserve the prior protected release flow, document all operator credentials,
and verify the complete implementation before external publication.

### Tasks

- [x] Remove Apple secrets from the release workflow while retaining the
      protected `macos-release` approval environment.
- [x] Update public smoke checks for the real Applications bundle and schema 2
      doctor result.
- [x] Separate first-package bootstrap authentication from dist-tag
      authentication and document later OIDC migration.
- [x] Update all public installation, release, support, and checklist documents.
- [x] Run the full local validation suite and review the release inventory.

### Relevant Files

- `.github/workflows/`
- `RELEASE.md`
- `docs/release-checklist.md`

### Expected Changes

- modify: protected release/promotion workflows and public operator docs

### Do Not Modify

- Staging router deployment
- Immutable release-tag behavior
- Candidate-before-beta promotion ordering

### Commands

```bash
npm run check
npm run test:e2e
npm audit --omit=dev --audit-level=moderate
```

### Acceptance Criteria

- [x] Lint, typecheck, unit, integration, public-boundary, workflow, launcher,
      and packaged E2E tests pass.
- [x] Production audit reports no moderate-or-higher vulnerability.
- [x] No Apple credential is required by CI.
- [x] Documentation gives exact GitHub, staging, npm bootstrap, dist-tag, tag,
      promotion, OIDC, and credential-revocation steps.

### Validation Results

- `npm run check`: passed; 35 unit tests, 5 integration tests, 11 launcher tests
- `npm run test:e2e`: passed, 2 packaged Electron tests
- `npm audit --omit=dev --audit-level=moderate`: passed with zero findings

### Findings / Notes

- GitHub authentication is already valid for `HappyCool121`, which is an active
  administrator of `adrouter`; the remote repository does not yet exist.
- npm authentication is still required from the release operator.

---

## Follow-up Work

- Create and push the public GitHub repository using `RELEASE.md`.
- Enter the staging and short-lived npm secrets, then create and promote the
  immutable release tag.
- After the first npm package exists, configure trusted publishing and revoke
  the bootstrap token.
- Manually cover Apple Silicon, Intel, macOS 12, and a current macOS release.

## Decision Log

| Date | Decision | Rationale | Impact |
| --- | --- | --- | --- |
| 2026-07-26 | Use credential-free ad-hoc signing | Avoid Apple account and notarization requirements while retaining bundle integrity | Some users may need one-time Open Anyway approval |
| 2026-07-26 | Install the real app on first command invocation | Avoid npm lifecycle downloads and fragile aliases | `npm install -g` installs only the CLI; `adrouter-agent` creates the app |
| 2026-07-26 | Keep the scoped public identity and prior promotion sequence | Existing code and release policy are already wired to these names | One GitHub repository and one npm package are required |
