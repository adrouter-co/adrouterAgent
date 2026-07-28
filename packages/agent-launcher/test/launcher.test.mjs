import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  assertAllowedDownloadUrl,
  assertNonRoot,
  assertSafeArchiveEntries,
  assertSafeArchiveSymlink,
  assertSupportedMacOsVersion,
  assertSupportedPlatform,
  inspectInstallation,
  install,
  releasePaths,
} from '../lib/installer.mjs';
import { artifactKey, selectArtifact, validateManifest } from '../lib/manifest.mjs';

const manifest = {
  schema: 3,
  distributionMode: 'credential-free-portable',
  releaseVersion: '0.1.0-beta.10',
  releaseTag: 'v0.1.0-beta.10',
  repository: 'adrouter/adrouterAgent',
  bundleIdentifier: 'com.adrouter.agent',
  bundleShortVersion: '0.1.0',
  bundleVersion: '10010',
  authentication: {
    fixture: 'tests/fixtures/platform-auth-v1.json',
    fixtureSha256: '93a8ec8d4eba38f9165179aa0cdfe3316f8134a882bd0426bd83339af55d17f8',
    acceptanceAsset: 'authentication-acceptance.json',
  },
  artifacts: [
    {
      key: 'darwin-universal',
      platform: 'darwin',
      architectures: ['arm64', 'x64'],
      assetName: 'AdRouter-Agent-0.1.0-beta.10-darwin-universal.zip',
      assetUrl:
        'https://github.com/adrouter/adrouterAgent/releases/download/v0.1.0-beta.10/AdRouter-Agent-0.1.0-beta.10-darwin-universal.zip',
      sha256: 'a'.repeat(64),
      archiveRoot: 'AdRouter Agent.app',
      executablePath: 'Contents/MacOS/AdRouter Agent',
      verificationMode: 'macos-adhoc',
    },
    {
      key: 'linux-x64',
      platform: 'linux',
      architectures: ['x64'],
      assetName: 'AdRouter-Agent-0.1.0-beta.10-linux-x64.zip',
      assetUrl:
        'https://github.com/adrouter/adrouterAgent/releases/download/v0.1.0-beta.10/AdRouter-Agent-0.1.0-beta.10-linux-x64.zip',
      sha256: 'b'.repeat(64),
      archiveRoot: 'AdRouter Agent-linux-x64',
      executablePath: 'AdRouter Agent',
      verificationMode: 'portable-checksum',
    },
    {
      key: 'win32-x64',
      platform: 'win32',
      architectures: ['x64'],
      assetName: 'AdRouter-Agent-0.1.0-beta.10-win32-x64.zip',
      assetUrl:
        'https://github.com/adrouter/adrouterAgent/releases/download/v0.1.0-beta.10/AdRouter-Agent-0.1.0-beta.10-win32-x64.zip',
      sha256: 'c'.repeat(64),
      archiveRoot: '.',
      executablePath: 'AdRouter Agent.exe',
      verificationMode: 'portable-checksum',
    },
  ],
};

test('validates the exact credential-free release manifest', () => {
  assert.equal(validateManifest(manifest).releaseVersion, '0.1.0-beta.10');
  const stableManifest = JSON.parse(JSON.stringify(manifest).replaceAll('0.1.0-beta.10', '0.1.0'));
  assert.equal(validateManifest(stableManifest).releaseVersion, '0.1.0');
  assert.throws(() => validateManifest({ ...manifest, schema: 1 }));
  assert.throws(() => validateManifest({ ...manifest, distributionMode: 'notarized' }));
  assert.throws(() => validateManifest({ ...manifest, repository: 'attacker/repository' }));
  assert.throws(() => validateManifest({ ...manifest, bundleIdentifier: 'evil.app' }));
  assert.throws(() =>
    validateManifest({
      ...manifest,
      authentication: { ...manifest.authentication, fixtureSha256: 'a'.repeat(64) },
    })
  );
  assert.throws(() =>
    validateManifest({
      ...manifest,
      artifacts: manifest.artifacts.map((artifact, index) =>
        index === 0 ? { ...artifact, sha256: 'UNBUILT' } : artifact
      ),
    })
  );
  assert.throws(() =>
    validateManifest({
      ...manifest,
      artifacts: manifest.artifacts.map((artifact, index) =>
        index === 0 ? { ...artifact, assetUrl: 'https://example.com/app.zip' } : artifact
      ),
    })
  );
});

