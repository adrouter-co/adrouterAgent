import { type UtilityProcess, utilityProcess } from 'electron';
import { INSTALLATION_AUTH_PROTOCOL_VERSION, MAX_SIGNED_REQUEST_BYTES } from '../shared/constants';
import {
  type ApprovalDecision,
  ApprovalSchema,
  type EventType,
  type JournalEvent,
  SettlementSchema,
  type TurnStatus,
} from '../shared/contracts';
import {
  type RuntimeAuthRequest,
  type RuntimeEvent,
  type RuntimePortMessage,
  RuntimePortMessageSchema,
  type RuntimeRequest,
} from '../shared/runtime-protocol';
import { now, safeRecord } from '../shared/security';
import type { RuntimeRouterConfiguration } from './configuration-store';
import type { AppDatabase } from './database';
import type { InstallationAuthManager } from './installation-auth';

const terminalStatuses = new Set<TurnStatus>(['completed', 'failed', 'cancelled', 'interrupted']);

interface ActiveRuntime {
  threadId: string;
  turnId: string;
  child: UtilityProcess;
  closing: boolean;
  ready: Promise<void>;
  markReady: () => void;
  authMode: RuntimeRouterConfiguration['authMode'];
  authControllers: Map<string, AbortController>;
}

export interface StartRuntimeInput {
  threadId: string;
  turnId: string;
  input: string;
  model: string;
  thinkingLevel: 'none' | 'medium' | 'high';
  runtimeMode: 'auto' | 'mock' | 'live';
  history: Array<{
    type: EventType;
    turnId: string | null;
    payload: Record<string, unknown>;
    timestamp: string;
  }>;
}

export class RuntimeSupervisor {
  private active?: ActiveRuntime;

  public constructor(
    private readonly database: AppDatabase,
    private readonly runtimePath: string,
    private readonly emitJournalEvent: (event: JournalEvent) => void,
    private readonly installationAuth?: InstallationAuthManager
  ) {}

  public get activeThreadId(): string | undefined {
    return this.active?.threadId;
  }

