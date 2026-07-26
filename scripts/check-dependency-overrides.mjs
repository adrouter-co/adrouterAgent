import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const expected = new Map([
  ['brace-expansion', { alias: 'adrouter-brace-expansion-patch', version: '5.0.8' }],
  ['protobufjs', { alias: 'adrouter-protobufjs-patch', version: '7.6.5' }],
]);
const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));

for (const [name, replacement] of expected) {
  assert.equal(
    packageJson.devDependencies[replacement.alias],
    `npm:${name}@${replacement.version}`,
    `${name} must have an exact private helper alias`
  );
  const nestedKey = `node_modules/@earendil-works/pi-coding-agent/node_modules/${name}`;
  assert.equal(
    lock.packages[nestedKey].version,
    replacement.version,
    `${name} lock resolution is stale`
  );
  const physical = JSON.parse(
    readFileSync(
      resolve(
        'node_modules',
        '@earendil-works',
        'pi-coding-agent',
        'node_modules',
        name,
        'package.json'
      )
    )
  );
  assert.equal(
    physical.version,
    replacement.version,
    `${name} physical nested resolution is stale`
  );
}

for (const name of [
  '@earendil-works/pi-agent-core',
  '@earendil-works/pi-ai',
  '@earendil-works/pi-coding-agent',
]) {
  assert.equal(packageJson.dependencies[name], '0.80.6', `${name} must remain pinned`);
}

console.log('Dependency override policy and physical install passed.');
