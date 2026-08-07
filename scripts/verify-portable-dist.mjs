import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { verifyPackagedStagingDefault } from './verify-packaged-default.mjs';

const platform = process.argv[2];
const arch = process.argv[3] ?? 'x64';
if (!['linux', 'win32'].includes(platform) || arch !== 'x64') {
  throw new Error('Usage: node scripts/verify-portable-dist.mjs <linux|win32> x64');
}

const assertBinaryArchitecture = (body, expectedArchitecture, label) => {
  let machine;
  if (body.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) {
    if (body[5] !== 1) throw new Error(`${label} is not a little-endian ELF binary.`);
    machine = body.readUInt16LE(18);
  } else if (body.subarray(0, 2).toString('ascii') === 'MZ') {
    const peOffset = body.readUInt32LE(0x3c);
    if (body.subarray(peOffset, peOffset + 4).toString('binary') !== 'PE\0\0') {
      throw new Error(`${label} has an invalid PE header.`);
    }
    machine = body.readUInt16LE(peOffset + 4);
  } else {
    throw new Error(`${label} is not a supported native executable.`);
  }
  const expectedMachine =
    expectedArchitecture === 'arm64'
      ? platform === 'linux'
        ? 0xb7
        : 0xaa64
      : platform === 'linux'
        ? 0x3e
        : 0x8664;
  if (machine !== expectedMachine) {
    throw new Error(`${label} does not match the requested ${expectedArchitecture} architecture.`);
  }
};

const require = createRequire(import.meta.url);
const asar = require('@electron/asar');
const out = resolve('out');
const packageRoot = join(out, `AdRouter Agent-${platform}-${arch}`);
const executable = join(
  packageRoot,
  platform === 'win32' ? 'AdRouter Agent.exe' : 'AdRouter Agent'
);
const resources = join(packageRoot, 'resources');
const archive = join(resources, 'app.asar');
const requireProtectedSignature = process.env.ADROUTER_REQUIRE_PLATFORM_SIGNATURE === '1';
if (!existsSync(executable) || !existsSync(archive)) {
  throw new Error(`The ${platform}-${arch} package is missing its executable or app.asar.`);
}
assertBinaryArchitecture(readFileSync(executable), arch, 'The packaged Electron executable');
if (platform === 'win32' && requireProtectedSignature) {
  const expectedSubject = process.env.ADROUTER_WINDOWS_SIGNER_SUBJECT;
  if (!expectedSubject)
    throw new Error('Protected Windows verification requires the signer subject.');
  const script =
    '& { param([string]$root,[string]$subject) ' +
    '$files=Get-ChildItem -LiteralPath $root -Recurse -File | Where-Object { $_.Extension -in ".exe",".dll",".node" }; ' +
    'if (-not $files) { exit 1 }; foreach ($file in $files) { $s=Get-AuthenticodeSignature -LiteralPath $file.FullName; ' +
    'if ([string]$s.Status -ne "Valid" -or [string]$s.SignerCertificate.Subject -ne $subject) { exit 1 } } }';
  execFileSync('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    script,
    packageRoot,
    expectedSubject,
  ]);
}
for (const resource of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'PRIVACY.md']) {
  if (!existsSync(join(resources, resource)))
    throw new Error(`Missing packaged resource ${resource}.`);
}
const makeRoot = join(out, 'make');
const zips = existsSync(makeRoot)
  ? readdirSync(makeRoot, { recursive: true })
      .map(String)
      .filter((entry) => entry.endsWith('.zip') && entry.includes(platform) && entry.includes(arch))
  : [];
if (zips.length !== 1) throw new Error(`Expected exactly one ${platform}-${arch} ZIP.`);

const packagedFiles = asar.listPackage(archive);
const nativeSandboxPath =
  platform === 'linux'
    ? join(resources, 'vendor', 'seccomp', arch, 'apply-seccomp')
    : join(resources, 'vendor', 'srt-win', arch, 'srt-win.exe');
if (!existsSync(nativeSandboxPath)) {
  throw new Error(`The packaged application is missing ${nativeSandboxPath}.`);
}
const vendorRoot = join(resources, 'vendor');
const expectedVendorEntry =
  platform === 'linux' ? `seccomp/${arch}/apply-seccomp` : `srt-win/${arch}/srt-win.exe`;
const vendorEntries = readdirSync(vendorRoot, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) =>
    join(entry.parentPath, entry.name)
      .slice(vendorRoot.length + 1)
      .replaceAll('\\', '/')
  )
  .sort();
if (JSON.stringify(vendorEntries) !== JSON.stringify([expectedVendorEntry])) {
  throw new Error(`The packaged sandbox helper inventory is invalid: ${vendorEntries.join(', ')}`);
}
assertBinaryArchitecture(readFileSync(nativeSandboxPath), arch, 'The packaged sandbox helper');
if (
  packagedFiles.some(
    (filename) =>
      filename.endsWith('.map') ||
      /(^|\/)(?:tests?|playwright-report|test-results)(\/|$)/.test(filename)
  )
) {
  throw new Error('The packaged application contains source maps or test artifacts.');
}
const text = packagedFiles
  .filter((filename) => /\.(?:css|html|js|json)$/.test(filename))
  .map((filename) => asar.extractFile(archive, filename.slice(1)).toString('utf8'))
  .join('\n');
for (const forbidden of ['ADROUTER_E2E_BUILD', ['BEGIN', 'PRIVATE', 'KEY'].join(' ')]) {
  if (text.includes(forbidden)) throw new Error(`Packaged application contains ${forbidden}.`);
}
verifyPackagedStagingDefault(packagedFiles, (filename) =>
  asar.extractFile(archive, filename.slice(1)).toString('utf8')
);

console.log(`Verified ${platform}-${arch} portable package and ZIP.`);
