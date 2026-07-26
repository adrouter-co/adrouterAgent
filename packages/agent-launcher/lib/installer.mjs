import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  readlink,
  realpath,
  rename,
  rm,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join, posix, relative, sep } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const APP_NAME = 'AdRouter Agent.app';
const EXECUTABLE_NAME = 'AdRouter Agent';
const RECEIPT_OWNER = '@adrouter/agent';
const MAX_DOWNLOAD_BYTES = 512 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const GATEKEEPER_WARNING =
  'This credential-free beta is not Developer ID signed or notarized. If macOS blocks it, open System Settings > Privacy & Security and choose Open Anyway.';
const ALLOWED_HOSTS = new Set([
  'github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
]);

export function assertSupportedPlatform(platform = process.platform, arch = process.arch) {
  if (platform !== 'darwin') {
    throw new Error(`Unsupported platform ${platform}; AdRouter Agent requires macOS 12 or newer.`);
  }
  if (arch !== 'arm64' && arch !== 'x64') {
    throw new Error(`Unsupported macOS architecture ${arch}; expected arm64 or x64.`);
  }
}

export function assertSupportedMacOsVersion(version) {
  const major = Number.parseInt(String(version).split('.')[0] ?? '', 10);
  if (!Number.isSafeInteger(major) || major < 12) {
    throw new Error(`Unsupported macOS version ${version}; macOS 12 or newer is required.`);
  }
}

export function assertNonRoot(uid = process.getuid?.()) {
  if (uid === 0) {
    throw new Error('Do not run adrouter-agent with sudo; install it as the logged-in macOS user.');
  }
}

export function assertAllowedDownloadUrl(input) {
  const url = input instanceof URL ? input : new URL(input);
  if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname)) {
    throw new Error(`Refusing non-canonical download URL: ${url.origin}`);
  }
  if (url.username || url.password || url.port) {
    throw new Error('Refusing a download URL containing credentials or a non-default port.');
  }
  return url;
}

export function assertSafeArchiveEntries(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error('The release ZIP is empty.');
  }
  for (const entry of entries) {
    if (
      typeof entry !== 'string' ||
      entry.includes('\0') ||
      entry.startsWith('/') ||
      entry.startsWith('\\') ||
      entry.split(/[\\/]/).includes('..')
    ) {
      throw new Error(`Unsafe ZIP entry: ${JSON.stringify(entry)}`);
    }
    if (entry !== APP_NAME && !entry.startsWith(`${APP_NAME}/`)) {
      throw new Error(`Unexpected ZIP layout entry: ${entry}`);
    }
  }
}

export function assertSafeArchiveSymlink(entry, target) {
  assertSafeArchiveEntries([entry]);
  if (
    typeof target !== 'string' ||
    target.length === 0 ||
    target.includes('\0') ||
    target.startsWith('/') ||
    target.startsWith('\\') ||
    target.includes('\\')
  ) {
    throw new Error(`Unsafe ZIP symbolic link target: ${JSON.stringify(target)}`);
  }
  const resolved = posix.resolve('/', posix.dirname(entry), target);
  const appRoot = `/${APP_NAME}`;
  if (resolved !== appRoot && !resolved.startsWith(`${appRoot}/`)) {
    throw new Error(`ZIP symbolic link escapes ${APP_NAME}: ${entry} -> ${target}`);
  }
}

