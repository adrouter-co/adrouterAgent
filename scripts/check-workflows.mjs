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
for (const required of [
  'adrouter-staging',
  'macos-release',
  'attestations: write',
  'id-token: write',
  'credential-free portable release',
  'linux-x64',
  'win32-x64',
  'https://api-staging.adrouter.co',
]) {
  assert.ok(release.includes(required), `release workflow is missing ${required}`);
}
assert.ok(!release.includes('ADROUTER_STAGING_URL'), 'staging URL must not be a secret');
for (const forbidden of [
  'APPLE_DEVELOPER_ID',
  'APPLE_API_KEY',
  'CERTIFICATE_PASSWORD',
  'REQUIRE_SIGNED_DIST',
]) {
  assert.ok(!release.includes(forbidden), `release workflow still references ${forbidden}`);
}
const promotion = readFileSync(join(workflowDirectory, 'promote-release.yml'), 'utf8');
for (const required of [
  'npm-publish',
  'NPM_BOOTSTRAP_TOKEN',
  'NPM_DIST_TAG_TOKEN',
  '--tag candidate',
  'dist-tag add',
  'linux-x64',
  'win32-x64',
]) {
  assert.ok(promotion.includes(required), `promotion workflow is missing ${required}`);
}

console.log(`Workflow pinning and release-policy checks passed for ${workflows.length} workflows.`);
