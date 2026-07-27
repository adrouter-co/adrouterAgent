import { Agent, type AgentEvent, type AgentMessage } from '@earendil-works/pi-agent-core';
import type { AssistantMessage } from '@earendil-works/pi-ai';
import {
  AgentSession,
  AuthStorage,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent';
import type { ApprovalDecision, Sponsor } from '../shared/contracts';
import type { RuntimeEvent, RuntimeStartSchema } from '../shared/runtime-protocol';
import { containsSponsorKey, now, removeSponsorData, safeRecord } from '../shared/security';
import { SandboxedCommandRunner } from './command-runner';
import { createAdRouterPiProvider } from './pi-provider';
import { sandboxReadiness } from './platform';
import {
  AdRouterClient,
  type ProtectedRouterHeaders,
  type ProtectedRouterRequest,
} from './router-client';
import { createDesktopTools, type ToolApproval } from './tools';

type RuntimeStart = typeof RuntimeStartSchema._output;

const toText = (content: unknown): string => {
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return '';
  }
  return content
    .filter((block): block is { type: 'text'; text: string } =>
      Boolean(block && typeof block === 'object' && (block as { type?: unknown }).type === 'text')
    )
    .map((block) => block.text)
    .join('');
};

const zeroUsage: AssistantMessage['usage'] = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

export const toAgentThinkingLevel = (
  level: RuntimeStart['thinkingLevel']
): 'off' | 'medium' | 'high' => (level === 'none' ? 'off' : level);

export const normalizeAssistantContent = (value: unknown): AssistantMessage['content'] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((rawBlock): AssistantMessage['content'] => {
    const block = safeRecord(rawBlock);
    if (block.type === 'text' && typeof block.text === 'string') {
      return [{ type: 'text', text: block.text }];
    }
    if (
      block.type === 'toolCall' &&
      typeof block.id === 'string' &&
      typeof block.name === 'string'
    ) {
      return [
        {
          type: 'toolCall',
          id: block.id,
          name: block.name,
          arguments: safeRecord(removeSponsorData(block.arguments)),
        },
      ];
    }
    // Hidden thinking is deliberately not persisted or reconstructed.
    return [];
  });
};

export const historyToMessages = (history: RuntimeStart['history']): AgentMessage[] => {
  const messages: AgentMessage[] = [];
  for (const event of history) {
    if (containsSponsorKey(event.payload)) {
      continue;
    }
    if (event.type === 'message.user' && typeof event.payload.text === 'string') {
      messages.push({
        role: 'user',
        content: event.payload.text,
        timestamp: Date.parse(event.timestamp),
      });
    }
    if (event.type === 'message.complete' && typeof event.payload.text === 'string') {
      const structuredContent = normalizeAssistantContent(event.payload.content);
      messages.push({
        role: 'assistant',
        content:
          structuredContent.length > 0
            ? structuredContent
            : [{ type: 'text', text: event.payload.text }],
        api: 'adrouter',
        provider: 'adrouter',
        model: typeof event.payload.model === 'string' ? event.payload.model : 'unknown',
        usage: structuredClone(zeroUsage),
        stopReason: structuredContent.some((block) => block.type === 'toolCall')
          ? 'toolUse'
          : 'stop',
        timestamp: Date.parse(event.timestamp),
      });
    }
    if (event.type === 'tool.result') {
      const payload = safeRecord(event.payload);
      const toolCallId = typeof payload.toolCallId === 'string' ? payload.toolCallId : undefined;
      const toolName = typeof payload.name === 'string' ? payload.name : undefined;
      const toolOutput = typeof payload.output === 'string' ? payload.output : undefined;
      if (toolCallId && toolName && toolOutput) {
        messages.push({
          role: 'toolResult',
          toolCallId,
          toolName,
          content: [{ type: 'text', text: toolOutput }],
          isError: Boolean(payload.isError),
          timestamp: Date.parse(event.timestamp),
        });
      }
    }
  }
  return messages;
};