export function releasePaths(_manifest, homeDirectory = homedir()) {
  const applicationsDirectory = join(homeDirectory, 'Applications');
  const supportDirectory = join(
    homeDirectory,
    'Library',
    'Application Support',
    'adrouter-agent-launcher'
  );
  return {
    applicationsDirectory,
    supportDirectory,
    appPath: join(applicationsDirectory, APP_NAME),
    receiptPath: join(supportDirectory, 'receipt.json'),
  };
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function execute(file, args, options = {}) {
  return execFileAsync(file, args, {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    ...options,
  });
}

async function plistValue(appPath, key, executeImpl) {
  const plist = join(appPath, 'Contents', 'Info.plist');
  const { stdout } = await executeImpl('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, plist]);
  return stdout.trim();
}

async function verifyApp(appPath, manifest, executeImpl = execute) {
  await executeImpl('/usr/bin/codesign', ['--verify', '--deep', '--strict', appPath]);
  const signatureResult = await executeImpl('/usr/bin/codesign', ['-dv', '--verbose=4', appPath]);
  const signatureDetails = `${signatureResult.stdout ?? ''}${signatureResult.stderr ?? ''}`;
  if (
    !signatureDetails.includes('Signature=adhoc') ||
    !signatureDetails.includes('TeamIdentifier=not set')
  ) {
    throw new Error('The application is not the expected credential-free ad-hoc build.');
  }

  const bundleIdentifier = await plistValue(appPath, 'CFBundleIdentifier', executeImpl);
  const shortVersion = await plistValue(appPath, 'CFBundleShortVersionString', executeImpl);
  const buildVersion = await plistValue(appPath, 'CFBundleVersion', executeImpl);
  if (bundleIdentifier !== manifest.bundleIdentifier) {
    throw new Error('The installed app bundle identifier does not match the release manifest.');
  }
  if (shortVersion !== manifest.bundleShortVersion) {
    throw new Error('The installed app short bundle version does not match the release manifest.');
  }
  if (buildVersion !== manifest.bundleVersion) {
    throw new Error('The installed app build version does not match the release manifest.');
  }

  const executable = join(appPath, 'Contents', 'MacOS', EXECUTABLE_NAME);
  const { stdout: architectures } = await executeImpl('/usr/bin/lipo', ['-archs', executable]);
  if (!architectures.includes('arm64') || !architectures.includes('x86_64')) {
    throw new Error('The installed app is not a universal arm64+x86_64 build.');
  }
}

async function assessGatekeeper(appPath, executeImpl = execute) {
  try {
    await executeImpl('/usr/sbin/spctl', ['--assess', '--type', 'execute', appPath]);
    return 'accepted';
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return 'unavailable';
    return 'rejected';
  }
}

async function verifyExtractedTree(root, appPath) {
  const canonicalRoot = `${await realpath(root)}${sep}`;
  async function visit(path) {
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) {
      const entry = relative(root, path).split(sep).join('/');
      assertSafeArchiveSymlink(entry, await readlink(path));
    }
    const canonical = await realpath(path);
    if (canonical !== canonicalRoot.slice(0, -1) && !canonical.startsWith(canonicalRoot)) {
      throw new Error('Release archive escaped its extraction directory.');
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) return;
    for (const entry of await readdir(path)) await visit(join(path, entry));
  }
  const topLevel = await readdir(root);
  if (topLevel.length !== 1 || topLevel[0] !== APP_NAME) {
    throw new Error('Release archive must contain exactly AdRouter Agent.app.');
  }
  await visit(appPath);
}

async function download(manifest, destination, fetchImpl = fetch) {
  let current = assertAllowedDownloadUrl(manifest.assetUrl);
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const response = await fetchImpl(current, {
      redirect: 'manual',
      headers: { 'user-agent': `@adrouter/agent/${manifest.releaseVersion}` },
      signal: AbortSignal.timeout(5 * 60 * 1000),
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw new Error('Download redirect did not include a Location header.');
      current = assertAllowedDownloadUrl(new URL(location, current));
      continue;
    }
    if (!response.ok || !response.body) {
      throw new Error(`Release download failed with HTTP ${response.status}.`);
    }
    const contentLength = response.headers.get('content-length');
    const declaredSize = contentLength === null ? null : Number(contentLength);
    if (
      declaredSize !== null &&
      (!Number.isSafeInteger(declaredSize) || declaredSize < 0 || declaredSize > MAX_DOWNLOAD_BYTES)
    ) {
      throw new Error('Release download exceeds the maximum permitted size.');
    }
    const handle = await open(destination, 'wx', 0o600);
    let received = 0;
    const digest = createHash('sha256');
    const reader = response.body.getReader();
    try {
      while (true) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        received += chunk.byteLength;
        if (received > MAX_DOWNLOAD_BYTES) {
          throw new Error('Release download exceeds the maximum permitted size.');
        }
        digest.update(chunk);
        await handle.write(chunk);
      }
    } finally {
      reader.releaseLock();
      await handle.close();
    }
    if (declaredSize !== null && received !== declaredSize) {
      throw new Error('Release download ended before the declared content length.');
    }
    const actual = digest.digest('hex');
    if (actual !== manifest.sha256) throw new Error('Release ZIP checksum verification failed.');
    return { bytes: received, sha256: actual, finalUrl: current.href };
  }
  throw new Error('Release download exceeded the redirect limit.');
}

