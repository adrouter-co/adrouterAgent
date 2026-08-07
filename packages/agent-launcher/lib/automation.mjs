import { spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createConnection } from 'node:net';
import { applicationExecutablePath } from './installer.mjs';

const PROTOCOL_VERSION = 1;
const MAX_FRAME_BYTES = 1024 * 1024;
const METHODS = new Set([
  'diagnostics.get',
  'projects.list',
  'tasks.start',
  'tasks.list',
  'tasks.get',
  'tasks.events',
  'tasks.stop',
  'approvals.list',
  'approvals.resolve',
]);

const canonicalize = (value) =>
  Array.isArray(value)
    ? value.map(canonicalize)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.entries(value)
            .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
            .map(([key, nested]) => [key, canonicalize(nested)])
        )
      : value;

const digest = (value) =>
  createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');

export const signingPayload = (fields) => JSON.stringify(canonicalize(fields));

export async function runAutomationKeyHelper(appPath, artifact, request, options = {}) {
  const platform = options.platform ?? process.platform;
  const executable = applicationExecutablePath(appPath, artifact, platform);
  const spawnImpl = options.spawnImpl ?? spawn;
  return await new Promise((resolveResponse, rejectResponse) => {
    const child = spawnImpl(executable, ['--automation-key-helper'], {
      env: process.env,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = Buffer.alloc(0);
    let stderrBytes = 0;
    let settled = false;
    let timeout;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      rejectResponse(error);
    };
    timeout = setTimeout(() => {
      child.kill('SIGTERM');
      fail(new Error('The installed automation key helper timed out.'));
    }, options.timeoutMs ?? 15_000);
    timeout.unref?.();
    child.once('error', fail);
    child.stdout.on('data', (chunk) => {
      stdout = Buffer.concat([stdout, chunk]);
      if (stdout.byteLength > MAX_FRAME_BYTES) {
        child.kill('SIGTERM');
        fail(new Error('The automation key-helper response exceeded 1 MiB.'));
      }
    });
    child.stderr.on('data', (chunk) => {
      stderrBytes += chunk.byteLength;
      if (stderrBytes > MAX_FRAME_BYTES) child.kill('SIGTERM');
    });
    child.once('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      let response;
      try {
        response = JSON.parse(stdout.toString('utf8').trim());
      } catch {
        rejectResponse(new Error('The installed automation key helper returned invalid JSON.'));
        return;
      }
      if (code !== 0 || response?.ok !== true || !response.result) {
        rejectResponse(new Error(response?.error ?? 'The installed automation key helper failed.'));
        return;
      }
      resolveResponse(response.result);
    });
    const frame = `${JSON.stringify(request)}\n`;
    if (Buffer.byteLength(frame) > MAX_FRAME_BYTES) {
      child.kill('SIGTERM');
      fail(new Error('The automation key-helper request exceeded 1 MiB.'));
      return;
    }
    child.stdin.end(frame);
  });
}

export async function sendLocalRpc(endpoint, request, options = {}) {
  const connectImpl = options.connectImpl ?? createConnection;
  return await new Promise((resolveResponse, rejectResponse) => {
    const socket = connectImpl(endpoint);
    let bytes = Buffer.alloc(0);
    let settled = false;
    let timeout;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      rejectResponse(error);
    };
    timeout = setTimeout(() => {
      socket.destroy();
      fail(new Error('The local Agent RPC request timed out.'));
    }, options.timeoutMs ?? 30_000);
    timeout.unref?.();
    socket.once('error', fail);
    socket.on('data', (chunk) => {
      bytes = Buffer.concat([bytes, chunk]);
      if (bytes.byteLength > MAX_FRAME_BYTES) {
        socket.destroy();
        fail(new Error('The local Agent RPC response exceeded 1 MiB.'));
        return;
      }
      const newline = bytes.indexOf(0x0a);
      if (newline < 0) return;
      socket.end();
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try {
        const response = JSON.parse(bytes.subarray(0, newline).toString('utf8'));
        if (response?.version !== PROTOCOL_VERSION || response?.requestId !== request.requestId) {
          rejectResponse(new Error('The local Agent RPC response binding is invalid.'));
          return;
        }
        resolveResponse(response);
      } catch {
        rejectResponse(new Error('The local Agent RPC response is not valid JSON.'));
      }
    });
    socket.once('connect', () => {
      const frame = `${JSON.stringify(request)}\n`;
      if (Buffer.byteLength(frame) > MAX_FRAME_BYTES) {
        socket.destroy();
        fail(new Error('The local Agent RPC request exceeded 1 MiB.'));
        return;
      }
      socket.write(frame);
    });
  });
}

