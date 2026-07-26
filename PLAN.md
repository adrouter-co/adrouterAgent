# Plan: Cross-platform AdRouter Agent with live staging support

## Goal

Ship the AdRouter Agent as a portable desktop application and npm-managed
launcher for macOS, Ubuntu 24.04 LTS x64, and Windows 11 x64, with fresh
installations preconfigured for `https://api-staging.adrouter.co` and no
embedded credentials.

## Context

- The current Electron application, packaging, release workflow, and npm
  launcher are macOS-specific.
- The desktop router client already supports configurable HTTPS origins and
  uses `/health`, `/v1/profile`, `/v1/models`, and `/v1/agent/turn`.
- The staging service is live at `https://api-staging.adrouter.co`; health and
  model discovery match the current client contract, while authenticated routes
  require a user-supplied bearer token.
- macOS command execution uses Seatbelt. Linux will use Bubblewrap. Windows
  command execution remains fail-closed until the pinned sandbox runtime's
  one-time elevated setup has been run manually.
- The existing macOS user-data path and saved router configuration must remain
  unchanged.

## Research Summary

- Electron Forge's ZIP maker supports macOS, Windows, and Linux, so portable
  archives do not require an additional maker dependency.
- Electron `safeStorage` uses Keychain on macOS, DPAPI on Windows, and the
  available secret store on Linux. Linux weak `basic_text` storage must be
  rejected for bearer-token persistence.
- Ubuntu 24.04 restricts unprivileged user namespaces through AppArmor;
  Bubblewrap needs a narrow executable profile rather than a global security
  relaxation.
- `@anthropic-ai/sandbox-runtime@0.0.65` documents macOS, Linux, and alpha
  Windows support. Windows needs a one-time `windows-install` command with UAC.

## Constraints

- Preserve current macOS behavior, saved configuration, router routes, NDJSON
  protocol, database data, and sponsor isolation.
- Keep the launcher dependency-free and free of lifecycle scripts.
- Preserve fail-closed archive, checksum, redirect, command-policy, credential,
  and sandbox behavior.
- Do not embed, log, package, or expose an AdRouter bearer token.
- Keep Electron 43 pinned so the existing macOS 12 support is not silently
  dropped.
- Keep the first implementation small, reviewable, and reversible.
- Prefer minimal diffs over broad rewrites and introduce no new runtime
  dependencies unless explicitly required.

## Out of Scope

- Native MSI/MSIX, DMG, deb, rpm, AppImage, Start-menu, or desktop-menu
  installers.
- Windows code signing, Linux package signing, Apple Developer ID signing,
  notarization, or auto-update.
- Windows/Linux ARM64, WSL, and Linux distributions other than Ubuntu 24.04 LTS.
- Automatically elevating privileges or disabling AppArmor/system sandboxing.
- Router backend deployment or API-contract changes.
- Unrelated UI redesign, module renames, or opportunistic cleanup.

## Reversibility

- Add platform adapters and schema readers before replacing platform-specific
  branches.
- Preserve schema-2 macOS receipts and migrate only after verifying the managed
  installation.
- Keep platform release jobs isolated so any new target can be disabled without
  changing macOS output.
- Stage launcher updates beside the destination and restore the prior managed
  installation on activation failure.
- Keep implementation commits aligned with the steps and document any
  irreversible release action before performing it.

---

## Step A: Make the desktop runtime and configuration platform-aware

### Status

`done`

### Objective

Run the Electron application safely on macOS, Ubuntu, and Windows while making
the live staging origin the editable default for fresh onboarding.

### Tasks

- [x] Add one non-secret staging-origin constant and use it only when no router
      configuration has been saved.
- [x] Add platform-aware paths, environment construction, command quoting,
      command-policy normalization, cancellation, and process-tree handling.
- [x] Add sandbox readiness reporting and fail closed when the platform sandbox
      or secure credential storage is unavailable.
- [x] Use native title bars and platform-neutral user-facing copy outside macOS.
- [x] Add Windows and Linux icon assets required by Electron packaging.
- [x] Add platform-focused unit and integration coverage.

### Relevant Files

- `src/main/`
- `src/runtime/`
- `src/preload/`
- `src/renderer/`
- `assets/`
- `test/`

### Expected Changes

- create: small platform/runtime adapter modules and focused tests
- modify: configuration defaults, sandbox startup, command execution, app info,
  credential handling, and platform-specific UI copy
- delete: no persisted data, routes, or legacy receipt readers

### Do Not Modify

- Router API paths or NDJSON event contracts
- Sponsor isolation and command approval flow
- Existing saved router origins or user-data locations

### Commands

```bash
npm run lint
npm run typecheck
npm test
npm run test:integration
```

### Acceptance Criteria

- [x] Fresh onboarding is prefilled with the exact staging origin and remains
      editable; an existing saved origin is preserved.
- [x] Unsafe Linux credential storage and missing Linux/Windows sandbox setup
      remove shell/Git capabilities and surface actionable diagnostics.
- [x] Windows command parsing handles executable suffixes, drive paths, UNC
      paths, backslashes, PowerShell serialization, and process-tree shutdown.
