# Plan: AdRouter Agent Safe Desktop Parity Completion

## Goal

Close the remaining safe, desktop-appropriate gaps between AdRouter Agent and AdRouterCLI while
preserving the Agent's stronger sandbox, approval, identity, sponsor-privacy, and GUI boundaries.
The original parity pass stopped after local implementation and verification. Step G records the
separately authorized credential-free beta.13 candidate release; stable/final channel promotion
still requires later downloaded-artifact acceptance and separate authorization.

## Context

- The canonical repository is `adrouter/adrouterAgent`; sibling Router and CLI repositories are
  read-only contract references with independent commits, lockfiles, and releases.
- The baseline is the existing uncommitted parity work on `codex/agent-parity-roadmap` at
  `3db591b264f1`. It contains durable tasks, structured operations, signed local automation,
  declarative bundles, session checkpoints/forks/import/export, and signed update infrastructure.
- The baseline passed `npm run check` with Node.js 25.9.0 before this completion pass. It must be
  preserved and reviewed rather than reset or replaced.
- The approved parity target is safe desktop parity: useful CLI coding workflows presented through
  native GUI and scoped signed RPC, without arbitrary extensions/providers/themes, broad shell,
  credential exposure, approval bypasses, or gist-style sharing.
- Router/CLI source currently share the exact catalog artifact and are the coordinated source for
  the Agent catalog. Deployment parity cannot be assumed and remains a later rollout gate.
- CLI-style global profiles are deferred. Their safe per-task subset is implemented as immutable
  Agent presets. CLI session portability is one-way import of a v3 JSONL active branch plus
  sanitized Agent JSON/HTML export; bidirectional fidelity is not promised.

## Research Summary

- Router/CLI source catalog comparison found exact per-model limits that differ from the Agent's
  previous fixed-limit artifact. The Agent generator and compatibility checks must preserve exact
  per-model context, input, and output values.
- Router errors use bounded display text in `error` and machine behavior in `code`, with optional
  bounded numeric `details`; clients must never branch on display strings.
- A safe overflow retry is possible only when a structured `input_limit_exceeded` response occurs
  before any paid/output event is consumed. Exactly one forced compaction retry is allowed; no
  retry is permitted after ad, text, thinking, tool, settlement, done, or ambiguous transport.
- The current runtime protocol already supports steer and queued follow-up, but the renderer blocks
  composition while running. The durable task model already contains parent/checkpoint data but the
  GUI presents a flat list.
- The local RPC transport is signed, owner-only, and scoped, but lacks compact/fork/export and
  running-turn controls. Export data therefore needs short-lived, client-bound handles rather than
  arbitrary paths or unbounded frames.
- True image turns are deferred because current Router provider adapters stringify message content;
  adding desktop attachment UI alone would falsely imply multimodal delivery.
- Current repository instructions define normal concurrency as one task and official release
  targets as macOS universal, Ubuntu 24.04 x64, and Windows 11 x64. Existing queue/lease machinery
  stays, but the default and public claims must match those constraints.

## Constraints

- Preserve hosted Ed25519 installation auth, fresh DPoP-style proofs, refresh rotation, nonce and
  revocation behavior, comparison-code binding, and OS-encrypted private state.
- Sponsor and settlement data remain display/accounting-only and are rejected from prompts,
  messages, tools, commands, edits, session entries, compaction, imports, delegation, and RPC data.
- Keep Node/filesystem access out of the isolated renderer. Reads may be silent; every mutation,
  general command, Git write, network operation, dependency change, or delegation requires a fresh
  immutable allow-once decision.
- Preserve workspace containment, bounded streams/output/search, fail-closed OS sandboxing,
  redacted diagnostics, and no automatic replay after partial or ambiguous paid output.
- Keep normal task capacity at one. Preserve queue/lease internals for isolation and future review,
  but do not enable multi-task execution by default.
- Preserve Node.js 25.9.0 for the app and Node.js 22.19+ with zero runtime dependencies for the npm
  launcher. Add no dependencies unless unavoidable; none are planned.
