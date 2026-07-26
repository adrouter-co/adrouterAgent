import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const serverUrl = process.env.ADROUTER_API_URL?.replace(/\/+$/, '');
const token = process.env.ADROUTER_API_KEY;
if (!serverUrl || !token) {
  throw new Error('Set ADROUTER_API_URL and ADROUTER_API_KEY to run the optional live smoke test.');
}
const workspace = await mkdtemp(join(tmpdir(), 'adrouter-live-smoke-'));
const headers = { authorization: `Bearer ${token}` };
try {
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
      runtime_mode: 'auto',
      context: {
        systemPrompt: 'This is a bounded read-only connectivity check. Do not call tools.',
        messages: [{ role: 'user', content: 'Reply with READY only.' }],
        tools: [],
      },
      metadata: { client: 'adrouter-agent-live-smoke', workspace, ads_enabled: false },
    }),
  });
  if (!response.ok) throw new Error(`Agent turn failed with HTTP ${response.status}.`);
  const body = await response.text();
  if (!body.split(/\r?\n/).some((line) => line && JSON.parse(line).type === 'done')) {
    throw new Error('The live router stream ended without a done event.');
  }
  console.log(`Live router smoke passed for model ${model}.`);
} finally {
  await rm(workspace, { recursive: true, force: true });
}
