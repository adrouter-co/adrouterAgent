import { existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { verifyPackagedStagingDefault } from './verify-packaged-default.mjs';

const platform = process.argv[2];
const arch = process.argv[3] ?? 'x64';
if (!['linux', 'win32'].includes(platform) || arch !== 'x64') {
  throw new Error('Usage: node scripts/verify-portable-dist.mjs <linux|win32> x64');
}

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
if (!existsSync(executable) || !existsSync(archive)) {
  throw new Error(`The ${platform}-${arch} package is missing its executable or app.asar.`);
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
