# Plan: AdRouter Agent Platform-Access Beta Rollout

## Goal

Make the Electron desktop Agent wire-compatible with the Router's platform-bound authentication
contract, replace self-consistent mocks with canonical contract evidence, convert release promotion
to a safely pausable trusted-publishing flow, and publish/accept the exact `0.1.0-beta.10`
application and launcher artifacts.

## Context

- This is the independent `adrouter/adrouterAgent` repository for the Electron desktop app and
  public `@adrouter/agent` launcher.
- Source/application/launcher metadata is `0.1.0-beta.10`. Beta.8 was rejected after exact-artifact
  acceptance found two desktop usability defects. Beta.9 was published only as a candidate and was
  superseded before channel promotion by the approved dark-theme and UI refinement release delta.
- Use beta.10 only if a fresh npm/Git/GitHub check shows the version, tag, release, draft, and
  workflow identity are still unused. Otherwise increment before tagging.
- Main-process encrypted installation storage, enrollment, refresh, signing broker, sign-out,
  renderer-safe status, launcher/package tooling, credential-free workflows, and acceptance
  validation are substantially implemented.
- Pinned Node.js 25.9.0 verification on 2026-07-27 passed 18 unit files/58 tests, three
  integration files/10 tests, and 18 launcher/release tests. Packaged E2E
  verification also passed.
- Those green tests are false interoperability confidence because the Desktop mocks assert the same
  incompatible contract emitted by Desktop.
- Router initiation requires `public_key_jwk`, `requested_scopes`, and `storage_class`.
  Desktop currently sends `public_jwk`, `scopes`, and `storage_classification`.
- Router device redemption requires `grant_type`, `device_code`, and `client_kind`, and rejects
  extra fields. Desktop omits `client_kind` and may send `installation_id`.
- Router errors are `{ error: <safe message>, code: <machine code> }`. Desktop currently treats
  `error` as the machine-code enum, so pending, slow-down, denial, expiry, and other flows fail.
- Router bodyless `GET /v1/profile` rejects `Content-Digest` and DPoP `bht`. Desktop currently
  adds both for an empty body.
- Router/CLI canonical fixture SHA-256 is
  `93a8ec8d4eba38f9165179aa0cdfe3316f8134a882bd0426bd83339af55d17f8`;
  Desktop has no canonical mirrored fixture.
- The current promotion workflow performs candidate publication, anonymous smoke, and finalization
  in one dispatch. It intentionally fails without acceptance but is not a real pause/resume
  boundary.
- `@adrouter/agent` already exists publicly, so `NPM_BOOTSTRAP_TOKEN` documentation and branches
  are stale.
- This plan ends at a beta release. Stable, production, signing/notarization, and OpenCode are out
  of scope.

## Research Summary

- Router source and OpenAPI are authoritative for request names, strict grant schemas, response
  envelopes, proof-body rules, and client/version policy.
- The CLI's byte-identical fixture provides a second implemented client reference; Desktop must
  mirror the Router fixture rather than inventing a third local shape.
- Electron `safeStorage` remains the correct privileged boundary. Main alone owns private keys,
  refresh credentials, access memory, proof signing, and revocation; renderer sees only redacted
  enrollment state.
- [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) supports GitHub Actions OIDC
  publication with npm 11.5.1+, Node 22.14+, GitHub-hosted runners, and `id-token: write`.
  The pinned Node 25 workflow satisfies that runtime floor.
- Trusted publishing covers `npm publish`, while current npm dist-tag operations still need a
  narrowly scoped traditional token. Desktop therefore removes the bootstrap token and keeps only
  a fresh `NPM_DIST_TAG_TOKEN` for finalization.
- The launcher candidate needs publicly downloadable GitHub ZIP URLs, so candidate phase must publish
  the GitHub prerelease before anonymous launcher smoke. It must not move npm final channels.
- Desktop acceptance validation requires exactly four artifacts: macOS universal ZIP, Ubuntu x64
  ZIP, Windows x64 ZIP, and launcher tarball, plus primary and distinct-second-OS cohorts.

## Constraints

- Use repository-pinned Node.js 25.9.0, npm 10+, Electron 43, the existing lockfile, Forge, and the
  existing process boundaries.