- [x] macOS behavior and all relevant tests continue to pass.

### Validation Results

- `npm run lint`: passed
- `npm run typecheck`: passed
- `npm test`: passed, 39 tests
- `npm run test:integration`: passed, 6 tests

### Findings / Notes

- Windows sandbox setup is intentionally a manual prerequisite; the application
  never requests elevation.

---

## Step B: Produce and verify portable artifacts for each operating system

### Status

`review`

### Objective

Build a macOS universal ZIP, Ubuntu x64 ZIP, and Windows x64 ZIP with an
artifact manifest that lets the launcher choose and verify the exact target.

### Tasks

- [x] Configure Forge ZIP outputs and platform-specific executable/icon details.
- [x] Generalize release preparation and verification to manifest schema 3 with
      an `artifacts` collection keyed by `darwin-universal`, `linux-x64`, and
      `win32-x64`.
- [x] Preserve ad-hoc macOS verification and define portable checksum/archive
      verification for unsigned Linux and Windows beta artifacts.
- [x] Add native CI build jobs and aggregate checksums, SBOMs, manifest, ZIPs,
      and the npm tarball before creating a draft release.
- [x] Add release-script and manifest tests for supported and rejected targets.

### Relevant Files

- `forge.config.ts`
- `package.json`
- `scripts/`
- `.github/workflows/`
- `assets/`

### Expected Changes

- modify: Forge configuration, package scripts, release manifest preparation,
  release verification, and CI matrices
- create: platform icon assets or deterministic generation inputs if absent

### Do Not Modify

- Public package/application identity
- Immutable release-tag and candidate-before-promotion policy
- macOS universal architecture support

### Commands

```bash
npm run make:mac
npm run verify:dist
npm run test:workflows
node scripts/prepare-release-assets.mjs 0.1.0-beta.4
node scripts/verify-release-assets.mjs out/release
```

### Acceptance Criteria

- [ ] Native build jobs emit the exact three artifact keys and stable archive
      layouts described by schema 3.
- [x] Every archive has a checksum and SBOM entry and passes target-appropriate
      verification.
- [x] macOS remains universal and strictly verifies its ad-hoc signature.
- [x] Linux and Windows outputs contain the expected executable paths and no
      secrets.

### Validation Results

- `npm run make:mac`: passed
- `npm run verify:dist`: passed
- `npm run make:linux && npm run verify:dist:linux`: passed cross-build verification
- `npm run make:windows && npm run verify:dist:windows`: passed cross-build verification
- workflow policy checks: passed
- release preparation and verification: passed, 8 checksummed assets

### Findings / Notes

- Linux and Windows portable beta archives are unsigned; checksums and release
  provenance establish artifact integrity but not publisher identity.
- The native Ubuntu and Windows jobs are configured but must run on GitHub
  before promotion; local cross-builds verified both archive layouts.

---

## Step C: Generalize the npm launcher and diagnostics

### Status

`done`

### Objective

Install, update, diagnose, and launch the correct portable application on every
supported OS without lifecycle downloads or runtime dependencies.

### Tasks

- [x] Select schema-3 artifacts by exact OS/architecture and reject unsupported
      combinations.
- [x] Add XDG and LocalAppData installation/receipt paths while preserving the
      macOS locations.
- [x] Generalize safe archive extraction, executable validation, activation,
      rollback, and launch behavior for ZIP layouts on all targets.
- [x] Add schema-3 receipts and doctor output, retaining verified schema-2
      macOS migration support.
- [x] Expand npm `os` metadata and add installer/doctor tests for traversal,
      checksum, redirect, collision, rollback, and migration failures.

### Relevant Files

- `packages/agent-launcher/package.json`
- `packages/agent-launcher/lib/`
- `packages/agent-launcher/test/`
- `packages/agent-launcher/README.md`

### Expected Changes

- modify: launcher platform selection, paths, archive validation, receipt,
  doctor schema, startup, package metadata, and documentation
- create: platform-focused launcher helpers/tests where useful

### Do Not Modify

- Dependency-free package design
- No-lifecycle-script policy
- Canonical-host redirect and checksum enforcement
- Safe staged activation and rollback guarantees

### Commands

```bash
npm run test:launcher
npm run check:launcher-package
```

### Acceptance Criteria

- [x] The launcher chooses only the exact compatible artifact and refuses
      unsupported OS/CPU combinations.
- [x] Install paths are `~/Applications`, XDG data, and LocalAppData on macOS,
      Linux, and Windows respectively.
- [x] Schema-3 doctor output reports platform, architecture, sandbox readiness,
      installation integrity, and actionable static setup guidance without
      exposing credentials.
- [x] Malicious or corrupt archives and interrupted updates fail safely.

### Validation Results

- `npm run test:launcher`: passed, 16 tests
- `npm run check:launcher-package`: passed

### Findings / Notes

- npm CPU metadata retains `arm64` for the existing universal macOS build, but
  the launcher rejects ARM64 on new operating-system targets.

---

## Step D: Document setup, authentication, and live staging validation

### Status

`review`

### Objective

Give users and release operators exact platform prerequisites, bearer-token
setup, and a protected live staging canary with no secret leakage.

