import assert from 'node:assert/strict';
import { sign } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createTestReleaseSigning } from '../../../scripts/test-release-signing.mjs';
import { canonicalJson } from '../lib/canonical-json.mjs';
import { reconcilePendingActivation, releasePaths } from '../lib/installer.mjs';
import { artifactKey, releaseManifestSigningBytes, validateManifest } from '../lib/manifest.mjs';
import {
  applySignedUpdate,
  checkForUpdate,
  compareAgentVersions,
  updateManifestUrl,
} from '../lib/update.mjs';

const targetMetadata = [
  [
    'darwin-universal',
    'darwin',
    ['arm64', 'x64'],
    'AdRouter Agent.app',
    'Contents/MacOS/AdRouter Agent',
    'macos-developer-id',
  ],
  [
    'linux-x64',
    'linux',
    ['x64'],
    'AdRouter Agent-linux-x64',
    'AdRouter Agent',
    'portable-checksum',
  ],
  ['win32-x64', 'win32', ['x64'], '.', 'AdRouter Agent.exe', 'windows-authenticode'],
];

const createEnvelope = (overrides = {}) => {
  const signing = createTestReleaseSigning();
  const version = overrides.releaseVersion ?? '0.1.0-beta.16';
  const signed = {
    distributionMode: 'signed-release-metadata',
    channel: overrides.channel ?? 'beta',
    releaseVersion: version,
    releaseTag: `v${version}`,
    repository: 'adrouter/adrouterAgent',
    bundleIdentifier: 'com.adrouter.agent',
    bundleShortVersion: '0.1.0',
    bundleVersion: '10016',
    minimumAgentVersion: '0.1.0-beta.12',
    issuedAt: signing.issuedAt,
    expiresAt: signing.expiresAt,
    authentication: {
      fixture: 'tests/fixtures/platform-auth-v1.json',
      fixtureSha256: '93a8ec8d4eba38f9165179aa0cdfe3316f8134a882bd0426bd83339af55d17f8',
      acceptanceAsset: 'authentication-acceptance.json',
    },
    health: { deadlineSeconds: 120, markerProtocol: 1, rollbackRequired: true },
    artifacts: targetMetadata.map(
      ([key, platform, architectures, archiveRoot, executablePath, verificationMode], index) => ({
        key,
        platform,
        architectures,
        assetName: `AdRouter-Agent-${version}-${key}.zip`,
        assetUrl:
          `https://github.com/adrouter/adrouterAgent/releases/download/v${version}/` +
          `AdRouter-Agent-${version}-${key}.zip`,
        bytes: 1000 + index,
        sha256: String(index + 1).repeat(64),
        archiveRoot,
        executablePath,
        verificationMode,
        signature:
          platform === 'darwin'
            ? { type: 'developer-id', required: true, expectedSigner: 'TESTTEAM01' }
            : platform === 'win32'
              ? {
                  type: 'authenticode',
                  required: true,
                  expectedSigner: 'CN=AdRouter Agent Test Fixture',
                }
              : { type: 'none', required: false, expectedSigner: null },
      })
    ),
  };
  const envelope = {
    schema: 4,
    signed,
    signatures: [
      {
        keyId: signing.keyId,
        algorithm: 'Ed25519',
        signature: sign(null, releaseManifestSigningBytes(signed), signing.privateKey).toString(
          'base64'
        ),
      },
    ],
  };
  return { envelope, signing };
};

test('RFC 8785 canonical JSON is deterministic and rejects non-JSON values', () => {
  assert.equal(
    canonicalJson({ z: 1, a: { beta: true, alpha: 'first' }, list: [3, null, -0] }),
    '{"a":{"alpha":"first","beta":true},"list":[3,null,0],"z":1}'
  );
  assert.throws(() => canonicalJson({ value: Number.NaN }), /finite numbers/);
  assert.throws(() => canonicalJson({ value: undefined }), /undefined/);
  assert.throws(() => canonicalJson('\ud800'), /surrogates/);
});

