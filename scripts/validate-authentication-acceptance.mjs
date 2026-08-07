import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const exactKeys = (value, keys, label) => {
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), `${label} fields are not exact`);
};

const safeString = (value, pattern, label) => {
  assert.equal(typeof value, 'string', `${label} must be a string`);
  assert.match(value, pattern, `${label} is malformed`);
  assert.ok(
    !/(?:adr_(?:live|test)_|npm_|BEGIN [A-Z ]*PRIVATE KEY|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.)/.test(
      value
    ),
    `${label} contains credential-shaped material`
  );
};

export const ACCEPTANCE_ARTIFACT_COUNT = 4;
export const ACCEPTANCE_COHORT_COUNT = 2;
export const LEGACY_ACCEPTANCE_SCHEMA = 1;
export const SIGNED_ACCEPTANCE_SCHEMA = 2;

export const resultKeys = [
  'enrollment',
  'profile',
  'turn',
  'streamCompletion',
  'tokenRotation',
  'replayRejected',
  'tamperRejected',
  'tokenWithoutKeyRejected',
  'revocation',
  'upgradePolicy',
  'localSecretCleanup',
];
export const signedResultKeys = [
  ...resultKeys,
  'manifestSignature',
  'platformSignature',
  'healthyStartRollback',
];

export const validateAcceptance = (value, manifest) => {
  assert.ok(
    value && typeof value === 'object' && !Array.isArray(value),
    'acceptance must be an object'
  );
  exactKeys(
    value,
    [
      'schema',
      'clientKind',
      'repository',
      'package',
      'candidateVersion',
      'releaseTag',
      'sourceCommit',
      'artifacts',
      'cohorts',
      'redactionAttestation',
    ],
    'acceptance'
  );
  assert.ok(
    [LEGACY_ACCEPTANCE_SCHEMA, SIGNED_ACCEPTANCE_SCHEMA].includes(value.schema),
    'acceptance schema must be 1 or 2'
  );
  const signedAcceptance = value.schema === SIGNED_ACCEPTANCE_SCHEMA;
  assert.equal(value.clientKind, 'desktop');
  assert.equal(value.repository, 'adrouter/adrouterAgent');
  assert.equal(value.package, '@adrouter/agent');
  safeString(value.candidateVersion, /^\d+\.\d+\.\d+(?:-beta\.\d+)?$/, 'candidateVersion');
  assert.equal(value.releaseTag, `v${value.candidateVersion}`);
  safeString(value.sourceCommit, /^[a-f0-9]{40}$/, 'sourceCommit');
  assert.equal(value.redactionAttestation, true);

  assert.ok(
    Array.isArray(value.artifacts) && value.artifacts.length === ACCEPTANCE_ARTIFACT_COUNT,
    'exactly four artifacts are required'
  );
  const artifactNames = new Set();
  for (const artifact of value.artifacts) {
    exactKeys(artifact, ['name', 'sha256'], 'artifact');
    safeString(artifact.name, /^[A-Za-z0-9][A-Za-z0-9._-]{0,239}$/, 'artifact.name');
    safeString(artifact.sha256, /^[a-f0-9]{64}$/, 'artifact.sha256');
    assert.ok(!artifactNames.has(artifact.name), `duplicate artifact ${artifact.name}`);
    artifactNames.add(artifact.name);
  }

  assert.ok(
    Array.isArray(value.cohorts) && value.cohorts.length === ACCEPTANCE_COHORT_COUNT,
    'exactly two acceptance cohorts are required'
  );
  const primary = value.cohorts.find((cohort) => cohort.environmentClass === 'primary-operator');
  if (signedAcceptance) {
    const windowsX64 = value.cohorts.find(
      (cohort) => cohort.environmentClass === 'physical-windows-x64'
    );
    assert.ok(
      primary && windowsX64,
      'signed acceptance requires primary and physical Windows 11 x64 cohorts'
    );
    assert.equal(windowsX64.os, 'windows');
    assert.equal(windowsX64.architecture, 'x64');
    assert.match(windowsX64.runtimeVersion, /^Windows 11(?:[ ._+-].*)?$/);
  } else {
    const second = value.cohorts.find((cohort) => cohort.environmentClass === 'second-os');
    assert.ok(primary && second, 'primary-operator and second-os cohorts are required');
    assert.notEqual(
      primary.os,
      second.os,
      'the second cohort must use a distinct operating system'
    );
    assert.equal(
      second.os,
      'windows',
      'the physical Windows 11 x64 acceptance cohort must use Windows'
    );
    assert.equal(second.architecture, 'x64', 'the Windows acceptance cohort must use x64');
    assert.match(
      second.runtimeVersion,
      /^Windows 11(?:[ ._+-].*)?$/,
      'the Windows acceptance cohort must identify Windows 11'
    );
  }
  for (const cohort of value.cohorts) {
    exactKeys(
      cohort,
      [
        'environmentClass',
        'os',
        'architecture',
        'runtimeVersion',
        'storageClassification',
        'testedAt',
        'recorder',
        'results',
      ],
      'cohort'
    );
    assert.ok(
      (signedAcceptance
        ? ['primary-operator', 'physical-windows-x64']
        : ['primary-operator', 'second-os']
      ).includes(cohort.environmentClass)
    );
    assert.ok(['macos', 'ubuntu', 'windows'].includes(cohort.os));
    assert.ok(['arm64', 'x64'].includes(cohort.architecture));
    assert.equal(cohort.storageClassification, 'os_encrypted');
    safeString(cohort.runtimeVersion, /^[A-Za-z0-9][A-Za-z0-9 ._+-]{0,99}$/, 'runtimeVersion');
    safeString(cohort.recorder, /^[A-Za-z0-9][A-Za-z0-9 ._@-]{0,99}$/, 'recorder');
    assert.ok(Number.isFinite(Date.parse(cohort.testedAt)), 'testedAt must be an ISO timestamp');
    const expectedResults = signedAcceptance ? signedResultKeys : resultKeys;
    exactKeys(cohort.results, expectedResults, 'results');
    for (const key of expectedResults) {
      assert.equal(cohort.results[key], true, `${key} did not pass`);
    }
  }

  if (manifest) {
    if (manifest.schema === 4) {
      assert.equal(value.schema, 2, 'schema-4 releases require signed acceptance schema 2');
    }
    assert.equal(value.candidateVersion, manifest.releaseVersion);
    assert.equal(value.releaseTag, manifest.releaseTag);
    assert.equal(value.sourceCommit, manifest.sourceCommit);
    const required = manifest.files
      .filter((record) => record.name.endsWith('.zip') || record.name.endsWith('.tgz'))
      .map(({ name, sha256 }) => ({ name, sha256 }))
      .sort((left, right) => left.name.localeCompare(right.name));
    assert.deepEqual(
      value.artifacts.slice().sort((left, right) => left.name.localeCompare(right.name)),
      required,
      'acceptance artifact identities do not match the immutable manifest'
    );
  }
  return value;
};

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  const acceptancePath = resolve(process.argv[2] ?? 'authentication-acceptance.json');
  const manifestFlag = process.argv.indexOf('--manifest');
  const manifestPath =
    manifestFlag >= 0
      ? resolve(process.argv[manifestFlag + 1])
      : join(dirname(acceptancePath), 'artifact-manifest.json');
  const manifest = existsSync(manifestPath)
    ? JSON.parse(readFileSync(manifestPath, 'utf8'))
    : undefined;
  validateAcceptance(JSON.parse(readFileSync(acceptancePath, 'utf8')), manifest);
  console.log(`Validated sanitized authentication acceptance ${basename(acceptancePath)}.`);
}
