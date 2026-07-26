import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const serverUrl = (process.env.ADROUTER_API_URL ?? 'https://api-staging.adrouter.co').replace(
  /\/+$/,
  ''
);
const token = process.env.ADROUTER_API_KEY;
if (!token) {
  throw new Error('Set ADROUTER_API_KEY to run the optional live staging smoke test.');
}
const workspace = await mkdtemp(join(tmpdir(), 'adrouter-live-smoke-'));
const headers = { authorization: `Bearer ${token}` };
try {
  const healthResponse = await fetch(`${serverUrl}/health`);
  if (!healthResponse.ok)
    throw new Error(`Health check failed with HTTP ${healthResponse.status}.`);
  const profileResponse = await fetch(`${serverUrl}/v1/profile`, { headers });
  if (!profileResponse.ok) {
    throw new Error(`Authentication failed with HTTP ${profileResponse.status}.`);
  }
  const modelsResponse = await fetch(`${serverUrl}/v1/models`, { headers });
  if (!modelsResponse.ok)
    throw new Error(`Model discovery failed with HTTP ${modelsResponse.status}.`);
  const payload = await modelsResponse.json();
  const first = Array.isArray(payload) ? payload[0] : payload.models?.[0];
  const model = typeof first === 'string' ? first : first?.id;
  if (!model) throw new Error('The router returned no models.');

  const response = await fetch(`${serverUrl}/v1/agent/turn`, {
    method: 'POST',
    headers: {
      ...headers,
      accept: 'application/x-ndjson',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      thinking_level: 'medium',
      context: {
        systemPrompt: 'This is a bounded read-only connectivity check. Do not call tools.',
        messages: [{ role: 'user', content: 'Reply with READY only.' }],
        tools: [],
      },
      metadata: { client: 'adrouter-agent-live-smoke', workspace, ads_enabled: false },
    }),
  });
  if (!response.ok) {
    const detail = (await response.text()).replace(token, '[credential]').slice(0, 500);
    throw new Error(
      `Agent turn failed with HTTP ${response.status}${detail ? `: ${detail}` : '.'}`
    );
  }
  const body = await response.text();
  if (!body.split(/\r?\n/).some((line) => line && JSON.parse(line).type === 'done')) {
    throw new Error('The live router stream ended without a done event.');
  }
  console.log(`Live router smoke passed for model ${model}.`);
} finally {
  await rm(workspace, { recursive: true, force: true });
}
