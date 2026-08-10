import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const brokerRoot = join(repositoryRoot, 'native', 'workspace-broker');
const nodeGyp = join(repositoryRoot, 'node_modules', 'node-gyp', 'bin', 'node-gyp.js');
const output = join(brokerRoot, 'build', 'Release', 'adrouter_workspace_broker.node');

if (!existsSync(nodeGyp)) {
  throw new Error('The pinned node-gyp entrypoint is unavailable. Run npm ci with the lockfile.');
}

const runBuild = (arch) => {
  execFileSync(
    process.execPath,
    [nodeGyp, 'rebuild', '--directory', brokerRoot, `--arch=${arch}`],
    {
      cwd: repositoryRoot,
      stdio: 'inherit',
    }
  );
  if (!existsSync(output)) throw new Error(`Workspace broker build did not produce ${output}.`);
};

if (process.platform === 'darwin') {
  const slices = mkdtempSync(join(tmpdir(), 'adrouter-workspace-broker-'));
  const arm64 = join(slices, 'adrouter_workspace_broker-arm64.node');
  const x64 = join(slices, 'adrouter_workspace_broker-x64.node');
  try {
    runBuild('arm64');
    copyFileSync(output, arm64);
    runBuild('x64');
    copyFileSync(output, x64);
    execFileSync('lipo', ['-create', arm64, x64, '-output', output], { stdio: 'inherit' });
  } finally {
    rmSync(slices, { recursive: true, force: true });
  }
} else {
  runBuild(process.arch);
}

process.stdout.write(
  `Built descriptor-bound workspace broker for ${process.platform}-${process.arch}.\n`
);
