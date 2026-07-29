# Plan: AdRouter Agent Beta.11 Security Candidate

## Goal

Resolve the current open Dependabot and CodeQL security findings, strengthen release-time dependency
and packaged-default verification, and publish the immutable `0.1.0-beta.11` build only under npm
`candidate` until it passes acceptance on a physical Windows 11 x64 laptop.

## Context

- This is the independent `adrouter/adrouterAgent` Electron desktop repository and
  `@adrouter/agent` launcher.
- The source and GitHub prerelease are currently `0.1.0-beta.10`; npm `candidate` points to
  beta.10 while `beta` and `latest` remain on the previously accepted beta.
- Dependabot reports ten open alerts rooted in transitive build dependencies `tar@6.2.1` and
  `tmp@0.0.33`. The same `tar` root also has an auto-dismissed critical decompression advisory.
- CodeQL reports incomplete URL substring sanitization in the portable-distribution verifier because
  it accepts any bundle text containing the staging origin as a substring.
- The remaining old `brace-expansion` copies belong to the Electron Forge development toolchain.
  The production Pi path is already patched to `5.0.8`; eliminating every Forge copy would require
  unsupported Packager/Rebuild/Inquirer major overrides.
- Release versions, Git tags, and npm versions are immutable. A rejected candidate must be replaced
  by a higher beta.
- The user requires a clean physical Windows-laptop candidate installation and acceptance pass before
  beta.11 may move to `beta` or `latest`.

## Research Summary

- `tar@7.5.22` and `tmp@0.2.7` satisfy the repository Node.js floor and remove the targeted
  advisories. An isolated Node 25.9.0 install with exact npm overrides passed lint, typecheck, unit,
  integration, packaging, and packaged E2E checks.
- The full npm audit becomes actionable when normalized by advisory rather than by propagated package
  node: all new high/critical advisories can fail closed while the single dev-only Forge
  `GHSA-mh99-v99m-4gvg` root remains explicitly bounded.
- The packaged staging origin currently appears as an exact string literal in the expected main and
  renderer bundles. Parsing those bundles and comparing literal values avoids substring matching;
  packaged E2E can independently prove the fresh-install value actually shown to users.
- The existing two-phase release workflow already supports publishing `candidate`, pausing for
  exact-artifact acceptance, and moving final channels without rebuilding.

## Constraints

- Use repository-pinned Node.js 25.9.0, npm 10+, Electron 43, and exact dependency versions.
- Preserve renderer isolation, encrypted installation storage, HTTPS/loopback policy, workspace
  containment, one-time mutation/command approvals, fail-closed sandboxing, and sponsor separation.
- Preserve existing public APIs, IPC contracts, persisted state, and user-facing behavior.
- Keep changes minimal and reviewable; do not force unsupported Electron Forge dependency majors.
- Do not hand-edit generated `out/`, `.vite/`, release artifacts, provenance, or launcher
  `UNBUILT` placeholders.
- Do not tag, publish, upload release assets, move npm channels, configure secrets, or approve
  protected environments without explicit release authorization and required authentication.
- Keep `beta` and `latest` unchanged until physical Windows acceptance succeeds.

## Out of Scope

- Stable `0.1.0`, automatic updates, Developer ID signing, notarization, or new native targets.
- General dependency modernization or unrelated Electron Forge migration.
- Runtime router/authentication, UI, schema, IPC, sandbox, or sponsor-channel redesign.
- Manual dismissal of GitHub security alerts.
- Modification or withdrawal of immutable beta.10 artifacts absent compromise evidence.

## Reversibility

- Dependency pins and audit policy are isolated manifest/script changes and can be reverted together.
- The new packaged verifier replaces only the vulnerable check and is covered by focused fixtures
  before the old behavior is removed.
- Candidate publication does not move final channels. A failed beta.11 remains available by exact
  version and is superseded by beta.12.
- Final promotion reuses the accepted immutable artifacts and can run only after evidence is attached.

---

## Step A: Remediate vulnerable build dependencies

### Status

`done`

### Objective

Remove the vulnerable `tar` and `tmp` trees and ensure future high/critical build advisories fail
the normal CI and release validation paths.

### Tasks

