import { describe, expect, it, vi } from 'vitest';
import { AdRouterClient, RouterHttpError } from '@/runtime/router-client';

const turnInput = {
  model: 'opaque-model',
  thinkingLevel: 'medium' as const,
  runtimeMode: 'mock' as const,
  messages: [{ role: 'user' as const, content: 'make a change', timestamp: Date.now() }],
  tools: [],
  projectDisplayName: 'safe-project',
  adsEnabled: true,
};

const collect = async <T>(stream: AsyncIterable<T>): Promise<T[]> => {
  const events: T[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
};

describe('AdRouterClient', () => {
  it('validates onboarding routes and keeps sponsorship out of model request context', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchFn: typeof fetch = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith('/health')) return new Response('{}', { status: 200 });
      if (url.endsWith('/v1/profile')) return new Response('{}', { status: 200 });
      if (url.endsWith('/v1/models'))
        return new Response(
          JSON.stringify({
            models: [
              {
                id: 'opaque-model',
                provider: 'opaque',
                display_name: 'Opaque Model',
                provider_label: 'Opaque Labs',
                thinking_levels: ['none', 'high'],
                default_thinking_level: 'high',
                configured: true,
              },
            ],
          }),
          { status: 200 }
        );
      return new Response(
        '{"type":"ad","ad":{"turn_id":"turn-1","tier":"B","sponsor":{"brand_name":"Acme","ad_copy":"Hello","click_url":"https://acme.example"},"provisional_savings":0.4}}\n{"type":"text","content":"done"}\n{"type":"done","assistant":{"content":"done"}}\n',
        { status: 200 }
      );
    });
    const client = new AdRouterClient({
      serverUrl: 'https://router.example',
      token: 'never-log-me',
      fetchFn,
    });

    await expect(client.diagnostics()).resolves.toMatchObject({
      health: true,
      authenticated: true,
      models: [
        {
          id: 'opaque-model',
          displayName: 'Opaque Model',
          providerLabel: 'Opaque Labs',
          thinkingLevels: ['none', 'high'],
          defaultThinkingLevel: 'high',
          configured: true,
        },
      ],
    });
    const events = await collect(client.turn(turnInput));

    const body = JSON.parse(String(calls.at(-1)?.init?.body)) as Record<string, unknown>;
    expect(body.metadata).toEqual({
      client: 'adrouter-agent-desktop',
      workspace: 'safe-project',
      ads_enabled: true,
    });
    expect(body.runtime_mode).toBe('mock');
    expect(body).not.toHaveProperty('messages');
    expect(body).not.toHaveProperty('tools');
    expect(body.context).toMatchObject({
      messages: [{ role: 'user', content: 'make a change' }],
      tools: [],
    });
    expect(JSON.stringify(body.context)).not.toContain('Acme');
    expect(events.map((event) => event.type)).toEqual(['ad', 'text', 'done']);
  });

  it('uses the hosted router default when runtime mode is auto', async () => {
    const fetchFn: typeof fetch = vi.fn(
      async () => new Response('{"type":"done"}\n', { status: 200 })
    );
    const client = new AdRouterClient({
      serverUrl: 'https://router.example',
      token: 'never-log-me',
      fetchFn,
    });

    await collect(client.turn({ ...turnInput, runtimeMode: 'auto' }));

    const body = JSON.parse(String(vi.mocked(fetchFn).mock.calls[0]?.[1]?.body)) as Record<
      string,
      unknown
    >;
    expect(body).not.toHaveProperty('runtime_mode');
  });

  it('retries transient 409/502 responses but fails closed on authentication errors', async () => {
    const retries: string[] = [];
    const transientFetch: typeof fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('busy', { status: 409 }))
      .mockResolvedValueOnce(new Response('upstream unavailable', { status: 502 }))
      .mockResolvedValueOnce(new Response('{"type":"done"}\n', { status: 200 }));
    const transientClient = new AdRouterClient({
      serverUrl: 'https://router.example',
      token: 'never-log-me',
      fetchFn: transientFetch,
    });

    await expect(
      collect(
        transientClient.turn({
          ...turnInput,
          onRetry: (attempt, reason) => retries.push(`${attempt}:${reason}`),
        })
      )
    ).resolves.toEqual([{ type: 'done', usage: {} }]);
    expect(retries).toHaveLength(2);

    const unauthorizedClient = new AdRouterClient({
      serverUrl: 'https://router.example',
      token: 'never-log-me',
      fetchFn: vi.fn(async () => new Response('unauthorized', { status: 401 })),
    });
    await expect(collect(unauthorizedClient.turn(turnInput))).rejects.toBeInstanceOf(
      RouterHttpError
    );
  });

  it('propagates cancellation without a retry', async () => {
    let resolveStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve;
    });
    const fetchFn: typeof fetch = vi.fn(
      async (_input: URL | RequestInfo, init?: RequestInit): Promise<Response> => {
        resolveStarted?.();
        return await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          });
        });
      }
    );
    const client = new AdRouterClient({
      serverUrl: 'https://router.example',
      token: 'never-log-me',
      fetchFn,
    });
    const controller = new AbortController();
    const pending = collect(client.turn(turnInput, controller.signal));
    await started;
    controller.abort();

    await expect(pending).rejects.toThrow('aborted');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
