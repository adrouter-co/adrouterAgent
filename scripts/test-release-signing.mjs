import { generateKeyPairSync } from 'node:crypto';
import { trustedReleaseKeyId } from '../packages/agent-launcher/lib/manifest.mjs';

export const createTestReleaseSigning = () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const publicJwk = publicKey.export({ format: 'jwk' });
  const keyId = trustedReleaseKeyId(publicJwk);
  return {
    privateKey,
    keyId,
    issuedAt: '2026-08-02T00:00:00.000Z',
    expiresAt: '2026-12-31T00:00:00.000Z',
    minimumAgentVersion: '0.1.0-beta.12',
    macTeamIdentifier: 'TESTTEAM01',
    windowsSignerSubject: 'CN=AdRouter Agent Test Fixture',
    trustedKeys: [
      {
        keyId,
        algorithm: 'Ed25519',
        publicKey: publicJwk,
        channels: ['beta', 'stable'],
        notBefore: '2026-08-01T00:00:00.000Z',
        notAfter: '2027-01-01T00:00:00.000Z',
        status: 'active',
      },
    ],
  };
};
