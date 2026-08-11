import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { validateManifest } from '../packages/agent-launcher/lib/manifest.mjs';

const directory = resolve(process.argv[2] ?? 'out/release');
const requireAcceptance = process.argv.includes('--require-acceptance');
const manifest = JSON.parse(readFileSync(join(directory, 'artifact-manifest.json'), 'utf8'));
assert.ok([3, 4].includes(manifest.schema), 'release manifest schema must be 3 or 4');
const expectedDistributionMode =
  manifest.schema === 3 ? 'credential-free-portable' : 'signed-release-metadata';
assert.equal(manifest.distributionMode, expectedDistributionMode);
assert.equal(manifest.repository, 'adrouter/adrouterAgent');
assert.match(manifest.releaseVersion, /^\d+\.\d+\.\d+(?:-beta\.\d+)?$/);
assert.equal(manifest.releaseTag, `v${manifest.releaseVersion}`);
assert.equal(manifest.bundleShortVersion, '0.1.0');
assert.equal(manifest.bundleVersion, '10018');

const expectedNames = [
  ...['darwin-universal', 'linux-x64', 'win32-x64'].flatMap((target) => [
    `AdRouter-Agent-${manifest.releaseVersion}-${target}.zip`,
    `AdRouter-Agent-${manifest.releaseVersion}-${target}.cdx.json`,
  ]),
  `AdRouter-Agent-${manifest.releaseVersion}-npm.cdx.json`,
  `adrouter-agent-${manifest.releaseVersion}.tgz`,
].sort();
const recordedNames = manifest.files.map((record) => record.name).sort();
assert.deepEqual(recordedNames, expectedNames, 'artifact manifest inventory is not exact');

for (const record of manifest.files) {
  assert.match(record.sha256, /^[a-f0-9]{64}$/);
  const file = join(directory, record.name);
  assert.equal(statSync(file).size, record.size, `${record.name} size differs`);
  const digest = createHash('sha256').update(readFileSync(file)).digest('hex');
  assert.equal(digest, record.sha256, `${record.name} checksum differs`);
}

const checksums = readFileSync(join(directory, 'SHA256SUMS'), 'utf8')
  .trim()
  .split('\n')
  .map((line) => {
    const match = line.match(/^([a-f0-9]{64}) {2}(.+)$/);
    assert.ok(match, `invalid SHA256SUMS record ${line}`);
    return { sha256: match[1], name: match[2] };
  });
assert.deepEqual(
  checksums.sort((left, right) => left.name.localeCompare(right.name)),
  manifest.files
    .map(({ name, sha256 }) => ({ name, sha256 }))
    .sort((left, right) => left.name.localeCompare(right.name))
);

const tarball = join(directory, `adrouter-agent-${manifest.releaseVersion}.tgz`);
const embeddedManifest = JSON.parse(
  execFileSync('tar', ['-xOzf', tarball, 'package/release-manifest.json'], {
    encoding: 'utf8',
  })
);
assert.deepEqual(embeddedManifest, manifest.launcherManifest);
const validatedEmbeddedManifest = validateManifest(embeddedManifest);
const embeddedPackage = JSON.parse(
  execFileSync('tar', ['-xOzf', tarball, 'package/package.json'], { encoding: 'utf8' })
);
assert.equal(embeddedPackage.name, '@adrouter/agent');
assert.equal(embeddedPackage.version, manifest.releaseVersion);
assert.equal(embeddedPackage.dependencies, undefined);
assert.equal(embeddedPackage.scripts, undefined);
assert.equal(embeddedManifest.schema, manifest.schema);
assert.equal(validatedEmbeddedManifest.distributionMode, expectedDistributionMode);
assert.deepEqual(validatedEmbeddedManifest.artifacts.map((artifact) => artifact.key).sort(), [
  'darwin-universal',
  'linux-x64',
  'win32-x64',
]);
assert.equal(validatedEmbeddedManifest.bundleIdentifier, 'com.adrouter.agent');
assert.deepEqual(validatedEmbeddedManifest.authentication, {
  fixture: 'tests/fixtures/platform-auth-v1.json',
  fixtureSha256: '93a8ec8d4eba38f9165179aa0cdfe3316f8134a882bd0426bd83339af55d17f8',
  acceptanceAsset: 'authentication-acceptance.json',
});

for (const sbomName of expectedNames.filter((name) => name.endsWith('.cdx.json'))) {
  const sbom = JSON.parse(readFileSync(join(directory, sbomName), 'utf8'));
  assert.equal(sbom.bomFormat, 'CycloneDX', `${sbomName} is not a CycloneDX SBOM`);
}

const actualNames = readdirSync(directory)
  .filter((name) => !name.startsWith('.'))
  .sort();
const acceptanceName = 'authentication-acceptance.json';
const acceptancePath = join(directory, acceptanceName);
if (requireAcceptance) {
  assert.ok(existsSync(acceptancePath), `${acceptanceName} is required before promotion`);
}
if (existsSync(acceptancePath)) {
  execFileSync(
    process.execPath,
    [
      resolve('scripts/validate-authentication-acceptance.mjs'),
      acceptancePath,
      '--manifest',
      join(directory, 'artifact-manifest.json'),
    ],
    { stdio: 'inherit' }
  );
}
const completeNames = [
  ...expectedNames,
  'SHA256SUMS',
  'artifact-manifest.json',
  ...(existsSync(acceptancePath) ? [acceptanceName] : []),
].sort();
assert.deepEqual(actualNames, completeNames, 'release directory contains unintended assets');
assert.equal(basename(directory).length > 0, true);

console.log(`Verified ${manifest.files.length} immutable release assets in ${directory}.`);