test('selects only supported operating-system and CPU combinations', () => {
  assert.doesNotThrow(() => assertSupportedPlatform('darwin', 'arm64'));
  assert.doesNotThrow(() => assertSupportedPlatform('darwin', 'x64'));
  assert.doesNotThrow(() => assertSupportedPlatform('linux', 'x64'));
  assert.doesNotThrow(() => assertSupportedPlatform('win32', 'x64'));
  assert.equal(artifactKey('linux', 'x64'), 'linux-x64');
  assert.equal(selectArtifact(manifest, 'win32', 'x64').key, 'win32-x64');
  assert.throws(() => assertSupportedPlatform('linux', 'arm64'), /Unsupported operating system/);
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
  assert.equal(assertAllowedDownloadUrl(manifest.artifacts[0].assetUrl).hostname, 'github.com');
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
  assert.throws(() => assertSafeArchiveEntries(['C:\\absolute']), /Unsafe ZIP entry/);
  assert.throws(() => assertSafeArchiveEntries(['Other.app/file']), /Unexpected ZIP layout/);
  assert.doesNotThrow(() =>
    assertSafeArchiveEntries(['AdRouter Agent.exe', 'resources\\app.asar'], '.')
  );
  assert.throws(() => assertSafeArchiveEntries(['..\\escape'], '.'), /Unsafe ZIP entry/);
  assert.throws(() => assertSafeArchiveEntries(['C:\\escape'], '.'), /Unsafe ZIP entry/);
});

test('keeps flat archive symlinks inside the extraction root', () => {
  assert.doesNotThrow(() => assertSafeArchiveSymlink('resources/current', 'app.asar', '.'));
  assert.throws(
    () => assertSafeArchiveSymlink('resources/escape', '../../outside', '.'),
    /escapes \./
  );
});

test('allows only relative archive symlinks that remain inside the app bundle', () => {
  const framework = 'AdRouter Agent.app/Contents/Frameworks/Electron Framework.framework';
  assert.doesNotThrow(() =>
    assertSafeArchiveSymlink(
      `${framework}/Electron Framework`,
      'Versions/Current/Electron Framework'
    )
  );
  assert.doesNotThrow(() => assertSafeArchiveSymlink(`${framework}/Versions/Current`, 'A'));
  assert.throws(
    () => assertSafeArchiveSymlink(`${framework}/escape`, '../../../../../../tmp/payload'),
    /escapes AdRouter Agent\.app/
  );
  assert.throws(
    () => assertSafeArchiveSymlink(`${framework}/absolute`, '/tmp/payload'),
    /Unsafe ZIP symbolic link target/
  );
  assert.throws(
    () => assertSafeArchiveSymlink(`${framework}/ambiguous`, '..\\payload'),
    /Unsafe ZIP symbolic link target/
  );
});

test('uses the real per-user Applications bundle and separate support receipt', () => {
  const paths = releasePaths(manifest, '/tmp/adrouter-agent-home', 'darwin');
  assert.equal(
    paths.appPath,
    join('/tmp/adrouter-agent-home', 'Applications', 'AdRouter Agent.app')
  );
  assert.equal(
    paths.receiptPath,
    join(
      '/tmp/adrouter-agent-home',
      'Library',
      'Application Support',
      'adrouter-agent-launcher',
      'receipt.json'
    )
  );
});

test('uses XDG and LocalAppData install locations for portable targets', () => {
  const linux = releasePaths(manifest, '/tmp/home', 'linux', { xdgDataHome: '/tmp/xdg' });
  assert.equal(linux.appPath, join('/tmp/xdg', 'adrouter-agent', 'app'));
  const windows = releasePaths(manifest, 'C:\\Users\\fixture', 'win32', {
    localAppData: 'C:\\Users\\fixture\\AppData\\Local',
  });
  assert.match(windows.appPath.replaceAll('\\', '/'), /Programs\/AdRouter Agent$/);
});