- Preserve public APIs and persisted data with additive versioned migrations/readers.
- Publish only the explicitly authorized unsigned/ad-hoc beta.13 GitHub prerelease and npm
  `candidate`; do not move `beta`/`latest`, sign/notarize, mutate hosted data, or finalize.

## Out of Scope

- CLI-style global profiles, arbitrary providers/extensions/themes/keybindings, broad shell/network
  authority, blanket approvals, privilege escalation, and executable third-party bundles.
- True image/model attachments until Router transports typed image content end to end.
- Bidirectional CLI session synchronization, automatic import execution, and import of all branches.
- Gist/public sharing, remote automation, raw tool invocation over RPC, project creation through
  untrusted paths, or approval bypasses.
- Linux ARM64 and Windows ARM64 as supported public release targets in this pass.
- Stable publication, npm `beta`/`latest` movement, signed-update enablement, hosted rollout, or
  finalization before primary macOS and physical Windows 11 x64 exact-artifact acceptance.

## Reversibility

- Preserve the current dirty baseline and make additive schema/API changes before replacing readers.
- Keep task/session JSON export intact while adding HTML and CLI import paths.
- Keep automatic compaction behavior while adding an explicit maintenance turn and budget events.
- Keep existing signed RPC methods unchanged; new methods are additive within protocol v1.
- Retain queue/lease machinery while setting the supported default/normal capacity to one.
- Keep implementation phases aligned with the steps below so each gap group can be reviewed or
  reverted independently without resetting unrelated baseline work.

---

## Step A: Baseline reconciliation and source-coordinated model contract

### Status

`done`

### Objective

Make the preserved baseline internally consistent with repository policy and synchronize the exact
Router/CLI source catalog, structured errors, overflow handling, and context maintenance behavior.

### Tasks

- [ ] Review the full dirty baseline for accidental generated files, secrets, unsupported release
      claims, and concurrency defaults; preserve all intended work without destructive Git actions.
- [ ] Set normal scheduler capacity to one while retaining bounded queue/lease infrastructure.
- [ ] Restore the official release matrix to macOS universal, Ubuntu x64, and Windows x64 in source,
      manifests, workflows, tests, and docs; do not hand-edit built hashes.
- [ ] Vendor/generate the exact Router/CLI source catalog with per-model limits and a deterministic
      cross-repository source/digest check.
- [ ] Extend `RouterHttpError` with bounded `code` and numeric `details`, keeping safe display text.
- [ ] Implement exactly one forced compact-and-retry for pre-consumption
      `input_limit_exceeded`; forbid retry after any output/paid/ambiguous event.
- [ ] Add explicit manual compaction as a persisted maintenance turn with a 2,048-token summary cap
      and no Router-default output-budget change for normal turns.
- [ ] Publish bounded `ContextBudgetSnapshot` events for runtime, persistence, GUI, and diagnostics.

### Relevant Files

- `src/shared/catalog/`, `src/shared/model-catalog.ts`, `scripts/model-catalog.mjs`
- `src/runtime/router-client.ts`, `src/runtime/context-budget.ts`, `src/runtime/agent-session.ts`
- `src/shared/contracts.ts`, `src/shared/runtime-protocol.ts`
- `src/main/runtime-scheduler.ts`, `src/main/database.ts`, `src/main/ipc.ts`
- `package.json`, `forge.config.ts`, `packages/agent-launcher/release-manifest.json`
- `.github/workflows/`, `scripts/`, `tests/`, `README.md`, `RELEASE.md`, `docs/`

### Expected Changes

- modify: catalog artifact/generator/checks, error and runtime contracts, session/compaction logic,
  scheduler default, supported platform inventory, renderer budget/compact wiring, focused tests
- create: focused fixtures/tests for exact limits, bounded errors, safe retry, manual compaction, and
  context-budget events as required
- delete: unsupported ARM64 public-target declarations and fixed-limit catalog assumptions only

### Do Not Modify

