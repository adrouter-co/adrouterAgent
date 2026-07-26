# AdRouter Agent

AdRouter Agent is a local-first cross-platform desktop coding agent. It opens a folder
you approve, keeps durable task threads, inspects and edits project files, runs
approved development commands in an OS sandbox, and presents its work for
review.

Model inference is sent only to the AdRouter server you configure. Sponsor
selection and settlement use a separate display channel; sponsor data is never
added to model prompts, tool arguments, commands, patches, or compacted agent
context.

> **Public beta:** AdRouter Agent 0.1.0-beta.6 supports macOS 12+ on Apple Silicon
> and Intel, Ubuntu Desktop 24.04 LTS x64, and Windows 11 x64. One agent task can
> run at a time, and updates are installed manually.

## Install from npm

The npm package is a small verified launcher for the exact platform ZIP on
GitHub Releases. Installation requires Node.js 22.19.0 or newer:

```bash
npm install --global @adrouter/agent@beta
adrouter-agent doctor --json
adrouter-agent
```

`adrouter-agent install` downloads and verifies without launching.
`adrouter-agent --version` prints the release version without downloading.
The launcher accepts no alternate URL or checksum, verifies the archive and
platform integrity, and installs the real application in the standard per-user
location. See [platform setup and staging authentication](docs/platform-setup.md)
for Ubuntu prerequisites, Windows one-time sandbox provisioning, install paths,
and authentication steps.

This beta is not Developer ID signed or notarized. If macOS blocks the first
launch, open **System Settings → Privacy & Security** and choose **Open Anyway**.
The launcher never removes quarantine metadata or changes Gatekeeper settings.
After launch, the app is prefilled with `https://api-staging.adrouter.co`.
Enter a staging AdRouter bearer token, select **Test connection**, and save.

Remote routers must use HTTPS. Plain HTTP is accepted only for `localhost`,
`127.0.0.1`, and `::1` development servers. The token is encrypted with the
operating-system credential store and is never exposed to the renderer.

The installed app includes its runtime dependencies. After installation it can
be opened directly without the CLI. AdRouterCLI, the
AdRouter WebUI, and a source checkout are not required. Git is optional; when
available, the app adds branch and change metadata, while non-Git folders
remain fully usable.

## Run from a source checkout

The updated product is the Electron desktop application. Run it with
`npm run dev`; it does not start an `adrouter` executable, the AdRouterCLI, or
the WebUI in the background.

The normal local setup has two processes:

```text
Terminal 1: sibling AdRouter backend  http://localhost:8787
Terminal 2: this Electron application (renderer dev server on http://localhost:5174)
```

Port `5174` is reserved for the Electron renderer during development so the
sibling WebUI can run concurrently on its standard `http://localhost:5173`.

The desktop repository pins Node.js in `.nvmrc`:

```bash
cd /path/to/adrouterAgent
nvm install 25.9.0
nvm use 25.9.0
npm ci
npm run dev
```

If `nvm` is not installed, use any Node version manager that can provide
Node.js `25.9.0`. Node 24 is not supported by this repository's `engines`
field. The sibling backend supports Node.js `22.13` or newer.

### Start the local backend

The desktop needs an independently running AdRouter backend. From the usual
sibling checkout:

```bash
cd /path/to/router/backend
npm install
cp .env.example .env.local
```

Set a local bearer token and, for live DeepSeek inference, a separate
DeepSeek Platform key in `router/backend/.env.local`:

```dotenv
ADROUTER_PROFILE_ID=local-demo
ADROUTER_PROFILE_NAME=AdRouter Local Demo
ADROUTER_API_KEY=your_generated_local_bearer_token
DEEPSEEK_API_KEY=your_deepseek_platform_key
PORT=8787
```

Generate a local bearer token without printing it into the repository:

```bash
openssl rand -hex 32
```

Never reuse `DEEPSEEK_API_KEY` as `ADROUTER_API_KEY`, commit either credential,
or paste either value into a chat, screenshot, or issue. `.env.local` is
intentionally local-only.