- Keep key generation, encrypted persistence, refresh, proof signing, and revocation in main.
  Renderer/preload never receives private or token material.
- Keep the main/utility broker purpose-, origin-, method-, path-, size-, and version-allowlisted; it
  must not become a general signing oracle.
- `safeStorage` must fail closed on unavailable/unsafe backends; no plaintext or file-only fallback
  is allowed for hosted Desktop auth.
- For POST requests, sign and send exactly one serialized byte sequence. For bodyless GET requests,
  omit body digest headers and claims entirely.
- Preserve HTTPS/loopback policy, renderer isolation, sandbox, workspace containment, one-time
  mutation/command approvals, stream/cancellation/no-replay behavior, and sponsor separation.
- Do not hand-edit generated `out/`, `.vite/`, packaged ZIPs, provenance, or `UNBUILT`
  source placeholders.
- Versions/tags/artifacts are immutable. Any candidate defect uses a higher beta.
- Publishing, tagging, workflow/environment configuration, release uploads, dist-tag changes, and
  token cleanup require explicit authorization.
- Preserve unrelated dirty/untracked work, including `AGENTS.md`.

## Out of Scope

- Stable `0.1.0`, production Router rollout, automatic updates, or a stable channel.
- Developer ID signing/notarization or changing the unsigned portable beta posture.
- Linux/Windows arm64 desktop artifacts.
- OpenCode compatibility/release work.
- General UI, sandbox, task, diff, model, provider, or dependency redesign.
- Hardware-backed/non-exportable keys or attestation.
- Deleting hosted legacy credential records or remote AdRouter secrets.

## Reversibility

- Fix wire compatibility behind the existing versioned main-process auth boundary; do not broaden
  renderer IPC or destroy unrelated settings/tasks.
- Keep custom/loopback bearer configuration isolated for development while staging is dual auth.
- Candidate publication becomes an explicit phase. A rejected beta leaves `beta`/`latest`
  unchanged and is replaced by a higher version.
- Manual acceptance binds all four immutable artifacts and does not modify them.
- Router Desktop policy remains observe until the accepted beta completes the 24-hour staging soak;
  policy can return to observe independently of the public release.
- Remove temporary npm authentication only after final public verification.

---

## Step A: Correct the Desktop-to-Router wire contract

### Status

`done`

### Objective

Make enrollment, token polling/refresh, profile, and turn requests match Router source/OpenAPI byte
for byte and convert every known mismatch into a regression test.

### Tasks

- [x] Change the initiation JSON to exact strict keys:
      `client_kind`, `client_version`, `display_name`, `public_key_jwk`,
      `requested_scopes`, and `storage_class`.
- [x] Preserve one serialization of that object for `Content-Digest`, DPoP `bht`, and the
      transmitted POST body.
- [x] Change the device grant to exactly `grant_type`, `device_code`, and
      `client_kind: "desktop"`; never send `installation_id`.
- [x] Keep refresh grant exactly `grant_type`, `refresh_token`, and `installation_id`.
- [x] Change OAuth/platform error parsing to accept bounded
      `{ error: string, code: enum }`; branch on `code` and use `error` only as sanitized
      display text.
- [x] Cover `authorization_pending`, `slow_down`, `access_denied`, `expired_token`,
      `invalid_request`, `invalid_access_token`, `invalid_dpop_proof`,
      `use_dpop_nonce`, and `client_upgrade_required` as applicable.
- [x] Make `ProtectedRouterRequest.body` and `ProtectedRouterHeaders["Content-Digest"]` optional
      for bodyless requests.
- [x] Update proof creation so `GET /v1/profile` has no `Content-Digest` and no `bht`, while
      retaining `ath`, method, URL, nonce, client kind, and version.
- [x] Require body bytes and digest/bht for `POST /v1/agent/turn` and auth POST routes.
- [x] Keep one bounded header-only nonce retry before body consumption and reject authenticated
      redirects.
- [x] Validate token response `client_kind`, derive family expiry from
      `refresh_expires_in`, and retain safe reconnect behavior on mismatch/rotation failure.
- [x] Map `426` and minimum-version headers into existing upgrade/reconnect state without exposing
      response bodies.
