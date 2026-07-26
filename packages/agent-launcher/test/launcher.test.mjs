import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  assertAllowedDownloadUrl,
  assertNonRoot,
  assertSafeArchiveEntries,
  assertSupportedMacOsVersion,
  assertSupportedPlatform,
  inspectInstallation,
  install,
  releasePaths,
} from '../lib/installer.mjs';
import { validateManifest } from '../lib/manifest.mjs';

const manifest = {
  schema: 2,
  distributionMode: 'credential-free-adhoc',
  releaseVersion: '0.1.0-beta.1',
  releaseTag: 'v0.1.0-beta.1',
  assetName: 'AdRouter-Agent-0.1.0-beta.1-universal.zip',
  assetUrl:
    'https://github.com/adrouter/adrouterAgent/releases/download/v0.1.0-beta.1/AdRouter-Agent-0.1.0-beta.1-universal.zip',
  sha256: 'a'.repeat(64),
  repository: 'adrouter/adrouterAgent',
  bundleIdentifier: 'com.adrouter.agent',
  bundleShortVersion: '0.1.0',
  bundleVersion: '10001',
};

test('validates the exact credential-free release manifest', () => {
  assert.equal(validateManifest(manifest).releaseVersion, '0.1.0-beta.1');
  assert.throws(() => validateManifest({ ...manifest, schema: 1 }));
  assert.throws(() => validateManifest({ ...manifest, distributionMode: 'notarized' }));
  assert.throws(() => validateManifest({ ...manifest, repository: 'attacker/repository' }));
  assert.throws(() => validateManifest({ ...manifest, bundleIdentifier: 'evil.app' }));
  assert.throws(() => validateManifest({ ...manifest, sha256: 'UNBUILT' }));
  assert.throws(() => validateManifest({ ...manifest, assetUrl: 'https://example.com/app.zip' }));
});

test('accepts only supported macOS CPU architectures', () => {
  assert.doesNotThrow(() => assertSupportedPlatform('darwin', 'arm64'));
  assert.doesNotThrow(() => assertSupportedPlatform('darwin', 'x64'));
  assert.throws(() => assertSupportedPlatform('linux', 'x64'), /Unsupported platform/);
  assert.throws(
    () => assertSupportedPlatform('darwin', 'riscv64'),
    /Unsupported macOS architecture/
  );
});

test('accepts macOS 12 or newer and refuses root execution', () => {
  assert.doesNotThrow(() => assertSupportedMacOsVersion('12.0'));
  assert.doesNotThrow(() => assertSupportedMacOsVersion('15.7.7'));
  assert.throws(() => assertSupportedMacOsVersion('11.7.10'), /macOS 12 or newer/);
  assert.throws(() => assertSupportedMacOsVersion('unknown'), /macOS 12 or newer/);
  assert.throws(() => assertNonRoot(0), /Do not run adrouter-agent with sudo/);
  assert.doesNotThrow(() => assertNonRoot(501));
});

test('allows only canonical GitHub HTTPS download hosts', () => {
  assert.equal(assertAllowedDownloadUrl(manifest.assetUrl).hostname, 'github.com');
  assert.equal(
    assertAllowedDownloadUrl('https://release-assets.githubusercontent.com/file').hostname,
    'release-assets.githubusercontent.com'
  );
  assert.throws(() => assertAllowedDownloadUrl('http://github.com/file'), /non-canonical/);
  assert.throws(
    () => assertAllowedDownloadUrl('https://github.com.evil.test/file'),
    /non-canonical/
  );
  assert.throws(
    () => assertAllowedDownloadUrl('https://user:secret@github.com/file'),
    /credentials/
  );
});

test('rejects path traversal and unexpected archive layouts', () => {
  assert.doesNotThrow(() =>
    assertSafeArchiveEntries([
      'AdRouter Agent.app/',
      'AdRouter Agent.app/Contents/MacOS/AdRouter Agent',
    ])
  );
  assert.throws(() => assertSafeArchiveEntries(['../escape']), /Unsafe ZIP entry/);
  assert.throws(() => assertSafeArchiveEntries(['/absolute']), /Unsafe ZIP entry/);
  assert.throws(() => assertSafeArchiveEntries(['Other.app/file']), /Unexpected ZIP layout/);
});

test('uses the real per-user Applications bundle and separate support receipt', () => {
  const paths = releasePaths(manifest, '/tmp/adrouter-agent-home');
  assert.equal(paths.appPath, '/tmp/adrouter-agent-home/Applications/AdRouter Agent.app');
  assert.equal(
    paths.receiptPath,
    '/tmp/adrouter-agent-home/Library/Application Support/adrouter-agent-launcher/receipt.json'
  );
});