- sibling Router/CLI repositories, lockfiles, hosted auth wire behavior, protected keys, or remote state
- checked-in `UNBUILT` hashes except through existing deterministic source-manifest generation
- normal Router output budget or sponsor display semantics

### Commands

```bash
npm run catalog:check
npm run typecheck
npm test
npm run test:integration
```

### Acceptance Criteria

- [ ] Agent catalog exactly matches the coordinated Router/CLI source artifact and per-model limits.
- [ ] Machine decisions use bounded error `code`/`details`, never display text.
- [ ] Overflow retry occurs at most once and only before any paid/output/ambiguous consumption.
- [ ] Manual compaction is durable, sponsor-free, bounded, and visible with current budget values.
- [ ] Normal scheduler capacity and supported platform docs/manifests match repository instructions.
- [ ] Focused checks pass without sibling or remote changes.

### Validation Results

- `npm run catalog:check`: passed; exact digest `sha256:75b5c38f6f037ac2d5105b0e780bf449d00e0c851dcb749232503c3782b32b70`
- `npm run typecheck`: passed
- `npm test`: passed, 36 files / 129 tests
- `npm run test:integration`: passed, 3 files / 12 tests

### Findings / Notes

- Deployed `/v1/models` could not be verified from the current environment during planning; source
  parity is implementable locally and deployment parity remains a release gate.

---

## Step B: Bounded workspace tools and scoped instructions

### Status

`done`

### Objective

Close high-value CLI inspection gaps through bounded structured tools and workspace-contained
instruction discovery without adding broad shell or untrusted global configuration.

### Tasks

- [ ] Add ranged text reads with deterministic bounds and truncation metadata.
- [ ] Add workspace file listing with safe glob/filter parameters, pagination/cursors, Git-ignore
      awareness where available, and strict result/scan caps.
- [ ] Add bounded text/regex search with explicit file filters, pagination, match limits, binary
      rejection, timeouts, and a terminable worker for untrusted regular expressions.
- [ ] Discover `AGENTS.md`/`CLAUDE.md` only from the selected workspace root through the target's
      ancestor chain, preserving deterministic precedence and recording every instruction source.
- [ ] Keep project-root `.agent/instructions.md` behavior and reject symlink/outside-workspace files.

### Relevant Files

- `src/runtime/tools.ts`, `src/runtime/structured-files.ts`, `src/runtime/workspace.ts`
- `src/runtime/agent-session.ts`, `src/shared/contracts.ts`, `src/shared/runtime-protocol.ts`
- `tests/runtime/`, `tests/shared/`

### Expected Changes

- modify: read/list/search tool schemas and implementations, instruction loading, runtime metadata,
  and focused positive/negative tests
- create: a bounded regex worker/helper and fixtures if the existing runtime cannot terminate regex
  evaluation safely
- delete: no general command restrictions or existing safe read behavior

### Do Not Modify

- global user instruction files outside the selected workspace
- mutation approvals, network policy, renderer filesystem isolation, or Git state

### Commands

```bash
npm run typecheck
npm test -- tests/runtime/tools.test.ts tests/runtime/structured-files.test.ts
```

### Acceptance Criteria

- [ ] Large trees/files/searches remain bounded, paged, terminable, and workspace-contained.
- [ ] Ignore/filter behavior is deterministic and does not expose protected credential paths.
- [ ] Instruction precedence is explainable and every loaded source is shown in task metadata.
- [ ] Symlink escape, traversal, catastrophic regex, binary, oversized, and pagination tests fail safe.

### Validation Results

- `npm run typecheck`: passed
- focused runtime/workspace/repository tests: passed as part of the 129-test unit gate

### Findings / Notes

- Global or home-directory CLI instruction discovery is intentionally excluded from desktop parity.

---

## Step C: Desktop task/session UX and portable exports

### Status

`done`

### Objective

Expose already-safe runtime/session capabilities through the GUI and add deliberate one-way CLI
session import plus sanitized self-contained HTML export.

### Tasks