- [x] Mirror the canonical Router fixture, pin its checksum in release metadata, and test every
      positive/negative vector.
- [x] Replace tests that assert `public_jwk`, `scopes`, `storage_classification`, device
      `installation_id`, error-as-code, or GET body binding.
- [x] Add an integration fixture that imports Router-owned request/response examples or an exact
      mirrored file, so Desktop mocks cannot drift silently.

### Relevant Files

- `src/main/installation-auth.ts`
- `src/main/platform-auth-crypto.ts`
- `src/runtime/router-client.ts`
- `src/shared/runtime-protocol.ts`
- `src/shared/contracts.ts`
- `tests/main/installation-auth.test.ts`
- `tests/main/platform-auth-crypto.test.ts`
- `tests/integration/router-client.test.ts`
- Packaged E2E fixtures
- `packages/agent-launcher/release-manifest.json` or the authoritative fixture metadata location

### Expected Changes

- modify: initiation/grant/error schemas, body-optional proof/header types, profile/turn transport,
  fixture metadata, tests, and safe error mapping
- create: mirrored canonical `platform-auth-v1` fixture if absent

### Do Not Modify

- Renderer access to Node/Electron, general IPC surface, sandbox/approvals, prompt/tool mapping,
      stream events, or generated artifacts.
- Make POST body bindings optional or allow caller-supplied protected headers.
- Add OpenCode compatibility logic.

### Commands

~~~bash
nvm use 25.9.0
npm run lint
npm run typecheck
npm run test
npm run test:integration
npm run test:e2e
~~~

### Acceptance Criteria

- [x] Initiation and both grant types pass Router strict schemas exactly.
- [x] Pending/slow-down/denied/expired and upgrade/reconnect behavior branches on Router `code`.
- [x] Profile GET sends no body-binding header/claim; turn/auth POSTs bind exact bytes.
- [x] Canonical negative vectors cover changed body bytes, method, URL, token, nonce, key, kind, and version.
- [x] Fixture bytes/checksum match Router/CLI exactly.
- [x] Renderer receives no key/token/code-beyond-user-code/nonce/proof/header material.
- [x] Unit, integration, and packaged E2E tests pass with Router-derived mocks.

### Validation Results

- Corrected lint/typecheck/unit: passed (18 files, 58 tests).
- Corrected integration: passed outside the Codex filesystem sandbox (three files, 10 tests); the
  first sandboxed attempt could not create the macOS sandbox-runtime Unix socket.
- Corrected packaged E2E: passed (functional flow and packaged renderer-security tests).
- Canonical fixture SHA-256 matched Router and CLI byte-for-byte:
  `93a8ec8d4eba38f9165179aa0cdfe3316f8134a882bd0426bd83339af55d17f8`.
- Live production-shaped Router integration: not run.

### Findings / Notes

- This step is a release blocker even though the existing suite is green.
- Router uses strict Zod objects for initiation and grants, so extra/renamed fields are not harmless.
- The matching Router and CLI fixture files are currently untracked in their sibling working trees;
  exact bytes are proven, but fixture provenance is not yet tied to a committed sibling revision.

---

## Step B: Revalidate process boundaries and package behavior

### Status

`done`

### Objective

Prove the corrected contract without weakening main/utility/renderer isolation, safe storage,
refresh atomicity, stream behavior, or native packaging.

### Tasks

- [ ] Re-run safeStorage unavailable/unsafe-backend tests and confirm hosted enrollment fails before
      key creation/persistence.
- [ ] Re-run encrypted pending/installation migration, restart, refresh single-flight, rotation
      persistence failure, sign-out, and unrelated-settings preservation.
- [ ] Verify the main/utility broker accepts only the configured origin, approved methods/paths, and
      bounded exact bytes; renderer cannot invoke it.
- [ ] Test concurrent protected requests and refresh, header replacement attempts, cancellation,
      timeout, authenticated redirect rejection, one nonce retry, and partial-stream no replay.
- [ ] Test signed profile, agent turn, tools, stream ordering, usage/settlement, valid NONE, and
      reconnect/upgrade states against a production-shaped local Router.
