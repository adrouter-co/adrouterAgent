import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';

const tracked = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
  encoding: 'utf8',
})
  .split('\n')
  .filter(Boolean);
const forbiddenNames = [
  /(^|\/)\.env(?:\.|$)/,
  /(^|\/)node_modules\//,
  /(^|\/)(?:out|dist|coverage|test-results|playwright-report)\//,
  /\.(?:db|sqlite|log)$/i,
  /(^|\/)\.DS_Store$/,
];
const absoluteMacHomePrefix = ['', 'Users', ''].join('/');
const privateKeyMarker = ['BEGIN', 'PRIVATE', 'KEY'].join(' ');
for (const filename of tracked) {
  for (const pattern of forbiddenNames) {
    assert.ok(!pattern.test(filename), `public boundary includes forbidden file ${filename}`);
  }
  if (statSync(filename).isDirectory() || /\.(?:icns|png|jpg|zip|dmg|tgz)$/i.test(filename)) {
    continue;
  }
  const text = readFileSync(filename, 'utf8');
  assert.ok(
    !text.includes(absoluteMacHomePrefix),
    `${filename} contains an absolute developer path`
  );
  assert.ok(!text.includes(privateKeyMarker), `${filename} contains private key material`);
  assert.ok(!/npm_[A-Za-z0-9]{30,}/.test(text), `${filename} contains a possible npm token`);
  for (const match of text.matchAll(
    /(?:DEEPSEEK_API_KEY|ADROUTER_STAGING_API_KEY)\s*=\s*([^\s"'`]+)/g
  )) {
    assert.match(
      match[1],
      /^(?:your_|the_|example|redacted|local|\$|<|\{)/i,
      `${filename} contains a possible live credential`
    );
  }
}

console.log(`Public boundary passed for ${tracked.length} repository files.`);
