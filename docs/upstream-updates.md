# Pi and external-feature update workflow

AdRouterCLI is the intake and qualification repository for Pi source and reviewed external
extensions. AdRouter Agent is a separate product repository: it consumes exact Pi packages and
reimplements accepted cache/delegation behavior through its own utility process, task database,
sandbox, and approval broker. Never copy either repository's lockfile, Git history, tags, or release
actions into the other.

## Frozen inputs for this wave

| Component | Exact version | Exact upstream commit | Desktop disposition |
| --- | --- | --- | --- |
| Pi | `0.84.1` | `53fa77ccd8a279eb87e92294ef3687b03ff80112` | Exact `pi-agent-core`, `pi-ai`, and `pi-coding-agent` dependencies; controlled API adaptation. |
| pi-cache-optimizer | `2.8.2` | `dfa60b2c3e92f4a15363664c546d2042bded0b3f` | Native modes and stable-prefix logic only; no extension loading or provider mutation. |
| pi-subagents | `0.45.2` | `7836c0f5ef642a00ae0572c910dec7a56216c74d` | Native visible child tasks and approved lifecycle controls only; no upstream executable runtime. |

The authoritative source archives, integrity values, licenses, feature dispositions, and reviewed
CLI patches are frozen in the sibling AdRouterCLI `upstreams.lock.json`. A newer version reported by
the CLI audit begins a later review wave; it does not silently change this table.

## 1. Qualify in AdRouterCLI

From a clean CLI checkout:

```sh
npm run upstream:audit
npm run upstream:stage -- --component <component-id> --version <exact-locked-version>
npm run upstream:generate
npm run upstream:check
npm run check
npm run install:local
```

Review release notes, license/dependency changes, exact source diffs, and the component's
adopt/adapt/defer/reject ledger. Keep Pi core, cache, and subagent work independently reviewable.
The staging command verifies the frozen archive and leaves repository source unchanged. Neither
client may download executable extension code at runtime.

## 2. Reconcile the desktop package graph

Use the desktop-pinned toolchain and a clean Agent checkout:

```sh
nvm use 25.9.0
npm install --save-exact \
  @earendil-works/pi-agent-core@<frozen-version> \
  @earendil-works/pi-ai@<frozen-version> \
  @earendil-works/pi-coding-agent@<frozen-version>
npm run check:dependency-overrides
```

Review `package.json` and `package-lock.json`, not just npm's summary. Preserve the exact
`node-gyp` pin, security overrides, physical nested replacement checks, and Node 25 compatibility
patches unless a separate audit justifies changing them. `pi-client`, `pi-protocol`, `pi-tui`, and
`pi-telemetry` may be transitive requirements of the frozen coding-agent package, but they remain
non-direct and receive no desktop IPC, tool, network, credential, or resource-loading authority.

## 3. Adapt Pi through the desktop boundary

- Use the app-owned AdRouter provider and an in-memory Pi model runtime. Do not read or write Pi
  `auth.json`, `models.json`, sessions, or provider profiles.
- Keep `DefaultResourceLoader` extensions, Pi skills, prompt templates, themes, and context files
  disabled. The only tools exposed to Pi are the app's explicit allowlist.
- Keep official installation signing in Electron Main and Router framing at `/v1/agent/turn`
  unchanged. Optional Pi packages must never become a remote-control path.
- Keep exact-digest `.adrouter` bundles declarative Markdown. They may supply bounded instructions,
  skill content, or composer text only; they cannot add JavaScript, hooks, providers, or tools.

## 4. Port cache behavior natively

The desktop supports `off`, `stats-only`, and `prompt-rewrite` through
`ADROUTER_CACHE_OPTIMIZER`. The default and invalid-value fallback are `stats-only`.

- `off` disables optimizer diagnostics/rewrite; mandatory settlement accounting remains active.
- `stats-only` is request-byte neutral and displays only Router-normalized `cacheRead` and
  `cacheWrite` settlement counters already used by the Economics panel.
- `prompt-rewrite` is explicit opt-in, DeepSeek-only, and canonicalizes line endings only inside the
  app-owned stable prompt prefix. Repository, project, bundle, skill-index, preset, and user bytes
  remain untouched.

No mode changes provider registration, `models.json`, hosted cache fields, cache keys, sponsor data,
or network behavior. A source or Router schema change is required before any future cache hint can
be sent to the hosted service.

## 5. Port delegation through normal tasks

`delegate_task` creates a visible child task with an independent conversation, the same project and
model, an inherited immutable policy, and delegation forced off. Each parent owns at most three
depth-one children. The normal capacity-one scheduler and workspace/Git leases remain authoritative.

Parent tasks may request exact approval-bound `delegated_children`, `message_delegated_child`, and
`cancel_delegated_child` operations. Status is bounded to directly owned children. A message queues
one follow-up for an active/queued child or resumes a stopped child through the ordinary task start
path. Cancellation uses the ordinary stop path. Cross-parent control, nested delegation, ambient
credentials, copied conversation history, worktrees, missions, schedules, intercom, and arbitrary
workflow code remain unavailable.

## 6. Verify and hand off

After source review, refresh the public source-parity inventory and run the exact local gates under
Node.js 25.9.0:

```sh
npm run update:source-parity
npm run check
npm run verify:release-readiness
npm run test:e2e
git diff --check
git status --short --branch
```

Review package contents and the native broker architecture for every target. Complete the manual
matrix for hosted auth, custom-router auth, cache telemetry, DeepSeek opt-in prompt stability,
delegated child lifecycle, sponsor isolation, sandbox failure, recovery, and physical Windows.
Updating source and passing local gates does not authorize tags, GitHub releases, npm publication,
dist-tag movement, signing, or deployment; those remain separate protected actions.
