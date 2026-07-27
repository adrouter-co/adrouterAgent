# Public-beta release procedure

This is the operator runbook for `v0.1.0-beta.9`. It separates safe repository
setup from credential entry and irreversible publication.

## 1. Prerequisites

- GitHub user `HappyCool121` must be an administrator of organization
  `adrouter`.
- npm organization `@adrouter` must already exist. Do not create another
  organization or a placeholder `@adrouter/agent` package.
- The npm publisher must have 2FA enabled and create/write permission for the
  `@adrouter` scope.
- The staging router must expose the frozen platform-auth-v1 device, token, profile, turn, and
  revocation contract. Keep all provider credentials only on that backend.

This credential-free beta is ad-hoc signed for bundle integrity but is not
Developer ID signed or notarized. No Apple account, certificate, API key, or
notarization secret is used. Some Macs may require the user to approve the app
once under **System Settings → Privacy & Security → Open Anyway**.

Never paste credentials into an issue, commit, workflow input, release note,
shell history, or chat.

## 2. Create and push the public GitHub repository

The local repository is already independent and initialized on `main`. Review
it before creating remote state:

```bash
cd /path/to/adrouter_release/adrouterAgent
npm ci
npm run check
npm run test:e2e
npm audit --omit=dev --audit-level=moderate
git status --short
```

Verify GitHub authentication:

```bash
gh auth status
gh api user --jq .login
gh api orgs/adrouter/memberships/HappyCool121
```

Create an empty public repository and push the reviewed initial commit:

```bash
gh repo create adrouter/adrouterAgent --public --source=. --remote=origin
git add .
git commit -m "Prepare AdRouter Agent 0.1.0-beta.9 public release"
git push --set-upstream origin main
```

Do not ask GitHub to generate a README, license, or `.gitignore`.

## 3. Configure GitHub environments and repository security

Run the idempotent configuration script only after the repository exists:

```bash
npm run configure:github
```

It creates `macos-release` and `npm-publish`, adds
`HappyCool121` as required reviewer, permits the initiator to approve the job
to match the one-maintainer bootstrap policy, restricts deployment to the
release tag, enables public-repository security features, and creates main/tag
rulesets when the organization plan permits them. Inspect its printed summary
and confirm the required `ci / validate` check name in repository settings.

No GitHub environment in this repository receives a credential accepted by AdRouter profile or
inference routes. The protected `macos-release` environment remains an approval gate but has no
secrets. Hosted authentication evidence comes only from manual user-approved exact-candidate
cohorts.

## 4. Configure npm trusted publishing and temporary dist-tag access

The public `@adrouter/agent` package already exists. Before tagging, sign in to npmjs.com as an
authorized `@adrouter` member and configure its trusted publisher:

1. Open `@adrouter/agent` → **Settings** → **Trusted Publisher**.
2. Select GitHub Actions.
3. Organization/user: `adrouter`.
4. Repository: `adrouterAgent`.
5. Workflow filename: `promote-release.yml`.
6. Environment: `npm-publish`.
7. Select the allowed action **npm publish** and save.

npm validates this identity only on a real new-version publication. Do not republish or reuse an
existing version to test it.

For final dist-tag movement only, enable 2FA and create a **granular access token** with:

- package: `@adrouter/agent` only, read and write
- bypass 2FA: enabled for automation
- expiry: 1–7 days
- no unrelated package or organization access

Store it directly in the protected environment without printing it:

```bash
gh secret set NPM_DIST_TAG_TOKEN --env npm-publish
```

Trusted publishing and GitHub OIDC publish the immutable version under `candidate` without a stored
publish token. `NPM_DIST_TAG_TOKEN` is available only to finalization, which moves the accepted
version to `beta` and `latest` and removes `candidate`.

## 5. Create the immutable release tag

Wait for required CI on `main`, then create the exact annotated tag:

```bash
git fetch origin main --tags
git switch main
git pull --ff-only
test "$(node -p "require('./package.json').version")" = "0.1.0-beta.9"
git tag -a v0.1.0-beta.9 -m "AdRouter Agent 0.1.0-beta.9"
git push origin v0.1.0-beta.9
```

Approve the `macos-release` job when GitHub prompts. The credential-free workflow builds the macOS universal, Ubuntu x64, and
Windows x64 portable apps on native runners, creates the schema-3 npm launcher,
generates checksums/SBOMs/manifests, attests the assets, and creates a **draft
prerelease**. Never move or reuse the tag.

## 6. Inspect and promote

Download the draft assets and follow `docs/release-checklist.md`. Verify the
asset inventory, all three target keys, and both macOS CPU slices. Dispatch the promotion **from the release
tag ref** so the environment's deployment-tag policy applies:

```bash
gh workflow run promote-release.yml \
  --ref v0.1.0-beta.9 \
  -f tag=v0.1.0-beta.9 \
  -f phase=publish-candidate \
  -f channel=beta
```

Approve `npm-publish` when prompted. The Intel smoke job
uses GitHub's `macos-15-intel` runner; confirm that larger Intel macOS runners
are enabled and funded for the organization before promotion.

The candidate phase publishes the GitHub prerelease, verifies the attached npm tarball, publishes it
under temporary `candidate` through OIDC, and runs credential-free anonymous launcher checks on
Apple Silicon, Intel, Ubuntu, and Windows. It ends successfully without moving final channels.

Install the exact candidate on the primary operator device and a distinct second OS cohort. Approve
each installation in the WebUI; exercise enrollment, signed profile/turn, stream completion,
rotation, replay/tamper/token-without-key rejection, revocation, upgrade policy, and cleanup. Create
only the schema fields in `scripts/authentication-acceptance.schema.json`, then validate and upload:

```bash
node scripts/validate-authentication-acceptance.mjs authentication-acceptance.json \
  --manifest artifact-manifest.json
gh release upload v0.1.0-beta.9 authentication-acceptance.json
```

Dispatch the separate finalization phase from the immutable tag:

```bash
gh workflow run promote-release.yml \
  --ref v0.1.0-beta.9 \
  -f tag=v0.1.0-beta.9 \
  -f phase=finalize-release \
  -f channel=beta
```

Finalization revalidates exact acceptance and public installs before `beta` and `latest` move and
`candidate` is removed. A future stable release must use `channel=stable`; that path moves only
`latest` and explicitly preserves `beta`.

Final registry checks:

```bash
npm view @adrouter/agent@0.1.0-beta.9 version dist.integrity repository --json
npm view @adrouter/agent dist-tags --json
npm install --global @adrouter/agent@beta
adrouter-agent doctor --json
test -d ~/Applications/'AdRouter Agent.app'
```

## 7. Revoke temporary dist-tag access

After final verification:

1. Delete the temporary GitHub environment secret:

   ```bash
   gh secret delete NPM_DIST_TAG_TOKEN --env npm-publish
   ```

2. Revoke/delete the granular token on npmjs.com.
3. Before each later release, create a fresh short-lived token for
   `NPM_DIST_TAG_TOKEN`. Trusted publishing handles `npm publish`; dist-tag changes still require
   traditional authenticated access.

Do not attempt to republish `0.1.0-beta.9` to test OIDC. npm versions are
immutable; use a higher beta version.

## 8. Recovery

Before candidate publication, fix the source and issue a new tag/version. After candidate
publication but before finalization, leave `beta`/`latest` unchanged, withdraw the candidate if
necessary, and release a higher beta. After finalization, deprecate the defective version, withdraw
GitHub assets if necessary, and release a higher beta. Never retarget a release tag or reuse a
published npm version.
