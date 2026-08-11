import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { reviewedProductFiles } from './source-parity-files.mjs';

const files = reviewedProductFiles();
const records = files.map((filename) => {
  const digest = createHash('sha256').update(readFileSync(filename)).digest('hex');
  return `${digest}  ${filename}`;
});
writeFileSync(join('provenance', 'source-files.sha256'), `${records.join('\n')}\n`);
console.log(`Recorded ${records.length} reviewed product files.`);