Start and verify the backend:

```bash
npm run dev
curl -fsS http://localhost:8787/health
```

For live inference, the health response should report `status: "ok"`,
`mode: "live"`, `llm.configured: true`, and `profile.configured: true`.
Without a valid DeepSeek key, the backend can run in mock mode for protocol
and UI testing.

### Complete first-run onboarding

After `npm run dev` opens the desktop app:

1. Keep `https://api-staging.adrouter.co`, or enter `http://localhost:8787` for
   a local backend.
2. Enter the exact local `ADROUTER_API_KEY` from the backend `.env.local`.
3. Choose whether to enable sponsored compute.
4. Select **Test connection** and confirm health, authentication, and model
   discovery succeed.
5. Select **Save securely**.

The token is encrypted by Electron `safeStorage` using Keychain, DPAPI, or a
supported Linux secret store. It
is not exposed to the renderer or written to the event journal. Remote servers
must use HTTPS; plain HTTP is accepted only for loopback development URLs.

Select **Choose folder**, open a project directory, and start a chat. A new
chat can inspect files immediately. File mutations and general commands pause
for a fresh **Allow once** or **Deny** decision. The **Changes** drawer shows
agent-authored diffs only; it never stages, commits, or pushes changes.

## What is included

- Git and non-Git project folders selected through the native folder picker.
- Persistent projects, chats, append-only event history, and restart recovery.
- Streamed text, thinking, tool activity, command output, retries, and final
  evidence.
- Router-discovered models and supported thinking levels.
- Silent safe reads and a fresh **Allow once** or **Deny** decision for every
  file mutation and general command.
- Workspace containment, protected credential paths, and an OS command sandbox
  that blocks network access, privilege escalation, and outside-workspace
  access.
- Read-only agent-authored diffs that exclude pre-existing user changes.
- Tier A/B/C/NONE sponsor placement and settlement/economics summaries.
- Stop, permanent chat deletion, and local project instructions.

### Current desktop interaction surface

- The composer is the anchored interaction point for task entry, model and
  thinking-level selection, sponsor banners, and command approvals.
- Tier B/C bottom sponsor surfaces attach directly above the composer, animate
  into view when routed, and can be dismissed with the close control. Approval
  cards use the same dock and remain tied to the input area while a command is
  waiting for a decision.
- History, Changes, and Settings open as animated side drawers. The drawers
  preserve their existing read-only review, router-status, and configuration
  responsibilities.
- An empty project view provides starter suggestions for explaining a codebase,
  fixing a bug, or reviewing changes. Selecting a suggestion fills the composer
  without sending a request until the user submits it.
- Assistant responses use the blue response treatment with readable links and
  code blocks; user messages remain visually distinct for scanability.

## Router contract

The desktop app uses only these routes on the configured AdRouter origin:

```text
GET  /health
GET  /v1/profile       Authorization: Bearer <token>
GET  /v1/models        Authorization: Bearer <token>
POST /v1/agent/turn    Authorization: Bearer <token>
```

`POST /v1/agent/turn` streams newline-delimited JSON containing sponsor, text,
thinking, tool-call, settlement, usage, completion, and error events. The
router remains independently deployed and controls provider credentials and
model availability.

## Data and security

Application state is stored under the normal operating-system user-data
directory in SQLite and a small configuration file. The configuration contains
only OS-encrypted token ciphertext. Deleting a chat removes application
history and review metadata but never deletes project files.

The renderer is sandboxed and context-isolated, with no Node.js or raw
filesystem access. The utility process embeds the Pi-based coding-agent loop;
the app does not spawn an `adrouter` executable. Device permissions are denied
because the current product does not use the camera, microphone, Bluetooth,
location, or notifications.

See [PRIVACY.md](PRIVACY.md), [SECURITY.md](SECURITY.md), and
[docs/operator-guide.md](docs/operator-guide.md) for the complete boundaries
and operating model.

## Development

