import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const walk = (directory) =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });

const files = [
  ...readdirSync('assets')
    .filter((name) => /^icon\.(?:icns|ico|png|svg)$/.test(name))
    .map((name) => join('assets', name)),
  'entitlements.mac.plist',
  ...walk('src').filter(
    (name) => /\.(?:ts|tsx)$/.test(name) && name !== join('src', 'main', 'ipc.ts')
  ),
].sort();
const records = files.map((filename) => {
  const digest = createHash('sha256').update(readFileSync(filename)).digest('hex');
  return `${digest}  ${filename}`;
});
writeFileSync(join('provenance', 'source-files.sha256'), `${records.join('\n')}\n`);
console.log(`Recorded ${records.length} reviewed product files.`);
