# Plan: AdRouter Agent Beta.12 Sign-In-First Release

## Goal

Release the completed sign-in-first Desktop Agent enrollment flow as immutable
`0.1.0-beta.12`, deploy the matching Router WebUI support, and publish only to the npm
`candidate` channel until the exact artifacts pass the required physical Windows acceptance gate.

## Context

- This is the independent `adrouter/adrouterAgent` Electron repository and
  `@adrouter/agent` launcher.
- `v0.1.0-beta.11` is already an immutable public GitHub prerelease and npm `candidate`;
  npm `beta` and `latest` remain on the previously accepted beta.7.
- Beta.12 adds the AdRouterCLI-style browser sign-in handoff to Desktop Agent while keeping
  key generation, credentials, browser opening, clipboard access, and signed cancellation in the
  Electron main process.
- The Router backend already contains the device authorization, handoff, polling, cancellation,
  approval, refresh, profile, turn, and revocation contract. No backend, infrastructure, database,
  or Supabase migration change is required.
- Router WebUI commit `141adcc95298c364288aa8488297a1ce7dc2a898` adds Desktop Agent handoff copy
  and was deployed to Cloudflare Pages staging as deployment `128cdcac`.
- Pre-existing local PitchDemo work and `.playwright-cli/` output are unrelated to beta.12 and must
  remain uncommitted and be restored after the release worktree is clean.

## Research Summary

- GitHub authentication is valid for `HappyCool121`, npm remote state confirms beta.11 occupies
  `candidate`, and Cloudflare OAuth has Pages write access.
- The protected release workflow publishes a new immutable version through GitHub OIDC, verifies
  anonymous installs on native runners, and leaves final npm channels unchanged during the
  candidate phase.
- Finalization requires a validated `authentication-acceptance.json` covering the exact artifact
  manifest and two distinct operating-system cohorts, including a physical Windows 11 x64 laptop.
- The hosted WebUI build is a direct Wrangler upload from a clean pushed commit and requires only
  browser-safe staging configuration.

## Constraints

- Use repository-pinned Node.js 25.9.0, npm 10+, Electron 43, and exact dependency versions.
- Preserve renderer isolation, OS-encrypted installation storage, DPoP body binding,
  HTTPS/loopback policy, workspace containment, one-time mutation/command approvals, fail-closed
  sandboxing, and sponsor separation.
- Preserve existing backend routes, schema, infrastructure, traffic gates, and hosted secrets.
- Keep the release small, reviewable, and reversible; introduce no new dependency.
- Do not include the unrelated PitchDemo files, script, export, styles, tests, or browser logs.
- Never retarget beta.11 or republish an existing npm version; beta.12 must use a new tag and bytes.
- Do not move `beta` or `latest` until exact beta.12 physical Windows acceptance is attached and
  the protected finalization workflow succeeds.

## Out of Scope

- Backend, Fly.io, AWS/CDK, Supabase schema, migration, or traffic-policy changes.
- Stable `0.1.0`, automatic updates, Developer ID signing, notarization, or new native targets.
- PitchDemo publication or unrelated renderer redesign.
- Replacing or withdrawing beta.11 absent a separate release decision.

## Reversibility

- The WebUI deployment is an immutable Pages artifact and can be rolled back to the previous Pages
  deployment without changing the compatible backend.
- The Agent source change is isolated in a new beta.12 commit and tag. Before candidate publication
  it can be corrected normally; after publication a defect requires beta.13 rather than changed
  beta.12 bytes.
- Candidate publication does not move accepted npm channels. A rejected beta.12 can remain available
  only by exact version while beta.13 supersedes it.

---

## Step A: Complete and verify sign-in-first enrollment

### Status

`done`

### Objective

Implement a two-phase Desktop Agent enrollment flow matching AdRouterCLI's sign-in-first behavior
without weakening the Electron security boundary or replacing an active installation prematurely.

### Tasks

- [x] Add memory-only sign-in preparation and explicit Continue before key/server state creation.
- [x] Keep browser and clipboard operations in the main process and hide the handoff identifier.
- [x] Add encrypted pending-approval restart recovery and signed best-effort cancellation.
- [x] Preserve an existing installation until the replacement validates completely.
- [x] Add main-process, contract, renderer, restart, cancellation, and replacement coverage.

### Relevant Files

- `src/main/installation-auth.ts`
- `src/main/configuration-store.ts`
- `src/main/ipc.ts`
- `src/preload/index.ts`
- `src/shared/contracts.ts`
- `src/renderer/App.tsx`
- `tests/main/installation-auth.test.ts`
- `tests/renderer/App.test.tsx`

### Expected Changes

- modify: enrollment implementation, IPC contracts, onboarding UI, tests, and authentication docs
- create: no production source files outside the existing architecture

### Do Not Modify

