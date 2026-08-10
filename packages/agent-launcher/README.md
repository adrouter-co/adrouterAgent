# `@adrouter/agent`

This dependency-free package installs and launches the matching AdRouter Agent
portable application from the canonical GitHub release. The desktop binaries
are not duplicated in the npm tarball.

```bash
npm install --global @adrouter/agent@beta
adrouter-agent doctor --json
adrouter-agent
```

Supported targets are macOS 12+ universal arm64/x64, Ubuntu Desktop 24.04 LTS x64, and Windows 11
x64 with Node.js 22.19 or newer. The current public beta.16 uses the credential-free schema-3 manifest;
the launcher accepts no alternate artifact URL or checksum and validates bounded downloads, exact
SHA-256 digests, archive paths, native architecture, bundle identity, and managed receipts.

The beta.16 release remains ad-hoc/unsigned. A future schema-4 release requires
Developer ID/notarization on macOS and Authenticode on Windows; Linux identity is provided by the
signed manifest and exact artifact checksum. Update checks use a fixed HTTPS origin with no
redirects. Applying an update is compiled off until exact signed acceptance is recorded. The
launcher never disables host security or auto-elevates.

Commands:

- `adrouter-agent` or `adrouter-agent launch`: install if needed, then launch.
- `adrouter-agent install`: install and verify without launching.
- `adrouter-agent doctor --json`: report installation, integrity, and sandbox
  status without credentials.
- `adrouter-agent pair`: create a protected Ed25519 client key through the installed app helper and
  show a comparison code for explicit GUI approval.
- `adrouter-agent rpc METHOD --params '{}' --json`: call the bounded owner-only local RPC with a
  paired key; mutations still pause for the same fresh approval.
- `adrouter-agent update check --channel beta --json`: verify fixed-origin signed update metadata.
- `adrouter-agent update apply --channel beta --confirm`: reserved behind the disabled signed
  acceptance gate.
- `adrouter-agent --version`: print the package/release version without a
  network request.

See the repository's platform-setup guide for Ubuntu dependencies, Windows
one-time sandbox provisioning, and staging bearer-token onboarding.
