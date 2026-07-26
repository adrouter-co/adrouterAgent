# `@adrouter/agent`

This dependency-free package installs and launches the credential-free,
ad-hoc-signed universal macOS application from the matching
[AdRouter Agent GitHub release](https://github.com/adrouter/adrouterAgent/releases).
The desktop application is not duplicated in the npm tarball.

```bash
npm install --global @adrouter/agent@beta
adrouter-agent doctor --json
adrouter-agent
```

The launcher supports macOS 12 or newer, Apple Silicon and Intel, and Node.js
22.19.0 or newer. It accepts no alternate download URL or checksum. Downloads
are bounded, checked against the release manifest embedded in this package,
and installed as the real application at `~/Applications/AdRouter Agent.app`
after archive, bundle identity, universal architecture, and ad-hoc `codesign`
integrity checks.

This beta is not Developer ID signed or notarized. If macOS blocks the first
launch, open **System Settings → Privacy & Security** and choose **Open Anyway**.
The launcher never removes quarantine metadata or changes Gatekeeper settings.

Commands:

- `adrouter-agent` or `adrouter-agent launch`: install if needed, then launch.
- `adrouter-agent install`: install and verify without launching.
- `adrouter-agent doctor --json`: report platform, installation receipt,
  bundle integrity, ad-hoc signature, and diagnostic Gatekeeper status.
- `adrouter-agent --version`: print the package/release version without a
  network request.

See the [repository security policy](https://github.com/adrouter/adrouterAgent/blob/main/SECURITY.md)
before reporting a vulnerability.