test('schema-4 release envelopes verify exact key, signature, target metadata, and time', () => {
  const { envelope, signing } = createEnvelope();
  const manifest = validateManifest(envelope, {
    trustedKeys: signing.trustedKeys,
    now: signing.issuedAt,
  });
  assert.equal(manifest.schema, 4);
  assert.equal(manifest.artifacts.length, 3);
  assert.throws(() => artifactKey('linux', 'arm64'), /Unsupported operating system/);
  assert.throws(() => artifactKey('win32', 'arm64'), /Unsupported operating system/);

  for (const mutate of [
    (value) => {
      value.signed.artifacts[0].sha256 = 'f'.repeat(64);
    },
    (value) => {
      value.signed.artifacts[1].bytes += 1;
    },
    (value) => {
      value.signed.artifacts[2].architectures = ['x64', 'arm64'];
    },
    (value) => {
      value.signed.channel = 'stable';
    },
    (value) => {
      value.signatures[0].keyId = 'f'.repeat(64);
    },
  ]) {
    const changed = structuredClone(envelope);
    mutate(changed);
    assert.throws(
      () =>
        validateManifest(changed, {
          trustedKeys: signing.trustedKeys,
          now: signing.issuedAt,
        }),
      /release|artifact|signed|trusted/i
    );
  }
  assert.throws(
    () =>
      validateManifest(envelope, {
        trustedKeys: signing.trustedKeys,
        now: '2027-01-02',
        enforceExpiry: true,
      }),
    /not currently valid/
  );
});

test('fixed-origin update checks reject redirects and accept only a trusted matching channel', async () => {
  const { envelope, signing } = createEnvelope();
  let requestedUrl;
  const result = await checkForUpdate('0.1.0-beta.12', 'beta', {
    trustedKeys: signing.trustedKeys,
    now: signing.issuedAt,
    fetchImpl: async (url, options) => {
      requestedUrl = url;
      assert.equal(options.redirect, 'manual');
      return new Response(JSON.stringify(envelope), { status: 200 });
    },
  });
  assert.equal(requestedUrl, updateManifestUrl('beta'));
  assert.equal(result.available, true);
  assert.equal(result.latestVersion, '0.1.0-beta.16');
  await assert.rejects(
    checkForUpdate('0.1.0-beta.12', 'beta', {
      fetchImpl: async () =>
        new Response(null, { status: 302, headers: { location: 'https://example.com' } }),
    }),
    /must not redirect/
  );
  assert.equal(compareAgentVersions('0.1.0', '0.1.0-beta.99') > 0, true);
  const downgrade = createEnvelope({ releaseVersion: '0.1.0-beta.11' });
  await assert.rejects(
    checkForUpdate('0.1.0-beta.12', 'beta', {
      trustedKeys: downgrade.signing.trustedKeys,
      now: downgrade.signing.issuedAt,
      fetchImpl: async () => new Response(JSON.stringify(downgrade.envelope), { status: 200 }),
    }),
    /downgrade/
  );
});

test('update application requires confirmation, remains disabled, and binds health launch args', async () => {
  const { envelope, signing } = createEnvelope();
  await assert.rejects(
    applySignedUpdate('0.1.0-beta.12', 'beta', { userConfirmed: true }),
    /disabled/
  );
  let launched;
  const result = await applySignedUpdate('0.1.0-beta.12', 'beta', {
    userConfirmed: true,
    applicationEnabled: true,
    trustedKeys: signing.trustedKeys,
    now: signing.issuedAt,
    fetchImpl: async () => new Response(JSON.stringify(envelope), { status: 200 }),
    installImpl: async (_manifest, options) => {
      options.onPendingActivation({
        token: 'a'.repeat(43),
        markerPath: '/managed/health-marker.json',
      });
      return '/managed/app';
    },
    selectArtifactImpl: () => envelope.signed.artifacts[0],
    launchImpl: async (...args) => {
      launched = args;
    },
  });
  assert.equal(result.applied, true);
  assert.deepEqual(launched[1].args, [
    `--adrouter-launcher-health-token=${'a'.repeat(43)}`,
    '--adrouter-launcher-health-marker=/managed/health-marker.json',
  ]);
});

