import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { reviewedProductFiles } from './source-parity-files.mjs';

const manifest = readFileSync(resolve('provenance', 'source-files.sha256'), 'utf8')
  .trim()
  .split('\n');
assert.ok(manifest.length > 0, 'source parity manifest is empty');
const expectedFiles = reviewedProductFiles();
assert.deepEqual(
  manifest.map((record) => record.slice(66)),
  expectedFiles,
  'source parity manifest does not cover the exact reviewed product file set'
);

for (const record of manifest) {
  const match = record.match(/^([a-f0-9]{64}) {2}(.+)$/);
  assert.ok(match, `invalid source parity record: ${record}`);
  const [, expected, filename] = match;
  const actual = createHash('sha256')
    .update(readFileSync(resolve(filename)))
    .digest('hex');
  assert.equal(actual, expected, `${filename} differs from the reviewed source commit`);
}

console.log(`Source parity passed for ${manifest.length} reviewed product files.`);
