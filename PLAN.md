# Plan: AdRouter Agent beta.7 key rotation, WebUI polish, and public release

## Goal

Ship `0.1.0-beta.7` with device-local sign out/API-key rotation, focused visual parity with
`3days/router/webui`, polished bidirectional side-panel animation, correct packaged jellyfish app
icons, and the existing protected npm/GitHub prerelease workflow.

## Context

- The current public release is `0.1.0-beta.6`; npm `beta` and `latest` resolve to that immutable
  version and GitHub publishes `v0.1.0-beta.6` as a prerelease.
- The desktop stores its API credential as OS-encrypted ciphertext and never exposes plaintext to
  the renderer. Sign out must clear only that ciphertext while preserving the configured origin,
  sponsorship preference, projects, chats, and compatible model preferences.
- The sibling WebUI establishes the requested ivory/blue chat, jellyfish branding, first-page
  layout, icons, and Tier A/B/C/NONE presentation. The desktop keeps its coding-agent controls and
  desktop security boundaries.
- History enters from the left; Changes and Settings enter from the right. All drawers need a real
  mounted closed frame followed by an open frame, plus a closing transition before unmount.
- The user selected packaged icons only: macOS Applications bundle, Windows executable/taskbar,
  and Linux window/dock. Installer, shortcut, and application-menu registration remain excluded.

## Research Summary

- Electron `safeStorage` supports asynchronous encryption and decryption; credential clearing can
  remain an atomic configuration-file update without a server contract change.
- Electron Forge/Packager accepts the platform application icon for macOS and Windows. Linux
  window/dock identity additionally needs an explicit PNG passed to `BrowserWindow` because the
  portable ZIP does not install a desktop entry.
- npm trusted publishing can publish the package through GitHub OIDC, while dist-tag changes still
  require a short-lived traditional token. The existing promotion workflow already separates
  `candidate` publication from anonymous verification and final `beta`/`latest` movement.
- GitHub immutable release tags and protected environments require fix-forward recovery with a
  higher beta rather than retagging or republishing.

## Constraints

- Preserve renderer isolation, secure credential storage, HTTPS/loopback URL policy, workspace
  containment, one-time approvals, and fail-closed OS sandbox behavior.
- Keep sponsor and settlement data in the display channel only; never add it to model, tool,
  command, patch, or compacted context.
- Preserve router routes, NDJSON contracts, local SQLite history, project data, and existing saved
  origins/preferences.
- Keep the implementation small, reviewable, and reversible. Add only the pinned `lucide-react`
  UI dependency required to match the reference icon language.
- Preserve the user-owned untracked `AGENTS.md`; never edit or stage it.
- Release versions/tags are immutable. Publish `0.1.0-beta.7` under `candidate`, verify it, then
  move `beta` and `latest` and remove `candidate`.

## Out of Scope

- Backend credential creation/revocation or browser account-management APIs.
- Dark mode, a full WebUI feature port, advertiser/developer dashboards, or unrelated UI cleanup.
- MSI/MSIX, DMG, deb/rpm/AppImage, shortcuts, Start-menu/Desktop entries, signing, notarization,
  or automatic updates.
- Changes to sponsor selection, settlement, model prompts, runtime tools, or command policy.

## Reversibility

- Migrate configuration additively to schema 3 and retain schema-1/schema-2 readers.
- Keep sign out as one privileged IPC operation that atomically clears ciphertext; a failed write
  leaves the current session intact.
- Keep visual changes inside renderer/assets/window configuration so runtime behavior can be
  reverted independently.
- Merge through the protected PR path before creating the immutable release tag. Any post-tag
  defect is fixed forward as `0.1.0-beta.8` or later.

---

## Step A: Add secure local sign out and API-key rotation

### Status

`done`

### Objective

Let a configured user sign out locally, return to prefilled onboarding, and save a replacement API
credential without exposing or revoking credential material through the desktop client.

### Tasks

