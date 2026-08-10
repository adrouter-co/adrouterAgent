import { spawnSync } from 'node:child_process';
import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RELEASE_ARTIFACTS,
  releaseManifestSigningBytes,
  trustedReleaseKeyId,
  validateManifest,
} from '../packages/agent-launcher/lib/manifest.mjs';
import { TRUSTED_RELEASE_KEYS } from '../packages/agent-launcher/lib/trusted-release-keys.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const launcherDirectory = join(root, 'packages', 'agent-launcher');

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed:\n${result.stdout ?? ''}${result.stderr ?? ''}`
    );
  }
  return result.stdout;
}

function runNpm(args, options = {}) {
  const npmExecPath = process.env.npm_execpath;
  return npmExecPath
    ? run(process.execPath, [npmExecPath, ...args], options)
    : run(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, options);
}

const releaseTargetMetadata = (credentialFreeBeta = false) =>
  Object.entries(RELEASE_ARTIFACTS).map(([key, value]) => ({
    key,
    platform: value.platform,
    architectures: [...value.architectures],
    archiveRoot: value.archiveRoot,
    executablePath: value.executablePath,
    verificationMode: credentialFreeBeta
      ? (value.legacyVerificationMode ?? value.verificationMode)
      : value.verificationMode,
  }));

export const targetMetadata = releaseTargetMetadata();

const releaseSigningConfiguration = (overrides = {}) => {
  const keyFile = process.env.ADROUTER_RELEASE_SIGNING_KEY_FILE;
  return {
    privateKey:
      overrides.privateKey ?? (keyFile ? readFileSync(resolve(keyFile), 'utf8') : undefined),
    keyId: overrides.keyId ?? process.env.ADROUTER_RELEASE_KEY_ID,
    issuedAt: overrides.issuedAt ?? process.env.ADROUTER_MANIFEST_ISSUED_AT,
    expiresAt: overrides.expiresAt ?? process.env.ADROUTER_MANIFEST_EXPIRES_AT,
    channel: overrides.channel ?? process.env.ADROUTER_RELEASE_CHANNEL,
    minimumAgentVersion:
      overrides.minimumAgentVersion ?? process.env.ADROUTER_MINIMUM_AGENT_VERSION,
    macTeamIdentifier: overrides.macTeamIdentifier ?? process.env.ADROUTER_MAC_TEAM_IDENTIFIER,
    windowsSignerSubject:
      overrides.windowsSignerSubject ?? process.env.ADROUTER_WINDOWS_SIGNER_SUBJECT,
    trustedKeys: overrides.trustedKeys ?? TRUSTED_RELEASE_KEYS,
  };
};

const createReleaseEnvelope = (payload, signingOverrides) => {
  const configuration = releaseSigningConfiguration(signingOverrides);
  for (const field of [
    'privateKey',
    'keyId',
    'issuedAt',
    'expiresAt',
    'minimumAgentVersion',
    'macTeamIdentifier',
    'windowsSignerSubject',
  ]) {
    if (!configuration[field]) {
      throw new Error(`Protected release signing requires ${field}.`);
    }
  }
  const privateKey =
    configuration.privateKey?.type === 'private'
      ? configuration.privateKey
      : createPrivateKey(configuration.privateKey);
  const publicJwk = createPublicKey(privateKey).export({ format: 'jwk' });
  const derivedKeyId = trustedReleaseKeyId(publicJwk);
  if (configuration.keyId && configuration.keyId !== derivedKeyId) {
    throw new Error('The configured release key ID does not match the signing key.');
  }
  const channel =
    configuration.channel ?? (payload.releaseVersion.includes('-') ? 'beta' : 'stable');
  const signed = {
    ...payload,
    channel,
    minimumAgentVersion: configuration.minimumAgentVersion,
    issuedAt: configuration.issuedAt,
    expiresAt: configuration.expiresAt,
    health: {
      deadlineSeconds: 120,
      markerProtocol: 1,
      rollbackRequired: true,
    },
    artifacts: payload.artifacts.map((artifact) => ({
      ...artifact,
      signature:
        artifact.platform === 'darwin'
          ? {
              type: 'developer-id',
              required: true,
              expectedSigner: configuration.macTeamIdentifier,
            }
          : artifact.platform === 'win32'
            ? {
                type: 'authenticode',
                required: true,
                expectedSigner: configuration.windowsSignerSubject,
              }
            : { type: 'none', required: false, expectedSigner: null },
    })),
  };
  const envelope = {
    schema: 4,
    signed,
    signatures: [
      {
        keyId: derivedKeyId,
        algorithm: 'Ed25519',
        signature: sign(null, releaseManifestSigningBytes(signed), privateKey).toString('base64'),
      },
    ],
  };
  validateManifest(envelope, {
    trustedKeys: configuration.trustedKeys,
    now: configuration.issuedAt,
  });
  return envelope;
};

export function buildLauncherPackage({
  artifacts,
  outputDirectory,
  stagingRoot,
  signing,
  credentialFreeBeta = false,
} = {}) {
  const rootPackage = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const launcherPackage = JSON.parse(readFileSync(join(launcherDirectory, 'package.json'), 'utf8'));
  const version = rootPackage.version;
  if (launcherPackage.version !== version || !/^\d+\.\d+\.\d+(?:-beta\.\d+)?$/.test(version)) {
    throw new Error('Root and launcher versions must match the supported release version.');
  }
  if (credentialFreeBeta && !/-beta\.\d+$/.test(version)) {
    throw new Error('Credential-free release packaging is restricted to beta versions.');
  }

  const selectedTargetMetadata = releaseTargetMetadata(credentialFreeBeta);
  if (!Array.isArray(artifacts) || artifacts.length !== selectedTargetMetadata.length) {
    throw new Error('All three platform release ZIP files are required.');
  }
  const archives = selectedTargetMetadata.map((target) => {
    const input = artifacts.find((artifact) => artifact.key === target.key);
    const archive = resolve(input?.zipPath ?? '');
    if (!input?.zipPath || !statSync(archive).isFile()) {
      throw new Error(`A release ZIP file is required for ${target.key}.`);
    }
    return { ...target, archive };
  });
  const output = resolve(outputDirectory ?? join(root, 'out', 'release'));
  mkdirSync(output, { recursive: true });
  const ownedStaging = !stagingRoot;
  const staging = stagingRoot
    ? resolve(stagingRoot)
    : mkdtempSync(join(tmpdir(), 'adrouter-launcher-package-'));
  const packageDirectory = join(staging, 'package');

  try {
    rmSync(packageDirectory, { recursive: true, force: true });
    mkdirSync(packageDirectory, { recursive: true });
    for (const entry of ['bin', 'lib', 'README.md', 'package.json']) {
      cpSync(join(launcherDirectory, entry), join(packageDirectory, entry), { recursive: true });
    }
    cpSync(join(root, 'LICENSE'), join(packageDirectory, 'LICENSE'));
    const releaseArtifacts = archives.map(({ archive, ...target }) => {
      const assetName = `AdRouter-Agent-${version}-${target.key}.zip`;
      if (basename(archive) !== assetName) {
        throw new Error(`Release ZIP for ${target.key} must be named ${assetName}.`);
      }
      const artifact = {
        ...target,
        assetName,
        assetUrl: `https://github.com/adrouter/adrouterAgent/releases/download/v${version}/${assetName}`,
        sha256: sha256(archive),
      };
      return credentialFreeBeta ? artifact : { ...artifact, bytes: statSync(archive).size };
    });
    const releaseIdentity = {
      releaseVersion: version,
      releaseTag: `v${version}`,
      repository: 'adrouter/adrouterAgent',
      bundleIdentifier: 'com.adrouter.agent',
      bundleShortVersion: '0.1.0',
      bundleVersion: '10017',
      authentication: {
        fixture: 'tests/fixtures/platform-auth-v1.json',
        fixtureSha256: '93a8ec8d4eba38f9165179aa0cdfe3316f8134a882bd0426bd83339af55d17f8',
        acceptanceAsset: 'authentication-acceptance.json',
      },
      artifacts: releaseArtifacts,
    };
    const releaseManifest = credentialFreeBeta
      ? {
          schema: 3,
          distributionMode: 'credential-free-portable',
          ...releaseIdentity,
        }
      : createReleaseEnvelope(
          { distributionMode: 'signed-release-metadata', ...releaseIdentity },
          signing
        );
    validateManifest(
      releaseManifest,
      credentialFreeBeta ? undefined : { trustedKeys: signing?.trustedKeys }
    );
    writeFileSync(
      join(packageDirectory, 'release-manifest.json'),
      `${JSON.stringify(releaseManifest, null, 2)}\n`
    );
    const packedJson = runNpm(
      ['pack', '--ignore-scripts', '--json', '--pack-destination', output],
      { cwd: packageDirectory }
    );
    const packed = JSON.parse(packedJson)[0];
    if (!packed?.filename) throw new Error('npm pack did not report a tarball filename.');
    const tarball = join(output, packed.filename);
    return {
      tarball,
      manifest: releaseManifest,
      packageSize: packed.size,
      unpackedSize: packed.unpackedSize,
      files: packed.files.map((file) => file.path),
    };
  } finally {
    if (ownedStaging) rmSync(staging, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const outputIndex = process.argv.indexOf('--output');
  const artifacts = targetMetadata.map((target) => {
    const argumentIndex = process.argv.indexOf(`--${target.key}`);
    return {
      key: target.key,
      zipPath: argumentIndex >= 0 ? process.argv[argumentIndex + 1] : undefined,
    };
  });
  const result = buildLauncherPackage({
    artifacts,
    outputDirectory: outputIndex >= 0 ? process.argv[outputIndex + 1] : undefined,
    signing: {},
    credentialFreeBeta: process.env.ADROUTER_CREDENTIAL_FREE_BETA === '1',
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
