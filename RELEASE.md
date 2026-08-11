# Credential-free beta release procedure

This runbook owns the unsigned/ad-hoc beta candidate path used by `0.1.0-beta.17`. It does not
authorize a stable release or movement of npm `beta`/`latest`. Candidate publication must use the
immutable tag, GitHub-built artifacts, GitHub-before-npm ordering, and npm trusted publishing.

macOS is ad-hoc signed and not notarized. Linux and Windows are unsigned portable builds. Every ZIP
is still pinned by its exact SHA-256 digest, canonical GitHub URL, archive layout, platform, and
architecture in the dependency-free launcher's schema-3 manifest. The schema-4 signed-update code
remains present but update application stays compiled off and is not part of this beta candidate.

## 1. Local source gates

Use a clean committed tree at the intended immutable beta version with Node.js 25.9.0:

```bash
npm ci
npm run check
npm run verify:release-readiness
npm run test:e2e
git diff --check
git status --short --branch
```

The root package, launcher package, source placeholder manifest, Forge bundle version, changelog,
promotion default, and About metadata must agree. Checked-in `UNBUILT` hashes are placeholders and
are never release evidence.

## 2. Immutable credential-free build

Push exactly one unused `v<version>` tag from the clean release commit. `release-tag.yml` accepts
beta versions only and builds exactly:

- `darwin-universal`, ad-hoc signed with no Apple team identifier;
- `linux-x64`, unsigned portable;
- `win32-x64`, unsigned portable;
- one SBOM for each native target, the dependency-free npm launcher and its SBOM;
- `SHA256SUMS`, schema-3 `artifact-manifest.json`, and GitHub attestations.

Protected aggregation opens an immutable draft prerelease. Download draft assets rather than using
local `out/` files. Verify every digest, archive layout, native architecture, bundle identity, and
the absence of secrets, source maps, test hooks, and absolute developer paths.

## 3. Candidate publication

After the draft inventory passes, dispatch `promote-release.yml` with:

- tag `v<version>`;
- phase `publish-candidate`;
- channel `beta`.

The workflow publishes the GitHub prerelease first, verifies anonymous ZIP downloads, publishes the
exact tarball to npm `candidate` through trusted publishing, and runs anonymous installer/doctor/
launch smoke tests on macOS arm64 and Intel, Ubuntu x64, and Windows x64. `beta` and `latest` must
remain unchanged.

Candidate publication is allowed before the later physical Windows cohort specifically so the exact
immutable public artifact can be tested. It is not final acceptance or channel promotion.

## 4. Exact-artifact acceptance and finalization

Before any finalization, record schema-1 `authentication-acceptance.json` against the immutable
schema-3 manifest with both cohorts:

- the primary macOS operator on the downloaded candidate;
- a separate physical Windows 11 x64 device.

Each cohort must pass installation authentication, profile/turn, streaming, refresh rotation,
replay/tamper/token-without-key rejection, revocation, cleanup, and upgrade policy. Validate the
sanitized record locally and attach it without replacing any existing release asset:

```bash
node scripts/validate-authentication-acceptance.mjs authentication-acceptance.json \
  --manifest artifact-manifest.json
```

Finalization is a separate authorization and workflow dispatch. For this beta it moves npm `beta`
and `latest` to the exact accepted version and removes `candidate`; it never rebuilds or retargets
the tag. Delete `NPM_DIST_TAG_TOKEN` and revoke its short-lived granular npm token after use.

For `0.1.0-beta.16` only, `promote-release.yml` also exposes an explicit operator acceptance
override. It may be used from `main` only after the operator has attested successful live macOS and
physical Windows testing and separately authorized finalization. A bounded audit reason is required.
The override waives only the `authentication-acceptance.json` presence check; immutable tag, release
inventory, npm integrity, and all anonymous macOS arm64/Intel, Ubuntu, and Windows launcher smoke
checks remain mandatory. The workflow rejects this override for every other version.

If npm accepts the beta.16 `beta`/`latest` writes but rejects deletion of the temporary `candidate`
alias, the same override may complete with `candidate` retained only when all three tags resolve to
the exact beta.16 package. This does not replace an artifact or create another release channel; it
records a registry-cleanup exception so the accepted public channels are not rolled back.

## 5. Future signed releases and recovery

Schema-4 Ed25519 manifests, Developer ID/notarization, Authenticode, and healthy-start rollback are
deferred to a separate reviewed release. They require a committed active public key and protected
private/signing material; do not generate throwaway production keys.

Before candidate publication, fix source and use a higher version. After publication, keep final
channels unchanged and withdraw a defective candidate if policy permits. Tags, package versions,
and release assets are immutable; always fix forward.
