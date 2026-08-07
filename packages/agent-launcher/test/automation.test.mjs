import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { callAutomation, pairAutomation, signingPayload } from '../lib/automation.mjs';
import { runCli } from '../lib/cli.mjs';

const appPath = '/fixture/AdRouter Agent.app';
const artifact = { executablePath: 'Contents/MacOS/AdRouter Agent' };

test('pairing binds an approved GUI comparison code and protected key', async () => {
  const helperCalls = [];
  const rpcCalls = [];
  const helper = async (request) => {
    helperCalls.push(request);
    if (request.method === 'key.generate')
      return { keyId: 'a'.repeat(64), publicKey: 'fixture-key' };
    if (request.method === 'endpoint') return { endpoint: '/fixture/rpc.sock' };
    if (request.method === 'key.bind') return { keyId: request.keyId, clientId: request.clientId };
    throw new Error(`Unexpected helper method ${request.method}`);
  };
  const rpc = async (endpoint, request) => {
    rpcCalls.push({ endpoint, request });
    if (request.method === 'pair.request') {
      return {
        ok: true,
        result: {
          pairing: {
            id: '11111111-1111-4111-8111-111111111111',
            comparisonCode: '123-456',
            scopes: ['tasks:read'],
            status: 'pending',
            expiresAt: '2026-08-02T00:05:00.000Z',
            clientId: null,
          },
        },
      };
    }
    return {
      ok: true,
      result: {
        pairing: {
          id: request.params.pairingId,
          comparisonCode: '123-456',
          scopes: ['tasks:read'],
          status: 'approved',
          expiresAt: '2026-08-02T00:05:00.000Z',
          clientId: '22222222-2222-4222-8222-222222222222',
        },
      },
    };
  };
  let shown;
  const result = await pairAutomation(appPath, artifact, {
    helper,
    rpc,
    scopes: ['tasks:read'],
    now: () => Date.parse('2026-08-02T00:00:00.000Z'),
    wait: async () => undefined,
    onPairing: (pairing) => {
      shown = pairing.comparisonCode;
    },
  });
  assert.equal(shown, '123-456');
  assert.equal(result.pairing.clientId, '22222222-2222-4222-8222-222222222222');
  assert.deepEqual(helperCalls.at(-1), {
    method: 'key.bind',
    keyId: 'a'.repeat(64),
    clientId: '22222222-2222-4222-8222-222222222222',
  });
  assert.equal(rpcCalls[0].endpoint, '/fixture/rpc.sock');
  assert.deepEqual(rpcCalls[0].request.params.scopes, ['tasks:read']);
});

test('failed pairing deletes only the newly generated unbound key', async () => {
  const helperCalls = [];
  const helper = async (request) => {
    helperCalls.push(request);
    if (request.method === 'key.generate')
      return { keyId: 'b'.repeat(64), publicKey: 'fixture-key' };
    if (request.method === 'endpoint') return { endpoint: '/fixture/rpc.sock' };
    if (request.method === 'key.delete') return { deleted: true };
    throw new Error(`Unexpected helper method ${request.method}`);
  };
  await assert.rejects(
    pairAutomation(appPath, artifact, {
      helper,
      rpc: async () => ({ ok: false, error: { message: 'denied before queueing' } }),
    }),
    /denied before queueing/
  );
  assert.deepEqual(helperCalls.at(-1), { method: 'key.delete', keyId: 'b'.repeat(64) });
});

test('RPC calls sign the canonical method and parameter digest without exposing a private key', async () => {
  let signedPayload;
  let sentRequest;
  const params = { z: 1, nested: { beta: true, alpha: 'first' }, a: 2 };
  const helper = async (request) => {
    if (request.method === 'key.list') {
      return {
        keys: [
          {
            keyId: 'c'.repeat(64),
            clientId: '33333333-3333-4333-8333-333333333333',
          },
        ],
      };
    }
    if (request.method === 'endpoint') return { endpoint: '/fixture/rpc.sock' };
    if (request.method === 'key.sign') {
      signedPayload = request.payload;
      return { signature: Buffer.alloc(64, 7).toString('base64') };
    }
    throw new Error(`Unexpected helper method ${request.method}`);
  };
  const result = await callAutomation(appPath, artifact, 'tasks.list', params, {
    helper,
    rpc: async (_endpoint, request) => {
      sentRequest = request;
      return { ok: true, result: { tasks: [] } };
    },
  });
  assert.deepEqual(result, { tasks: [] });
  const expectedDigest = createHash('sha256')
    .update(JSON.stringify({ a: 2, nested: { alpha: 'first', beta: true }, z: 1 }))
    .digest('hex');
  assert.equal(sentRequest.paramsDigest, expectedDigest);
  const { params: _params, signature: _signature, ...fields } = sentRequest;
  assert.equal(signedPayload, signingPayload(fields));
  assert.equal('privateKey' in sentRequest, false);
});

test('RPC requires an explicit key selection when several paired keys exist', async () => {
  await assert.rejects(
    callAutomation(
      appPath,
      artifact,
      'diagnostics.get',
      {},
      {
        helper: async () => ({
          keys: [
            { keyId: 'd'.repeat(64), clientId: '44444444-4444-4444-8444-444444444444' },
            { keyId: 'e'.repeat(64), clientId: '55555555-5555-4555-8555-555555555555' },
          ],
        }),
      }
    ),
    /select one with --key/
  );
});

test('CLI pair and rpc commands preserve machine-readable stdout', async () => {
  const stdout = [];
  const stderr = [];
  const io = {
    stdout: { write: (value) => stdout.push(value) },
    stderr: { write: (value) => stderr.push(value) },
  };
  const manifest = { releaseVersion: '0.1.0-beta.12' };
  const common = {
    readManifest: async () => manifest,
    selectArtifact: () => artifact,
    inspectInstallation: async () => ({
      installed: true,
      receiptMatches: true,
      bundleIntegrity: true,
      applicationPath: appPath,
      warning: null,
    }),
    install: async () => appPath,
    launch: async () => undefined,
  };
  await runCli(['pair', '--json'], io, {
    ...common,
    pairAutomation: async (_path, _artifact, options) => {
      options.onPairing({ comparisonCode: '654-321' });
      return {
        keyId: 'f'.repeat(64),
        pairing: {
          clientId: '66666666-6666-4666-8666-666666666666',
          scopes: ['tasks:read'],
        },
      };
    },
  });
  assert.deepEqual(JSON.parse(stdout.at(-1)), {
    protocolVersion: 1,
    clientId: '66666666-6666-4666-8666-666666666666',
    keyId: 'f'.repeat(64),
    scopes: ['tasks:read'],
  });
  assert.match(stderr.join(''), /654-321/);

  stdout.length = 0;
  let invocation;
  await runCli(
    [
      'rpc',
      'tasks.list',
      '--params',
      '{"projectId":"77777777-7777-4777-8777-777777777777"}',
      '--json',
    ],
    io,
    {
      ...common,
      callAutomation: async (...values) => {
        invocation = values;
        return { tasks: [] };
      },
    }
  );
  assert.deepEqual(JSON.parse(stdout.at(-1)), { tasks: [] });
  assert.deepEqual(invocation[3], { projectId: '77777777-7777-4777-8777-777777777777' });
});
