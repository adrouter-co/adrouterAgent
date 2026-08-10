# AdRouter Agent repository instructions

## Scope and repository boundary

This independent repository is the canonical Electron desktop Agent and public npm launcher. Its
GitHub repository is `adrouter/adrouterAgent`; do not combine its changes, lockfile, commits, or
release operations with sibling release projects.

Before changing product or release behavior, read `README.md`, `PLAN.md`, `SECURITY.md`,
`RELEASE.md`, `docs/release-checklist.md`, manifests, workflows, and
`git status --short --branch`. Source and tests define local behavior; npm/GitHub/deployed state
must be verified separately.

## Source map and toolchain

- `src/main/` — Electron lifecycle, privileged IPC, installation state, and persistence.
- `src/preload/` — narrow isolated renderer bridge.
- `src/renderer/` — React UI for projects, tasks, installation sign-in, approvals, diffs, settings,
  and sponsor display.
- `src/runtime/` — utility-process coding runtime, workspace tools, command policy, and OS sandbox.
- `src/shared/` — cross-process contracts and utilities.
- `packages/agent-launcher/` — dependency-free `@adrouter/agent` installer/launcher and embedded
  release manifest.
- `tests/` and `scripts/` — unit/integration/renderer/runtime/main/E2E coverage plus package,
  provenance, artifact, acceptance, and release verification.
- `.github/workflows/` — CI, native builds, protected candidate/promotion, and registry smoke flows.
- `out/`, `.vite/`, output, coverage, provenance, archives, and packaged applications are generated.

App development pins Node.js 25.9.0 and the root npm lockfile. The public launcher supports Node.js
22.19+ and has no runtime dependencies or lifecycle downloads. Do not normalize those engines.

## Hosted identity and router contract

- Official hosted sign-in creates an Ed25519 installation, opens the Agent-specific browser
  handoff, shows a comparison code, and waits for explicit approval before the UI enables Continue.
- Store installation private/refresh material only through Electron `safeStorage`; keep it outside
  the renderer. Each hosted `/v1/profile` and `/v1/agent/turn` call uses a fresh DPoP-style proof
  with short-lived access material.
- Preserve cancellation/retry cleanup, refresh rotation, nonce handling, revocation/upgrade errors,
  comparison-code binding, browser Done/Quit behavior, and redacted diagnostics.
- The app discovers models with public `GET /v1/models`; do not hardcode an obsolete two-model
  catalog. Hosted `/v1/turn` and account API-key creation are not supported.
- Custom remote URLs require HTTPS; plain HTTP is loopback-only. Keep explicitly supported local
  bearer-key behavior separate from official hosted installation auth.

## Product and security invariants

- Sponsor and settlement data are display-only. Strip sponsor-shaped data from model/tool context;
  never send it as prompts, assistant text, tools, commands, edits, or compacted task state.
- Keep Node/filesystem access out of the isolated renderer. Reads may be silent, but every mutation
  and general command needs a fresh Allow once/Deny decision.
- Preserve workspace containment, safe path handling, encrypted local state, fail-closed sandbox
  behavior, constrained IPC, bounded streaming, secret redaction, and no automatic replay after
  partial paid output.
- The app may show agent-authored diffs but never stages, commits, pushes, elevates, disables host
  security, or weakens the OS sandbox automatically.
- The current normal runtime handles one agent task at a time.

## Verification

Use focused tests while iterating. With the repository-pinned Node.js 25.9.0, the normal gate is:

```sh
npm run check
```

Add packaged `npm run test:e2e`, launcher/tarball checks, native ZIP verification, or live/candidate
acceptance only when the change and environment require them. Physical Windows acceptance cannot
be replaced by a simulated or macOS-only result.

The checked-in `packages/agent-launcher/release-manifest.json` uses `UNBUILT` source placeholders
until protected native workflows fill hashes. Do not hand-edit them or use them to judge already
published GitHub assets.

## Release-state source and policy

Read `../../docs/state.md` and the newest workspace parity report, then re-query npm and GitHub
before making a current version, channel, asset, signing, or acceptance claim. Local dirty future
work is not part of an immutable public tag. The release targets macOS 12+ universal, Ubuntu
Desktop 24.04 x64, and Windows 11 x64; signing/notarization and stable/auto-update status must be
verified from the exact release rather than inferred.

- Keep immutable version, `v<version>` GitHub tag, npm `candidate`, final `beta`/`latest`, native
  assets, and source commit distinct.
- Publish prereleases only under explicit `candidate`, verify all native artifacts and anonymous
  launcher installs, then move both public prerelease channels to the exact accepted version and
  remove `candidate`. Revisit final-tag policy before a stable release so `beta` is not accidentally
  moved to stable.
- Build, tag, publish, and promote only from a clean committed tree. Tags and package versions are
  immutable; fix forward with a higher beta.
- Publishing, tagging, dist-tag movement, release edits, protected approvals, signing/notarization,
  and remote-secret changes require explicit user authorization. Authentication belongs in
  interactive CLI/browser or protected environments, never chat or command output.
