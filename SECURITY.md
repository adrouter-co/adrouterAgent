# Security Policy

## Supported versions

Security fixes are provided for the newest public beta release only. Users
should manually install the latest release before reporting a problem.

| Version | Supported |
| --- | --- |
| 0.1.0-beta.7 | Yes |
| 0.1.0-beta.6 | No |
| 0.1.0-beta.5 | No |
| 0.1.0-beta.4 | No |
| 0.1.0-beta.3 | No |
| 0.1.0-beta.2 | No |
| Older builds | No |

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability or include router
tokens, provider keys, private project data, or exploit details in logs.

Use the repository's **Security → Report a vulnerability** flow to create a
private GitHub security advisory. Include the affected app version, operating
system version and architecture, reproduction steps, and the smallest safe diagnostic
sample. Maintainers will acknowledge the report through the advisory.

## Security boundaries

Sponsor payloads are display-only. The renderer cannot access raw credentials,
Node.js, the filesystem, or child processes. File mutations and general
commands require a fresh one-time approval and remain constrained by the
workspace sandbox.

The npm launcher accepts release metadata only from its embedded manifest. It
downloads from an allowlist of GitHub HTTPS hosts, enforces a size bound,
checks the exact target ZIP digest, rejects unsafe archive layouts and escaping
symlinks, and applies target-specific executable/signature checks. Linux and
Windows portable beta artifacts are unsigned; checksums prove artifact
integrity, not publisher identity.
