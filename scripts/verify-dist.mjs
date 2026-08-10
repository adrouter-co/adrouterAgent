import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { verifyPackagedStagingDefault } from './verify-packaged-default.mjs';

const require = createRequire(import.meta.url);
const asar = require('@electron/asar');
const packageJson = require('../package.json');
const out = resolve('out');
const requireProtectedSignature = process.env.ADROUTER_REQUIRE_PLATFORM_SIGNATURE === '1';

if (!existsSync(out)) {
  throw new Error('No Forge output found. Run npm run make:mac first.');
}

const makeDirectory = join(out, 'make');
const macZipDirectory = join(makeDirectory, 'zip', 'darwin', 'universal');
const entries = existsSync(macZipDirectory)
  ? readdirSync(macZipDirectory, { recursive: true }).map(String)
  : [];
const apps = readdirSync(out, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name.endsWith('-darwin-universal'))
  .map((entry) => join(entry.name, 'AdRouter Agent.app'))
  .filter((entry) => existsSync(join(out, entry)));
const expectedZipName = `AdRouter Agent-darwin-universal-${packageJson.version}.zip`;
const zips = entries.filter((entry) => entry.endsWith(expectedZipName));

if (apps.length !== 1 || zips.length !== 1) {
  throw new Error(
    `Expected one universal macOS .app and exactly one ${expectedZipName} in the Forge output.`
  );
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
  if (requireProtectedSignature) {
    const teamIdentifier = process.env.ADROUTER_APPLE_TEAM_IDENTIFIER;
    if (
      !teamIdentifier ||
      !signature.includes('Authority=Developer ID Application:') ||
      !signature.includes(`TeamIdentifier=${teamIdentifier}`)
    ) {
      throw new Error('Expected the protected Developer ID signer and team identifier.');
    }
    execFileSync('spctl', ['--assess', '--type', 'execute', appPath], { stdio: 'inherit' });
    execFileSync('xcrun', ['stapler', 'validate', appPath], { stdio: 'inherit' });
  } else if (
    !signature.includes('Signature=adhoc') ||
    !signature.includes('TeamIdentifier=not set')
  ) {
    throw new Error('Expected a credential-free ad-hoc signature with no Apple Team Identifier.');
  }

  const info = JSON.parse(
    execFileSync('plutil', ['-convert', 'json', '-o', '-', infoPath], { encoding: 'utf8' })
  );
  if (
    info.CFBundleIdentifier !== 'com.adrouter.agent' ||
    info.CFBundleShortVersionString !== '0.1.0' ||
    info.CFBundleVersion !== '10017' ||
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
  const brokerPath = join(
    resourcesPath,
    'vendor',
    'workspace-broker',
    'darwin-universal',
    'adrouter_workspace_broker.node'
  );
  if (!existsSync(brokerPath)) {
    throw new Error('Missing descriptor-bound universal macOS workspace broker.');
  }
  const brokerArchitectures = execFileSync('lipo', ['-archs', brokerPath], {
    encoding: 'utf8',
  });
  if (!brokerArchitectures.includes('arm64') || !brokerArchitectures.includes('x86_64')) {
    throw new Error(`Workspace broker has unexpected architectures: ${brokerArchitectures.trim()}`);
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
  if (!packagedText.includes('0.1.0-beta.17')) {
    throw new Error('The packaged About metadata does not include the public release version.');
  }
  verifyPackagedStagingDefault(packagedFiles, (filename) =>
    asar.extractFile(asarPath, filename.slice(1)).toString('utf8')
  );

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

console.log(
  `Verified ${apps.length} ${requireProtectedSignature ? 'Developer ID/notarized' : 'credential-free ad-hoc'} app(s) and ${zips.length} ZIP(s).`
);