- Backend route/schema behavior
- Renderer credential and raw-URL isolation
- PitchDemo source, tests, script, export, or styles

### Commands

```bash
npm run lint
npm run typecheck
npm run test
npm run test:integration
npm run test:e2e
```

### Acceptance Criteria

- [x] No key or authorization request exists before Continue.
- [x] The renderer receives no handoff identifier or credential material.
- [x] Cancellation, restart, replacement, and browser-open failures are safe and recoverable.
- [x] Unit, integration, launcher, and packaged Electron coverage passes.

### Validation Results

- `npm run lint`: passed
- `npm run typecheck`: passed
- `npm run test`: passed, 72 tests
- `npm run test:integration`: passed, 10 tests
- `npm run test:e2e`: passed, 2 packaged Electron tests

### Findings / Notes

- The existing backend contract was sufficient; no service deployment or migration is needed.

---

## Step B: Deploy matching Router WebUI support

### Status

`done`

### Objective

Allow OAuth return paths and installation approval UI to distinguish Desktop Agent from
AdRouterCLI while retaining the shared backend handoff protocol.

### Tasks

- [x] Accept exact `connect=agent` OAuth return state.
- [x] Add Desktop Agent-specific handoff, Continue, and completion copy.
- [x] Validate the WebUI and hosted-build configuration.
- [x] Commit and push the exact reviewed Router source.
- [x] Direct-upload the verified artifact to Cloudflare Pages and verify custom/immutable URLs.

### Relevant Files

- `router/webui/src/supabase.ts`
- `router/webui/src/installation-access.tsx`
- `router/webui/src/supabase.test.ts`
- `router/webui/src/account.test.tsx`
- `router/webui/src/installation-access.test.tsx`

### Expected Changes

- modify: Router WebUI source and tests only
- create: immutable Cloudflare Pages deployment

### Do Not Modify

- Router backend, Supabase, infrastructure, secrets, or traffic gates
- Git-triggered Pages deployment configuration

### Commands

```bash
cd router/webui
npm run typecheck
npm test
npm run build:hosted
npx wrangler pages deploy dist --project-name=adrouter-dashboard --branch=main
```

### Acceptance Criteria

- [x] Router commit is clean, pushed, and bound to the deployed Pages artifact.
- [x] Hosted custom and immutable routes return the SPA successfully.
- [x] The deployed JavaScript digest equals the verified local artifact.
- [x] Agent-specific approval copy is present in the hosted bundle.

### Validation Results

- WebUI typecheck: passed
- WebUI test suite: passed, 69 Vitest tests and 10 hosted-config tests
- Hosted build verification: passed
- Cloudflare deployment: passed at `https://128cdcac.adrouter-dashboard.pages.dev`
- Post-deployment verification: passed for 14 custom/immutable route requests

### Findings / Notes

- The release source is Router commit `141adcc95298c364288aa8488297a1ce7dc2a898`.

---

## Step C: Prepare and publish beta.12 candidate

### Status

`in_progress`

### Objective

Create clean beta.12 source and publish its immutable native artifacts and launcher under npm
`candidate` without moving final channels.

### Tasks

- [x] Separate and preserve unrelated PitchDemo work outside the release commit.
- [x] Update application/launcher version, native build number, changelog, release docs, and workflow
      defaults to beta.12.
- [x] Regenerate source parity from the reviewed beta.12 source set.
- [x] Run all local source, launcher, audit, packaged E2E, and native macOS release gates.
- [ ] Push the clean beta.12 commit, wait for required CI, create and push immutable tag
      `v0.1.0-beta.12`.
- [ ] Approve/verify the protected native release build and dispatch `publish-candidate`.
- [ ] Verify the GitHub prerelease, npm `candidate`, attestations, and anonymous platform installs.

### Relevant Files

- `package.json`
- `package-lock.json`
- `packages/agent-launcher/package.json`
- `packages/agent-launcher/release-manifest.json`
- `forge.config.ts`
- `CHANGELOG.md`
- `README.md`
- `SECURITY.md`
- `RELEASE.md`
- `.github/workflows/promote-release.yml`
- `provenance/source-files.sha256`

### Expected Changes

- modify: reviewed login source/docs/tests and beta.12 release/version metadata
- create: immutable tag, GitHub prerelease, native assets, attestations, and npm candidate

### Do Not Modify

- Published beta.11 tag, release, package, or artifacts
- npm `beta` and `latest` during candidate publication
- Unrelated PitchDemo work

### Commands

```bash
npm ci
npm run check
npm run test:e2e
npm run audit:build
npm run check:launcher-package
npm run verify:release-readiness
npm run make:mac
npm run verify:dist
git tag -a v0.1.0-beta.12 -m "AdRouter Agent 0.1.0-beta.12"
git push origin main v0.1.0-beta.12
gh workflow run promote-release.yml --ref v0.1.0-beta.12 -f tag=v0.1.0-beta.12 -f phase=publish-candidate -f channel=beta
```

