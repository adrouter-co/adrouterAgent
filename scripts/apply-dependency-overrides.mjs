import assert from 'node:assert/strict';
import { cpSync, readFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const piNestedRoot = resolve(
  root,
  'node_modules',
  '@earendil-works',
  'pi-coding-agent',
  'node_modules'
);
const replacements = [
  {
    name: 'brace-expansion',
    sourceName: 'adrouter-brace-expansion-patch',
    version: '5.0.8',
  },
  {
    name: 'protobufjs',
    sourceName: 'adrouter-protobufjs-patch',
    version: '7.6.5',
  },
];

for (const replacement of replacements) {
  const source = resolve(root, 'node_modules', replacement.sourceName);
  const destination = resolve(piNestedRoot, replacement.name);
  const installed = JSON.parse(readFileSync(resolve(source, 'package.json'), 'utf8'));
  assert.equal(
    installed.version,
    replacement.version,
    `${replacement.name} root resolution must be ${replacement.version}`
  );
  rmSync(destination, { recursive: true, force: true });
  cpSync(source, destination, { recursive: true });
  const physical = JSON.parse(readFileSync(resolve(destination, 'package.json'), 'utf8'));
  assert.equal(physical.version, replacement.version);
}

console.log('Applied two audited dependency overrides to the Pi shrinkwrapped install.');
