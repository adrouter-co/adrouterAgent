<p align="center">
  <a href="https://adrouter.co">
    <img src="assets/icon.svg" alt="AdRouter Agent" width="112">
  </a>
</p>

<h1 align="center">AdRouter Agent</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/@adrouter/agent"><img src="https://img.shields.io/npm/v/%40adrouter%2Fagent/beta?label=npm%20beta" alt="npm beta version"></a>
  <a href="https://github.com/adrouter/adrouterAgent/actions/workflows/ci.yml"><img src="https://github.com/adrouter/adrouterAgent/actions/workflows/ci.yml/badge.svg" alt="CI status"></a>
  <a href="https://github.com/adrouter/adrouterAgent/releases"><img src="https://img.shields.io/github/v/release/adrouter/adrouterAgent?include_prereleases&amp;label=release" alt="GitHub release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" alt="Apache 2.0 license"></a>
</p>

<p align="center">
  A local-first desktop coding agent that connects an approved project to AdRouter.
</p>

AdRouter Agent keeps durable task threads, reads and edits files in a folder you choose, runs
approved development commands in an operating-system sandbox, and presents every change for
review. It is distributed as a small npm launcher backed by matching native assets on
[GitHub Releases](https://github.com/adrouter/adrouterAgent/releases).

Sponsor content is display-only. It is never added to model prompts, tool arguments, commands,
patches, or compacted task context. Hosted AdRouter access is currently invite-only.

## Install

Node.js 22.19 or newer is required for the dependency-free launcher. Choose the release channel you
want to follow.

Beta channel:

```sh
npm install --global @adrouter/agent@beta
```

Latest channel:

```sh
npm install --global @adrouter/agent@latest
```

Security candidate under acceptance testing (beta.17):

```sh
npm install --global @adrouter/agent@candidate
```

Then verify and launch the installed application:

```sh
adrouter-agent --version
adrouter-agent doctor --json
adrouter-agent
```

The launcher downloads the exact platform archive from the matching GitHub release, verifies its
SHA-256 digest, layout, architecture, bundle identity, and managed receipt, then installs it in the
standard per-user location. It accepts no alternate release URL or checksum.

| Platform | Public beta support | Integrity status |
| --- | --- | --- |
| macOS 12+ on Apple Silicon or Intel | Universal application | Ad-hoc signed; not notarized |
| Ubuntu Desktop 24.04 LTS x64 | Portable application | Unsigned; sandbox and secret-store checks required |
| Windows 11 x64 | Portable application | Unsigned; one-time sandbox setup required |

See [platform setup](docs/platform-setup.md) for install locations, Ubuntu prerequisites, Windows
sandbox provisioning, and first-launch guidance. The application includes its runtime dependencies;
AdRouterCLI, a source checkout, and the WebUI are not required after installation.

## First run

1. Start `adrouter-agent`.
2. Select **Connect this Agent**, finish browser sign-in, return to the app, and select
   **Continue**.
3. Compare the code in the Agent with the code in the AdRouter WebUI, then approve only the
   installation you recognize.
4. Choose a project folder and start a task.
5. Review every requested file mutation, general command, or Git operation before choosing
   **Allow once**.

The installation private key and rotating refresh credential are encrypted with Electron
`safeStorage` through Keychain, DPAPI, or a supported Linux secret store. Access tokens remain
memory-only. Remote routers must use HTTPS; plain HTTP is accepted only for loopback development.

## What the Agent includes

- Git and non-Git projects selected through the native folder picker.
- Persistent projects, searchable task history, checkpoints, forks, and redacted import/export.
- Streamed text, thinking, tool activity, command output, retries, and final evidence.
- Safe silent reads plus a fresh **Allow once** or **Deny** decision for each mutation or command.
- Workspace containment and operating-system sandbox checks that fail closed.
- Agent-authored diffs that remain separate from pre-existing project changes.
- Model and thinking selection, task presets, trusted project guidance, and sponsor controls.
- Explicit installation revocation and local sign-out without deleting projects or task history.

The Agent never stages, commits, pushes, elevates privileges, disables host security, or expands a
task's saved capability limits automatically.

## Updates

Repeat the install command for the channel you follow:

```sh
# Accepted prereleases
npm install --global @adrouter/agent@beta

# Current recommended release
npm install --global @adrouter/agent@latest

# Security candidate under acceptance testing (beta.17)
npm install --global @adrouter/agent@candidate
```

Updates are manual during the beta. Installing a newer accepted launcher verifies and replaces only
the managed application; it preserves encrypted installation material, projects, sessions, and
unrelated workspace changes. Run `adrouter-agent doctor --json` after updating.

## Documentation

- [Platform setup and authentication](docs/platform-setup.md)
- [Operator guide and architecture](docs/operator-guide.md)
- [Manual acceptance testing](docs/manual-testing.md)
- [Privacy](PRIVACY.md)
- [Security policy](SECURITY.md)
- [Support](SUPPORT.md)
- [Changelog](CHANGELOG.md)
- [GitHub releases](https://github.com/adrouter/adrouterAgent/releases)

## Development and contributing

The desktop source checkout pins Node.js 25.9.0:

```sh
nvm use 25.9.0
npm ci
npm run check
```

`npm run test:e2e` packages and exercises the deterministic Electron suite. See
[CONTRIBUTING.md](CONTRIBUTING.md), the [release procedure](RELEASE.md), and
[source provenance](SOURCE_PROVENANCE.md) for maintainer workflows.

## License

AdRouter Agent is released under the [Apache License 2.0](LICENSE). Third-party attributions are
recorded in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and in each release SBOM.