- [ ] Allow the composer to steer a running turn or queue a follow-up, with explicit mode/labels,
      persistent queue state, cancellation/removal, and no silent replay after restart.
- [ ] Render parent/fork/checkpoint relationships as a hierarchical task tree with safe status and
      lightweight branch statistics.
- [ ] Add copy-last-assistant-response without copying sponsor or settlement display data.
- [ ] Add a two-step CLI v3 JSONL active-branch import: bounded parse/redaction/preview followed by
      explicit project mapping and confirmation; imported tasks never auto-run or auto-resume.
- [ ] Add sanitized self-contained HTML export alongside Agent JSON, with no active scripts, remote
      resources, absolute paths, credentials, sponsor model context, or unsafe raw markup.

### Relevant Files

- `src/main/session-service.ts`, `src/main/task-service.ts`, `src/main/database.ts`, `src/main/ipc.ts`
- `src/preload/index.ts`, `src/renderer/App.tsx`, `src/renderer/styles.css`
- `src/shared/contracts.ts`, `tests/main/`, `tests/renderer/`, `tests/e2e/`

### Expected Changes

- modify: session/task services, versioned import/export contracts, IPC/preload bridge, task tree,
  composer controls, copy/export/import UI, persistence migrations, and tests
- create: CLI v3 preview/import and safe HTML rendering helpers/fixtures as required
- delete: no existing Agent JSON import/export compatibility

### Do Not Modify

- clipboard beyond an explicit user click
- imported workspace files, Git state, approvals, or runtime execution
- sponsor display/accounting history except optional separately labeled display-only export metadata

### Commands

```bash
npm run typecheck
npm test
npm run test:e2e
```

### Acceptance Criteria

- [ ] Running tasks can be steered or receive visible queued follow-ups without ambiguous replay.
- [ ] Task ancestry/forks/checkpoints are understandable and descendants remain independent.
- [ ] CLI v3 import is bounded, previewed, redacted, active-branch-only, and inert after confirmation.
- [ ] JSON/HTML export and copy-last exclude secrets, unsafe markup, absolute paths, and sponsor context.
- [ ] Renderer remains isolated and all filesystem work stays behind privileged IPC.

### Validation Results

- `npm run typecheck`: passed
- `npm test`: passed, including session service and renderer coverage
- `npm run test:e2e`: passed after packaging the local macOS arm64 test application

### Findings / Notes

- Imported CLI tool entries are display/history data only; they do not recreate approvals or execute.

---

## Step D: Scoped signed RPC parity

### Status

`done`

### Objective

Add task control and export automation to the existing owner-only signed local protocol without
granting raw tool, file-path, import, or approval-bypass authority.

### Tasks

- [ ] Add protocol-v1 methods `tasks.steer`, `tasks.queueFollowUp`, `tasks.compact`, `tasks.fork`,
      and `tasks.export` with explicit existing scopes and bounded request schemas.
- [ ] Add `exports.read` using client-bound, single-purpose, five-minute handles and bounded chunks;
      never return or accept arbitrary filesystem paths.
- [ ] Route controls through the same task/session/scheduler invariants as GUI actions.
- [ ] Preserve signed canonical envelopes, nonce/replay/skew/rate/frame limits, client revocation,
      project trust, and fresh approval behavior.
- [ ] Add launcher JSON commands/exit behavior only where they can remain dependency-free and
      cannot expose plaintext client keys.

### Relevant Files

- `src/main/local-rpc-server.ts`, `src/shared/automation-protocol.ts`
- `src/main/task-service.ts`, `src/main/session-service.ts`, `src/main/runtime-supervisor.ts`
- `packages/agent-launcher/lib/automation.mjs`, `packages/agent-launcher/lib/cli.mjs`
- `tests/main/local-rpc-server.test.ts`, `packages/agent-launcher/test/automation.test.mjs`

### Expected Changes

- modify: automation schemas/dispatch, bounded export store, task/session routing, launcher commands,
  and protocol/security tests
- create: ephemeral export-handle helper only if it cannot fit cleanly in the RPC service
- delete: no existing protocol-v1 methods or signature checks