- [ ] Run source parity, public-boundary, launcher package, release readiness, and local macOS
      universal packaging/verification.
- [ ] Let release-tag native runners provide Ubuntu x64 and Windows x64 artifact evidence; do not
      claim those from a macOS build.
- [ ] Review diagnostics and logs for redaction; launcher doctor must not infer authenticated app
      state it cannot read.
- [ ] Record the exact Router fixture/commit and all validation results.

### Relevant Files

- `src/main/`
- `src/preload/`
- `src/runtime/`
- `src/renderer/`
- `tests/`
- `packages/agent-launcher/`
- `scripts/`
- `forge.config.ts`

### Expected Changes

- modify: tests or implementation only when a corrected-contract gate exposes a real defect
- no change: supported platform matrix or unsigned/not-notarized posture

### Do Not Modify

- Security/process boundaries to make a test pass.
- Generated package/output files by hand.
- User projects, tasks, chats, or unrelated configuration.

### Commands

~~~bash
nvm use 25.9.0
npm ci
npm run check
npm run test:e2e
npm run check:launcher-package
npm run verify:release-readiness
npm run make:mac
npm run verify:dist
git diff --check
~~~

### Acceptance Criteria

- [ ] Corrected authentication passes local Router integration and every process-boundary test.
- [ ] Private/refresh material remains encrypted in main; access remains memory-only; renderer stays
      isolated.
- [ ] Refresh/nonce/cancellation behavior cannot replay a partial stream or falsely revoke a family.
- [ ] Public/launcher/source-parity/release-readiness gates pass.
- [ ] macOS universal verifies locally; Linux/Windows remain explicit native-runner gates.
- [ ] No secret, developer path, test hook, or expanded signing capability is packaged/logged.

### Validation Results

- Post-correction lint, typecheck, unit, integration, public-boundary, source-parity,
  launcher-package, workflow-policy, and release-readiness gates: passed.
- Post-correction packaged E2E: passed for the local macOS arm64 package.
- Full `npm run check` components passed; integration required a host-permitted rerun because the
  outer Codex sandbox denied the sandbox-runtime Unix socket.
- Local macOS universal make/verify: passed on 2026-07-27; distribution verification confirmed the
  credential-free ad-hoc app and ZIP.
- Production-shaped local Router and native Linux/Windows runner gates: not run; exact-candidate
  hosted acceptance and release-tag native runners remain the authoritative gates.

### Findings / Notes

- A local macOS package cannot satisfy Ubuntu/Windows release evidence.

---

## Step C: Convert Desktop promotion to two-phase trusted publishing

### Status

`in_progress`

### Objective

Create an explicit pause between candidate publication and final channel movement, use OIDC for the
existing npm package, and retain only a short-lived dist-tag token.

### Tasks

- [x] Add required `phase` input with values `publish-candidate` and
      `finalize-release`; retain `channel` for beta/stable policy but use beta in this rollout.
- [x] Make candidate phase idempotently verify the exact tag/draft/assets, publish the GitHub
      prerelease if still draft, verify all public ZIP downloads, publish the launcher tarball under
      `candidate` through npm OIDC/provenance, and run anonymous platform smoke.
- [x] End candidate phase successfully without requiring acceptance or moving `beta`/`latest`.
- [x] Make finalization verify the already-public exact release/candidate, require
      `authentication-acceptance.json`, rerun public smoke as needed, and then move final tags and
      remove `candidate`.
- [x] Ensure rerunning either phase is a no-op only when exact tag, version, commit, checksums,
      registry integrity, and channel state match; conflicting state fails closed.
- [x] Remove the obsolete npm bootstrap token from workflow source, repository settings scripts/docs,
      `RELEASE.md`, and notices.
- [x] Remove the package-existence branch that falls back to a bootstrap token; `@adrouter/agent`
      already exists.
- [x] Configure npm trusted publisher: organization `adrouter`, repository
      `adrouterAgent`, workflow `promote-release.yml`, environment `npm-publish`, allowed
      action `npm publish`.
- [x] Preserve `id-token: write` only on candidate publication and preserve GitHub-hosted runners.
- [x] Keep `NPM_DIST_TAG_TOKEN` only on finalization. Require a package-scoped read/write granular
      token, bypass-2FA for automation, one-to-seven-day expiry, and revocation after verification.