- [x] Add exact npm overrides for `tar@7.5.22` and `tmp@0.2.7`; regenerate the lockfile.
- [x] Extend dependency-override checks to assert package manifest, lockfile, and physical installed
      versions, plus the existing production Pi `brace-expansion@5.0.8` replacement.
- [x] Add a build audit script that parses `npm audit --json`, rejects malformed/unavailable audit
      results, and fails for every unapproved high/critical advisory.
- [x] Permit only `GHSA-mh99-v99m-4gvg` when every affected node is dev-only and production remains
      patched; record a rationale and upstream-removal condition.
- [x] Wire the build audit into local checks, CI validation, and release-tag validation while
      retaining the production dependency audit.

### Relevant Files

- `package.json`
- `package-lock.json`
- `scripts/check-dependency-overrides.mjs`
- `.github/workflows/ci.yml`
- `.github/workflows/release-tag.yml`

### Expected Changes

- modify: dependency overrides/lockfile, dependency assertions, audit policy, and workflow gates
- create: focused build-audit policy script and tests if no suitable script exists

### Do Not Modify

- Electron Forge/Packager/Rebuild/Inquirer major versions.
- Production Pi override semantics or runtime dependencies unrelated to the alerts.

### Commands

```bash
npm ci
npm run check:dependency-overrides
npm audit --omit=dev --audit-level=moderate
npm run audit:build
npm run test
```

### Acceptance Criteria

- [x] Installed and locked `tar` is exactly `7.5.22`; `tmp` is exactly `0.2.7`.
- [x] Production audit reports zero vulnerabilities.
- [x] Full audit has no unapproved high/critical advisory and no critical advisory.
- [x] A new high/critical advisory or an invalid dev-only exception fails closed.
- [x] Dependency and workflow-policy tests pass.

### Validation Results

- `npm install`: passed under Node.js 25.9.0; postinstall dependency patches applied.
- `npm run check:dependency-overrides`: passed.
- `npm audit --omit=dev --audit-level=moderate`: passed with zero vulnerabilities.
- `npm run audit:build`: passed; 29 high-severity propagated nodes resolve only to the reviewed GHSA.
- `node --test scripts/build-audit-policy.test.mjs`: passed, five tests.
- `node scripts/check-workflows.mjs`: passed.

### Findings / Notes

- The bounded Forge exception is follow-up debt, not a production dependency exception.
- npm reports no critical advisories after the exact tar/tmp overrides.

---

## Step B: Harden packaged staging-origin verification

### Status

`done`

### Objective

Make the release verifier require the exact packaged default origin and prove the user-visible
fresh-install value without URL substring matching.

### Tasks

- [x] Add exact `acorn@8.17.0` as a direct dev dependency for deterministic bundle parsing.
- [x] Extract a testable verifier helper that parses only expected main/renderer JavaScript bundles
      and compares complete string literal values.
- [x] Require the canonical origin in both main and renderer; fail on malformed or unexpected bundle
      layouts.
- [x] Add regression tests for exact success, hostile suffix/prefix, path/query embedding, unrelated
      text, missing origin, and malformed JavaScript.
- [x] Extend packaged E2E to assert a fresh installation displays exactly
      `https://api-staging.adrouter.co`.

### Relevant Files

- `scripts/verify-portable-dist.mjs`
- `tests/e2e/packaged-security.spec.ts`
- focused script tests

### Expected Changes

- modify: portable verifier and packaged-security E2E
- create: reusable exact-literal helper/test if needed

### Do Not Modify

- Runtime URL validation, official-origin authentication policy, renderer isolation, or generated
  bundle output.

### Commands

```bash
npm run test
npm run test:e2e
npm run verify:dist
```

### Acceptance Criteria

- [x] No staging-origin substring allowlist remains in the portable verifier.
- [x] Exact literals in expected bundles pass and all longer/embedded/malformed cases fail.
- [x] Fresh packaged onboarding shows exactly the canonical staging origin.
- [x] Existing portable artifact integrity checks remain intact.

### Validation Results

- `npm run test`: passed, 20 files and 68 tests.
- `node --test scripts/verify-packaged-default.test.mjs`: passed, seven tests.
- `npm run test:e2e`: passed, including the fresh-install exact-origin assertion.
- `npm run verify:dist`: passed for the beta.11 universal macOS artifact.