### Do Not Modify

- installation-auth keys, Router credentials, TCP exposure, filesystem path access, raw tool calls,
  import methods, project creation, or approval resolution scopes

### Commands

```bash
npm run typecheck
npm test -- tests/main/local-rpc-server.test.ts
npm run test:launcher
```

### Acceptance Criteria

- [ ] Authorized clients can steer, queue, compact, fork, and export only tasks/projects in scope.
- [ ] Export handles expire, are client-bound, enforce ordered bounded reads, and reveal no paths.
- [ ] RPC actions cannot bypass approval, project trust, scheduler, sponsor, or restart protections.
- [ ] Existing clients and methods remain compatible within protocol v1.

### Validation Results

- `npm run typecheck`: passed
- focused RPC tests: passed, including client-bound export-handle coverage
- `npm run test:launcher`: passed, 44 tests

### Findings / Notes

- Import remains GUI-only because headless import combines untrusted content and project mapping.

---

## Step E: Final verification and cleanup

### Status

`done`

### Objective

Verify the integrated local implementation with pinned tooling, reconcile documentation and source
parity, and stop before all deployment/release actions.

### Tasks

- [ ] Run focused checks during implementation and the full Node.js 25.9.0 `npm run check` gate.
- [ ] Run packaged E2E, launcher/tarball, source-parity, and host-appropriate distribution checks
      required by the final changes; record unavailable physical/signing/live checks explicitly.
- [ ] Review `git diff --check`, complete diff, and status for unintended files, secrets, absolute
      developer paths, generated output, stale comments, and sibling changes.
- [ ] Update README, security/operator docs, release checklist, changelog, provenance/source parity,
      and this plan so local implementation is not confused with candidate/public/deployed state.
- [ ] Record the Router-first coordinated deployment and exact public `/v1/models` verification as
      unperformed release gates, then stop without deployment, tag, publish, promotion, or signing.

### Relevant Files

- `PLAN.md`, `README.md`, `SECURITY.md`, `RELEASE.md`, `CHANGELOG.md`, `docs/`
- `scripts/`, `tests/`, `provenance/source-files.sha256`, `.github/workflows/`

### Expected Changes

- modify: documentation, deterministic source-parity/provenance files, and validation results
- delete: temporary debugging/generated artifacts only

### Do Not Modify

- remote release, registry, deployment, hosted database, traffic, secrets, tags, or sibling repos
- user work that is unrelated to this parity baseline

### Commands

```bash
npm run check
npm run verify:release-readiness
npm run test:e2e
git diff --check
git status --short --branch
```

### Acceptance Criteria

- [ ] All locally runnable required gates pass under Node.js 25.9.0.
- [ ] Safe parity features are bounded, sponsor-safe, approval-preserving, and replay-safe.
- [ ] Documentation accurately separates local source, candidate, public, and deployed states.
- [ ] No deployment/release/signing/publishing operation is performed.
- [ ] Skipped live, signing, native, and physical acceptance remains explicit and incomplete.

### Validation Results

- `npm run check`: passed under Node.js 25.9.0 (129 unit, 12 integration, 44 launcher/release tests)
- `npm run verify:release-readiness`: intentionally not run; the preserved worktree is uncommitted
  and no release preparation was authorized
- `npm run test:e2e`: passed after local packaging; no artifact was published
- `git diff --check`: passed
- `git status --short --branch`: reviewed on `codex/agent-parity-roadmap`; the preserved parity
  baseline remains intentionally uncommitted

### Findings / Notes

- Exact deployed catalog verification is intentionally a post-implementation rollout gate and is
  not evidence required to complete local source work.
- Live Router deployment, signing/notarization, Linux native acceptance, physical Windows 11 x64
  acceptance, tagging, publication, and promotion were not performed.

---

## Step F: AdRouterCLI beta.19 policy and reusable-guidance parity

### Status

`done`

### Objective

