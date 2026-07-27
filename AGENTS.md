# AdRouter Agent project instructions

## Scope and repository boundary

This directory is the independent repository for the Electron desktop Agent and its npm launcher.
Its canonical GitHub repository is `adrouter/adrouterAgent`; do not combine its changes, lockfile, or
release actions with sibling release projects.

Before editing public or release behavior, read `README.md`, `PLAN.md`, `SECURITY.md`, `RELEASE.md`,
and `docs/release-checklist.md`, then run `git status --short`. Source manifests and workflows are
authoritative, but public registry/release state must be checked remotely.

## File structure

- `src/main/` — Electron main process, application lifecycle, persistence, and privileged IPC.
- `src/preload/` — narrow context bridge between the isolated renderer and main process.
- `src/renderer/` — React UI for projects, tasks, approvals, diffs, settings, and sponsor display.
- `src/runtime/` — utility-process coding runtime, workspace tools, command policy, and OS sandboxing.
- `src/shared/` — contracts and utilities shared across process boundaries.
- `packages/agent-launcher/` — dependency-free public `@adrouter/agent` installer/launcher and its
  embedded release manifest.
- `tests/` — unit, integration, renderer, runtime, main-process, and packaged Electron E2E coverage.
- `scripts/` — packaging, launcher construction, artifact verification, public-boundary checks,
  staging canary, and GitHub/release helpers.
- `.github/workflows/` — CI, native tagged builds, protected promotion, registry smoke tests, and
  prerelease publication.
- `assets/` and `docs/` — checked-in application assets and operating/release documentation.
- `out/`, `.vite/`, `output/`, coverage, and `provenance/` are generated output; never edit them by
  hand or treat local output as a public artifact.

## Stack

- Repository-pinned Node.js `25.9.0`, npm 10+, TypeScript, and the root `package-lock.json`.
- Electron 43 with Electron Forge, Vite, React 19, Monaco, SQLite, and Electron `safeStorage`.
- Biome, TypeScript, Vitest, Testing Library, and Playwright/Electron packaged E2E tests.
- `@anthropic-ai/sandbox-runtime` with Seatbelt on macOS, Bubblewrap on Ubuntu, and manual
  fail-closed Windows sandbox provisioning.
- The public launcher supports Node.js `>=22.19.0`, has no runtime dependencies or lifecycle
  downloads, and installs verified GitHub Release ZIPs.

## Current npm and GitHub deployment stage

Last publicly verified on 2026-07-27:

- Source/application version: `0.1.0-beta.7`.
- npm: `@adrouter/agent@0.1.0-beta.7` is public; both `beta` and `latest` resolve to it. The npm
  package is the launcher, not the Electron application archive.
- GitHub: `adrouter/adrouterAgent` is public on `main`; `v0.1.0-beta.7` is a published prerelease.
- Release targets are macOS 12+ universal, Ubuntu Desktop 24.04 x64, and Windows 11 x64. The beta is
  unsigned/not notarized and has no stable or automatic-update channel.

The checked-in `packages/agent-launcher/release-manifest.json` contains `UNBUILT` hashes. Those are
source placeholders filled by the protected artifact workflow; do not hand-edit them or use them to
judge the already-published GitHub assets. Recheck current remote state before making claims:

```sh
npm view @adrouter/agent version dist-tags --json
gh release view v0.1.0-beta.7 --repo adrouter/adrouterAgent
```

The deployment path is `release-tag.yml` followed by protected `promote-release.yml`. Native runners
build and verify the three portable ZIPs and launcher tarball, protected canaries validate staging,
and anonymous candidate installs must pass before npm `beta`/`latest` promotion. Release tags and npm
versions are immutable; fix forward with a higher beta. Do not publish, tag, move dist-tags, alter
releases, configure GitHub/npm secrets, sign, or notarize without explicit user authorization.

## npm version and dist-tag policy

Keep these namespaces distinct: the immutable package version is a prerelease such as
`0.1.0-beta.7`, its GitHub tag is `v0.1.0-beta.7`, and its npm channel names are `candidate`, `beta`,
and `latest`. Never create numbered npm dist-tags such as `beta.7`; users who need a fixed build
install `@adrouter/agent@0.1.0-beta.7`, while `@beta` follows the moving beta channel.

While the package is prerelease/unstable, publish only under temporary `candidate`, complete every
artifact and registry-install gate, then move both `beta` and `latest` to the exact accepted version
and remove `candidate`. Never publish without an explicit safe tag because npm defaults to `latest`,
and never move `latest` before verification. The current promotion workflow hardcodes both final
channels; before the first stable release, update and validate it so only `latest` moves to stable
and `beta` remains on the newest accepted beta.

## Deployment authorization and authentication

When the user explicitly authorizes deployment of a specified version, carry the documented npm and
GitHub release through end to end without requesting confirmation for each normal step. This includes
the release PR/tag, protected workflows, npm candidate/final tags, GitHub prerelease, verification,
and temporary-secret cleanup. Pause only for interactive login/2FA, required environment approvals,
missing credentials, or a genuine release blocker that needs a user decision.

The user supplies authentication through interactive CLI/browser prompts or protected GitHub
environments; never ask them to send a secret in chat, and never read or print secret values. Follow
`RELEASE.md` for the current bootstrap, trusted-publishing, and dist-tag credential roles. Staging
credentials must be revocable and low-quota, live only in `adrouter-staging`, and support all required
model canaries. Temporary npm tokens must be package-scoped, read/write, bypass-2FA enabled, valid for
no more than seven days, stored only in `npm-publish`, and revoked after verification. Use existing
GitHub CLI authentication when it has sufficient access; do not request unrelated provider keys or a
GitHub PAT.

## Working rules and verification

- Keep sponsor and settlement data in the display channel only; strip it from model, tool, command,
  patch, and compacted context.
- Preserve renderer isolation, encrypted credential storage, HTTPS/loopback policy, workspace
  containment, one-time mutation/command approvals, and fail-closed OS sandbox behavior.
- The app never stages, commits, pushes, disables host security, or elevates automatically.
- Use focused tests while iterating. Run `npm run check` for the normal gate; add `npm run test:e2e`,
  launcher/package verification, native artifact checks, or the protected live canary only when the
  change and environment require them.