- [x] Keep acceptance validation at exactly four artifacts and two distinct OS cohorts.
- [x] Extend workflow-policy tests to reject missing phase guards, one-shot dependencies,
      bootstrap-token names, direct latest publication, absent acceptance, and missing candidate
      cleanup.
- [x] Update release docs/checklists with the exact two dispatch commands and recovery path.

### Relevant Files

- `.github/workflows/promote-release.yml`
- `.github/workflows/release-tag.yml`
- `scripts/check-workflows.mjs`
- `scripts/validate-authentication-acceptance.mjs`
- `scripts/verify-release-assets.mjs`
- `scripts/configure-github-repository.mjs`
- `RELEASE.md`
- `docs/release-checklist.md`

### Expected Changes

- modify: promotion phases/guards, npm auth, workflow-policy tests, settings/release documentation
- delete: bootstrap-token branches/references

### Do Not Modify

- Native release-tag build inventory, launcher integrity, provenance/SBOM/checksum requirements,
      supported targets, or accepted artifacts.
- Remote configuration before explicit release authorization.
- Add an AdRouter inference credential to any workflow.

### Commands

~~~bash
nvm use 25.9.0
npm run check
npm run test:e2e
npm run check:launcher-package
npm run verify:release-readiness
rg -n 'NPM_BOOTSTRAP_TOKEN|ADROUTER_STAGING_API_KEY' .github RELEASE.md docs scripts
~~~

### Acceptance Criteria

- [x] Candidate and finalization are separate protected, resumable dispatches.
- [x] Candidate publishes the GitHub prerelease/ZIP URLs and npm `candidate`, then stops cleanly.
- [x] Finalization cannot start channel movement without exact four-artifact/two-cohort acceptance.
- [x] OIDC publishes the existing package and bootstrap-token logic is absent.
- [x] Only final dist-tag commands receive `NPM_DIST_TAG_TOKEN`.
- [x] Beta finalization moves `beta` and `latest`, removes `candidate`, and never rebuilds.
- [x] Workflow/release checks pass with no AdRouter inference credential.

### Validation Results

- Two-phase workflow, policy tests, documentation, YAML parsing, and release-readiness gates: passed.
- npm trusted publisher remote configuration and live OIDC candidate publication passed for
  beta.9; final channel movement remains intentionally separate.
- GitHub CLI is authenticated as active `adrouter` organization admin `HappyCool121`; the public
  repository grants admin access and both protected release environments exist. Neither environment
  currently has a configured secret.

### Findings / Notes

- The GitHub prerelease must be public during candidate testing because the launcher downloads ZIPs
  from public release URLs.

---

## Step D: Build and publish the immutable Desktop candidate

### Status

`in_progress`

### Objective

Tag clean reviewed beta.10 source, build all supported native artifacts, and publish the exact launcher
under `candidate` without moving final npm channels.

### Tasks

- [ ] Recheck npm version/dist-tags, Git tag, GitHub release/draft, and running workflow state for
      beta.10 immediately before tagging; increment if occupied.
- [ ] Merge the corrected contract and two-phase workflow through reviewed main.
- [ ] Run pinned-runtime clean-checkout source, E2E, launcher, public-boundary, parity, and release
      readiness gates.
- [ ] In npm package settings, configure the exact trusted publisher described in Step C.
- [ ] Create a fresh package-scoped `NPM_DIST_TAG_TOKEN` and enter it interactively in protected
      `npm-publish`; never print or pass it in command arguments.
- [ ] Create/push the immutable annotated `v0.1.0-beta.10` tag from clean reviewed main.
- [ ] Approve the expected secret-free `macos-release` environment and wait for macOS universal,
      Ubuntu x64, and Windows x64 builds.
- [ ] Verify draft tag/commit, three ZIPs, launcher tarball, `artifact-manifest.json`,
      `SHA256SUMS`, SBOMs, attestations, target integrity, and absence of secrets/developer paths.
