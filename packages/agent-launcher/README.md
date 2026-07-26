# `@adrouter/agent`

This dependency-free package installs and launches the matching AdRouter Agent
portable application from the canonical GitHub release. The desktop binaries
are not duplicated in the npm tarball.

```bash
npm install --global @adrouter/agent@beta
adrouter-agent doctor --json
adrouter-agent
```

Supported targets are macOS 12+ arm64/x64, Ubuntu Desktop 24.04 LTS x64, and
Windows 11 x64 with Node.js 22.19 or newer. The launcher accepts no alternate
download URL or checksum. It validates the embedded schema-3 manifest, bounded
download, SHA-256 digest, archive paths, executable, managed receipt, and
staged-update rollback before activation.

macOS is ad-hoc signed but not notarized. Linux and Windows portable beta
artifacts are unsigned. Run `adrouter-agent doctor --json` for the platform
install path, artifact key, verification result, sandbox readiness, and static
setup guidance. The launcher never disables host security or auto-elevates.

Commands:

- `adrouter-agent` or `adrouter-agent launch`: install if needed, then launch.
- `adrouter-agent install`: install and verify without launching.
- `adrouter-agent doctor --json`: report installation, integrity, and sandbox
  status without credentials.
- `adrouter-agent --version`: print the package/release version without a
  network request.

See the repository's platform-setup guide for Ubuntu dependencies, Windows
one-time sandbox provisioning, and staging bearer-token onboarding.