Adapt the remaining high-value configuration/guidance gaps found in immutable AdRouterCLI tag
`v0.81.0-beta.19` (`97aae329fccbbfb5a4655f52f5246e1cc6ff9bab`) to the Agent's stricter desktop
security model, without importing global profiles, executable extensions, broad shell authority, or
automatic prompt execution.

### Tasks

- [x] Add Agent-native task presets for model/thinking defaults, additional instructions, and
      capability ceilings.
- [x] Capture a versioned immutable policy snapshot at task creation; inherit it for forks/children,
      disable nested delegation, redact instructions in renderer summaries, and enforce policy before
      one-use approval consumption.
- [x] Discover only bounded project `.adrouter/skills/**/SKILL.md` and
      `.adrouter/prompts/**/*.md`; reject symlinks, binaries, executable-shaped files, malformed
      metadata, duplicates, and resource/scan/byte overflow.
- [x] Require exact path/digest trust, load skill bodies only on demand, fail closed after
      change/removal/revocation, and make prompt templates explicit composer inserts that never send.
- [x] Keep imported CLI history inert, allow a separately selected preset for the new imported task,
      and preserve exact inherited policy on checkpoint forks.
- [x] Reconcile the schema-2 release-acceptance JSON schema with the executable validator: exactly
      four archive identities, exactly two cohorts, exact result fields, and structural drift tests.
- [x] Run the complete pinned local gate, packaged E2E, source-provenance refresh, and final diff/status
      review; record signing/live/native/physical/remote gates as unperformed.

### Validation Results

- `npm run check`: passed under Node.js 25.9.0: lint and typecheck; 38 unit files / 141
  tests; 3 integration files / 12 tests; catalog, bundle, 65-file source-provenance,
  dependency-override, public-boundary, documentation, and workflow checks; 45 launcher/release
  tests.
- `npm run test:e2e`: passed after packaging the local macOS arm64 application: 2 tests covering
  the functional Agent flow and packaged Electron security.
- Focused policy/preset/guidance/session/Git/review/renderer tests: passed (38 tests).
- Acceptance validator/schema drift tests: passed (3 tests).
- `git diff --check`: passed; final status and the intentional uncommitted parity baseline were
  reviewed on `codex/agent-parity-roadmap`; no absolute developer path or private-key/token pattern
  was found in the repository scan.

### Findings / Notes

- CLI profiles remain intentionally deferred: they atomically replace global settings/system files
  and broaden provider/thinking/global-path semantics. Immutable Agent task presets deliver the safe
  per-task value without changing local-account configuration.
- CLI skills may include scripts, references, global paths, package discovery, and command aliases.
  Agent parity is Markdown-only progressive disclosure from an explicitly trusted project path; it
  cannot register code, tools, hooks, providers, or automatic commands.
- Release readiness, live Router/catalog verification, signing/notarization, Linux native
  acceptance, physical Windows 11 x64 acceptance, tagging, publishing, promotion, and all remote
  mutation remain deliberately unperformed release gates.
- No version, tag, release, registry channel, workflow gate, signing secret, or hosted deployment was
  changed.

---

## Step G: Credential-free beta.13 candidate

### Status

`in_progress`

### Objective

Publish the implemented parity work as immutable `0.1.0-beta.13` GitHub and npm `candidate`
artifacts using the credential-free schema-3 release model, while leaving final channels and signed
updates unchanged until downloaded-artifact acceptance is complete.

### Tasks

- [x] Confirm GitHub authentication, npm trusted publishing, unused beta.13 identity, and current
      public/candidate state.
- [x] Add an explicit beta-only credential-free packaging path without removing future schema-4
      verification/update code.
- [x] Run the complete source, dependency-audit, release-readiness, packaged-Electron, and universal
      macOS artifact gates locally.
- [ ] Install the exact published candidate anonymously and run the primary macOS live acceptance.
- [ ] Commit and push the release source, create immutable `v0.1.0-beta.13`, and verify the
      GitHub-built three-platform draft inventory.
- [ ] Publish the GitHub prerelease before npm `candidate`, run anonymous matrix smoke, and confirm
      npm `beta`/`latest` remain unchanged.
