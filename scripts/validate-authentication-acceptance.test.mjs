import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  ACCEPTANCE_ARTIFACT_COUNT,
  ACCEPTANCE_COHORT_COUNT,
  LEGACY_ACCEPTANCE_SCHEMA,
  resultKeys,
  SIGNED_ACCEPTANCE_SCHEMA,
  signedResultKeys,
  validateAcceptance,
} from './validate-authentication-acceptance.mjs';

const jsonSchema = JSON.parse(
  readFileSync(new URL('./authentication-acceptance.schema.json', import.meta.url), 'utf8')
);

const results = Object.fromEntries(
  [
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
  ].map((key) => [key, true])
);
const artifacts = ['darwin-universal.zip', 'linux-x64.zip', 'win32-x64.zip', 'agent.tgz'].map(
  (name, index) => ({ name, sha256: String(index + 1).repeat(64) })
);
const fixture = {
  schema: 1,
  clientKind: 'desktop',
  repository: 'adrouter/adrouterAgent',
  package: '@adrouter/agent',
  candidateVersion: '0.1.0-beta.12',
  releaseTag: 'v0.1.0-beta.12',
  sourceCommit: 'a'.repeat(40),
  artifacts,
  cohorts: [
    {
      environmentClass: 'primary-operator',
      os: 'macos',
      architecture: 'arm64',
      runtimeVersion: 'macOS 15.6',
      storageClassification: 'os_encrypted',
      testedAt: '2026-07-27T00:00:00.000Z',
      recorder: 'release-operator',
      results,
    },
    {
      environmentClass: 'second-os',
      os: 'windows',
      architecture: 'x64',
      runtimeVersion: 'Windows 11',
      storageClassification: 'os_encrypted',
      testedAt: '2026-07-27T01:00:00.000Z',
      recorder: 'release-operator',
      results,
    },
  ],
  redactionAttestation: true,
};

const signedResults = {
  ...results,
  manifestSignature: true,
  platformSignature: true,
  healthyStartRollback: true,
};
const signedFixture = {
  ...structuredClone(fixture),
  schema: 2,
  artifacts: ['darwin-universal.zip', 'linux-x64.zip', 'win32-x64.zip', 'agent.tgz'].map(
    (name, index) => ({ name, sha256: String(index + 1).repeat(64) })
  ),
  cohorts: [
    { ...structuredClone(fixture.cohorts[0]), results: signedResults },
    {
      ...structuredClone(fixture.cohorts[1]),
      environmentClass: 'physical-windows-x64',
      results: signedResults,
    },
  ],
};

test('acceptance validation is exact and rejects sensitive or incomplete evidence', () => {
  assert.equal(validateAcceptance(structuredClone(fixture)).schema, 1);
  assert.equal(
    validateAcceptance({
      ...structuredClone(fixture),
      candidateVersion: '0.1.0',
      releaseTag: 'v0.1.0',
    }).candidateVersion,
    '0.1.0'
  );
  assert.throws(() => validateAcceptance({ ...structuredClone(fixture), notes: 'not allowed' }));
  const leaked = structuredClone(fixture);
  leaked.cohorts[0].recorder = 'adr_live_secretmaterial';
  assert.throws(() => validateAcceptance(leaked), /credential-shaped/);
  const failed = structuredClone(fixture);
  failed.cohorts[1].results.turn = false;
  assert.throws(() => validateAcceptance(failed), /turn did not pass/);
  const noWindows = structuredClone(fixture);
  noWindows.cohorts[1].os = 'ubuntu';
  noWindows.cohorts[1].runtimeVersion = 'Ubuntu 24.04';
  assert.throws(() => validateAcceptance(noWindows), /physical Windows 11 x64/);
  const wrongWindows = structuredClone(fixture);
  wrongWindows.cohorts[1].runtimeVersion = 'Windows 10';
  assert.throws(() => validateAcceptance(wrongWindows), /identify Windows 11/);
});

test('signed acceptance requires primary and physical Windows 11 x64 cohorts', () => {
  assert.equal(validateAcceptance(structuredClone(signedFixture)).schema, 2);
  const wrongWindowsArchitecture = structuredClone(signedFixture);
  wrongWindowsArchitecture.cohorts[1].architecture = 'arm64';
  assert.throws(() => validateAcceptance(wrongWindowsArchitecture), /x64/);
  const legacyForSignedManifest = structuredClone(fixture);
  assert.throws(
    () =>
      validateAcceptance(legacyForSignedManifest, {
        schema: 4,
        releaseVersion: legacyForSignedManifest.candidateVersion,
        releaseTag: legacyForSignedManifest.releaseTag,
        sourceCommit: legacyForSignedManifest.sourceCommit,
        files: [],
      }),
    /schema 2/
  );
});

test('published JSON schema stays exact with the executable validator contract', () => {
  assert.equal(jsonSchema.$id, 'https://adrouter.co/schemas/authentication-acceptance-v2.json');
  assert.equal(jsonSchema.properties.artifacts.minItems, ACCEPTANCE_ARTIFACT_COUNT);
  assert.equal(jsonSchema.properties.artifacts.maxItems, ACCEPTANCE_ARTIFACT_COUNT);
  assert.equal(jsonSchema.properties.cohorts.minItems, ACCEPTANCE_COHORT_COUNT);
  assert.equal(jsonSchema.properties.cohorts.maxItems, ACCEPTANCE_COHORT_COUNT);
  assert.deepEqual(
    Object.keys(jsonSchema.properties.cohorts.items.properties.results.properties).sort(),
    signedResultKeys.slice().sort()
  );

  const conditional = (schema) =>
    jsonSchema.allOf.find((candidate) => candidate.if.properties.schema.const === schema).then
      .properties.cohorts;
  const legacy = conditional(LEGACY_ACCEPTANCE_SCHEMA);
  const signed = conditional(SIGNED_ACCEPTANCE_SCHEMA);
  assert.deepEqual(legacy.items.properties.environmentClass.enum, [
    'primary-operator',
    'second-os',
  ]);
  assert.deepEqual(legacy.items.properties.results.required, resultKeys);
  assert.deepEqual(signed.items.properties.environmentClass.enum, [
    'primary-operator',
    'physical-windows-x64',
  ]);
  assert.deepEqual(signed.items.properties.results.required, signedResultKeys);
  assert.deepEqual(
    signed.allOf.map((entry) => entry.contains.properties.environmentClass.const),
    ['primary-operator', 'physical-windows-x64']
  );
});