- [x] Add schema-3 persistence with nullable encrypted token and schema-1/schema-2 migration.
- [x] Add an atomic `ConfigurationStore.signOut()` operation that preserves non-secret settings.
- [x] Expose a typed `configuration.signOut()` IPC method and reject it while an agent task runs.
- [x] Add Settings confirmation/copy explaining device-local removal and server-side revocation.
- [x] Return to onboarding with the preserved origin and sponsorship preference after success.
- [x] Cover migration, atomic clearing, active-task rejection, and renderer rotation flow.

### Relevant Files

- `src/main/configuration-store.ts`
- `src/main/ipc.ts`
- `src/preload/index.ts`
- `src/shared/contracts.ts`
- `src/renderer/App.tsx`
- `tests/main/configuration-store.test.ts`
- `tests/renderer/App.test.tsx`

### Expected Changes

- modify: configuration schema/read/write logic, privileged IPC contract, Settings/onboarding UI,
  and focused tests
- delete: no user data or legacy schema readers

### Do Not Modify

- Router credential lifecycle/backend endpoints
- Token isolation from the renderer
- Projects, chats, approvals, or runtime event data

### Commands

```bash
npm run typecheck
npm test -- tests/main/configuration-store.test.ts tests/renderer/App.test.tsx
```

### Acceptance Criteria

- [x] Sign out clears only encrypted credential ciphertext after confirmation.
- [x] Origin, sponsored-compute setting, projects, chats, and compatible model preferences survive.
- [x] Active tasks cannot be signed out from either the UI or direct IPC.
- [x] A failed replacement credential leaves the app signed out and shows actionable diagnostics.
- [x] Plaintext credentials never cross from main/preload into the renderer.

### Validation Results

- `npm run typecheck`: passed
- focused configuration/renderer tests: passed (8 tests)
- packaged sign-out E2E: passed

### Findings / Notes

- Sign out is deliberately device-local. Users create/rotate/revoke hosted keys in the WebUI.

---

## Step B: Apply focused WebUI visual parity and bidirectional drawers

### Status

`done`

### Objective

Match the sibling WebUI's recognizable chat, empty-state, tier presentation, jellyfish identity,
and icon language while preserving desktop-specific project/review controls.

### Tasks

- [x] Add pinned `lucide-react` icons and replace textual/glyph controls with labeled icon buttons.
- [x] Rework the first-page/chat shell to the WebUI ivory/blue composition and jellyfish branding.
- [x] Align Tier A/B/C/NONE surfaces without changing sponsor data or placement semantics.
- [x] Place History on the left and Changes/Settings on the right with enter/exit animations.
- [x] Honor reduced-motion and retain accessible names, focus states, and responsive behavior.
- [x] Add renderer tests for drawer direction/state and the sign-out affordance.

### Relevant Files

- `src/renderer/App.tsx`
- `src/renderer/styles.css`
- `src/renderer/index.html`
- `package.json`
- `package-lock.json`
- `tests/renderer/App.test.tsx`

### Expected Changes

- modify: renderer structure/styles/tests and pinned dependencies
- create: no parallel design system or duplicated sponsor model

### Do Not Modify

- Sponsor event DTOs or tier-selection logic
- Runtime/model/tool context construction
- Desktop coding-agent project, approval, and review responsibilities

### Commands

```bash
npm run lint
npm run typecheck
npm test -- tests/renderer/App.test.tsx
```

### Acceptance Criteria

- [x] Empty and active chat screens visibly follow the sibling WebUI's ivory/blue system.
- [x] Tier A/B/C/NONE remain correctly labeled, dismissible where already supported, and display-only.
- [x] History animates from/to the left; Changes and Settings animate from/to the right.
- [x] Entry animation occurs after mounting and exit finishes before unmounting.
- [x] Keyboard/accessibility labels and reduced-motion behavior remain usable.

### Validation Results

- renderer lint/typecheck/tests: passed

### Findings / Notes

- Focused parity intentionally excludes dark mode and browser account/dashboard surfaces.

---

## Step C: Update packaged identity and beta.7 release metadata

### Status

`done`

