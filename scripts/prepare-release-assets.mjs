import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { buildLauncherPackage } from './build-launcher-package.mjs';

const version = process.argv[2];
const packageJson = JSON.parse(readFileSync(resolve('package.json'), 'utf8'));
if (!version || version !== packageJson.version || !/^\d+\.\d+\.\d+-beta\.\d+$/.test(version)) {
  throw new Error(
    `Release version must be semantic and match package.json (${packageJson.version}).`
  );
}

const walk = (directory) =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });

const makeDirectory = resolve('out', 'make');
const releaseDirectory = resolve('out', 'release');
const files = walk(makeDirectory);
const zips = files.filter((file) => file.endsWith('.zip'));
if (zips.length !== 1) {
  throw new Error(`Expected exactly one universal ZIP; found ${zips.length}.`);
}

rmSync(releaseDirectory, { recursive: true, force: true });
mkdirSync(releaseDirectory, { recursive: true });

const artifacts = [[zips[0], join(releaseDirectory, `AdRouter-Agent-${version}-universal.zip`)]];
for (const [source, destination] of artifacts) copyFileSync(source, destination);

const sbom = execFileSync(
  'npm',
  [
    'sbom',
    '--omit=dev',
    '--package-lock-only',
    '--sbom-format=cyclonedx',
    '--sbom-type=application',
  ],
  { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 }
);
JSON.parse(sbom);
const appSbom = join(releaseDirectory, `AdRouter-Agent-${version}.cdx.json`);
writeFileSync(appSbom, sbom);

const zip = artifacts.find(([, file]) => file.endsWith('.zip'))?.[1];
if (!zip) throw new Error('Unable to identify the canonical release ZIP.');
const launcher = buildLauncherPackage({ zipPath: zip, outputDirectory: releaseDirectory });
const npmSbom = execFileSync(
  'npm',
  ['sbom', '--workspace', '@adrouter/agent', '--sbom-format=cyclonedx', '--sbom-type=application'],
  { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
);
JSON.parse(npmSbom);
const launcherSbom = join(releaseDirectory, `AdRouter-Agent-${version}-npm.cdx.json`);
writeFileSync(launcherSbom, npmSbom);

const releaseFiles = [
  ...artifacts.map(([, file]) => file),
  appSbom,
  launcher.tarball,
  launcherSbom,
];
const records = releaseFiles.map((file) => ({
  name: basename(file),
  sha256: createHash('sha256').update(readFileSync(file)).digest('hex'),
  size: statSync(file).size,
}));
const checksums = records
  .map((record) => {
    return `${record.sha256}  ${record.name}`;
  })
  .join('\n');
writeFileSync(join(releaseDirectory, 'SHA256SUMS'), `${checksums}\n`);

writeFileSync(
  join(releaseDirectory, 'artifact-manifest.json'),
  `${JSON.stringify(
    {
      schema: 2,
      distributionMode: 'credential-free-adhoc',
      repository: 'adrouter/adrouterAgent',
      sourceCommit: process.env.GITHUB_SHA ?? null,
      releaseVersion: version,
      releaseTag: `v${version}`,
      bundleShortVersion: '0.1.0',
      bundleVersion: '10003',
      launcherManifest: launcher.manifest,
      files: records,
    },
    null,
    2
  )}\n`
);

console.log(`Prepared ${records.length} checksummed release artifacts in ${releaseDirectory}.`);