### Acceptance Criteria

- [x] Every version/release surface agrees on beta.12 and build 10012.
- [x] The release commit contains no PitchDemo/browser-log content or generated output.
- [ ] All local and required GitHub release gates pass from the exact immutable commit.
- [ ] GitHub beta.12 prerelease and npm beta.12 candidate are public and anonymously installable.
- [ ] npm `beta` and `latest` remain on beta.7 pending physical acceptance.

### Validation Results

- `npm ci`: passed with pinned Node.js 25.9.0
- `npm run check`: passed; 70 unit tests, 10 integration tests, 32 launcher tests, and all public gates
- Production dependency audit: passed with zero vulnerabilities
- `npm run audit:build`: passed with the single bounded dev-only Forge advisory
- `npm run test:e2e`: passed, 2 packaged Electron tests
- Launcher/readiness gates: passed
- Universal macOS package and `npm run verify:dist`: passed
- Native GitHub release workflow: not run
- Candidate publication: not run

### Findings / Notes

- GitHub, npm, and Cloudflare authentication are currently valid.
- The stale generated beta.11 local ZIP was moved to
  `/private/tmp/AdRouter-Agent-darwin-universal-0.1.0-beta.11.previous.zip` so exact beta.12
  distribution verification could remain fail-closed.

---

## Step D: Final verification and cleanup

### Status

`todo`

### Objective

Bind human acceptance to the exact beta.12 artifacts, promote only after the physical Windows gate,
and restore preserved local work.

### Tasks

- [ ] Install and approve the exact candidate on the primary operator device.
- [ ] Complete the required physical Windows 11 x64 acceptance cohort.
- [ ] Validate and attach `authentication-acceptance.json` to the beta.12 release.
- [ ] Dispatch protected finalization to move `beta` and `latest` and remove `candidate`.
- [ ] Verify exact public installs and revoke temporary npm dist-tag access.
- [ ] Restore the preserved PitchDemo work and confirm its contents are unchanged.
- [ ] Record final release identifiers, validation results, and remaining risks.

### Relevant Files

- `scripts/authentication-acceptance.schema.json`
- `docs/release-checklist.md`
- `RELEASE.md`
- preserved local PitchDemo changes

### Expected Changes

- create: public-safe beta.12 authentication acceptance attachment
- modify: npm dist-tags only after exact acceptance
- restore: unrelated local PitchDemo working state

### Do Not Modify

- beta.12 bytes, tag, or artifact manifest after candidate publication
- hosted database, backend, infrastructure, or secrets unrelated to final dist-tag movement

### Commands

```bash
node scripts/validate-authentication-acceptance.mjs authentication-acceptance.json --manifest artifact-manifest.json
gh release upload v0.1.0-beta.12 authentication-acceptance.json
gh workflow run promote-release.yml --ref v0.1.0-beta.12 -f tag=v0.1.0-beta.12 -f phase=finalize-release -f channel=beta
npm view @adrouter/agent dist-tags --json
```

### Acceptance Criteria

- [ ] Exact primary-device and physical-Windows evidence validates against beta.12 artifacts.
- [ ] Finalization moves only the intended channels without rebuilding.
- [ ] Temporary dist-tag credentials are removed and revoked.
- [ ] The original unrelated local work is restored unchanged.
- [ ] The repository has no unintended release or generated files.

### Validation Results

- Physical Windows acceptance: not run
- Final npm promotion: not run
- Local-work restoration: not run

### Findings / Notes

- This step is intentionally blocked from completion until the user supplies the physical Windows
  acceptance cohort for the exact candidate.

---

## Follow-up Work

- Complete physical Windows beta.12 acceptance before moving `beta` or `latest`.
- Stable release, signing/notarization, and automatic updates remain separate work.
- Remove the bounded Forge advisory exception after an upstream-compatible toolchain update.

## Decision Log

| Date | Decision | Rationale | Impact |
| --- | --- | --- | --- |
| 2026-08-01 | Allocate beta.12 for sign-in-first enrollment. | Beta.11 is already immutable and public. | Login changes receive a new tag, package version, and artifacts. |
| 2026-08-01 | Reuse the existing backend contract. | Device handoff, polling, cancellation, approval, and token routes are already deployed. | No Fly, Supabase, schema, secret, or infrastructure change is needed. |
| 2026-08-01 | Publish beta.12 to `candidate` before final channels. | Native and physical Windows acceptance must bind exact immutable artifacts. | `beta` and `latest` stay on beta.7 until finalization. |
| 2026-08-01 | Exclude existing PitchDemo work from beta.12. | It predates and is unrelated to the login release. | User work remains preserved and the release diff stays scoped. |