### Objective

Use the canonical jellyfish mark throughout packaged desktop identity and prepare all source,
launcher, documentation, and protected-workflow metadata for immutable beta.7 artifacts.

### Tasks

- [x] Replace checked-in SVG/PNG/ICNS/ICO application icons from the canonical WebUI mark.
- [x] Pass the PNG icon to Linux `BrowserWindow` while preserving platform-native behavior.
- [x] Set package/launcher/docs/release metadata to `0.1.0-beta.7`, tag
      `v0.1.0-beta.7`, build version `10007`, and short app version `0.1.0`.
- [x] Update the GitHub repository configuration script's exact release-tag policy.
- [x] Update changelog, release notes/runbook, support table, and public boundary fixtures.
- [x] Verify source manifests retain `UNBUILT` hash placeholders until protected builds.

### Relevant Files

- `assets/`
- `src/main/index.ts`
- `forge.config.ts`
- `package.json`
- `package-lock.json`
- `packages/agent-launcher/`
- `README.md`
- `CHANGELOG.md`
- `SECURITY.md`
- `RELEASE.md`
- `docs/`
- `scripts/`
- `.github/workflows/`

### Expected Changes

- modify: packaged icons, window setup, version/release metadata, docs, and policy fixtures
- delete: obsolete non-jellyfish icon artwork only after replacement assets verify

### Do Not Modify

- Application/package identifiers
- Artifact target keys or launcher verification model
- Published beta.6 tag, release, assets, or npm package

### Commands

```bash
npm run check:public
npm run test:workflows
npm run check:launcher-package
```

### Acceptance Criteria

- [x] macOS bundle, Windows executable/taskbar, and Linux window/dock use the jellyfish identity.
- [x] No installer/shortcut/menu-registration behavior is introduced.
- [x] Every authoritative source manifest consistently targets beta.7.
- [x] Release placeholders remain unbuilt and no local artifact is treated as public output.

### Validation Results

- public/workflow/launcher checks: passed

### Findings / Notes

- Linux file-manager registration is unavailable for the portable ZIP without a desktop entry and
  remains out of scope.

---

## Step D: Final verification and cleanup

### Status

`done`

### Objective

Prove the code, packaged Electron app, launcher boundary, and release workflow are ready for the
protected public release.

### Tasks

- [x] Run the full normal validation suite and packaged deterministic Electron E2E.
- [x] Build/verify the local macOS universal artifact and relevant launcher/release assets.
- [x] Inspect the final diff, dependency audit, generated asset identity, and source parity.
- [x] Remove temporary debug/generated files and record any skipped cross-platform manual checks.
- [x] Mark completed plan steps and record validation results/remaining risks.

### Relevant Files

- repository-wide reviewed diff
- `tests/e2e/`
- `scripts/verify-*.mjs`
- `PLAN.md`

### Expected Changes

- modify: plan validation record and any narrowly required test/documentation corrections
- delete: temporary outputs only; never user data or tracked source

### Do Not Modify

- User-owned untracked `AGENTS.md`
- Published releases, npm tags, or protected secrets during local verification

### Commands

```bash
npm run check
npm run test:e2e
npm audit --omit=dev --audit-level=moderate
npm run make:mac
npm run verify:dist
git diff --check
git status --short
```

### Acceptance Criteria

- [x] Normal checks and deterministic packaged E2E pass.
- [x] The macOS universal package verifies and contains the expected icon/version identity.
- [x] No credentials, developer paths, test hooks, or sponsor data leaks enter public artifacts.
- [x] The final diff is scoped, documented, and ready for protected PR/release review.

### Validation Results

- `npm run check`: passed (41 unit/renderer, 6 integration, 17 launcher tests)
- `npm run test:e2e`: passed (2 packaged Electron tests)
- `npm audit --omit=dev --audit-level=moderate`: passed, 0 vulnerabilities
- `npm run make:mac && npm run verify:dist`: passed, universal app and ZIP verified
- `git diff --check`: passed

### Findings / Notes