async function archiveEntries(zipPath, executeImpl = execute) {
  const { stdout } = await executeImpl('/usr/bin/unzip', ['-Z1', zipPath]);
  const entries = stdout.split('\n').filter(Boolean);
  assertSafeArchiveEntries(entries);
  const { stdout: listing } = await executeImpl('/usr/bin/zipinfo', ['-l', zipPath]);
  for (const line of listing.split('\n').filter((value) => /^l[rwx-]{9}\s/.test(value))) {
    const match = line.match(/^l[rwx-]{9}\s+\S+\s+\S+\s+\d+\s+\S+\s+\d+\s+\S+\s+\S+\s+\S+\s+(.+)$/);
    if (!match) throw new Error('Unable to validate a ZIP symbolic link entry.');
    const entry = match[1];
    const { stdout: target } = await executeImpl('/usr/bin/unzip', ['-p', zipPath, entry]);
    assertSafeArchiveSymlink(entry, target);
  }
  return entries;
}

async function readReceipt(receiptPath, appPath) {
  try {
    const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
    const owned =
      receipt.schema === 2 &&
      receipt.owner === RECEIPT_OWNER &&
      receipt.applicationPath === appPath;
    return { receipt, owned };
  } catch {
    return { receipt: null, owned: false };
  }
}

function receiptMatchesManifest(receipt, manifest) {
  return (
    receipt?.releaseVersion === manifest.releaseVersion &&
    receipt?.sha256 === manifest.sha256 &&
    receipt?.releaseTag === manifest.releaseTag
  );
}

async function appIsRunning(appPath, executeImpl = execute) {
  const executable = join(appPath, 'Contents', 'MacOS', EXECUTABLE_NAME);
  const { stdout } = await executeImpl('/bin/ps', ['-axo', 'command=']);
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .some((line) => line === executable || line.startsWith(`${executable} `));
}

export async function inspectInstallation(manifest, options = {}) {
  const paths = releasePaths(manifest, options.homeDirectory);
  const report = {
    schema: 2,
    distributionMode: manifest.distributionMode,
    platform: options.platform ?? process.platform,
    architecture: options.arch ?? process.arch,
    macOsVersion: null,
    supported: false,
    releaseVersion: manifest.releaseVersion,
    releaseTag: manifest.releaseTag,
    applicationPath: paths.appPath,
    installed: false,
    receiptMatches: false,
    bundleIntegrity: false,
    signatureType: 'missing',
    gatekeeperAssessment: 'unavailable',
    warning: GATEKEEPER_WARNING,
  };
  try {
    assertSupportedPlatform(report.platform, report.architecture);
    const versionResult =
      options.macOsVersion === undefined
        ? await (options.executeImpl ?? execute)('/usr/bin/sw_vers', ['-productVersion'])
        : { stdout: options.macOsVersion };
    report.macOsVersion = versionResult.stdout.trim();
    assertSupportedMacOsVersion(report.macOsVersion);
    report.supported = true;
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error);
    return report;
  }

  report.installed = await exists(paths.appPath);
  if (!report.installed) return report;
  const receiptStatus = await readReceipt(paths.receiptPath, paths.appPath);
  report.receiptMatches =
    receiptStatus.owned && receiptMatchesManifest(receiptStatus.receipt, manifest);
  try {
    await verifyApp(paths.appPath, manifest, options.executeImpl);
    report.bundleIntegrity = true;
    report.signatureType = 'adhoc';
  } catch (error) {
    report.signatureType = 'invalid';
    report.error = error instanceof Error ? error.message : String(error);
  }
  report.gatekeeperAssessment = await assessGatekeeper(paths.appPath, options.executeImpl);
  if (report.gatekeeperAssessment === 'accepted') report.warning = null;
  return report;
}

