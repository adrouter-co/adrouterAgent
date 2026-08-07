import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildLauncherPackage } from './build-launcher-package.mjs';
import { createTestReleaseSigning } from './test-release-signing.mjs';

test('embeds all exact platform ZIP digests in the generated npm package', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'adrouter-launcher-build-test-'));
  try {
    const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
    const body = Buffer.from('signed-zip-fixture');
    const artifacts = ['darwin-universal', 'linux-x64', 'win32-x64'].map((key) => {
      const zipPath = join(temporary, `AdRouter-Agent-${version}-${key}.zip`);
      writeFileSync(zipPath, Buffer.concat([body, Buffer.from(key)]));
      return { key, zipPath };
    });
    const result = buildLauncherPackage({
      artifacts,
      outputDirectory: temporary,
      stagingRoot: join(temporary, 'staging'),
      signing: createTestReleaseSigning(),
    });
    assert.equal(
      result.manifest.signed.artifacts[0].sha256,
      createHash('sha256')
        .update(Buffer.concat([body, Buffer.from('darwin-universal')]))
        .digest('hex')
    );
    assert.equal(result.manifest.schema, 4);
    assert.equal(result.manifest.signed.distributionMode, 'signed-release-metadata');
    assert.equal(result.manifest.signed.bundleIdentifier, 'com.adrouter.agent');
    assert.deepEqual(result.manifest.signed.authentication, {
      fixture: 'tests/fixtures/platform-auth-v1.json',
      fixtureSha256: '93a8ec8d4eba38f9165179aa0cdfe3316f8134a882bd0426bd83339af55d17f8',
      acceptanceAsset: 'authentication-acceptance.json',
    });
    assert.equal(
      result.manifest.signed.artifacts[0].assetUrl,
      `https://github.com/adrouter/adrouterAgent/releases/download/v${version}/` +
        `AdRouter-Agent-${version}-darwin-universal.zip`
    );
    assert.equal(result.manifest.signatures[0].algorithm, 'Ed25519');
    assert.equal(result.manifest.signed.artifacts.length, 3);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test('builds an explicit credential-free manifest only for beta candidates', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'adrouter-launcher-unsigned-test-'));
  try {
    const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
    const artifacts = ['darwin-universal', 'linux-x64', 'win32-x64'].map((key) => {
      const zipPath = join(temporary, `AdRouter-Agent-${version}-${key}.zip`);
      writeFileSync(zipPath, `credential-free-${key}`);
      return { key, zipPath };
    });
    const result = buildLauncherPackage({
      artifacts,
      outputDirectory: temporary,
      stagingRoot: join(temporary, 'staging'),
      credentialFreeBeta: true,
    });
    assert.equal(result.manifest.schema, 3);
    assert.equal(result.manifest.distributionMode, 'credential-free-portable');
    assert.equal(result.manifest.bundleVersion, '10013');
    assert.equal(result.manifest.artifacts[0].verificationMode, 'macos-adhoc');
    assert.equal(result.manifest.artifacts[2].verificationMode, 'portable-checksum');
    assert.equal('bytes' in result.manifest.artifacts[0], false);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
