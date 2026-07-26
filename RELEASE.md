# Public-beta release procedure

This is the operator runbook for `v0.1.0-beta.6`. It separates safe repository
setup from credential entry and irreversible publication.

## 1. Prerequisites

- GitHub user `HappyCool121` must be an administrator of organization
  `adrouter`.
- npm organization `@adrouter` must already exist. Do not create another
  organization or a placeholder `@adrouter/agent` package.
- The npm publisher must have 2FA enabled and create/write permission for the
  `@adrouter` scope.
- The staging router must expose `/health`, `/v1/profile`, `/v1/models`, and
  `/v1/agent/turn`. Keep `DEEPSEEK_API_KEY` only on that backend.

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
git commit -m "Prepare AdRouter Agent 0.1.0-beta.6 public release"
git push --set-upstream origin main
```

Do not ask GitHub to generate a README, license, or `.gitignore`.

## 3. Configure GitHub environments and repository security

Run the idempotent configuration script only after the repository exists:

```bash
npm run configure:github
```

It creates `adrouter-staging`, `macos-release`, and `npm-publish`, adds
`HappyCool121` as required reviewer, permits the initiator to approve the job
to match the one-maintainer bootstrap policy, restricts deployment to the
release tag, enables public-repository security features, and creates main/tag
rulesets when the organization plan permits them. Inspect its printed summary
and confirm the required `ci / validate` check name in repository settings.

Add the single staging secret without printing its value. The staging URL is
the public constant `https://api-staging.adrouter.co` in the workflow:

```bash
gh secret set ADROUTER_STAGING_API_KEY --env adrouter-staging
```

Use a revocable, low-quota staging bearer token. The provider credential does
not belong in this repository or any GitHub environment here. The protected
`macos-release` environment remains an approval gate but has no secrets.

## 4. Bootstrap npm authentication

Sign in at npmjs.com as `imari` or another authorized `@adrouter` member,
enable 2FA, then create a **granular access token** with:

- package/scope: `@adrouter`, read and write
- bypass 2FA: enabled for automation
- expiry: 1–7 days
- no unrelated package or organization access

Store it directly in the protected environment:

```bash
gh secret set NPM_BOOTSTRAP_TOKEN --env npm-publish
gh secret set NPM_DIST_TAG_TOKEN --env npm-publish
```

For this first release, the same short-lived token may be entered for both
secrets. `NPM_BOOTSTRAP_TOKEN` creates the package; `NPM_DIST_TAG_TOKEN` moves
the verified version from `candidate` to `beta` and `latest`.

The first `npm publish` creates `@adrouter/agent`; do not publish a placeholder.
Do not create `@adrouter/agent-core` or a platform package.

## 5. Create the immutable release tag

Wait for required CI on `main`, then create the exact annotated tag:

```bash
git fetch origin main --tags
git switch main
git pull --ff-only
test "$(node -p "require('./package.json').version")" = "0.1.0-beta.6"
git tag -a v0.1.0-beta.6 -m "AdRouter Agent 0.1.0-beta.6"
git push origin v0.1.0-beta.6
```

Approve the `adrouter-staging` and `macos-release` jobs when GitHub prompts.
The workflow runs the live canary, builds the macOS universal, Ubuntu x64, and
Windows x64 portable apps on native runners, creates the schema-3 npm launcher,
generates checksums/SBOMs/manifests, attests the assets, and creates a **draft
prerelease**. Never move or reuse the tag.

## 6. Inspect and promote

Download the draft assets and follow `docs/release-checklist.md`. Verify the
asset inventory, all three target keys, and both macOS CPU slices. Dispatch the promotion **from the release
tag ref** so the environment's deployment-tag policy applies:

```bash
gh workflow run promote-release.yml \
  --ref v0.1.0-beta.6 \
  -f tag=v0.1.0-beta.6
```

Approve `npm-publish` and `adrouter-staging` when prompted. The Intel smoke job
uses GitHub's `macos-15-intel` runner; confirm that larger Intel macOS runners
are enabled and funded for the organization before promotion.

Promotion publishes the GitHub prerelease first, verifies the attached npm
tarball, publishes it under temporary `candidate`, runs anonymous launcher
checks on Apple Silicon, Intel, Ubuntu, and Windows, then moves `beta` and
`latest` to the exact version and removes `candidate`.

Final registry checks:

```bash
npm view @adrouter/agent@0.1.0-beta.6 version dist.integrity repository --json
npm view @adrouter/agent dist-tags --json
npm install --global @adrouter/agent@beta
adrouter-agent doctor --json
test -d ~/Applications/'AdRouter Agent.app'
```

## 7. Replace the bootstrap token with trusted publishing

After the package exists, open npmjs.com:

1. Open `@adrouter/agent` → **Settings** → **Trusted Publisher**.
2. Select GitHub Actions.
3. Organization/user: `adrouter`.
4. Repository: `adrouterAgent`.
5. Workflow filename: `promote-release.yml`.
6. Environment: `npm-publish`.
7. Select the required allowed action **npm publish**.
8. Save, then validate OIDC with a new version; npm does not validate the
   configuration when it is saved.

After the first release finishes:

1. Delete both first-release secrets from the GitHub environment:

   ```bash
   gh secret delete NPM_BOOTSTRAP_TOKEN --env npm-publish
   gh secret delete NPM_DIST_TAG_TOKEN --env npm-publish
   ```

2. Revoke/delete the granular token on npmjs.com.
3. Before each later release, create a fresh short-lived granular token and
   store only `NPM_DIST_TAG_TOKEN`. Trusted publishing handles `npm publish`,
   while npm dist-tag changes still require traditional authenticated access.

Do not attempt to republish `0.1.0-beta.6` to test OIDC. npm versions are
immutable; use a higher beta version.

## 8. Recovery

Before promotion, fix the source and issue a new tag/version. After public npm
publication, deprecate the defective version, withdraw the GitHub assets if
necessary, and release a higher beta version. Never retarget a release tag or
reuse a published npm version.