export async function install(manifest, options = {}) {
  assertSupportedPlatform(options.platform ?? process.platform, options.arch ?? process.arch);
  assertNonRoot(options.uid ?? process.getuid?.());
  const paths = releasePaths(manifest, options.homeDirectory);
  const executeImpl = options.executeImpl ?? execute;
  const existing = await inspectInstallation(manifest, options);
  if (!existing.supported) {
    throw new Error(existing.error ?? 'This Mac is not supported.');
  }
  if (
    existing.installed &&
    existing.receiptMatches &&
    existing.bundleIntegrity &&
    existing.signatureType === 'adhoc'
  ) {
    return paths.appPath;
  }

  const receiptStatus = await readReceipt(paths.receiptPath, paths.appPath);
  if (existing.installed && !receiptStatus.owned) {
    throw new Error(
      `${paths.appPath} already exists and is not managed by @adrouter/agent; move or remove it before installing.`
    );
  }
  if (existing.installed && (await appIsRunning(paths.appPath, executeImpl))) {
    throw new Error('Quit AdRouter Agent before installing or updating it.');
  }

  await mkdir(paths.applicationsDirectory, { recursive: true, mode: 0o755 });
  await mkdir(paths.supportDirectory, { recursive: true, mode: 0o700 });
  const staging = await mkdtemp(join(paths.applicationsDirectory, '.adrouter-agent-staging-'));
  const archive = join(staging, basename(manifest.assetName));
  const extracted = join(staging, 'extracted');
  const stagedApp = join(extracted, APP_NAME);
  const backupPath = join(
    paths.applicationsDirectory,
    `.AdRouter Agent.app.backup-${process.pid}-${Date.now()}`
  );
  let backedUp = false;
  let activated = false;
  try {
    const receipt = await download(manifest, archive, options.fetchImpl);
    await archiveEntries(archive, executeImpl);
    await mkdir(extracted, { mode: 0o700 });
    await executeImpl('/usr/bin/ditto', ['-x', '-k', archive, extracted]);
    await verifyExtractedTree(extracted, stagedApp);
    await verifyApp(stagedApp, manifest, executeImpl);

    if (existing.installed) {
      await rename(paths.appPath, backupPath);
      backedUp = true;
    }
    await rename(stagedApp, paths.appPath);
    activated = true;
    await (options.writeReceiptImpl ?? writeReceipt)(paths.receiptPath, {
      schema: 2,
      owner: RECEIPT_OWNER,
      distributionMode: manifest.distributionMode,
      releaseVersion: manifest.releaseVersion,
      releaseTag: manifest.releaseTag,
      sha256: receipt.sha256,
      bytes: receipt.bytes,
      finalUrl: receipt.finalUrl,
      applicationPath: paths.appPath,
      installedAt: new Date().toISOString(),
    });
    if (backedUp) await rm(backupPath, { recursive: true, force: true });
    return paths.appPath;
  } catch (error) {
    if (activated) await rm(paths.appPath, { recursive: true, force: true });
    if (backedUp && (await exists(backupPath))) await rename(backupPath, paths.appPath);
    throw error;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

async function writeReceipt(path, receipt) {
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    const handle = await open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
    } finally {
      await handle.close();
    }
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

export async function launch(appPath, spawnImpl = spawn) {
  await new Promise((resolvePromise, reject) => {
    const child = spawnImpl('/usr/bin/open', [appPath], {
      detached: true,
      stdio: 'ignore',
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`macOS open failed with exit code ${code}.`));
    });
    child.unref();
  });
}
