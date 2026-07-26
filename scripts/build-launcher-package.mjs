import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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

export function buildLauncherPackage({ zipPath, outputDirectory, stagingRoot } = {}) {
  const rootPackage = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const launcherPackage = JSON.parse(readFileSync(join(launcherDirectory, 'package.json'), 'utf8'));
  const version = rootPackage.version;
  if (launcherPackage.version !== version || !/^\d+\.\d+\.\d+-beta\.\d+$/.test(version)) {
    throw new Error('Root and launcher versions must match the beta release version.');
  }

  const archive = resolve(zipPath ?? '');
  if (!zipPath || !statSync(archive).isFile()) throw new Error('A release ZIP file is required.');
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
    const assetName = `AdRouter-Agent-${version}-universal.zip`;
    if (basename(archive) !== assetName) {
      throw new Error(`Release ZIP must be named ${assetName}.`);
    }
    const releaseManifest = {
      schema: 2,
      distributionMode: 'credential-free-adhoc',
      releaseVersion: version,
      releaseTag: `v${version}`,
      assetName,
      assetUrl: `https://github.com/adrouter/adrouterAgent/releases/download/v${version}/${assetName}`,
      sha256: sha256(archive),
      repository: 'adrouter/adrouterAgent',
      bundleIdentifier: 'com.adrouter.agent',
      bundleShortVersion: '0.1.0',
      bundleVersion: '10002',
    };
    writeFileSync(
      join(packageDirectory, 'release-manifest.json'),
      `${JSON.stringify(releaseManifest, null, 2)}\n`
    );
    const packedJson = run(
      'npm',
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
  const zipIndex = process.argv.indexOf('--zip');
  const outputIndex = process.argv.indexOf('--output');
  const result = buildLauncherPackage({
    zipPath: zipIndex >= 0 ? process.argv[zipIndex + 1] : undefined,
    outputDirectory: outputIndex >= 0 ? process.argv[outputIndex + 1] : undefined,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
