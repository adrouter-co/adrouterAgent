import assert from 'node:assert/strict';
import test from 'node:test';
import { validateAcceptance } from './validate-authentication-acceptance.mjs';

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
  candidateVersion: '0.1.0-beta.9',
  releaseTag: 'v0.1.0-beta.9',
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
});