### Tasks

- [x] Document Ubuntu dependencies and a narrow Bubblewrap AppArmor profile.
- [x] Document the pinned manual Windows sandbox setup command and its UAC
      requirement.
- [x] Document that the desktop defaults to staging but requires the user's
      AdRouter bearer token; distinguish it from provider credentials.
- [x] Default public smoke checks to the exact staging origin while retaining an
      explicit local-development override.
- [x] Keep only `ADROUTER_STAGING_API_KEY` secret in protected canary jobs and
      validate health, authentication, model discovery, and one bounded no-tools
      streamed turn.
- [x] Update security, privacy, support, release, and source-provenance docs.

### Relevant Files

- `README.md`
- `RELEASE.md`
- `SECURITY.md`
- `PRIVACY.md`
- `docs/`
- `.github/workflows/`

### Expected Changes

- modify: user setup, authentication, support, security, release, and CI canary
  documentation/configuration

### Do Not Modify

- Staging backend deployment or provider credentials
- Secret values or authentication bypasses
- Ad payload isolation rules

### Commands

```bash
npm run check:public
npm run test:staging-canary
```

### Acceptance Criteria

- [x] A new user can identify every OS prerequisite and where to obtain/enter
      the AdRouter bearer token without being told to expose it in a shell log.
- [x] The staging URL is public configuration and the token remains protected.
- [ ] The canary discovers a server-advertised model and reaches a terminal
      `done` event without enabling tools.
- [x] Documentation never suggests disabling AppArmor or reusing a provider key.

### Validation Results

- `npm run check:public`: passed
- `npm run test:staging-canary`: not run (requires protected secret)

### Findings / Notes

- `/health` is unauthenticated and cannot prove that a bearer token is valid;
  `/v1/profile` or `/v1/models` must be checked with authentication.
- `https://api-staging.adrouter.co/health`: passed with `{"status":"ok"}`.

---

## Step E: Final verification and cleanup

### Status

`review`

### Objective

Verify the complete change, review the diff for scope and secret safety, and
record any platform validation that still requires native hardware or release
credentials.

### Tasks

- [x] Run the full local validation suite and packaged macOS E2E coverage.
- [ ] Verify native Ubuntu and Windows CI jobs or record them as required
      pre-release validation when not runnable locally.
- [x] Review the final diff for unintended changes, credential exposure, stale
      macOS-only claims, debugging code, unused files, and generated output.
- [x] Confirm existing saved configurations and schema-2 macOS receipts remain
      readable.
- [x] Record remaining risks and follow-up release work.

### Relevant Files

- all files changed by Steps A-D
- `PLAN.md`

### Expected Changes

- modify: only validation findings, documentation corrections, and plan status
- delete: temporary/debug/generated files only if created by this work

### Do Not Modify

- Unrelated user changes
- External releases, npm versions, tags, or deployment state

### Commands

```bash
npm run check
npm run test:e2e
npm audit --omit=dev --audit-level=moderate
git diff --check
git status --short
```

### Acceptance Criteria

- [x] All locally runnable checks pass.
- [ ] Native CI covers every supported target before release promotion.
- [x] No secrets, generated artifacts, or unrelated changes are present.
- [x] Documentation and diagnostics state any unsigned/alpha limitations clearly.
- [x] Remaining external setup and authentication steps are listed for the user.

### Validation Results

- `npm run check`: passed
- `npm run test:e2e`: passed, 2 packaged Electron tests
- `npm audit --omit=dev --audit-level=moderate`: passed, 0 vulnerabilities
- `git diff --check`: passed

### Findings / Notes

- Only macOS packaging can be executed locally; Ubuntu and Windows package/runtime
  behavior must also pass on native CI runners before a public release.

---

## Follow-up Work

- Run a protected live staging canary with an issued AdRouter staging bearer
  token.
- Exercise installation, sandbox boundaries, update rollback, and GUI startup on
  clean Ubuntu 24.04 and Windows 11 x64 machines.
- Add signing/native installers only after the portable beta path is proven.

## Decision Log

| Date | Decision | Rationale | Impact |
| --- | --- | --- | --- |
| 2026-07-26 | Target macOS universal, Ubuntu 24.04 x64, and Windows 11 x64 | Covers the requested additional operating systems while matching supported sandbox/runtime paths | Other Linux distributions, WSL, and new-OS ARM64 remain unsupported |
| 2026-07-26 | Prioritize the dependency-free npm launcher and portable ZIPs | Reuses the hardened installer and avoids native installer/signing scope | Linux and Windows beta artifacts are unsigned |
| 2026-07-26 | Prefill only fresh onboarding with `https://api-staging.adrouter.co` | Makes the live service immediately discoverable without overwriting saved choices | Users still provide their own bearer token |
| 2026-07-26 | Require manual Windows sandbox provisioning | The pinned runtime's Windows support is alpha and needs UAC | Shell/Git tools fail closed until setup succeeds |
| 2026-07-26 | Keep Ubuntu AppArmor enabled with a narrow Bubblewrap profile | Ubuntu 24.04 restricts user namespaces by design | Setup is explicit without weakening host-wide security |