const wait = (milliseconds) => new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));

const endpointUnavailable = (error) =>
  error &&
  typeof error === 'object' &&
  ['ENOENT', 'ECONNREFUSED', 'ECONNRESET', 'EPIPE'].includes(error.code);

export async function pairAutomation(appPath, artifact, options = {}) {
  const helper =
    options.helper ?? ((request) => runAutomationKeyHelper(appPath, artifact, request, options));
  const rpc = options.rpc ?? ((endpoint, request) => sendLocalRpc(endpoint, request, options));
  const key = await helper({ method: 'key.generate' });
  const endpoint = (await helper({ method: 'endpoint' })).endpoint;
  const request = {
    version: PROTOCOL_VERSION,
    requestId: randomUUID(),
    method: 'pair.request',
    params: {
      displayName: options.displayName ?? '@adrouter/agent CLI',
      publicKey: key.publicKey,
      scopes: options.scopes ?? [
        'diagnostics:read',
        'tasks:read',
        'tasks:write',
        'approvals:resolve',
      ],
    },
  };
  let bound = false;
  try {
    const readyUntil =
      (options.readinessNow?.() ?? Date.now()) + (options.readinessTimeoutMs ?? 15_000);
    let created;
    for (;;) {
      try {
        created = await rpc(endpoint, request);
        break;
      } catch (error) {
        if (!endpointUnavailable(error) || (options.readinessNow?.() ?? Date.now()) >= readyUntil) {
          throw error;
        }
        await (options.wait ?? wait)(options.readinessPollMs ?? 250);
      }
    }
    if (!created?.ok || !created.result?.pairing) {
      throw new Error(created?.error?.message ?? 'The Agent rejected the pairing request.');
    }
    const pairing = created.result.pairing;
    options.onPairing?.(pairing);
    const expiresAt = Date.parse(pairing.expiresAt);
    while ((options.now?.() ?? Date.now()) < expiresAt) {
      await (options.wait ?? wait)(options.pollMs ?? 2_000);
      const status = await rpc(endpoint, {
        version: PROTOCOL_VERSION,
        requestId: randomUUID(),
        method: 'pair.status',
        params: { pairingId: pairing.id },
      });
      const current = status?.result?.pairing;
      if (current?.status === 'approved' && current.clientId) {
        await helper({ method: 'key.bind', keyId: key.keyId, clientId: current.clientId });
        bound = true;
        return { pairing: current, keyId: key.keyId, endpoint };
      }
      if (current?.status === 'denied' || current?.status === 'expired') {
        throw new Error(`The Agent ${current.status} the automation pairing request.`);
      }
    }
    throw new Error('The automation pairing request expired before GUI approval.');
  } finally {
    if (!bound) await helper({ method: 'key.delete', keyId: key.keyId }).catch(() => undefined);
  }
}

export async function callAutomation(appPath, artifact, method, params = {}, options = {}) {
  if (!METHODS.has(method)) throw new Error(`Unsupported local RPC method ${method}.`);
  const helper =
    options.helper ?? ((request) => runAutomationKeyHelper(appPath, artifact, request, options));
  const rpc = options.rpc ?? ((endpoint, request) => sendLocalRpc(endpoint, request, options));
  const keys = (await helper({ method: 'key.list' })).keys ?? [];
  const candidates = keys.filter((key) => key.clientId);
  const key = options.keyId
    ? candidates.find((candidate) => candidate.keyId === options.keyId)
    : candidates.length === 1
      ? candidates[0]
      : undefined;
  if (!key) {
    throw new Error(
      candidates.length > 1
        ? 'Multiple paired keys exist; select one with --key.'
        : 'No paired automation key exists; run adrouter-agent pair first.'
    );
  }
  const endpoint = (await helper({ method: 'endpoint' })).endpoint;
  const fields = {
    version: PROTOCOL_VERSION,
    requestId: randomUUID(),
    clientId: key.clientId,
    method,
    paramsDigest: digest(params),
    nonce: randomBytes(24).toString('base64url'),
    timestamp: new Date().toISOString(),
  };
  const signed = await helper({
    method: 'key.sign',
    keyId: key.keyId,
    payload: signingPayload(fields),
  });
  const response = await rpc(endpoint, { ...fields, params, signature: signed.signature });
  if (!response?.ok)
    throw new Error(response?.error?.message ?? 'The local Agent RPC call failed.');
  return response.result;
}