- Native Ubuntu and Windows artifact verification remains a protected workflow gate.

---

## Step E: Merge and publish the protected beta.7 release

### Status

`in_progress`

### Objective

Merge through protected `main`, create the immutable beta.7 tag, publish verified native assets,
and promote the launcher through npm candidate to beta/latest.

### Tasks

- [x] Create a `codex/` release branch, commit reviewed changes, push, and open a PR.
- [x] Obtain green required/native checks and merge the PR through GitHub.
- [ ] Reconfigure/verify beta.7 repository environment tag policies before pushing the tag.
- [ ] Create/push annotated `v0.1.0-beta.7` and approve protected release environments.
- [ ] Verify the draft prerelease asset inventory, checksums, SBOMs, attestations, and native jobs.
- [ ] Dispatch/approve promotion, verify anonymous candidate installs, and confirm final npm tags.
- [ ] Remove the short-lived dist-tag secret and revoke its npm token after verification.

### Relevant Files

- `.github/workflows/release-tag.yml`
- `.github/workflows/promote-release.yml`
- `scripts/configure-github-repository.mjs`
- `RELEASE.md`
- `docs/release-checklist.md`

### Expected Changes

- external: protected PR/merge, immutable tag, GitHub prerelease, npm version/dist-tags
- repository: no post-tag source edits unless fixing forward in a higher beta

### Do Not Modify

- Existing beta.6 tag/assets/npm version
- Protected credentials outside the documented environments
- Release artifacts produced outside GitHub Actions

### Commands

```bash
gh auth status
gh pr checks --watch
npm run configure:github
git tag -a v0.1.0-beta.7 -m "AdRouter Agent 0.1.0-beta.7"
git push origin v0.1.0-beta.7
gh workflow run promote-release.yml --ref v0.1.0-beta.7 -f tag=v0.1.0-beta.7
npm view @adrouter/agent@0.1.0-beta.7 version dist.integrity repository --json
npm view @adrouter/agent dist-tags --json
```

### Acceptance Criteria

- [ ] Protected PR review and required checks pass before the release tag is created.
- [ ] GitHub publishes the complete beta.7 prerelease from native protected builds.
- [ ] npm beta.7 passes anonymous four-platform candidate installation before promotion.
- [ ] `beta` and `latest` resolve exactly to beta.7 and `candidate` is removed.
- [ ] Temporary npm credentials are deleted from GitHub and revoked at npm.

### Validation Results

- public release validation: not run

### Findings / Notes

- Interactive GitHub reauthentication, npm token creation, and protected-environment approvals are
  user actions; no secret should be sent through chat or command arguments.
- PR #10 passed all checks and was merged through the configured one-maintainer administrator
  bypass because its author is also the sole CODEOWNER and cannot self-approve.
- A pre-tag audit found the promotion input default still referenced beta.6; a focused follow-up PR
  updates it to beta.7 and adds a package-version policy assertion before any tag is created.

---

## Follow-up Work

- Sign/notarize platform artifacts and add native installers only in a separately scoped release.
- Revisit Linux desktop-file registration if the product adopts deb/rpm/AppImage distribution.
- Add dark mode only after the shared WebUI design system defines an accepted dark palette.

## Decision Log

| Date | Decision | Rationale | Impact |
| --- | --- | --- | --- |
| 2026-07-26 | Use device-local sign out | The desktop has no account credential-lifecycle contract; clearing ciphertext safely enables replacement while revocation stays in WebUI. | Preserves backend/API scope and local history. |
| 2026-07-26 | Use focused WebUI parity | The desktop needs recognizable shared identity without importing browser-only dashboards or auth. | Limits UI work to chat, tiers, first page, icons, and panels. |
| 2026-07-26 | Package icons without shortcuts | Portable ZIPs can provide native app/window identity without expanding into installers. | macOS/Windows/Linux packaged identity changes; no menu registration. |
| 2026-07-26 | Release as beta.7 | beta.6 is already immutable and public. | All code/release metadata advances to the next prerelease. |
