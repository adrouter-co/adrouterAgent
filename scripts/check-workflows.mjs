import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const workflowDirectory = join('.github', 'workflows');
const workflows = readdirSync(workflowDirectory)
  .filter((filename) => /\.ya?ml$/.test(filename))
  .map((filename) => join(workflowDirectory, filename));
assert.ok(workflows.length >= 3, 'CI, release, and promotion workflows are required');
for (const workflow of workflows) {
  const text = readFileSync(workflow, 'utf8');
  for (const match of text.matchAll(/^\s*uses:\s*([^@\s]+)@([^\s#]+)/gm)) {
    assert.match(match[2], /^[a-f0-9]{40}$/, `${workflow} must pin ${match[1]} to a full SHA`);
  }
}
const release = readFileSync(join(workflowDirectory, 'release-tag.yml'), 'utf8');
const ci = readFileSync(join(workflowDirectory, 'ci.yml'), 'utf8');
for (const [name, workflow] of [
  ['CI', ci],
  ['release', release],
]) {
  assert.ok(
    workflow.includes('npm audit --omit=dev --audit-level=moderate'),
    `${name} workflow must retain the production dependency audit`
  );
  assert.ok(
    workflow.includes('npm run audit:build'),
    `${name} workflow must enforce the high/critical build audit policy`
  );
}
const retiredStagingCredential = ['ADROUTER', 'STAGING', 'API', 'KEY'].join('_');
for (const required of [
  'macos-release',
  'attestations: write',
  'id-token: write',
  'aggregate credential-free beta release',
  'ADROUTER_CREDENTIAL_FREE_BETA',
  'linux-x64',
  'win32-x64',
]) {
  assert.ok(release.includes(required), `release workflow is missing ${required}`);
}
assert.ok(!release.includes('ADROUTER_STAGING_URL'), 'staging URL must not be a secret');
assert.ok(
  !release.includes(retiredStagingCredential),
  'release workflow must not use an inference credential'
);
assert.ok(
  !release.includes('staging-canary'),
  'release workflow must be authentication-credential-free'
);
for (const forbidden of [
  'APPLE_DEVELOPER_ID',
  'REQUIRE_SIGNED_DIST',
  'RELEASE_SIGNING_PRIVATE_KEY_PEM',
  'ADROUTER_RELEASE_SIGNING_KEY_FILE',
  'ADROUTER_APPLE_SIGNING_IDENTITY',
  'ADROUTER_WINDOWS_SIGN_TOOL',
  'ADROUTER_SIGNED_RELEASE_ENABLED',
]) {
  assert.ok(!release.includes(forbidden), `release workflow still references ${forbidden}`);
}
const promotion = readFileSync(join(workflowDirectory, 'promote-release.yml'), 'utf8');
const packageVersion = JSON.parse(readFileSync('package.json', 'utf8')).version;
const retiredBootstrapToken = ['NPM', 'BOOTSTRAP', 'TOKEN'].join('_');
for (const required of [
  'npm-publish',
  'NPM_DIST_TAG_TOKEN',
  'phase:',
  'publish-candidate',
  'finalize-release',
  "if: inputs.phase == 'publish-candidate'",
  "if: inputs.phase == 'finalize-release'",
  'id-token: write',
  '--tag candidate',
  'dist-tag add',
  'linux-x64',
  'win32-x64',
  '--require-acceptance',
  'authentication acceptance',
  'CHANNEL',
  'expected_prerelease',
  'r.schema!==3',
  "?'adhoc':'unsigned-portable'",
]) {
  assert.ok(promotion.includes(required), `promotion workflow is missing ${required}`);
}
assert.ok(
  !promotion.includes(retiredBootstrapToken),
  'promotion workflow must not retain bootstrap-token publication'
);
assert.equal(
  promotion.match(/NPM_DIST_TAG_TOKEN/g)?.length,
  2,
  'the dist-tag token may appear only in finalization and its cleanup notice'
);
assert.equal(
  promotion.match(/id-token: write/g)?.length,
  1,
  'OIDC permission must be scoped only to candidate publication'
);
assert.match(
  promotion,
  /finalize-release:\n[\s\S]*?needs: \[verify-finalization, final-public-smoke\]/,
  'finalization must resume independently of candidate publication jobs'
);
assert.ok(
  !/npm publish[^\n]*--tag (?:latest|beta)/.test(promotion),
  'npm publication must use only the temporary candidate tag'
);
assert.ok(
  promotion.includes(`default: v${packageVersion}`),
  'promotion workflow default must match the immutable package version'
);
assert.ok(
  !promotion.includes(retiredStagingCredential) && !promotion.includes('smoke:live'),
  'promotion workflow must not use a hosted inference credential'
);
assert.ok(
  !promotion.includes('ADROUTER_SIGNED_RELEASE_ENABLED'),
  'credential-free beta promotion must not depend on the future signed-release gate'
);
assert.ok(
  release.includes('version#*-') && promotion.includes('version#*-'),
  'release workflows must distinguish stable versions from beta prereleases'
);

console.log(`Workflow pinning and release-policy checks passed for ${workflows.length} workflows.`);
