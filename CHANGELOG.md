# Changelog

All notable changes to AdRouter Agent are documented here.

## [0.1.0-beta.6] - 2026-07-26

### Fixed

- The Windows launcher now accepts Electron Forge's verified flat portable ZIP
  layout while continuing to reject absolute paths, drive-qualified paths,
  traversal, ambiguous path segments, and escaping symbolic links.
- Cross-platform promotion smokes no longer cancel healthy operating-system
  jobs when another matrix member fails, preserving complete deployment
  evidence before public distribution tags can move.

## [0.1.0-beta.5] - 2026-07-26

### Fixed

- The Windows launcher now binds ZIP inspection and extraction paths through
  explicit PowerShell parameters, so a verified portable archive is listed and
  expanded correctly on Windows 11.
- Windows npm smoke tests invoke the native `.cmd` launcher shim instead of the
  MSYS shell shim, preventing runner drive-letter translation from corrupting
  the installed package path.

## [0.1.0-beta.4] - 2026-07-26

### Added

- Portable Ubuntu 24.04 x64 and Windows 11 x64 desktop distributions alongside
  the existing universal macOS application.
- Platform-specific sandbox readiness diagnostics, secure credential-store
  checks, launcher installation paths, and native CI acceptance jobs.
- The live `https://api-staging.adrouter.co` origin as the default for fresh
  desktop installations and the protected release canary.

### Security

- Linux refuses weak `basic_text` credential storage, Windows uses DPAPI, and
  command tools remain unavailable until the platform sandbox is ready.
- Release manifests now select an exact OS/CPU artifact and verify its checksum,
  archive layout, executable, and target-specific integrity policy.

### Fixed

- The macOS distribution verifier now selects only the macOS universal ZIP when
  Linux and Windows artifacts are present in the same Forge output tree.

### Known limitations

- Linux and Windows portable beta artifacts are unsigned.
- Updates remain manual and only one agent run can be active at a time.

## [0.1.0-beta.3] - 2026-07-26

### Fixed

- The npm installer now accepts the standard relative framework symlinks inside
  an Electron macOS bundle while rejecting absolute, ambiguous, or escaping
  symlink targets before and after extraction.
- Anonymous registry propagation waits are long enough for a newly published
  candidate to become visible before macOS install smoke tests begin.

## [0.1.0-beta.2] - 2026-07-26

### Added

- First public-beta distribution of the universal macOS desktop application.
- Credential-free ad-hoc-signed universal ZIP delivery through GitHub Releases.
- Dependency-free npm launcher installation into `~/Applications` with
  checksum, archive, bundle identity, architecture, and integrity validation.
- Dependency-free `@adrouter/agent` npm installer and launcher with embedded
  release metadata, bounded downloads, checksum validation, safe extraction,
  signing verification, and Gatekeeper assessment.
- Immutable-tag release, protected staging/signing/publishing environments,
  SBOMs, artifact manifests, and GitHub artifact attestations.

### Security

- Production dependency resolutions override `brace-expansion` to `5.0.8` and
  `protobufjs` to `7.6.5`; reviewed Pi agent package versions remain unchanged.
- npm accepts no URL/checksum environment overrides and rejects unsupported
  platforms before downloading.

### Fixed

- Hosted AdRouter requests now leave `runtime_mode` unset when automatic routing
  is selected, preserving the server default and avoiding a rejected explicit
  `auto` value.

### Known limitations

- macOS only, with one active agent run at a time.
- Updates are downloaded and installed manually.
- A reachable AdRouter server and valid bearer token are required.

[0.1.0-beta.6]: https://github.com/adrouter/adrouterAgent/releases/tag/v0.1.0-beta.6
[0.1.0-beta.5]: https://github.com/adrouter/adrouterAgent/releases/tag/v0.1.0-beta.5
[0.1.0-beta.4]: https://github.com/adrouter/adrouterAgent/releases/tag/v0.1.0-beta.4
[0.1.0-beta.3]: https://github.com/adrouter/adrouterAgent/releases/tag/v0.1.0-beta.3
[0.1.0-beta.2]: https://github.com/adrouter/adrouterAgent/releases/tag/v0.1.0-beta.2
