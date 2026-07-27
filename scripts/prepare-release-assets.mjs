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
if (
  !version ||
  version !== packageJson.version ||
  !/^\d+\.\d+\.\d+(?:-beta\.\d+)?$/.test(version)
) {
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
const targets = [
  { key: 'darwin-universal', pattern: /darwin.*universal|universal.*darwin/i },
  { key: 'linux-x64', pattern: /linux.*x64|x64.*linux/i },
  { key: 'win32-x64', pattern: /win32.*x64|x64.*win32/i },
];
const selected = targets.map((target) => {
  const matches = zips.filter((file) => target.pattern.test(file));
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one ${target.key} ZIP; found ${matches.length}.`);
  }
  return { ...target, source: matches[0] };
});

rmSync(releaseDirectory, { recursive: true, force: true });
mkdirSync(releaseDirectory, { recursive: true });

const artifacts = selected.map((target) => ({
  key: target.key,
  source: target.source,
  destination: join(releaseDirectory, `AdRouter-Agent-${version}-${target.key}.zip`),
}));
for (const { source, destination } of artifacts) copyFileSync(source, destination);

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
const appSboms = artifacts.map((artifact) => {
  const destination = join(releaseDirectory, `AdRouter-Agent-${version}-${artifact.key}.cdx.json`);
  writeFileSync(destination, sbom);
  return destination;
});

const launcher = buildLauncherPackage({
  artifacts: artifacts.map((artifact) => ({ key: artifact.key, zipPath: artifact.destination })),
  outputDirectory: releaseDirectory,
});
const npmSbom = execFileSync(
  'npm',
  ['sbom', '--workspace', '@adrouter/agent', '--sbom-format=cyclonedx', '--sbom-type=application'],
  { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
);
JSON.parse(npmSbom);
const launcherSbom = join(releaseDirectory, `AdRouter-Agent-${version}-npm.cdx.json`);
writeFileSync(launcherSbom, npmSbom);

const releaseFiles = [
  ...artifacts.map((artifact) => artifact.destination),
  ...appSboms,
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
      schema: 3,
      distributionMode: 'credential-free-portable',
      repository: 'adrouter/adrouterAgent',
      sourceCommit: process.env.GITHUB_SHA ?? null,
      releaseVersion: version,
      releaseTag: `v${version}`,
      bundleShortVersion: '0.1.0',
      bundleVersion: '10009',
      launcherManifest: launcher.manifest,
      files: records,
    },
    null,
    2
  )}\n`
);

console.log(`Prepared ${records.length} checksummed release artifacts in ${releaseDirectory}.`);
