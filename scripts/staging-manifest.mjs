import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Run only after the owning build/package verification succeeds.
const directory = resolve(process.argv[2]);
const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (process.env.GITHUB_SHA && process.env.GITHUB_SHA !== sourceSha) {
  throw new Error('Artifact source does not match the workflow commit.');
}
function inventory(relative = '') {
  return readdirSync(join(directory, relative), { withFileTypes: true }).flatMap((entry) => {
    const path = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error(`Unexpected artifact symlink: ${path}`);
    if (entry.isDirectory()) return inventory(path);
    if (['SHA256SUMS', 'staging-manifest.json'].includes(path)) return [];
    const bytes = readFileSync(join(directory, path));
    return [{ path, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }];
  });
}
const files = inventory().sort((a, b) => a.path.localeCompare(b.path));
if (!files.length) throw new Error('No tested artifacts to retain.');
const record = {
  schemaVersion: 1,
  sourceSha,
  platform: process.env.STAGING_PLATFORM || `${process.platform}-${process.arch}`,
  runId: process.env.GITHUB_RUN_ID || null,
  runAttempt: process.env.GITHUB_RUN_ATTEMPT || null,
  files,
};
writeFileSync(join(directory, 'staging-manifest.json'), `${JSON.stringify(record, null, 2)}\n`);
const manifestDigest = createHash('sha256')
  .update(readFileSync(join(directory, 'staging-manifest.json')))
  .digest('hex');
writeFileSync(
  join(directory, 'SHA256SUMS'),
  `${files.map((f) => `${f.sha256}  ${f.path}`).join('\n')}\n${manifestDigest}  staging-manifest.json\n`
);
console.log(`Retained ${files.length} tested artifacts from ${sourceSha}.`);
