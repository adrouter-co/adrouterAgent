# Credential-free beta release checklist

Use this checklist for the ad-hoc/unsigned schema-3 beta candidate. Never publish local `out/`
artifacts, a dirty tree, or an already-used version/tag.

## Automated gates and draft

- [ ] The immutable tag, root/launcher versions, source placeholder, Forge bundle version, About
      metadata, changelog, and promotion default agree.
- [ ] The tree is clean and `npm run check`, release readiness, packaged E2E, audits, source parity,
      and `git diff --check` pass under Node.js 25.9.0.
- [ ] Exact Pi pins, transitive-only optional packages, audited security overrides, physical nested
      resolutions, and disabled executable resource loading pass `npm run check:dependency-overrides`.
- [ ] The inventory contains exactly `darwin-universal`, `linux-x64`, and `win32-x64` ZIPs; three
      native SBOMs; launcher tarball/SBOM; `SHA256SUMS`; schema-3 `artifact-manifest.json`; and
      attestations.
- [ ] The launcher manifest binds exact canonical URLs, SHA-256 digests, layouts, platforms,
      architectures, bundle identity, and authentication fixture.
- [ ] macOS is universal and ad-hoc signed with no team identifier; Linux and Windows are explicitly
      unsigned portable artifacts.
- [ ] Linux/Windows Electron binaries and bundled sandbox helpers match x64.
- [ ] No workflow log or artifact contains a secret, absolute developer path, source map, test hook,
      alternate origin, or unintended file.
- [ ] Signed update application and stable publication remain disabled.

## Candidate publication

- [ ] Publish the existing draft GitHub prerelease before npm.
- [ ] Publish the exact launcher tarball only under npm `candidate`; confirm `beta` and `latest`
      remain on the prior accepted version.
- [ ] Anonymous candidate install, doctor, integrity, and launch smoke passes on macOS arm64/Intel,
      Ubuntu x64, and Windows x64.
- [ ] Download every public ZIP and match its size and SHA-256 to both `SHA256SUMS` and the embedded
      schema-3 launcher manifest.

## Downloaded exact-artifact acceptance

- [ ] Complete launcher install, hosted sign-in, profile/turn, streaming, rotation, revocation,
      sandbox, structured-operation approval, immutable preset policy, changed-guidance revocation,
      session recovery, and local automation smoke on this primary Mac.
- [ ] Repeat on a separate physical Windows 11 x64 laptop after one-time sandbox setup; hosted
      runners do not replace this cohort.
- [ ] Tampered checksum, URL, layout, architecture, or manifest data fails closed.
- [ ] Reinstalling the same exact version preserves encrypted installation material, projects,
      sessions, and unrelated workspace/Git changes.

## Acceptance record and later finalization

- [ ] Create only schema-1 `authentication-acceptance.json` fields and bind all four archive
      identities (three ZIPs plus npm tarball) to `artifact-manifest.json`.
- [ ] Record the primary macOS operator and physical Windows 11 x64 cohorts; every required result
      is true.
- [ ] Validate the record locally and attach it to the matching immutable prerelease without
      replacing existing assets.
- [ ] Obtain separate finalization authorization before moving `beta`/`latest` or removing
      `candidate`.
- [ ] Delete `NPM_DIST_TAG_TOKEN` and revoke its short-lived granular npm token after finalization.
- [ ] On a defect, withdraw as policy permits and issue a higher version; never replace assets,
      retarget a tag, force Git state, or republish an npm version.