const systemPrompt = (input: RuntimeStart): string =>
  [
    'You are AdRouter Agent, a careful desktop coding agent.',
    'Work only through the supplied desktop tools. Do not ask for shell strings; use argv arrays.',
    'Respect repository instructions and project permissions. Explain plans and final evidence concisely.',
    'Never discuss, request, infer, or use sponsor data. Sponsorship is not part of your task context.',
    input.project.repositoryInstructions
      ? `Repository instructions:\n${input.project.repositoryInstructions}`
      : '',
    input.project.instructions ? `User project instructions:\n${input.project.instructions}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

const describeImportantMessage = (message: AgentMessage): string | undefined => {
  if (!('content' in message)) {
    return undefined;
  }
  if (message.role === 'user') {
    return `USER GOAL OR CONSTRAINT:\n${toText(message.content)}`;
  }
  if (message.role === 'toolResult') {
    const text = toText(message.content);
    if (message.isError) {
      return `UNRESOLVED TOOL ERROR (${message.toolName}):\n${text}`;
    }
    if (message.toolName === 'apply_patch') {
      return `RECORDED FILE MODIFICATION:\n${text}`;
    }
    if (message.toolName === 'run_command' && /"exitCode":(?!0\b)/.test(text)) {
      return `UNRESOLVED COMMAND FAILURE:\n${text}`;
    }
    return undefined;
  }
  const text = toText(message.content);
  if (/\b(plan|acceptance criteria|in progress|pending|todo)\b/i.test(text)) {
    return `RECORDED PLAN CONTEXT:\n${text}`;
  }
  return undefined;
};

const historyAnchors = (history: RuntimeStart['history']): string[] =>
  history.flatMap((event) => {
    if (containsSponsorKey(event.payload)) {
      return [];
    }
    if (event.type === 'approval.resolved') {
      return [`APPROVAL DECISION: ${JSON.stringify(event.payload)}`];
    }
    if (event.type === 'file.change' || event.type === 'diff.change') {
      return [`FILE STATE: ${JSON.stringify(event.payload)}`];
    }
    if (event.type === 'runtime.crash') {
      return [`UNRESOLVED RUNTIME ERROR: ${JSON.stringify(event.payload)}`];
    }
    return [];
  });

export const compactMessages = (
  messages: AgentMessage[],
  emit: (event: RuntimeEvent) => void,
  anchors: readonly string[] = []
): AgentMessage[] => {
  const characterCount = messages.reduce(
    (count, message) => count + toText('content' in message ? message.content : '').length,
    0
  );
  if (characterCount < 100_000 || messages.length < 24) {
    return messages;
  }
  const kept = messages.slice(-20);
  const retainedContext = messages
    .slice(0, -20)
    .map(describeImportantMessage)
    .filter((value): value is string => Boolean(value));
  const summary: AgentMessage = {
    role: 'user',
    content: [
      'Earlier verbose context was compacted. The following durable context is retained verbatim where available.',
      ...anchors,
      ...retainedContext,
      'Continue from the recent messages and re-read files when needed.',
    ].join('\n\n'),
    timestamp: Date.now(),
  };
  emit({
    type: 'compaction',
    turnId: null,
    timestamp: now(),
    payload: { droppedMessages: messages.length - kept.length, characterCount },
  });
  return [summary, ...kept];
};

export class DesktopAgentSession {
  private session?: AgentSession;
  private currentSponsor: Sponsor | null = null;
  private readonly pendingApprovals = new Map<
    string,
    { resolve: (decision: ApprovalDecision) => void; cleanup: () => void }
  >();
  private stopped = false;
  private readonly compactionAnchors: string[];

  public constructor(
    private readonly start: RuntimeStart,
    private readonly emit: (event: RuntimeEvent) => void,
    private readonly authorize?: (
      request: ProtectedRouterRequest
    ) => Promise<ProtectedRouterHeaders>
  ) {
    this.compactionAnchors = historyAnchors(start.history);
  }

  public async run(): Promise<void> {
    const router = new AdRouterClient({
      serverUrl: this.start.router.serverUrl,
      authentication:
        this.start.router.authMode === 'installation'
          ? {
              mode: 'installation',
              authorize:
                this.authorize ??
                (() =>
                  Promise.reject(new Error('The installation signing broker is unavailable.'))),
            }
          : { mode: 'custom_bearer', token: this.start.router.token },
    });
    const provider = createAdRouterPiProvider({
      client: router,
      modelId: this.start.model,
      thinkingLevel: this.start.thinkingLevel,
      runtimeMode: this.start.runtimeMode,
      projectDisplayName: this.start.project.displayName,
      adsEnabled: this.start.sponsoredCompute,
      onSponsor: (sponsor) => {
        this.currentSponsor = sponsor as Sponsor;
        this.emit({
          type: 'sponsor.update',
          turnId: this.start.turnId,
          timestamp: now(),
          payload: safeRecord(sponsor),
        });
      },
      onSettlement: (settlement) => {
        this.emit({
          type: 'settlement',
          turnId: this.start.turnId,
          timestamp: now(),
          payload: { ...settlement, sponsor: this.currentSponsor },
        });
      },
      onRetry: (attempt, reason) => {
        this.emit({
          type: 'retry',
          turnId: this.start.turnId,
          timestamp: now(),
          payload: { attempt, reason },
        });
      },
    });

    const commandRunner = new SandboxedCommandRunner();
    const sandbox = sandboxReadiness();
    const tools = createDesktopTools({
      workspaceRoot: this.start.project.path,
      permissionMode: this.start.project.permissionMode,
      threadId: this.start.threadId,
      turnId: this.start.turnId,
      commandRunner,
      allowedCommands: this.start.allowedCommands,
      commandsEnabled: sandbox.status === 'ready',
      requestApproval: (approval, signal) => this.requestApproval(approval, signal),
      emit: (type, payload) =>
        this.emit({ type, turnId: this.start.turnId, timestamp: now(), payload }),
    });

    const agent = new Agent({
      initialState: {
        model: provider.model,
        thinkingLevel: toAgentThinkingLevel(this.start.thinkingLevel),
        systemPrompt: systemPrompt(this.start),
        tools,
        messages: historyToMessages(this.start.history),
      },
      streamFn: provider.stream,
      steeringMode: 'one-at-a-time',
      followUpMode: 'one-at-a-time',
      toolExecution: 'sequential',
      transformContext: async (messages) =>
        compactMessages(messages, this.emit, this.compactionAnchors),
    });
    const authStorage = AuthStorage.inMemory({ adrouter: { type: 'api_key', key: 'runtime' } });
    const modelRegistry = ModelRegistry.inMemory(authStorage);
    modelRegistry.registerProvider('adrouter', {
      name: 'AdRouter',
      baseUrl: provider.model.baseUrl,
      apiKey: 'runtime',
      api: provider.model.api,
      streamSimple: provider.stream,
      models: [provider.model],
    });
    const settingsManager = SettingsManager.inMemory({
      steeringMode: 'one-at-a-time',
      followUpMode: 'one-at-a-time',
    });
    const resourceLoader = new DefaultResourceLoader({
      cwd: this.start.project.path,
      agentDir: this.start.project.path,
      settingsManager,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      systemPrompt: systemPrompt(this.start),
    });
    this.session = new AgentSession({
      agent,
      sessionManager: SessionManager.inMemory(this.start.project.path),
      settingsManager,
      cwd: this.start.project.path,
      resourceLoader,
      modelRegistry,
      baseToolsOverride: Object.fromEntries(tools.map((tool) => [tool.name, tool])),
      allowedToolNames: tools.map((tool) => tool.name),
    });
    this.session.subscribe((event) => this.forwardAgentEvent(event as AgentEvent));

    this.emit({
      type: 'turn.lifecycle',
      turnId: this.start.turnId,
      timestamp: now(),
      payload: { status: 'running' },
    });
    try {
      await this.session.prompt(this.start.input, { expandPromptTemplates: false });
      const status =
        this.stopped || this.session.state.errorMessage
          ? this.stopped
            ? 'cancelled'
            : 'failed'
          : 'completed';
      this.emit({
        type: 'turn.lifecycle',
        turnId: this.start.turnId,
        timestamp: now(),
        payload: { status, error: this.session.state.errorMessage ?? null },
      });
    } catch (error) {
      this.emit({
        type: 'turn.lifecycle',
        turnId: this.start.turnId,
        timestamp: now(),
        payload: {
          status: this.stopped ? 'cancelled' : 'failed',
          error: error instanceof Error ? error.message : String(error),
        },
      });
    } finally {
      await commandRunner.reset().catch(() => undefined);
    }
  }

  public steer(input: string): void {
    this.emit({
      type: 'message.user',
      turnId: this.start.turnId,
      timestamp: now(),
      payload: { role: 'user', text: input, mode: 'steer' },
    });
    void this.session?.steer(input);
  }

  public queueFollowUp(input: string): void {
    this.emit({
      type: 'message.user',
      turnId: this.start.turnId,
      timestamp: now(),
      payload: { role: 'user', text: input, mode: 'follow-up' },
    });
    void this.session?.followUp(input);
  }

  public stop(): void {
    this.stopped = true;
    this.session?.clearQueue();
    void this.session?.abort();
    for (const [, pending] of this.pendingApprovals) {
      pending.cleanup();
      pending.resolve('deny');
    }
    this.pendingApprovals.clear();
  }

  public resolveApproval(approvalId: string, decision: ApprovalDecision): boolean {
    const pending = this.pendingApprovals.get(approvalId);
    if (!pending) {
      return false;
    }
    this.pendingApprovals.delete(approvalId);
    pending.cleanup();
    pending.resolve(decision);
    this.compactionAnchors.push(`APPROVAL DECISION: ${approvalId} = ${decision}`);
    return true;
  }

  private async requestApproval(
    request: ToolApproval,
    signal?: AbortSignal
  ): Promise<ApprovalDecision> {
    if (this.stopped || signal?.aborted) {
      return 'deny';
    }
    this.emit({
      type: 'approval.request',
      turnId: this.start.turnId,
      timestamp: now(),
      payload: {
        ...request,
        threadId: this.start.threadId,
        turnId: this.start.turnId,
        createdAt: now(),
      },
    });
    this.emit({
      type: 'turn.lifecycle',
      turnId: this.start.turnId,
      timestamp: now(),
      payload: { status: 'awaiting_approval' },
    });

    return await new Promise<ApprovalDecision>((resolveDecision) => {
      const abort = (): void => {
        this.pendingApprovals.delete(request.id);
        resolveDecision('deny');
      };
      signal?.addEventListener('abort', abort, { once: true });
      this.pendingApprovals.set(request.id, {
        resolve: (decision) => {
          signal?.removeEventListener('abort', abort);
          resolveDecision(decision);
        },
        cleanup: () => signal?.removeEventListener('abort', abort),
      });
    });
  }

  private forwardAgentEvent(event: AgentEvent): void {
    if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') {
      this.emit({
        type: 'message.delta',
        turnId: this.start.turnId,
        timestamp: now(),
        payload: { role: 'assistant', text: event.assistantMessageEvent.delta },
      });
      return;
    }
    if (event.type === 'message_update' && event.assistantMessageEvent.type === 'thinking_delta') {
      this.emit({
        type: 'thinking.delta',
        turnId: this.start.turnId,
        timestamp: now(),
        payload: { text: event.assistantMessageEvent.delta },
      });
      return;
    }
    if (event.type === 'message_end' && event.message.role === 'assistant') {
      const text = toText(event.message.content);
      const content = normalizeAssistantContent(event.message.content);
      if (text || content.some((block) => block.type === 'toolCall')) {
        this.emit({
          type: 'message.complete',
          turnId: this.start.turnId,
          timestamp: now(),
          payload: { role: 'assistant', text, content, model: event.message.model },
        });
      }
      return;
    }
    if (event.type === 'tool_execution_start') {
      this.emit({
        type: 'tool.activity',
        turnId: this.start.turnId,
        timestamp: now(),
        payload: {
          recordKind: 'agent-tool-result',
          name: event.toolName,
          state: 'started',
          toolCallId: event.toolCallId,
          args: event.args,
        },
      });
      return;
    }
    if (event.type === 'tool_execution_end') {
      const result = safeRecord(event.result);
      const output = toText(result.content);
      this.emit({
        type: 'tool.result',
        turnId: this.start.turnId,
        timestamp: now(),
        payload: {
          name: event.toolName,
          toolCallId: event.toolCallId,
          output,
          isError: event.isError,
          details: result.details ?? {},
        },
      });
    }
  }
}
