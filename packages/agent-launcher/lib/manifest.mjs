import { readFile } from 'node:fs/promises';

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-beta\.\d+)?$/;
const ARTIFACTS = Object.freeze({
  'darwin-universal': {
    platform: 'darwin',
    architectures: ['arm64', 'x64'],
    archiveRoot: 'AdRouter Agent.app',
    executablePath: 'Contents/MacOS/AdRouter Agent',
    verificationMode: 'macos-adhoc',
    suffix: 'darwin-universal',
  },
  'linux-x64': {
    platform: 'linux',
    architectures: ['x64'],
    archiveRoot: 'AdRouter Agent-linux-x64',
    executablePath: 'AdRouter Agent',
    verificationMode: 'portable-checksum',
    suffix: 'linux-x64',
  },
  'win32-x64': {
    platform: 'win32',
    architectures: ['x64'],
    archiveRoot: '.',
    executablePath: 'AdRouter Agent.exe',
    verificationMode: 'portable-checksum',
    suffix: 'win32-x64',
  },
});

export function artifactKey(platform = process.platform, arch = process.arch) {
  if (platform === 'darwin' && (arch === 'arm64' || arch === 'x64')) {
    return 'darwin-universal';
  }
  if (platform === 'linux' && arch === 'x64') return 'linux-x64';
  if (platform === 'win32' && arch === 'x64') return 'win32-x64';
  throw new Error(`Unsupported operating system/architecture combination: ${platform}/${arch}.`);
}

export function selectArtifact(manifest, platform = process.platform, arch = process.arch) {
  const key = artifactKey(platform, arch);
  const artifact = manifest.artifacts.find((candidate) => candidate.key === key);
  if (!artifact) throw new Error(`The release manifest does not contain ${key}.`);
  return artifact;
}

export function validateManifest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The embedded release manifest is not an object.');
  }
  for (const key of [
    'releaseVersion',
    'releaseTag',
    'repository',
    'distributionMode',
    'bundleIdentifier',
    'bundleShortVersion',
    'bundleVersion',
  ]) {
    if (typeof value[key] !== 'string' || value[key].length === 0) {
      throw new Error(`The embedded release manifest has an invalid ${key}.`);
    }
  }
  if (value.schema !== 3) throw new Error('Unsupported release manifest schema.');
  if (value.distributionMode !== 'credential-free-portable') {
    throw new Error('The embedded release distribution mode is not supported.');
  }
  if (!VERSION_PATTERN.test(value.releaseVersion)) {
    throw new Error('The embedded release version is not a supported SemVer.');
  }
  if (value.releaseTag !== `v${value.releaseVersion}`) {
    throw new Error('The embedded release tag does not match the version.');
  }
  if (value.repository !== 'adrouter/adrouterAgent') {
    throw new Error('The embedded repository is not canonical.');
  }
  if (value.bundleIdentifier !== 'com.adrouter.agent') {
    throw new Error('The embedded bundle identifier is not canonical.');
  }
  if (!/^\d+\.\d+\.\d+$/.test(value.bundleShortVersion)) {
    throw new Error('The embedded short bundle version is invalid.');
  }
  if (!/^\d+(?:\.\d+){0,2}$/.test(value.bundleVersion)) {
    throw new Error('The embedded numeric bundle version is invalid.');
  }
  if (
    value.authentication?.fixture !== 'tests/fixtures/platform-auth-v1.json' ||
    value.authentication?.fixtureSha256 !==
      '93a8ec8d4eba38f9165179aa0cdfe3316f8134a882bd0426bd83339af55d17f8' ||
    value.authentication?.acceptanceAsset !== 'authentication-acceptance.json'
  ) {
    throw new Error('The embedded platform authentication metadata is not canonical.');
  }
  if (!Array.isArray(value.artifacts) || value.artifacts.length !== 3) {
    throw new Error('The embedded release manifest must contain exactly three artifacts.');
  }
  const seen = new Set();
  for (const artifact of value.artifacts) {
    const expected = ARTIFACTS[artifact?.key];
    if (!expected || seen.has(artifact.key)) {
      throw new Error(
        `The embedded release manifest has an invalid artifact key: ${artifact?.key}.`
      );
    }
    seen.add(artifact.key);
    for (const field of [
      'platform',
      'assetName',
      'assetUrl',
      'sha256',
      'archiveRoot',
      'executablePath',
      'verificationMode',
    ]) {
      if (typeof artifact[field] !== 'string' || artifact[field].length === 0) {
        throw new Error(`Artifact ${artifact.key} has an invalid ${field}.`);
      }
    }
    if (
      artifact.platform !== expected.platform ||
      JSON.stringify(artifact.architectures) !== JSON.stringify(expected.architectures) ||
      artifact.archiveRoot !== expected.archiveRoot ||
      artifact.executablePath !== expected.executablePath ||
      artifact.verificationMode !== expected.verificationMode
    ) {
      throw new Error(`Artifact ${artifact.key} does not match its canonical target metadata.`);
    }
    const expectedName = `AdRouter-Agent-${value.releaseVersion}-${expected.suffix}.zip`;
    if (artifact.assetName !== expectedName) {
      throw new Error(`Artifact ${artifact.key} has a non-canonical asset name.`);
    }
    const expectedUrl =
      `https://github.com/${value.repository}/releases/download/` +
      `${value.releaseTag}/${expectedName}`;
    if (artifact.assetUrl !== expectedUrl) {
      throw new Error(`Artifact ${artifact.key} has a non-canonical asset URL.`);
    }
    if (!SHA256_PATTERN.test(artifact.sha256)) {
      throw new Error(`Artifact ${artifact.key} checksum is not a SHA-256 digest.`);
    }
  }
  return Object.freeze({
    ...value,
    authentication: Object.freeze({ ...value.authentication }),
    artifacts: Object.freeze(value.artifacts.map((artifact) => Object.freeze({ ...artifact }))),
  });
}

export async function readManifest(url = new URL('../release-manifest.json', import.meta.url)) {
  const text = await readFile(url, 'utf8');
  return validateManifest(JSON.parse(text));
}
