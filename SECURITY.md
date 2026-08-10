# Security Policy

## Supported versions

Security fixes are provided for the newest public beta release only. Users
should manually install the latest release before reporting a problem.

| Version | Supported |
| --- | --- |
| 0.1.0-beta.16 | Yes |
| 0.1.0-beta.15 | No |
| 0.1.0-beta.14 | No |
| 0.1.0-beta.13 | No |
| 0.1.0-beta.12 | No |
| 0.1.0-beta.11 | No |
| 0.1.0-beta.10 | No |
| 0.1.0-beta.9 | No |
| 0.1.0-beta.8 | No |
| 0.1.0-beta.7 | No |
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

Every task stores an immutable, versioned capability snapshot when it is created. Later project or
preset edits cannot expand that task, and policy is rechecked before an operation can consume its
one-use approval. Project-owned Markdown is accepted only from bounded `.adrouter/skills` and
`.adrouter/prompts` paths, rejects symlinks/binary/executable-shaped or malformed resources, and is
inactive until its exact path and digest are trusted. Changed or revoked skills cannot fall back to
their prior content. Prompt templates require an explicit insert action and never auto-submit.

Local automation never listens on TCP. On macOS and Linux it uses a short deterministic socket
under `/tmp`, inside a directory that must be a real mode-0700 directory owned by the current user;
the socket must be owned by that user and mode 0600. Windows uses a current-user-DACL named pipe.
Every paired request remains scope-bound, signed, freshness-checked, nonce-protected, and bounded.

The beta.16 npm launcher uses the credential-free schema-3 manifest and pins every platform ZIP to
its canonical GitHub URL, exact SHA-256 digest, archive layout, platform, architecture, and bundle
identity. Downloads remain bounded, archive paths and symlinks are validated, macOS must have the
expected ad-hoc signature, and Linux/Windows are explicitly unsigned portable candidates. The
launcher also contains fail-closed schema-4 Ed25519 verification for a future protected release,
but signed update application remains disabled.

Managed update activation retains one prior installation until the initialized app writes the exact
owner-state healthy marker. A missing marker after the signed deadline restores the prior receipt and
application without elevation. The launcher never changes quarantine, Gatekeeper, AppArmor, Windows
security settings, or user consent.

Official hosted authentication uses a user-approved Ed25519 installation. The main process is the
only process that generates, decrypts, rotates, signs with, or revokes installation material.
`safeStorage` must use Keychain, DPAPI, or a supported Linux secret store; enrollment and reconnect
fail closed when that protection is unavailable. The renderer receives only the comparison code and
redacted state. Browser opening and clipboard writes remain in the main process, and the browser
handoff identifier is never returned to the renderer. A prepared sign-in is memory-only; only a
server-created pending approval is encrypted for restart recovery. The utility process receives only
request-scoped protected headers for allowlisted exact bytes and cannot request arbitrary signatures.

Loopback and explicit non-official custom routers may use the advanced bearer path. A bearer token
cannot override installation authentication for an official AdRouter origin.