function fixtureExecute({ gatekeeper = 'rejected', running = false, safeSymlink = false } = {}) {
  return async (file, args) => {
    if (file === '/usr/bin/sw_vers') return { stdout: '15.7.7\n', stderr: '' };
    if (file === '/usr/bin/unzip') {
      if (args[0] === '-p') {
        return { stdout: 'Versions/Current/Electron Framework', stderr: '' };
      }
      return {
        stdout: safeSymlink
          ? 'AdRouter Agent.app/\nAdRouter Agent.app/Contents/Info.plist\nAdRouter Agent.app/Contents/Frameworks/Electron Framework.framework/Electron Framework\n'
          : 'AdRouter Agent.app/\nAdRouter Agent.app/Contents/Info.plist\n',
        stderr: '',
      };
    }
    if (file === '/usr/bin/zipinfo') {
      return {
        stdout: safeSymlink
          ? 'lrwxr-xr-x  3.0 unx       35 bx       35 stor 26-Jul-26 08:53 AdRouter Agent.app/Contents/Frameworks/Electron Framework.framework/Electron Framework\n'
          : '-rw-r--r--  3.0 unx fixture\n',
        stderr: '',
      };
    }
    if (file === '/usr/bin/ditto') {
      const extracted = args.at(-1);
      const contents = join(extracted, 'AdRouter Agent.app', 'Contents');
      mkdirSync(join(contents, 'MacOS'), { recursive: true });
      writeFileSync(join(contents, 'Info.plist'), 'fixture');
      writeFileSync(join(contents, 'MacOS', 'AdRouter Agent'), 'fixture');
      if (safeSymlink) {
        const framework = join(contents, 'Frameworks', 'Electron Framework.framework');
        mkdirSync(join(framework, 'Versions', 'A'), { recursive: true });
        writeFileSync(join(framework, 'Versions', 'A', 'Electron Framework'), 'fixture');
        symlinkSync('A', join(framework, 'Versions', 'Current'));
        symlinkSync('Versions/Current/Electron Framework', join(framework, 'Electron Framework'));
      }
      return { stdout: '', stderr: '' };
    }
    if (file === '/usr/libexec/PlistBuddy') {
      if (args[1].includes('CFBundleIdentifier')) {
        return { stdout: 'com.adrouter.agent\n', stderr: '' };
      }
      return {
        stdout: args[1].includes('Short') ? '0.1.0\n' : '10010\n',
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
    artifacts: manifest.artifacts.map((artifact) =>
      artifact.key === 'darwin-universal'
        ? { ...artifact, sha256: createHash('sha256').update(body).digest('hex') }
        : artifact
    ),
  };
  try {
    const appPath = await install(fixtureManifest, {
      platform: 'darwin',
      arch: 'arm64',
      homeDirectory,
      uid: 501,
      fetchImpl: fixtureResponse(body),
      executeImpl: fixtureExecute(),
    });
    assert.equal(appPath, join(homeDirectory, 'Applications', 'AdRouter Agent.app'));
    const report = await inspectInstallation(fixtureManifest, {
      platform: 'darwin',
      arch: 'arm64',
      homeDirectory,
      executeImpl: fixtureExecute(),
    });
    assert.equal(report.schema, 3);
    assert.equal(report.installed, true);
    assert.equal(report.receiptMatches, true);
    assert.equal(report.bundleIntegrity, true);
    assert.equal(report.authenticationInspection, 'application-only');
    assert.equal(report.authenticationState, 'unknown');
    assert.equal(report.storageClassification, 'unknown');
    assert.equal(report.signedRequestSupport, true);
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

test('installs a signed app containing safe internal framework symlinks', {
  skip: process.platform === 'win32',
}, async () => {
  const homeDirectory = mkdtempSync(join(tmpdir(), 'adrouter-launcher-symlink-test-'));
  const body = Buffer.from('fixture zip body with safe framework symlinks');
  const fixtureManifest = {
    ...manifest,
    artifacts: manifest.artifacts.map((artifact) =>
      artifact.key === 'darwin-universal'
        ? { ...artifact, sha256: createHash('sha256').update(body).digest('hex') }
        : artifact
    ),
  };
  try {
    await assert.doesNotReject(
      install(fixtureManifest, {
        platform: 'darwin',
        arch: 'arm64',
        homeDirectory,
        uid: 501,
        fetchImpl: fixtureResponse(body),
        executeImpl: fixtureExecute({ safeSymlink: true }),
      })
    );
  } finally {
    rmSync(homeDirectory, { recursive: true, force: true });
  }
});

function portableExecute(platform, archiveRoot, executableName) {
  return async (file, args) => {
    if (platform === 'linux' && file === '/usr/bin/unzip' && args[0] === '-Z1') {
      return { stdout: `${archiveRoot}/\n${archiveRoot}/${executableName}\n`, stderr: '' };
    }
    if (platform === 'linux' && file === '/usr/bin/zipinfo') {
      return { stdout: '-rw-r--r-- fixture\n', stderr: '' };
    }
    const isExtract =
      (platform === 'linux' && file === '/usr/bin/unzip' && args[0] === '-q') ||
      (platform === 'win32' &&
        file === 'powershell.exe' &&
        args.some(
          (argument) =>
            argument.includes('param([string]$archive, [string]$destination)') &&
            argument.includes(
              'Expand-Archive -LiteralPath $archive -DestinationPath $destination -Force'
            )
        ));
    if (isExtract) {
      const destination = args.at(-1);
      const root = archiveRoot === '.' ? destination : join(destination, archiveRoot);
      mkdirSync(root, { recursive: true });
      const executable = join(root, executableName);
      writeFileSync(executable, 'portable fixture');
      if (platform === 'linux') chmodSync(executable, 0o755);
      return { stdout: '', stderr: '' };
    }
    if (platform === 'win32' && file === 'powershell.exe') {
      assert.ok(args.some((argument) => argument.includes('param([string]$zipPath)')));
      assert.ok(args.some((argument) => argument.includes('OpenRead($zipPath)')));
      return archiveRoot === '.'
        ? { stdout: `${executableName}\r\nresources\\app.asar\r\n`, stderr: '' }
        : { stdout: `${archiveRoot}/\r\n${archiveRoot}/${executableName}\r\n`, stderr: '' };
    }
    throw new Error(`Unexpected portable fixture executable ${file}`);
  };
}

for (const target of [
  {
    platform: 'linux',
    key: 'linux-x64',
    archiveRoot: 'AdRouter Agent-linux-x64',
    executable: 'AdRouter Agent',
  },
  {
    platform: 'win32',
    key: 'win32-x64',
    archiveRoot: '.',
    executable: 'AdRouter Agent.exe',
  },
]) {
  test(`installs and verifies the ${target.key} portable artifact`, async () => {
    const homeDirectory = mkdtempSync(join(tmpdir(), `adrouter-${target.key}-`));
    const body = Buffer.from(`${target.key} fixture zip`);
    const fixtureManifest = {
      ...manifest,
      artifacts: manifest.artifacts.map((artifact) =>
        artifact.key === target.key
          ? { ...artifact, sha256: createHash('sha256').update(body).digest('hex') }
          : artifact
      ),
    };
    const locationOptions =
      target.platform === 'linux'
        ? { xdgDataHome: join(homeDirectory, '.local', 'share') }
        : { localAppData: join(homeDirectory, 'AppData', 'Local') };
    try {
      const appPath = await install(fixtureManifest, {
        ...locationOptions,
        platform: target.platform,
        arch: 'x64',
        homeDirectory,
        uid: 501,
        fetchImpl: fixtureResponse(body),
        executeImpl: portableExecute(target.platform, target.archiveRoot, target.executable),
      });
      const report = await inspectInstallation(fixtureManifest, {
        ...locationOptions,
        platform: target.platform,
        arch: 'x64',
        homeDirectory,
      });
      assert.equal(report.installed, true);
      assert.equal(report.receiptMatches, true);
      assert.equal(report.bundleIntegrity, true);
      assert.equal(report.signatureType, 'unsigned-portable');
      assert.equal(existsSync(appPath), true);
    } finally {
      rmSync(homeDirectory, { recursive: true, force: true });
    }
  });
}

test('refuses to overwrite an unmanaged Applications bundle', async () => {
  const homeDirectory = mkdtempSync(join(tmpdir(), 'adrouter-launcher-collision-test-'));
  const appPath = join(homeDirectory, 'Applications', 'AdRouter Agent.app');
  mkdirSync(appPath, { recursive: true });
  try {
    await assert.rejects(
      install(manifest, {
        platform: 'darwin',
        arch: 'arm64',
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
    artifacts: manifest.artifacts.map((artifact) =>
      artifact.key === 'darwin-universal'
        ? { ...artifact, sha256: createHash('sha256').update(firstBody).digest('hex') }
        : artifact
    ),
  };
  try {
    const appPath = await install(firstManifest, {
      platform: 'darwin',
      arch: 'arm64',
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
      artifacts: manifest.artifacts.map((artifact) =>
        artifact.key === 'darwin-universal'
          ? { ...artifact, sha256: createHash('sha256').update(nextBody).digest('hex') }
          : artifact
      ),
    };
    await assert.rejects(
      install(nextManifest, {
        platform: 'darwin',
        arch: 'arm64',
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
        platform: 'darwin',
        arch: 'arm64',
        homeDirectory,
        uid: 501,
        fetchImpl: async () => new Response('wrong body', { status: 200 }),
        executeImpl: fixtureExecute(),
      }),
      /checksum verification failed/
    );
    await assert.rejects(
      install(manifest, {
        platform: 'darwin',
        arch: 'arm64',
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
