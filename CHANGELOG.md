# Changelog

All notable changes to AdRouter Agent are documented here.

## [0.1.0-beta.1] - 2026-07-26

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

### Known limitations

- macOS only, with one active agent run at a time.
- Updates are downloaded and installed manually.
- A reachable AdRouter server and valid bearer token are required.

[0.1.0-beta.1]: https://github.com/adrouter/adrouterAgent/releases/tag/v0.1.0-beta.1