- [ ] Record physical Windows 11 x64 downloaded-candidate acceptance later; do not finalize in this
      pass.

### Findings / Notes

- The user explicitly authorized npm candidate and GitHub prerelease publication without Developer
  ID/notarization, Authenticode, or Ed25519 manifest signing for this beta.
- The primary macOS live test will run on this Mac. The physical Windows 11 x64 test is deferred to
  the user's Windows laptop and remains a hard gate for later finalization.

### Validation Results

- `npm run check`: passed (141 unit, 12 integration, and 47 launcher/release tests plus lint,
  typecheck, public-boundary, documentation, workflow, and source-parity checks).
- Production `npm audit --omit=dev --audit-level=moderate`: passed with zero vulnerabilities;
  `npm run audit:build` passed with only the bounded dev-only Forge advisory chain.
- `npm run verify:release-readiness`: passed, including the exact launcher tarball allowlist.
- `npm run test:e2e`: passed both packaged Electron functional/security tests on this Mac.
- Universal `npm run make:mac` and `npm run verify:dist`: passed for one ad-hoc app and ZIP.
- Exact downloaded-candidate macOS live acceptance and physical Windows acceptance remain pending.

---

## Follow-up Work

- Verify the hosted Router's exact `/v1/models` catalog and installation-auth contract during the
  downloaded beta.13 macOS canary before any later channel finalization.
- Run exact-artifact primary macOS and physical Windows 11 x64 acceptance for any future candidate.
- Provision signing/notarization/update trust only through protected environments after separate
  authorization and review.
- Revisit CLI-style global profiles and true multimodal turns only in separate plans with Router
  support.
- Consider higher task capacity or additional release architectures only after repository policy,
  platform evidence, and explicit acceptance requirements change.

## Decision Log

| Date | Decision | Rationale | Impact |
| --- | --- | --- | --- |
| 2026-08-04 | Preserve the existing 7,262-line dirty parity baseline. | The work is intentional and already passes the normal gate; resetting it would discard reviewed progress. | Implementation extends and reconciles the current branch rather than starting over. |
| 2026-08-04 | Target safe desktop parity. | The Agent's sandbox, approvals, hosted identity, and GUI-native UX are product invariants. | Useful CLI workflows are adapted, while arbitrary execution/provider/plugin surfaces remain excluded. |
| 2026-08-04 | Coordinate catalog source with Router/CLI and gate rollout on deployment parity. | Source artifacts agree but deployed state was not verifiable from this environment. | Local work vendors exact source; no release proceeds until Router deployment is proven. |
| 2026-08-04 | Support one-way CLI v3 active-branch import plus Agent JSON/HTML export. | This provides practical portability without promising unsafe or lossy bidirectional synchronization. | Import is previewed, redacted, inert, and GUI-confirmed. |
| 2026-08-04 | Add GUI and scoped signed RPC controls. | Local automation is useful when it shares the same task/session/security engine. | Steer, follow-up, compact, fork, and export are available without raw tools or approval bypass. |
| 2026-08-04 | Defer profiles and true image turns. | Profiles broaden configuration semantics; Router does not yet deliver typed image content to providers. | Neither is represented as supported parity in this pass. |
| 2026-08-04 | Keep normal capacity at one and official targets at macOS universal, Ubuntu x64, and Windows x64. | These are explicit repository invariants. | Queue/lease/signing infrastructure remains, but unsupported defaults and ARM64 release claims are removed. |
| 2026-08-07 | Adapt CLI beta.19 profiles as immutable Agent task presets, not global profile switching. | Desktop tasks need reproducible policy without replacing user-level settings or widening provider authority. | Presets are copied into versioned task snapshots and later edits cannot expand existing tasks. |
| 2026-08-07 | Support only exact-digest project Markdown skills/prompts. | CLI's global/package/script-capable skill surface is outside the Agent's trust and sandbox boundaries. | Skills use metadata-first on-demand loading; prompts require an explicit insert and neither can add executable behavior. |
