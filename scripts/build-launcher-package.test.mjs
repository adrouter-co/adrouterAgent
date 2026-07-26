import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildLauncherPackage } from './build-launcher-package.mjs';

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
    });
    assert.equal(
      result.manifest.artifacts[0].sha256,
      createHash('sha256')
        .update(Buffer.concat([body, Buffer.from('darwin-universal')]))
        .digest('hex')
    );
    assert.equal(result.manifest.schema, 3);
    assert.equal(result.manifest.distributionMode, 'credential-free-portable');
    assert.equal(result.manifest.bundleIdentifier, 'com.adrouter.agent');
    assert.equal(
      result.manifest.artifacts[0].assetUrl,
      `https://github.com/adrouter/adrouterAgent/releases/download/v${version}/` +
        `AdRouter-Agent-${version}-darwin-universal.zip`
    );
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
