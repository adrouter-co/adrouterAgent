import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const expected = new Map([
  [
    'brace-expansion',
    {
      alias: 'adrouter-brace-expansion-patch',
      version: '5.0.9',
      lockKey: 'node_modules/brace-expansion',
    },
  ],
  ['protobufjs', { alias: 'adrouter-protobufjs-patch', version: '7.6.5' }],
  ['undici', { alias: 'adrouter-undici-patch', version: '8.9.0' }],
]);
const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const securityPins = new Map([
  ['fast-uri', '3.1.5'],
  ['tar', '7.5.22'],
  ['tmp', '0.2.7'],
]);

for (const [name, version] of securityPins) {
  assert.equal(packageJson.overrides[name], version, `${name} override must remain exact`);
  const locked = Object.entries(lock.packages).filter(
    ([key]) => key === `node_modules/${name}` || key.endsWith(`/node_modules/${name}`)
  );
  assert.ok(locked.length > 0, `${name} must exist in the lockfile`);
  for (const [key, entry] of locked) {
    assert.equal(entry.version, version, `${key} must resolve to ${version}`);
  }
  const physical = JSON.parse(readFileSync(resolve('node_modules', name, 'package.json'), 'utf8'));
  assert.equal(physical.version, version, `${name} physical resolution must be ${version}`);
}

for (const [name, replacement] of expected) {
  assert.equal(
    packageJson.devDependencies[replacement.alias],
    `npm:${name}@${replacement.version}`,
    `${name} must have an exact private helper alias`
  );
  const nestedKey =
    replacement.lockKey ?? `node_modules/@earendil-works/pi-coding-agent/node_modules/${name}`;
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
  assert.equal(packageJson.dependencies[name], '0.84.1', `${name} must remain pinned`);
  assert.equal(
    lock.packages[`node_modules/${name}`].version,
    '0.84.1',
    `${name} root lock resolution must remain exact`
  );
  const physical = JSON.parse(readFileSync(resolve('node_modules', name, 'package.json'), 'utf8'));
  assert.equal(physical.version, '0.84.1', `${name} physical resolution must remain exact`);
}

for (const name of ['@earendil-works/pi-client', '@earendil-works/pi-protocol']) {
  assert.equal(
    packageJson.dependencies[name],
    undefined,
    `${name} must remain transitive-only and cannot gain direct product authority`
  );
  const nestedKey = `node_modules/@earendil-works/pi-coding-agent/node_modules/${name}`;
  assert.equal(
    lock.packages[nestedKey].version,
    '0.84.1',
    `${name} transitive lock resolution must match the frozen Pi release`
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
      ),
      'utf8'
    )
  );
  assert.equal(physical.version, '0.84.1', `${name} transitive physical resolution must be exact`);
}

const agentSessionSource = readFileSync(resolve('src', 'runtime', 'agent-session.ts'), 'utf8');
for (const boundary of [
  'noExtensions: true',
  'noSkills: true',
  'noPromptTemplates: true',
  'baseToolsOverride:',
  'allowedToolNames:',
]) {
  assert.ok(agentSessionSource.includes(boundary), `Pi resource boundary is missing ${boundary}`);
}
for (const optionalPackage of ['@earendil-works/pi-client', '@earendil-works/pi-protocol']) {
  assert.ok(
    !agentSessionSource.includes(optionalPackage),
    `${optionalPackage} must not be imported by the desktop runtime`
  );
}
const cacheOptimizerSource = readFileSync(resolve('src', 'runtime', 'cache-optimizer.ts'), 'utf8');
for (const forbidden of [
  'models.json',
  'registerProvider(',
  'promptCacheKey',
  'fetch(',
  'writeFile',
]) {
  assert.ok(
    !cacheOptimizerSource.includes(forbidden),
    `desktop cache optimization gained forbidden authority: ${forbidden}`
  );
}

const crossZipPackage = JSON.parse(
  readFileSync(resolve('node_modules', 'cross-zip', 'package.json'), 'utf8')
);
assert.equal(crossZipPackage.version, '4.0.1', 'cross-zip must remain at the reviewed version');
const crossZipSource = readFileSync(resolve('node_modules', 'cross-zip', 'index.js'), 'utf8');
for (const expected of [
  'fs.rm(outPath, { recursive: true, force: true, maxRetries: 3 }, doZip2)',
  'fs.rmSync(outPath, { recursive: true, force: true, maxRetries: 3 })',
]) {
  assert.ok(crossZipSource.includes(expected), 'cross-zip Node 25 compatibility patch is missing');
}
assert.ok(
  !crossZipSource.includes('fs.rmdir(outPath, { recursive: true'),
  'cross-zip still uses removed recursive fs.rmdir'
);
assert.ok(
  !crossZipSource.includes('fs.rmdirSync(outPath, { recursive: true'),
  'cross-zip still uses removed recursive fs.rmdirSync'
);

console.log(
  'Security pins, dependency override policy, compatibility patch, and physical install passed.'
);