### Findings / Notes

- Static bundle verification covers native artifacts; packaged E2E proves the literal is active
  configuration rather than dead bundle text.

---

## Step C: Prepare beta.11 source and release policy

### Status

`done`

### Objective

Make every authoritative source, launcher, documentation, and workflow check agree on the immutable
beta.11 candidate and its Windows-only final promotion gate.

### Tasks

- [x] Confirm npm version, Git tag, GitHub release, and workflow namespace for beta.11 are unused.
- [x] Set application/launcher version to `0.1.0-beta.11` and native build number to `10011`
      across authoritative manifests and source-parity checks.
- [x] Update changelog, README, security supported-version table, release procedure, and checklist.
- [x] Document that `candidate` replaces beta.10 while beta/latest remain unchanged until the
      physical Windows 11 x64 cohort passes.
- [x] Extend workflow-policy checks to require the production audit and new build audit before native
      builds or publication.

### Relevant Files

- authoritative manifests and source-parity scripts
- `CHANGELOG.md`
- `README.md`
- `SECURITY.md`
- `RELEASE.md`
- `docs/release-checklist.md`

### Expected Changes

- modify: beta.11 version/build metadata, release notes/policy, and workflow assertions

### Do Not Modify

- beta.10 tag/assets, launcher release-manifest hashes, stable channel policy, signing posture, or
  unsupported platform claims.

### Commands

```bash
npm run check:source-parity
npm run check:workflows
npm run check:launcher-package
npm run verify:release-readiness
git diff --check
```

### Acceptance Criteria

- [x] All authoritative source/version surfaces agree on beta.11 and build 10011.
- [x] Release policy publishes only `candidate` before Windows acceptance.
- [x] Beta/latest promotion cannot occur without exact Windows 11 x64 acceptance evidence.
- [x] Beta.10 remains immutable and installable by exact version.

### Validation Results

- Remote beta.11 namespace: npm version, GitHub release, and Git tag are unused.
- `npm run check:public`: passed source parity, dependency, public-boundary, docs, and workflow policy.
- `npm run check:launcher-package`: passed.
- `npm run verify:release-readiness`: passed, including 30 launcher/release tests.

### Findings / Notes

- Stop and allocate a higher beta if any beta.11 namespace is occupied.

---

## Step D: Publish candidate and require physical Windows acceptance

### Status

`in_progress`

### Objective

Publish the exact beta.11 artifacts without moving final npm channels, then wait for the user's
physical Windows laptop acceptance before finalization.

### Tasks

- [ ] After explicit release authorization, tag clean reviewed main as `v0.1.0-beta.11` and push
      the immutable tag.
- [ ] Approve native build workflow and verify macOS universal, Ubuntu x64, Windows x64, launcher,
      checksums, SBOMs, attestations, and manifest.
- [ ] Dispatch `phase=publish-candidate`; verify npm `candidate` points to beta.11 while
      `beta`/`latest` remain unchanged.
- [ ] On a clean physical Windows 11 x64 laptop, install `@adrouter/agent@candidate` anonymously
      and complete launch, enrollment, signed profile/turn, refresh/revocation, project/task,
      approval, command, sandbox, persistence, and redaction checks.
- [ ] Generate and attach exact sanitized authentication acceptance evidence.
- [ ] Only after the Windows cohort passes, dispatch `phase=finalize-release`, move `beta` and
      `latest` to beta.11, and remove `candidate`.
- [ ] If Windows acceptance fails, leave final channels unchanged and fix forward with beta.12.

### Relevant Files

- `.github/workflows/release-tag.yml`
- `.github/workflows/promote-release.yml`
- release assets and acceptance schema

### Expected Changes

- create: immutable GitHub prerelease and npm beta.11 candidate
- modify later: final npm channels only after Windows acceptance

### Do Not Modify

- Published beta.11 bytes/tag after candidate publication.
- Final channels before physical Windows acceptance.

### Commands

```bash
git tag -a v0.1.0-beta.11 -m "AdRouter Agent 0.1.0-beta.11"
git push origin v0.1.0-beta.11
gh workflow run promote-release.yml --ref v0.1.0-beta.11 -f tag=v0.1.0-beta.11 -f phase=publish-candidate -f channel=beta
npm view @adrouter/agent dist-tags --json
```