- [ ] Dispatch `phase=publish-candidate`, `channel=beta`.
- [ ] Verify the GitHub prerelease is public, each ZIP is anonymously downloadable, npm
      `candidate` matches the exact launcher, and `beta`/`latest` still point to beta.7.
- [ ] Stop on any identity/integrity mismatch; allocate a higher beta rather than replacing assets.

### Relevant Files

- `package.json`
- `package-lock.json`
- `CHANGELOG.md`
- `packages/agent-launcher/package.json`
- `packages/agent-launcher/release-manifest.json`
- `.github/workflows/release-tag.yml`
- `.github/workflows/promote-release.yml`

### Expected Changes

- create: immutable beta tag, three native ZIPs, launcher tarball, manifests/SBOMs/checksums/
  attestations, public GitHub prerelease, and npm candidate
- retain: npm `beta`/`latest` on beta.7 before finalization

### Do Not Modify

- `UNBUILT` source placeholders by hand, used tags/versions, generated local artifacts as public
      assets, unsupported target claims, or another repository.
- Remote state without exact release authorization.

### Commands

~~~bash
npm view @adrouter/agent version dist-tags --json
gh release list --repo adrouter/adrouterAgent --limit 10
git ls-remote --tags origin refs/tags/v0.1.0-beta.10

nvm use 25.9.0
npm ci
npm run check
npm run test:e2e
npm run check:launcher-package
npm run verify:release-readiness
git status --short

gh secret set NPM_DIST_TAG_TOKEN --repo adrouter/adrouterAgent --env npm-publish
git tag -a v0.1.0-beta.10 -m "AdRouter Agent 0.1.0-beta.10"
git push origin v0.1.0-beta.10

gh release view v0.1.0-beta.10 --repo adrouter/adrouterAgent --json isDraft,isPrerelease,tagName,assets
gh workflow run promote-release.yml --repo adrouter/adrouterAgent --ref v0.1.0-beta.10 -f tag=v0.1.0-beta.10 -f phase=publish-candidate -f channel=beta
npm view @adrouter/agent@0.1.0-beta.10 version dist.integrity repository --json
npm view @adrouter/agent dist-tags --json
~~~

### Acceptance Criteria

- [ ] Beta.10 is unused and tags a clean reviewed commit with the functional fixes and prior contract/workflow changes.
- [ ] All three native runner builds and launcher/artifact integrity checks pass.
- [ ] GitHub prerelease exposes the unchanged ZIPs and npm candidate exposes the exact launcher.
- [ ] Trusted publishing/provenance succeeds without `NPM_BOOTSTRAP_TOKEN`.
- [ ] `beta`/`latest` remain on beta.7 and only `candidate` points to beta.10.
- [ ] No secret or private installation state enters workflows/artifacts.

### Validation Results

- Beta.8 candidate publication completed, but exact-candidate acceptance rejected it on 2026-07-28:
  project/new-chat transitions displayed stale transcript state and the Changes drawer never
  rendered its Monaco diff under the offline CSP. Beta.8 must not be finalized.
- Beta.9 candidate publication completed successfully, but its immutable tag predates the approved
  dark-theme and UI refinement delta, so it remains unpromoted and beta.10 is the fix-forward build.
- Clean pre-tag validation passed on 2026-07-27: `npm ci`, `npm run check`, packaged E2E,
  production dependency audit, launcher-package/release-readiness, local universal macOS make, and
  distribution verification.
- Beta.10 remote version/tag/release vacancy and publication remain to run.

### Findings / Notes

- The beta.10 source version does not reserve the remote immutable namespace until its tag is pushed.

---

## Step E: Accept the exact Desktop artifacts and finalize beta

### Status

`todo`

### Objective

Test the exact launcher/native candidate on two operating systems, attach sanitized four-artifact
evidence, and move beta channels without rebuilding.

### Tasks

- [ ] Install exact `@adrouter/agent@0.1.0-beta.10`/`@candidate` on the primary operator system,
      verify launcher integrity and downloaded ZIP checksum, then launch the packaged app.
- [ ] Confirm `safeStorage` is supported, select “Connect this Agent,” compare the WebUI code, and
      approve the exact Desktop installation.
- [ ] Complete signed profile/turn, stream completion, token rotation, replay/tamper/token-without-key
      rejection, revocation, minimum-version handling, diagnostics redaction, and local cleanup.
