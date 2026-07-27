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

function runNpm(args, options = {}) {
  const npmExecPath = process.env.npm_execpath;
  return npmExecPath
    ? run(process.execPath, [npmExecPath, ...args], options)
    : run(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, options);
}

const targetMetadata = [
  {
    key: 'darwin-universal',
    platform: 'darwin',
    architectures: ['arm64', 'x64'],
    archiveRoot: 'AdRouter Agent.app',
    executablePath: 'Contents/MacOS/AdRouter Agent',
    verificationMode: 'macos-adhoc',
  },
  {
    key: 'linux-x64',
    platform: 'linux',
    architectures: ['x64'],
    archiveRoot: 'AdRouter Agent-linux-x64',
    executablePath: 'AdRouter Agent',
    verificationMode: 'portable-checksum',
  },
  {
    key: 'win32-x64',
    platform: 'win32',
    architectures: ['x64'],
    archiveRoot: '.',
    executablePath: 'AdRouter Agent.exe',
    verificationMode: 'portable-checksum',
  },
];

export function buildLauncherPackage({ artifacts, outputDirectory, stagingRoot } = {}) {
  const rootPackage = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const launcherPackage = JSON.parse(readFileSync(join(launcherDirectory, 'package.json'), 'utf8'));
  const version = rootPackage.version;
  if (launcherPackage.version !== version || !/^\d+\.\d+\.\d+(?:-beta\.\d+)?$/.test(version)) {
    throw new Error('Root and launcher versions must match the supported release version.');
  }

  if (!Array.isArray(artifacts) || artifacts.length !== targetMetadata.length) {
    throw new Error('All three platform release ZIP files are required.');
  }
  const archives = targetMetadata.map((target) => {
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
      return {
        ...target,
        assetName,
        assetUrl: `https://github.com/adrouter/adrouterAgent/releases/download/v${version}/${assetName}`,
        sha256: sha256(archive),
      };
    });
    const releaseManifest = {
      schema: 3,
      distributionMode: 'credential-free-portable',
      releaseVersion: version,
      releaseTag: `v${version}`,
      repository: 'adrouter/adrouterAgent',
      bundleIdentifier: 'com.adrouter.agent',
      bundleShortVersion: '0.1.0',
      bundleVersion: '10009',
      authentication: {
        fixture: 'tests/fixtures/platform-auth-v1.json',
        fixtureSha256: '93a8ec8d4eba38f9165179aa0cdfe3316f8134a882bd0426bd83339af55d17f8',
        acceptanceAsset: 'authentication-acceptance.json',
      },
      artifacts: releaseArtifacts,
    };
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
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
