import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { buildLauncherPackage } from './build-launcher-package.mjs';

const rootPackage = JSON.parse(readFileSync(resolve('package.json'), 'utf8'));
const launcher = JSON.parse(
  readFileSync(resolve('packages', 'agent-launcher', 'package.json'), 'utf8')
);
assert.equal(launcher.name, '@adrouter/agent');
assert.equal(launcher.version, rootPackage.version);
assert.equal(launcher.license, 'Apache-2.0');
assert.equal(launcher.engines.node, '>=22.19.0');
assert.deepEqual(launcher.os, ['darwin', 'linux', 'win32']);
assert.deepEqual(launcher.cpu, ['arm64', 'x64']);
assert.equal(launcher.private, undefined);
assert.equal(launcher.dependencies, undefined);
assert.equal(launcher.optionalDependencies, undefined);
assert.equal(launcher.scripts, undefined);
assert.equal(launcher.publishConfig.access, 'public');
assert.equal(launcher.publishConfig.provenance, true);

const temporary = mkdtempSync(join(tmpdir(), 'adrouter-launcher-check-'));
try {
  const artifacts = ['darwin-universal', 'linux-x64', 'win32-x64'].map((key) => {
    const zipPath = join(temporary, `AdRouter-Agent-${launcher.version}-${key}.zip`);
    writeFileSync(zipPath, `launcher-package-fixture-${key}\n`);
    return { key, zipPath };
  });
  const packed = buildLauncherPackage({
    artifacts,
    outputDirectory: temporary,
    stagingRoot: join(temporary, 'staging'),
  });
  const listing = execFileSync('tar', ['-tzf', packed.tarball], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    .sort();
  const required = [
    'package/LICENSE',
    'package/README.md',
    'package/bin/adrouter-agent.mjs',
    'package/lib/cli.mjs',
    'package/lib/installer.mjs',
    'package/lib/manifest.mjs',
    'package/package.json',
    'package/release-manifest.json',
  ].sort();
  assert.deepEqual(listing, required);
  assert.ok(packed.packageSize < 100 * 1024, 'launcher tarball must stay below 100 KiB');
  assert.equal(basename(packed.tarball), `adrouter-agent-${launcher.version}.tgz`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

console.log('Launcher package metadata and exact tarball allowlist passed.');