### Acceptance Criteria

- [ ] Candidate artifacts are exact, public, and anonymously installable on every supported target.
- [ ] Beta/latest remain unchanged until physical Windows acceptance passes.
- [ ] Acceptance binds the exact tag, commit, three ZIPs, launcher, and Windows cohort.
- [ ] Failed acceptance results in a higher immutable beta rather than replaced artifacts.

### Validation Results

- Candidate publication: not run; requires release authorization/protected GitHub workflow.
- Physical Windows acceptance: not run; requires the user's Windows laptop.
- Finalization: not run and prohibited before Windows acceptance.

### Findings / Notes

- npm trusted publishing handles candidate publication; a short-lived package-scoped dist-tag token
  is needed only for finalization.

---

## Step E: Final verification and cleanup

### Status

`review`

### Objective

Prove the complete local source change, reconcile GitHub security results, and remove temporary
implementation artifacts before release handoff.

### Tasks

- [x] Run the complete pinned-runtime validation suite, packaged E2E, launcher/package, public
      boundary, source parity, workflow policy, release readiness, and local native verification.
- [x] Review the final diff for unrelated changes, generated output, secrets, stale versions,
      weakened checks, and expanded security boundaries.
- [x] Remove temporary debug/output files and update validation results in this plan.
- [ ] After default-branch scans, confirm all current `tar`/`tmp` alerts close, the critical
      `tar` advisory no longer applies, and CodeQL alert 1 closes.
- [ ] Record the remaining dev-only Forge exception and its upstream removal follow-up.

### Relevant Files

- `package.json` and lockfile
- `scripts/`, `tests/`, and workflows
- release documentation and `PLAN.md`

### Expected Changes

- modify: validation results and documentation only if final checks expose a discrepancy
- delete: only temporary generated/debug files

### Do Not Modify

- Security/process boundaries, published artifacts, or unrelated user work merely to pass a gate.

### Commands

```bash
npm ci
npm run check
npm run test:e2e
npm run check:launcher-package
npm run verify:release-readiness
npm run make:mac
npm run verify:dist
git diff --check
git status --short
```

### Acceptance Criteria

- [ ] Every applicable local source/package/release gate passes.
- [ ] No open targeted Dependabot or CodeQL finding remains after default-branch scans.
- [ ] Only the explicitly documented dev-only Forge advisory remains.
- [ ] No credential, developer path, test hook, or unintended generated file is committed.
- [ ] The repository is ready for protected beta.11 candidate publication.

### Validation Results

- Full local validation: passed; integration required a host-permitted rerun for the sandbox socket.
- Native macOS universal package/verification: passed.
- GitHub post-merge security scans: not run

### Findings / Notes

- Native GitHub runners and physical Windows acceptance remain authoritative for non-macOS artifacts.

---

## Follow-up Work

- Remove the bounded Forge `brace-expansion` exception after an upstream-compatible toolchain
  update.
- Finalize beta.11 only after physical Windows acceptance and exact evidence attachment.
- Stable release, signing/notarization, and automatic updates remain separate work.

## Decision Log

| Date | Decision | Rationale | Impact |
| --- | --- | --- | --- |
| 2026-07-29 | Pin `tar@7.5.22` and `tmp@0.2.7`. | Exact overrides remove the open and critical advisory roots without a risky Forge migration. | Targeted alerts close while packaging behavior remains compatible. |
| 2026-07-29 | Allow only the dev-only Forge `brace-expansion` GHSA. | The production path is already patched and upstream Forge still pins incompatible legacy dependencies. | Any other high/critical advisory fails CI; upstream migration remains tracked. |
| 2026-07-29 | Parse packaged bundle literals instead of substring matching. | Exact value comparison addresses CodeQL while preserving cross-platform static verification. | Hostile prefix/suffix and dead-text matches no longer satisfy the release gate. |
| 2026-07-29 | Publish beta.11 under `candidate` first. | Candidate evaluation must not change accepted channels. | Beta/latest remain unchanged through candidate testing. |
| 2026-07-29 | Require physical Windows acceptance before finalization. | The user must validate the Windows install and security flow on real hardware. | Final promotion is blocked until the Windows cohort passes. |