function fixtureExecute({ gatekeeper = 'rejected', running = false } = {}) {
  return async (file, args) => {
    if (file === '/usr/bin/sw_vers') return { stdout: '15.7.7\n', stderr: '' };
    if (file === '/usr/bin/unzip') {
      return {
        stdout: 'AdRouter Agent.app/\nAdRouter Agent.app/Contents/Info.plist\n',
        stderr: '',
      };
    }
    if (file === '/usr/bin/zipinfo') {
      return { stdout: '-rw-r--r--  3.0 unx fixture\n', stderr: '' };
    }
    if (file === '/usr/bin/ditto') {
      const extracted = args.at(-1);
      const contents = join(extracted, 'AdRouter Agent.app', 'Contents');
      mkdirSync(join(contents, 'MacOS'), { recursive: true });
      writeFileSync(join(contents, 'Info.plist'), 'fixture');
      writeFileSync(join(contents, 'MacOS', 'AdRouter Agent'), 'fixture');
      return { stdout: '', stderr: '' };
    }
    if (file === '/usr/libexec/PlistBuddy') {
      if (args[1].includes('CFBundleIdentifier')) {
        return { stdout: 'com.adrouter.agent\n', stderr: '' };
      }
      return {
        stdout: args[1].includes('Short') ? '0.1.0\n' : '10001\n',
        stderr: '',
      };
    }
    if (file === '/usr/bin/codesign' && args.includes('-dv')) {
      return { stdout: '', stderr: 'Signature=adhoc\nTeamIdentifier=not set\n' };
    }
    if (file === '/usr/bin/codesign') return { stdout: '', stderr: '' };
    if (file === '/usr/bin/lipo') return { stdout: 'x86_64 arm64\n', stderr: '' };
    if (file === '/usr/sbin/spctl') {
      if (gatekeeper === 'accepted') return { stdout: '', stderr: '' };
      const error = new Error('rejected');
      error.code = gatekeeper === 'unavailable' ? 'ENOENT' : 1;
      throw error;
    }
    if (file === '/bin/ps') {
      const command = running
        ? `${args.home ?? ''}/Applications/AdRouter Agent.app/Contents/MacOS/AdRouter Agent\n`
        : '';
      return { stdout: command, stderr: '' };
    }
    throw new Error(`Unexpected fixture executable ${file}`);
  };
}

function fixtureResponse(body) {
  return async () =>
    new Response(body, {
      status: 200,
      headers: { 'content-length': String(body.length) },
    });
}

test('installs into Applications and reports credential-free integrity', async () => {
  const homeDirectory = mkdtempSync(join(tmpdir(), 'adrouter-launcher-install-test-'));
  const body = Buffer.from('fixture zip body');
  const fixtureManifest = {
    ...manifest,
    sha256: createHash('sha256').update(body).digest('hex'),
  };
  try {
    const appPath = await install(fixtureManifest, {
      homeDirectory,
      uid: 501,
      fetchImpl: fixtureResponse(body),
      executeImpl: fixtureExecute(),
    });
    assert.equal(appPath, join(homeDirectory, 'Applications', 'AdRouter Agent.app'));
    const report = await inspectInstallation(fixtureManifest, {
      homeDirectory,
      executeImpl: fixtureExecute(),
    });
    assert.equal(report.schema, 2);
    assert.equal(report.installed, true);
    assert.equal(report.receiptMatches, true);
    assert.equal(report.bundleIntegrity, true);
    assert.equal(report.signatureType, 'adhoc');
    assert.equal(report.gatekeeperAssessment, 'rejected');
    assert.match(report.warning, /Open Anyway/);
    const receipt = JSON.parse(
      readFileSync(
        join(
          homeDirectory,
          'Library',
          'Application Support',
          'adrouter-agent-launcher',
          'receipt.json'
        ),
        'utf8'
      )
    );
    assert.equal(receipt.owner, '@adrouter/agent');
    assert.equal(receipt.applicationPath, appPath);
  } finally {
    rmSync(homeDirectory, { recursive: true, force: true });
  }
});

test('refuses to overwrite an unmanaged Applications bundle', async () => {
  const homeDirectory = mkdtempSync(join(tmpdir(), 'adrouter-launcher-collision-test-'));
  const appPath = join(homeDirectory, 'Applications', 'AdRouter Agent.app');
  mkdirSync(appPath, { recursive: true });
  try {
    await assert.rejects(
      install(manifest, {
        homeDirectory,
        uid: 501,
        executeImpl: fixtureExecute(),
      }),
      /is not managed by @adrouter\/agent/
    );
  } finally {
    rmSync(homeDirectory, { recursive: true, force: true });
  }
});

test('restores the previous managed app when activation receipt writing fails', async () => {
  const homeDirectory = mkdtempSync(join(tmpdir(), 'adrouter-launcher-rollback-test-'));
  const firstBody = Buffer.from('first fixture zip body');
  const firstManifest = {
    ...manifest,
    sha256: createHash('sha256').update(firstBody).digest('hex'),
  };
  try {
    const appPath = await install(firstManifest, {
      homeDirectory,
      uid: 501,
      fetchImpl: fixtureResponse(firstBody),
      executeImpl: fixtureExecute(),
    });
    const marker = join(appPath, 'previous-install-marker');
    writeFileSync(marker, 'preserve me');

    const nextBody = Buffer.from('next fixture zip body');
    const nextManifest = {
      ...manifest,
      sha256: createHash('sha256').update(nextBody).digest('hex'),
    };
    await assert.rejects(
      install(nextManifest, {
        homeDirectory,
        uid: 501,
        fetchImpl: fixtureResponse(nextBody),
        executeImpl: fixtureExecute(),
        writeReceiptImpl: async () => {
          throw new Error('receipt failure');
        },
      }),
      /receipt failure/
    );
    assert.equal(existsSync(marker), true);
  } finally {
    rmSync(homeDirectory, { recursive: true, force: true });
  }
});

test('fails closed on a checksum mismatch or non-canonical redirect', async () => {
  const homeDirectory = mkdtempSync(join(tmpdir(), 'adrouter-launcher-failure-test-'));
  try {
    await assert.rejects(
      install(manifest, {
        homeDirectory,
        uid: 501,
        fetchImpl: async () => new Response('wrong body', { status: 200 }),
        executeImpl: fixtureExecute(),
      }),
      /checksum verification failed/
    );
    await assert.rejects(
      install(manifest, {
        homeDirectory,
        uid: 501,
        fetchImpl: async () =>
          new Response(null, {
            status: 302,
            headers: { location: 'https://downloads.evil.test/app.zip' },
          }),
        executeImpl: fixtureExecute(),
      }),
      /non-canonical download URL/
    );
  } finally {
    rmSync(homeDirectory, { recursive: true, force: true });
  }
});
