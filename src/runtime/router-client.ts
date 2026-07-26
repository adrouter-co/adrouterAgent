import type { Context, Tool } from '@earendil-works/pi-ai';
import { z } from 'zod';
import type {
  RouterDiagnostics,
  RouterModelDescriptor,
  RuntimeMode,
  ThinkingLevel,
} from '../shared/contracts';
import { containsSponsorKey, removeSponsorData } from '../shared/security';
import { NdjsonParser, type RouterStreamEvent } from './ndjson';

const ProfileSchema = z.object({}).passthrough();
const HealthSchema = z.object({ mode: z.enum(['live', 'mock']).optional() }).passthrough();
const ModelDescriptorSchema = z.object({
  id: z.string(),
  provider: z.string().optional(),
  display_name: z.string().optional(),
  provider_label: z.string().optional(),
  thinking_levels: z.array(z.enum(['none', 'medium', 'high'])).optional(),
  default_thinking_level: z.enum(['none', 'medium', 'high']).optional(),
  configured: z.boolean().optional(),
});
const ModelsSchema = z.union([
  z.array(z.string()),
  z.object({ models: z.array(z.union([z.string(), ModelDescriptorSchema])) }),
]);

const modelDescriptor = (
  value: string | z.infer<typeof ModelDescriptorSchema>
): RouterModelDescriptor => {
  if (typeof value === 'string') {
    return {
      id: value,
      provider: 'router',
      displayName: value,
      providerLabel: 'AdRouter',
      thinkingLevels: ['none', 'medium', 'high'],
      defaultThinkingLevel: 'medium',
      configured: false,
    };
  }
  const thinkingLevels = value.thinking_levels ?? ['none', 'medium', 'high'];
  const defaultThinkingLevel = value.default_thinking_level ?? 'medium';
  return {
    id: value.id,
    provider: value.provider ?? 'router',
    displayName: value.display_name ?? value.id,
    providerLabel: value.provider_label ?? value.provider ?? 'AdRouter',
    thinkingLevels,
    defaultThinkingLevel: thinkingLevels.includes(defaultThinkingLevel)
      ? defaultThinkingLevel
      : (thinkingLevels[0] ?? 'medium'),
    configured: value.configured ?? false,
  };
};

export class RouterHttpError extends Error {
  public constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'RouterHttpError';
  }
}

export interface RouterClientOptions {
  serverUrl: string;
  token: string;
  fetchFn?: typeof fetch;
}

export interface RouterTurnInput {
  model: string;
  thinkingLevel: ThinkingLevel;
  runtimeMode: RuntimeMode;
  messages: Context['messages'];
  tools: Tool[];
  systemPrompt?: string;
  projectDisplayName: string;
  adsEnabled: boolean;
  onRetry?: (attempt: number, reason: string) => void;
}

const normalizeServerUrl = (input: string): string => input.replace(/\/+$/, '');

const getMessageText = (context: Context): unknown[] =>
  context.messages.map((message) => {
    if (message.role === 'user') {
      return { role: 'user', content: message.content };
    }
    if (message.role === 'toolResult') {
      return {
        role: 'toolResult',
        toolCallId: message.toolCallId,
        toolName: message.toolName,
        content: message.content,
        isError: message.isError,
      };
    }
    return {
      role: 'assistant',
      content: message.content,
    };
  });

export class AdRouterClient {
  private readonly fetchFn: typeof fetch;
  private readonly serverUrl: string;

  public constructor(private readonly options: RouterClientOptions) {
    this.fetchFn = options.fetchFn ?? fetch;
    this.serverUrl = normalizeServerUrl(options.serverUrl);
  }

