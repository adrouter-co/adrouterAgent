import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildLauncherPackage } from './build-launcher-package.mjs';

test('embeds the exact release ZIP digest in the generated npm package', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'adrouter-launcher-build-test-'));
  try {
    const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
    const zip = join(temporary, `AdRouter-Agent-${version}-universal.zip`);
    const body = Buffer.from('signed-zip-fixture');
    writeFileSync(zip, body);
    const result = buildLauncherPackage({
      zipPath: zip,
      outputDirectory: temporary,
      stagingRoot: join(temporary, 'staging'),
    });
    assert.equal(result.manifest.sha256, createHash('sha256').update(body).digest('hex'));
    assert.equal(result.manifest.schema, 2);
    assert.equal(result.manifest.distributionMode, 'credential-free-adhoc');
    assert.equal(result.manifest.bundleIdentifier, 'com.adrouter.agent');
    assert.equal(
      result.manifest.assetUrl,
      `https://github.com/adrouter/adrouterAgent/releases/download/v${version}/` +
        `AdRouter-Agent-${version}-universal.zip`
    );
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