test('expired unhealthy activation restores the prior managed installation', async () => {
  const { envelope, signing } = createEnvelope();
  const manifest = validateManifest(envelope, {
    trustedKeys: signing.trustedKeys,
    now: signing.issuedAt,
  });
  const home = join(tmpdir(), `adrouter-rollback-${process.pid}-${Date.now()}`);
  const paths = releasePaths(manifest, home, 'linux', { xdgDataHome: join(home, 'data') });
  try {
    await mkdir(paths.appPath, { recursive: true });
    await mkdir(paths.rollbackPath, { recursive: true });
    await mkdir(paths.supportDirectory, { recursive: true });
    await writeFile(join(paths.appPath, 'new.txt'), 'new');
    await writeFile(join(paths.rollbackPath, 'old.txt'), 'old');
    const previousReceipt = {
      schema: 3,
      owner: '@adrouter/agent',
      applicationPath: paths.appPath,
      releaseVersion: '0.1.0-beta.12',
    };
    await writeFile(
      paths.receiptPath,
      JSON.stringify({ ...previousReceipt, releaseVersion: '0.1.0-beta.16' })
    );
    await writeFile(
      paths.pendingPath,
      JSON.stringify({
        schema: 1,
        applicationPath: paths.appPath,
        rollbackPath: paths.rollbackPath,
        markerPath: paths.markerPath,
        targetVersion: '0.1.0-beta.16',
        deadlineAt: '2026-08-02T00:01:00.000Z',
        token: 'a'.repeat(43),
        previousReceipt,
      })
    );
    const result = await reconcilePendingActivation(manifest, {
      platform: 'linux',
      arch: 'x64',
      homeDirectory: home,
      xdgDataHome: join(home, 'data'),
      now: new Date('2026-08-02T00:02:00.000Z'),
      executeImpl: async () => ({ stdout: '' }),
    });
    assert.equal(result.state, 'rolled-back');
    assert.equal(await readFile(join(paths.appPath, 'old.txt'), 'utf8'), 'old');
    assert.equal(
      JSON.parse(await readFile(paths.receiptPath, 'utf8')).releaseVersion,
      '0.1.0-beta.12'
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('matching healthy-start marker commits the staged installation', async () => {
  const { envelope, signing } = createEnvelope();
  const manifest = validateManifest(envelope, {
    trustedKeys: signing.trustedKeys,
    now: signing.issuedAt,
  });
  const home = join(tmpdir(), `adrouter-healthy-${process.pid}-${Date.now()}`);
  const paths = releasePaths(manifest, home, 'linux', { xdgDataHome: join(home, 'data') });
  try {
    await mkdir(paths.appPath, { recursive: true });
    await mkdir(paths.rollbackPath, { recursive: true });
    await mkdir(paths.supportDirectory, { recursive: true });
    await writeFile(join(paths.appPath, 'new.txt'), 'new');
    await writeFile(join(paths.rollbackPath, 'old.txt'), 'old');
    const pending = {
      schema: 1,
      applicationPath: paths.appPath,
      rollbackPath: paths.rollbackPath,
      markerPath: paths.markerPath,
      targetVersion: manifest.releaseVersion,
      deadlineAt: '2026-08-02T00:02:00.000Z',
      token: 'b'.repeat(43),
      previousReceipt: { schema: 3, owner: '@adrouter/agent' },
    };
    await writeFile(paths.pendingPath, JSON.stringify(pending));
    await writeFile(
      paths.markerPath,
      JSON.stringify({
        schema: 1,
        protocol: 1,
        releaseVersion: manifest.releaseVersion,
        token: pending.token,
      })
    );
    const result = await reconcilePendingActivation(manifest, {
      platform: 'linux',
      arch: 'x64',
      homeDirectory: home,
      xdgDataHome: join(home, 'data'),
      now: new Date('2026-08-02T00:01:00.000Z'),
    });
    assert.equal(result.state, 'healthy');
    assert.equal(await readFile(join(paths.appPath, 'new.txt'), 'utf8'), 'new');
    await assert.rejects(readFile(join(paths.rollbackPath, 'old.txt')), /ENOENT/);
    await assert.rejects(readFile(paths.pendingPath), /ENOENT/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