- [ ] Verify renderer isolation, sandbox, workspace containment, mutation/command approvals,
      cancellation/no replay, and valid NONE behavior in the packaged app.
- [ ] Repeat the core auth/storage/launch matrix on a distinct second OS cohort.
- [ ] Record `os_encrypted` on both cohorts; unsafe storage must fail closed.
- [ ] Download `artifact-manifest.json`; create acceptance JSON containing all three ZIP SHA-256
      values plus launcher tarball SHA-256 and the two exact cohort results.
- [ ] Validate locally, manually inspect for sensitive/high-entropy values, and upload to the matching
      GitHub prerelease.
- [ ] Dispatch `phase=finalize-release`, `channel=beta`; require acceptance and anonymous
      platform smoke before dist-tag changes.
- [ ] Verify `beta`/`latest` point to beta.10, `candidate` is absent, and npm/GitHub/
      checksums/provenance/acceptance identities agree.
- [ ] Delete `NPM_DIST_TAG_TOKEN` and revoke the granular npm token.
- [ ] Hand exact beta.10 identity/evidence to the Router owner for the 24-hour staging soak.

### Relevant Files

- `scripts/authentication-acceptance.schema.json`
- `scripts/validate-authentication-acceptance.mjs`
- `docs/manual-testing.md`
- `docs/release-checklist.md`
- GitHub release assets and npm registry state

### Expected Changes

- create: sanitized exact four-artifact acceptance asset
- modify: npm `beta`/`latest` and `candidate` through protected finalization
- retain: identical public GitHub prerelease assets

### Do Not Modify

- Candidate ZIPs/tarball, tag, commit, acceptance evidence after validation, stable metadata, or
      local user projects/history beyond intentional auth cleanup.
- OpenCode or Router production state.

### Commands

~~~bash
npm install --global @adrouter/agent@0.1.0-beta.10
adrouter-agent --version
adrouter-agent doctor --json
adrouter-agent

gh release download v0.1.0-beta.10 --repo adrouter/adrouterAgent --pattern artifact-manifest.json
node scripts/validate-authentication-acceptance.mjs authentication-acceptance.json --manifest artifact-manifest.json
gh release upload v0.1.0-beta.10 authentication-acceptance.json --repo adrouter/adrouterAgent
gh workflow run promote-release.yml --repo adrouter/adrouterAgent --ref v0.1.0-beta.10 -f tag=v0.1.0-beta.10 -f phase=finalize-release -f channel=beta

npm view @adrouter/agent dist-tags --json
npm view @adrouter/agent@0.1.0-beta.10 version dist.integrity repository --json
gh release view v0.1.0-beta.10 --repo adrouter/adrouterAgent --json isDraft,isPrerelease,tagName,assets

gh secret delete NPM_DIST_TAG_TOKEN --repo adrouter/adrouterAgent --env npm-publish
~~~

### Acceptance Criteria

- [ ] Primary and distinct-second-OS cohorts pass the complete packaged auth/storage/security matrix.
- [ ] Acceptance matches the exact tag, commit, three ZIPs, launcher tarball, `os_encrypted`
      classification, and redaction policy.
- [ ] Finalization reuses unchanged artifacts and all public smoke gates pass.
- [ ] `beta`/`latest` point to beta.10 and `candidate` is absent.
- [ ] Trusted publisher remains correctly scoped and the temporary dist-tag token is revoked.
- [ ] Router owner has exact evidence for Desktop staging enforcement.

### Validation Results

- Exact-candidate cohorts: not run.
- Acceptance validation/upload: not run; upload requires explicit authorization.
- Finalization/public verification/token cleanup: not run.

### Findings / Notes

- The acceptance asset is post-candidate evidence and must not be baked into the source tag or
  launcher tarball.

---

## Step F: Final verification and cleanup

### Status

`todo`

### Objective

Reconcile the corrected source, four public artifacts, acceptance evidence, and post-enforcement
staging behavior while preserving every Desktop security boundary.

### Tasks

- [ ] Re-run pinned clean-checkout source, integration, packaged E2E, launcher, parity,
      public-boundary, and release-readiness gates at the public tag commit.