Use Node.js `25.9.0` and npm 10 or newer:

```bash
nvm use 25.9.0
npm ci
npm run dev
```

Useful checks:

```bash
npm run check
npm run test:e2e
```

The available scripts are:

| Command | Purpose |
| --- | --- |
| `npm run dev` | Launch the Electron app with Forge/Vite development tooling. |
| `npm run start` | Alias for the development launch. |
| `npm run lint` | Run Biome checks. |
| `npm run typecheck` | Run TypeScript without emitting files. |
| `npm run test` | Run unit tests. |
| `npm run test:integration` | Run integration tests. |
| `npm run check` | Run lint, typecheck, unit tests, and integration tests. |
| `npm run test:e2e` | Package and run the deterministic Electron E2E suite. |
| `npm run smoke:live` | Send a bounded no-tools request to a real router. |
| `npm run make:mac` | Build a local universal macOS ZIP. |
| `npm run verify:dist` | Verify the generated macOS artifacts. |
| `npm run make:linux` | Build an Ubuntu/Linux x64 portable ZIP. |
| `npm run make:windows` | Build a Windows x64 portable ZIP. |

The deterministic E2E suite packages an inspector-enabled test build and uses
an in-process fixture router. It does not need live credentials. To exercise a
real router without printing its token:

```bash
ADROUTER_API_KEY="$ADROUTER_API_KEY" \
npm run smoke:live
```

The smoke test discovers a model, sends a no-tools `READY` request, requires a
terminal response, and removes its temporary workspace.

Additional references:

- [Manual acceptance test](docs/manual-testing.md)
- [Public beta release checklist](docs/release-checklist.md)
- [Operator and architecture guide](docs/operator-guide.md)
- [Implementation record](PLAN.md)
- [Public release procedure](RELEASE.md)
- [Source provenance](SOURCE_PROVENANCE.md)
- [Support](SUPPORT.md)

## Troubleshooting

### The app cannot reach the router

Check the backend process and the configured URL:

```bash
curl -fsS http://localhost:8787/health
```

Health is a public endpoint and does not validate the bearer token. If health
works but onboarding authentication fails, compare the desktop token with the
backend's `ADROUTER_API_KEY` and restart the backend after editing `.env.local`.

### The router is healthy but reports mock mode

Set a valid `DEEPSEEK_API_KEY` in the backend's `.env.local` and restart the
backend. Mock mode is still useful for testing the desktop protocol, approvals,
and sponsor presentation.

### No models appear

The desktop discovers models through authenticated `GET /v1/models`. Refresh
the Agent status panel in **Settings**, check the bearer token, and inspect the
backend model configuration. A cached model catalog may remain visible while a
temporary router check is unavailable.

### A command or file operation is blocked

This is expected for network access, dependency installation, credentials,
privilege escalation, destructive filesystem/Git operations, shell operators,
and paths outside the selected workspace. Run intentionally required setup
commands manually outside the agent. If the OS sandbox cannot initialize,
commands fail closed.

For deeper operational guidance, see [docs/operator-guide.md](docs/operator-guide.md).

## Build and release

Local universal artifacts can be built on macOS with Node.js 25:

```bash
npm run make:mac
npm run verify:dist
```

The GitHub release workflow runs the complete deterministic and live gates,
creates macOS universal, Ubuntu x64, and Windows x64 portable ZIPs, verifies
their platform integrity, generates SHA-256 checksums and CycloneDX SBOMs, and
opens a draft `vX.Y.Z` prerelease. It uses no signing credentials and does not
claim publisher identity for the unsigned portable beta artifacts.

The release operator must manually install the downloaded draft artifacts on
Apple Silicon, Intel, clean Ubuntu 24.04, and clean Windows 11 hosts before
publishing. Release tags are immutable; a defective release is withdrawn and
replaced with a higher patch version.

## License

AdRouter Agent is licensed under the [Apache License 2.0](LICENSE). Third-party
attributions are recorded in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)
and in the SBOM attached to each release.
