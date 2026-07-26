import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const asar = require('@electron/asar');
const out = resolve('out');

if (!existsSync(out)) {
  throw new Error('No Forge output found. Run npm run make:mac first.');
}

const makeDirectory = join(out, 'make');
const entries = existsSync(makeDirectory)
  ? readdirSync(makeDirectory, { recursive: true }).map(String)
  : [];
const apps = readdirSync(out, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name.endsWith('-darwin-universal'))
  .map((entry) => join(entry.name, 'AdRouter Agent.app'))
  .filter((entry) => existsSync(join(out, entry)));
const zips = entries.filter((entry) => entry.endsWith('.zip'));

if (apps.length !== 1 || zips.length !== 1) {
  throw new Error('Expected one universal macOS .app and exactly one ZIP in the Forge output.');
}

for (const app of apps) {
  const appPath = join(out, app);
  const binaryPath = join(appPath, 'Contents', 'MacOS', 'AdRouter Agent');
  const resourcesPath = join(appPath, 'Contents', 'Resources');
  const asarPath = join(resourcesPath, 'app.asar');
  const infoPath = join(appPath, 'Contents', 'Info.plist');
  const architectures = execFileSync('lipo', ['-archs', binaryPath], { encoding: 'utf8' });
  if (!architectures.includes('arm64') || !architectures.includes('x86_64')) {
    throw new Error(`Expected an arm64+x64 executable, received: ${architectures.trim()}`);
  }

  execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'inherit' });
  const signatureResult = spawnSync('codesign', ['-dv', '--verbose=4', appPath], {
    encoding: 'utf8',
  });
  if (signatureResult.status !== 0) {
    throw new Error(`Unable to inspect app signature: ${signatureResult.stderr}`);
  }
  const signature = `${signatureResult.stdout}${signatureResult.stderr}`;
  if (!signature.includes('Signature=adhoc') || !signature.includes('TeamIdentifier=not set')) {
    throw new Error('Expected a credential-free ad-hoc signature with no Apple Team Identifier.');
  }

  const info = JSON.parse(
    execFileSync('plutil', ['-convert', 'json', '-o', '-', infoPath], { encoding: 'utf8' })
  );
  if (
    info.CFBundleIdentifier !== 'com.adrouter.agent' ||
    info.CFBundleShortVersionString !== '0.1.0' ||
    info.CFBundleVersion !== '10001' ||
    info.NSAppTransportSecurity?.NSAllowsArbitraryLoads !== false ||
    info.NSAppTransportSecurity?.NSAllowsLocalNetworking !== true
  ) {
    throw new Error(
      'The packaged bundle identity, numeric versions, or transport-security policy is incorrect.'
    );
  }
  for (const key of [
    'NSAudioCaptureUsageDescription',
    'NSBluetoothAlwaysUsageDescription',
    'NSBluetoothPeripheralUsageDescription',
    'NSCameraUsageDescription',
    'NSMicrophoneUsageDescription',
  ]) {
    if (key in info) throw new Error(`Unexpected unused permission declaration: ${key}`);
  }
  for (const resource of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'PRIVACY.md']) {
    if (!existsSync(join(resourcesPath, resource))) {
      throw new Error(`Missing packaged legal resource: ${resource}`);
    }
  }
  const packagedFiles = asar.listPackage(asarPath);
  if (
    packagedFiles.some(
      (filename) =>
        filename.endsWith('.map') ||
        /(^|\/)(?:tests?|playwright-report|test-results)(\/|$)/.test(filename)
    )
  ) {
    throw new Error('The packaged application contains source maps or test artifacts.');
  }
  const textFiles = packagedFiles.filter((filename) => /\.(?:css|html|js|json)$/.test(filename));
  const packagedText = textFiles
    .map((filename) => asar.extractFile(asarPath, filename.slice(1)).toString('utf8'))
    .join('\n');
  for (const forbidden of [
    ['', 'Users', ''].join('/'),
    'ADROUTER_E2E_BUILD',
    ['BEGIN', 'PRIVATE', 'KEY'].join(' '),
  ]) {
    if (packagedText.includes(forbidden)) {
      throw new Error(`The packaged application contains forbidden content: ${forbidden}`);
    }
  }
  if (!packagedText.includes('0.1.0-beta.1')) {
    throw new Error('The packaged About metadata does not include the public release version.');
  }

  const fuseOutput = execFileSync(
    resolve('node_modules', '.bin', 'electron-fuses'),
    ['read', '--app', appPath],
    { encoding: 'utf8' }
  );
  for (const expected of [
    'RunAsNode is Disabled',
    'EnableNodeOptionsEnvironmentVariable is Disabled',
    'EnableNodeCliInspectArguments is Disabled',
    'EnableEmbeddedAsarIntegrityValidation is Enabled',
    'GrantFileProtocolExtraPrivileges is Disabled',
  ]) {
    if (!fuseOutput.includes(expected))
      throw new Error(`Unexpected Electron fuse state: ${expected}`);
  }
}

console.log(`Verified ${apps.length} credential-free ad-hoc app(s) and ${zips.length} ZIP(s).`);