  public async diagnostics(signal?: AbortSignal): Promise<RouterDiagnostics> {
    const checkedAt = new Date().toISOString();
    const headers = { Authorization: `Bearer ${this.options.token}` };
    let health: Response;
    try {
      health = await this.fetchFn(`${this.serverUrl}/health`, { signal });
    } catch (error) {
      return {
        health: false,
        authenticated: false,
        mode: 'unknown',
        models: [],
        modelsStale: false,
        checkedAt,
        error: error instanceof Error ? error.message : 'AdRouter is unreachable.',
      };
    }
    if (!health.ok) {
      return {
        health: false,
        authenticated: false,
        mode: 'unknown',
        models: [],
        modelsStale: false,
        checkedAt,
        error: `AdRouter health check failed (${health.status}).`,
      };
    }
    const healthPayload = HealthSchema.parse(await health.json());

    let models: RouterModelDescriptor[] = [];
    try {
      const modelsResponse = await this.fetchFn(`${this.serverUrl}/v1/models`, { headers, signal });
      if (modelsResponse.ok) {
        const modelsPayload = ModelsSchema.parse(await modelsResponse.json());
        const rawModels = Array.isArray(modelsPayload) ? modelsPayload : modelsPayload.models;
        models = rawModels.map(modelDescriptor);
      }
    } catch {
      // Authentication is checked separately; model discovery failure is reported below.
    }

    try {
      const profile = await this.fetchFn(`${this.serverUrl}/v1/profile`, { headers, signal });
      if (!profile.ok) {
        return {
          health: true,
          authenticated: false,
          mode: healthPayload.mode ?? 'unknown',
          models,
          modelsStale: false,
          checkedAt,
          error: `AdRouter authentication failed (${profile.status}).`,
        };
      }
      ProfileSchema.parse(await profile.json());
    } catch (error) {
      return {
        health: true,
        authenticated: false,
        mode: healthPayload.mode ?? 'unknown',
        models,
        modelsStale: false,
        checkedAt,
        error: error instanceof Error ? error.message : 'AdRouter authentication failed.',
      };
    }

    return {
      health: true,
      authenticated: true,
      mode: healthPayload.mode ?? 'unknown',
      models,
      modelsStale: false,
      checkedAt,
      error: models.length > 0 ? null : 'AdRouter returned no models.',
    };
  }

  public async *turn(
    input: RouterTurnInput,
    signal?: AbortSignal
  ): AsyncGenerator<RouterStreamEvent> {
    const requestBody = {
      model: input.model,
      thinking_level: input.thinkingLevel,
      runtime_mode: input.runtimeMode,
      context: removeSponsorData({
        systemPrompt: input.systemPrompt,
        messages: getMessageText({ messages: input.messages }),
        tools: input.tools,
      }),
      metadata: {
        client: 'adrouter-agent-desktop',
        workspace: input.projectDisplayName,
        ads_enabled: input.adsEnabled,
      },
    };

    if (containsSponsorKey(requestBody.context)) {
      throw new Error('Sponsor data was rejected before reaching the router model context.');
    }

    let response: Response | undefined;
    let lastError: unknown;
    for (let attempt = 0; attempt <= 2; attempt += 1) {
      try {
        response = await this.fetchFn(`${this.serverUrl}/v1/agent/turn`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.options.token}`,
            'Content-Type': 'application/json',
            Accept: 'application/x-ndjson, application/json',
          },
          body: JSON.stringify(requestBody),
          signal,
        });
        if (response.ok) {
          break;
        }
        const retryable = response.status === 409 || response.status === 502;
        const message = await response.text();
        if (!retryable || attempt === 2) {
          throw new RouterHttpError(
            response.status,
            message || `AdRouter returned ${response.status}.`
          );
        }
        input.onRetry?.(attempt + 1, `AdRouter returned ${response.status}.`);
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 250 * (attempt + 1)));
      } catch (error) {
        lastError = error;
        if (signal?.aborted || error instanceof RouterHttpError || attempt === 2) {
          throw error;
        }
        input.onRetry?.(attempt + 1, error instanceof Error ? error.message : String(error));
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 250 * (attempt + 1)));
      }
    }

    if (!response?.ok || !response.body) {
      throw lastError instanceof Error
        ? lastError
        : new Error('AdRouter returned no response body.');
    }

    const reader = response.body.getReader();
    const parser = new NdjsonParser();
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      const parsed = parser.push(value);
      for (const parseError of parsed.errors) {
        yield { type: 'error', message: parseError, code: 'malformed_event' };
      }
      yield* parsed.events;
    }
    const final = parser.finish();
    for (const parseError of final.errors) {
      yield { type: 'error', message: parseError, code: 'malformed_event' };
    }
    yield* final.events;
  }
}