  public async start(input: StartRuntimeInput, router: RuntimeRouterConfiguration): Promise<void> {
    if (this.active) {
      throw new Error('Another AdRouter Agent task is already running.');
    }
    const thread = this.database.getThread(input.threadId);
    if (!thread) {
      throw new Error('Thread not found.');
    }
    const project = this.database.getProject(thread.projectId);
    if (!project) {
      throw new Error('Project not found.');
    }

    const child = utilityProcess.fork(this.runtimePath, [], {
      serviceName: 'AdRouter Agent Runtime',
      stdio: 'ignore',
    });
    let markReady = (): void => undefined;
    const ready = new Promise<void>((resolve) => {
      markReady = resolve;
    });
    const active: ActiveRuntime = {
      threadId: input.threadId,
      turnId: input.turnId,
      child,
      closing: false,
      ready,
      markReady,
      authMode: router.authMode,
      authControllers: new Map(),
    };
    this.active = active;

    child.on('message', (message) => {
      void this.handlePortMessage(active, message).catch((error) =>
        this.handleCrash(active, error)
      );
    });
    child.once('error', (error) => this.handleCrash(active, error));
    child.once('exit', (code) => {
      if (!active.closing) {
        this.handleCrash(active, new Error(`The agent runtime exited with code ${code}.`));
      }
    });
    await Promise.race([
      active.ready,
      new Promise<never>((_resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error('The isolated agent runtime did not become ready.')),
          10_000
        );
        timeout.unref();
      }),
    ]);
    child.postMessage({
      kind: 'request',
      request: {
        type: 'start',
        threadId: input.threadId,
        turnId: input.turnId,
        project: {
          id: project.id,
          path: project.path,
          displayName: project.displayName,
          instructions: project.instructions,
          repositoryInstructions: project.repositoryInstructions,
          permissionMode: project.permissionMode,
        },
        model: input.model,
        thinkingLevel: input.thinkingLevel,
        runtimeMode: input.runtimeMode,
        sponsoredCompute: router.sponsoredCompute,
        router:
          router.authMode === 'installation'
            ? { authMode: 'installation', serverUrl: router.serverUrl }
            : {
                authMode: 'custom_bearer',
                serverUrl: router.serverUrl,
                token: router.token,
              },
        input: input.input,
        history: input.history,
        allowedCommands: [],
      },
    } satisfies RuntimePortMessage);
  }

  public steer(threadId: string, input: string): void {
    this.send(this.getActive(threadId), { type: 'steer', input });
  }

  public queueFollowUp(threadId: string, input: string): void {
    this.send(this.getActive(threadId), {
      type: 'queue-follow-up',
      input,
    });
  }

  public stop(threadId: string): void {
    const active = this.getActive(threadId);
    this.rejectPendingApprovals(active, 'The task was stopped.');
    this.send(active, { type: 'stop' });
    setTimeout(() => {
      if (this.active === active) {
        this.finish(active, 'cancelled', null);
      }
    }, 5_000).unref();
  }

  public resolveApproval(approvalId: string, decision: ApprovalDecision): void {
    const approval = this.database.getApproval(approvalId);
    if (!approval) {
      throw new Error('Approval not found.');
    }
    this.send(this.getActive(approval.threadId), {
      type: 'approval',
      approvalId,
      decision,
    });
  }

  public assertApprovalActive(approvalId: string): void {
    const approval = this.database.getApproval(approvalId);
    if (!approval || approval.decision) {
      throw new Error('Approval is not pending.');
    }
    const active = this.getActive(approval.threadId);
    if (active.turnId !== approval.turnId) {
      throw new Error('Approval does not belong to the active turn.');
    }
  }

  private getActive(threadId: string): ActiveRuntime {
    if (!this.active || this.active.threadId !== threadId) {
      throw new Error('This thread has no active agent runtime.');
    }
    return this.active;
  }

  private send(active: ActiveRuntime, request: RuntimeRequest): void {
    active.child.postMessage({ kind: 'request', request } satisfies RuntimePortMessage);
  }

  private async handlePortMessage(active: ActiveRuntime, raw: unknown): Promise<void> {
    const message = RuntimePortMessageSchema.parse(raw);
    if (message.kind === 'ready') {
      active.markReady();
      return;
    }
    if (message.kind === 'auth-request') {
      await this.handleAuthRequest(active, message);
      return;
    }
    if (message.kind === 'auth-cancel') {
      active.authControllers.get(message.requestId)?.abort();
      active.authControllers.delete(message.requestId);
      return;
    }
    if (message.kind !== 'event') {
      return;
    }
    await this.handleRuntimeEvent(active, message.event);
  }

  private async handleAuthRequest(
    active: ActiveRuntime,
    request: RuntimeAuthRequest
  ): Promise<void> {
    if (
      this.active !== active ||
      active.closing ||
      active.authMode !== 'installation' ||
      !this.installationAuth
    ) {
      this.sendAuthFailure(active, request.requestId, 'Installation signing is unavailable.');
      return;
    }
    const body =
      request.bodyBase64 === undefined ? undefined : Buffer.from(request.bodyBase64, 'base64');
    if (
      (body?.byteLength ?? 0) > MAX_SIGNED_REQUEST_BYTES ||
      (body !== undefined && body.toString('base64') !== request.bodyBase64)
    ) {
      this.sendAuthFailure(active, request.requestId, 'The signing request body is invalid.');
      return;
    }
    const controller = new AbortController();
    active.authControllers.set(request.requestId, controller);
    try {
      const headers = await this.installationAuth.authorize({
        method: request.method,
        path: request.path,
        body,
        nonce: request.nonce,
        signal: controller.signal,
      });
      if (this.active === active && !active.closing && !controller.signal.aborted) {
        active.child.postMessage({
          kind: 'auth-response',
          protocolVersion: INSTALLATION_AUTH_PROTOCOL_VERSION,
          requestId: request.requestId,
          ok: true,
          headers,
        } satisfies RuntimePortMessage);
      }
    } catch {
      if (!controller.signal.aborted) {
        this.sendAuthFailure(
          active,
          request.requestId,
          'The protected router request was not authorized.'
        );
      }
    } finally {
      active.authControllers.delete(request.requestId);
    }
  }

  private sendAuthFailure(active: ActiveRuntime, requestId: string, error: string): void {
    if (this.active !== active || active.closing) return;
    active.child.postMessage({
      kind: 'auth-response',
      protocolVersion: INSTALLATION_AUTH_PROTOCOL_VERSION,
      requestId,
      ok: false,
      error,
    } satisfies RuntimePortMessage);
  }

  private async handleRuntimeEvent(
    active: ActiveRuntime,
    runtimeEvent: RuntimeEvent
  ): Promise<void> {
    if (this.active !== active) {
      return;
    }
    const payload = safeRecord(runtimeEvent.payload);
    if (runtimeEvent.type === 'approval.request') {
      const approval = ApprovalSchema.parse({
        ...payload,
        id: payload.id,
        threadId: active.threadId,
        turnId: active.turnId,
        decision: null,
        resolvedAt: null,
      });
      this.database.createApproval(approval);
    }
    if (runtimeEvent.type === 'file.change') {
      this.database.recordFileMutation({
        threadId: active.threadId,
        path: String(payload.path),
        status: String(payload.status),
        beforeBase64: typeof payload.beforeBase64 === 'string' ? payload.beforeBase64 : null,
        afterBase64: typeof payload.afterBase64 === 'string' ? payload.afterBase64 : null,
        beforeHash: typeof payload.beforeHash === 'string' ? payload.beforeHash : null,
        afterHash: typeof payload.afterHash === 'string' ? payload.afterHash : null,
      });
      delete payload.beforeBase64;
      delete payload.afterBase64;
    }
    if (runtimeEvent.type === 'settlement') {
      const settlement = SettlementSchema.parse(payload);
      if (!this.database.addRouterOutcome(active.threadId, active.turnId, settlement)) {
        return;
      }
    }
    if (runtimeEvent.type === 'turn.lifecycle') {
      const status = payload.status as TurnStatus;
      const error = typeof payload.error === 'string' ? payload.error : null;
      this.database.updateTurnStatus(active.turnId, status, error);
      this.emitLastEvent(active.threadId);
      if (status === 'awaiting_approval') {
        this.setThreadStatus(active.threadId, 'awaiting_approval');
      } else if (status === 'preparing' || status === 'running') {
        this.setThreadStatus(active.threadId, 'running');
      } else if (terminalStatuses.has(status)) {
        this.finish(active, status, error);
      }
      return;
    }

    const event = this.database.appendEvent(
      active.threadId,
      runtimeEvent.turnId,
      runtimeEvent.type as EventType,
      payload
    );
    this.emitJournalEvent(event);
  }

  private setThreadStatus(
    threadId: string,
    status: 'idle' | 'running' | 'awaiting_approval' | 'failed'
  ): void {
    this.database.updateThreadStatus(threadId, status);
    this.emitLastEvent(threadId);
  }

  private finish(active: ActiveRuntime, status: TurnStatus, error: string | null): void {
    if (this.active !== active) {
      return;
    }
    this.rejectPendingApprovals(
      active,
      status === 'cancelled'
        ? 'The task was cancelled.'
        : 'The agent runtime ended before this approval was resolved.'
    );
    const turn = this.database.getTurn(active.turnId);
    if (turn?.status !== status) {
      this.database.updateTurnStatus(active.turnId, status, error);
      this.emitLastEvent(active.threadId);
    }
    this.setThreadStatus(active.threadId, status === 'failed' ? 'failed' : 'idle');
    const evidence = this.database.appendEvent(
      active.threadId,
      active.turnId,
      'final.evidence',
      this.database.buildEvidence(active.threadId, active.turnId)
    );
    this.emitJournalEvent(evidence);
    active.closing = true;
    for (const controller of active.authControllers.values()) controller.abort();
    active.authControllers.clear();
    active.child.kill();
    this.active = undefined;
  }

  private rejectPendingApprovals(active: ActiveRuntime, reason: string): void {
    for (const approval of this.database.denyPendingApprovalsForTurn(active.turnId)) {
      const event = this.database.appendEvent(active.threadId, active.turnId, 'approval.resolved', {
        approvalId: approval.id,
        decision: 'deny',
        reason,
      });
      this.emitJournalEvent(event);
    }
  }

  private handleCrash(active: ActiveRuntime, error: unknown): void {
    if (this.active !== active) {
      return;
    }
    const event = this.database.appendEvent(active.threadId, active.turnId, 'runtime.crash', {
      error: error instanceof Error ? error.message : String(error),
      timestamp: now(),
    });
    this.emitJournalEvent(event);
    this.finish(active, 'interrupted', 'The isolated agent runtime stopped unexpectedly.');
  }

  private emitLastEvent(threadId: string): void {
    const event = this.database.listEvents(threadId).at(-1);
    if (event) {
      this.emitJournalEvent(event);
    }
  }
}