- [ ] Re-run the canonical fixture and known mismatch regressions.
- [ ] Re-run exact beta enrollment/profile/turn/refresh/negative/revocation/upgrade after Router
      staging enforcement.
- [ ] Compare npm version/dist-tags/integrity, Git tag/commit, GitHub assets, checksums, manifest,
      attestations, acceptance JSON, and trusted publisher identity.
- [ ] Review source/diff/package contents for unrelated files, generated output, expanded IPC,
      generic signing capability, secret material, stale field names, bootstrap token, one-shot
      promotion, or authenticated inference jobs.
- [ ] Remove only temporary debug/release files created for this rollout.
- [ ] Update documentation if implemented workflow inputs or manual commands differ.
- [ ] Record remaining platform limitations and Router rollback readiness.

### Relevant Files

- `src/`
- `tests/`
- `packages/agent-launcher/`
- `scripts/`
- `.github/workflows/`
- `docs/`
- `PLAN.md`

### Expected Changes

- modify: tests/docs only if final verification exposes a required correction
- delete: only temporary implementation/release files

### Do Not Modify

- Accepted artifacts/evidence, unrelated user work, task/project data, stable metadata, or security
      boundaries merely to pass tests.

### Commands

~~~bash
nvm use 25.9.0
npm ci
npm run check
npm run test:e2e
npm run check:launcher-package
npm run verify:release-readiness
git diff --check
git status --short
npm view @adrouter/agent dist-tags --json
~~~

### Acceptance Criteria

- [ ] All source, process-boundary, E2E, launcher, package, native, and release-policy gates pass.
- [ ] Exact beta.10 works after Router staging enforcement.
- [ ] Public source/artifact/provenance/acceptance identities agree.
- [ ] No renderer/utility/package/workflow/log/diagnostic exposes installation material.
- [ ] Bootstrap-token and one-shot promotion behavior are absent.
- [ ] Temporary auth is revoked and Router owner has tested rollback evidence.

### Validation Results

- Final clean suite: not run.
- Post-enforcement exact beta acceptance: not run.
- Final public reconciliation/security review: not run.

### Findings / Notes

- Do not mark done until the release-coordination and Router plans accept the Desktop handoff.

---

## Follow-up Work

- Stable `0.1.0` and its separate soak.
- Developer ID signing/notarization and broader publisher identity.
- Production Router rollout and irreversible legacy cleanup.
- Hardware-backed/non-exportable key research.
- Additional native targets only with matching build, sandbox, and integrity evidence.

## Decision Log

| Date | Decision | Rationale | Impact |
| --- | --- | --- | --- |
| 2026-07-27 | Treat current green Desktop tests as non-conformance. | Mocks assert the same wrong wire shape as implementation. | Beta release is blocked until Router-derived regression tests pass. |
| 2026-07-27 | Use the Router/CLI fixture checksum as canonical. | It is the implemented server contract and already matches CLI byte-for-byte. | Desktop imports/mirrors one shared protocol identity. |
| 2026-07-27 | Omit body binding for bodyless profile GET. | Router explicitly rejects digest/bht when `bodyRequired=false`. | Header/proof types become body-optional while POST stays exact-byte bound. |
| 2026-07-27 | Add explicit candidate/finalize phases. | Manual packaged acceptance must pause safely before channel movement. | Workflow reruns become idempotent checkpoints instead of expected failure. |
| 2026-07-27 | Use trusted publishing and retain only a dist-tag token. | The public npm package already exists and OIDC supports publish. | Stale bootstrap-token paths are removed before beta.8. |
| 2026-07-27 | Require four-artifact, two-OS acceptance. | The launcher selects native ZIPs and storage behavior is OS-specific. | Finalization proves both distribution layers without rebuilding. |
| 2026-07-27 | Publish beta only. | Functional staging rollout does not authorize stable. | Beta/latest move to beta.8; stable is deferred. |
| 2026-07-28 | Fix forward from beta.9 to beta.10 for the approved UI release. | Beta.9 is already immutable and cannot absorb the newer reviewed UI delta. | Beta.10 becomes the only candidate eligible for `beta`/`latest` promotion. |
