import { readFile } from 'node:fs/promises';

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+-beta\.\d+$/;

export function validateManifest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The embedded release manifest is not an object.');
  }
  const requiredStrings = [
    'releaseVersion',
    'releaseTag',
    'assetName',
    'assetUrl',
    'sha256',
    'repository',
    'distributionMode',
    'bundleIdentifier',
    'bundleShortVersion',
    'bundleVersion',
  ];
  for (const key of requiredStrings) {
    if (typeof value[key] !== 'string' || value[key].length === 0) {
      throw new Error(`The embedded release manifest has an invalid ${key}.`);
    }
  }
  if (value.schema !== 2) throw new Error('Unsupported release manifest schema.');
  if (value.distributionMode !== 'credential-free-adhoc') {
    throw new Error('The embedded release distribution mode is not supported.');
  }
  if (!VERSION_PATTERN.test(value.releaseVersion)) {
    throw new Error('The embedded release version is not a beta SemVer.');
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
  if (value.assetName !== `AdRouter-Agent-${value.releaseVersion}-universal.zip`) {
    throw new Error('The embedded release asset name is not canonical.');
  }
  const expectedUrl =
    `https://github.com/${value.repository}/releases/download/` +
    `${value.releaseTag}/${value.assetName}`;
  if (value.assetUrl !== expectedUrl) {
    throw new Error('The embedded release asset URL is not canonical.');
  }
  if (!SHA256_PATTERN.test(value.sha256)) {
    throw new Error('The embedded release checksum is not a SHA-256 digest.');
  }
  if (!/^\d+\.\d+\.\d+$/.test(value.bundleShortVersion)) {
    throw new Error('The embedded short bundle version is invalid.');
  }
  if (!/^\d+(?:\.\d+){0,2}$/.test(value.bundleVersion)) {
    throw new Error('The embedded numeric bundle version is invalid.');
  }
  return Object.freeze({ ...value });
}

export async function readManifest(url = new URL('../release-manifest.json', import.meta.url)) {
  const text = await readFile(url, 'utf8');
  return validateManifest(JSON.parse(text));
}
