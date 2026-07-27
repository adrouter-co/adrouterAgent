import { app, type IpcMainInvokeEvent, ipcMain, shell, type WebContents } from 'electron';
import { sandboxReadiness } from '../runtime/platform';
import {
  ApprovalSchema,
  type IpcMethod,
  IpcSchemas,
  type JournalEvent,
  ThreadDetailSchema,
} from '../shared/contracts';
import { createId } from '../shared/security';
import type { ConfigurationStore } from './configuration-store';
import type { AppDatabase } from './database';
import type { InstallationAuthManager } from './installation-auth';
import type { RepositoryService } from './repository-service';
import type { ReviewService } from './review-service';
import type { RuntimeSupervisor } from './runtime-supervisor';

const PUBLIC_RELEASE_VERSION = '0.1.0-beta.8';

interface Subscription {
  id: string;
  webContents: WebContents;
  threadId: string;
}

export class EventSubscriptions {
  private readonly subscriptions = new Map<string, Subscription>();

  public subscribe(webContents: WebContents, threadId: string): string {
    const id = createId();
    this.subscriptions.set(id, { id, webContents, threadId });
    webContents.once('destroyed', () => this.removeByWebContents(webContents));
    return id;
  }

  public unsubscribe(webContents: WebContents, id: string): boolean {
    const subscription = this.subscriptions.get(id);
    if (!subscription || subscription.webContents !== webContents) {
      return false;
    }
    this.subscriptions.delete(id);
    return true;
  }

  public publish(event: JournalEvent): void {
    for (const subscription of this.subscriptions.values()) {
      if (subscription.threadId === event.threadId && !subscription.webContents.isDestroyed()) {
        subscription.webContents.send('adrouter:event', {
          subscriptionId: subscription.id,
          event,
        });
      }
    }
  }

  private removeByWebContents(webContents: WebContents): void {
    for (const [id, subscription] of this.subscriptions) {
      if (subscription.webContents === webContents) {
        this.subscriptions.delete(id);
      }
    }
  }
}

const assertTrustedSender = (event: IpcMainInvokeEvent): void => {
  const frame = event.senderFrame;
  if (!frame || frame !== event.sender.mainFrame) {
    throw new Error('Rejected IPC from a non-main renderer frame.');
  }
  const url = new URL(frame.url);
  if (url.protocol !== 'app:' || url.hostname !== 'renderer') {
    throw new Error('Rejected IPC from an untrusted renderer frame.');
  }
};

type Handler = (input: unknown, event: IpcMainInvokeEvent) => Promise<unknown> | unknown;

const register = (method: IpcMethod, handler: Handler): void => {
  ipcMain.handle(`adrouter:${method}`, async (event, rawInput) => {
    assertTrustedSender(event);
    const schemas = IpcSchemas[method];
    const input = schemas.input.parse(rawInput);
    const result = await handler(input, event);
    return schemas.output.parse(result);
  });
};

export interface IpcDependencies {
  database: AppDatabase;
  configuration: ConfigurationStore;
  repositories: RepositoryService;
  review: ReviewService;
  supervisor: RuntimeSupervisor;
  installationAuth: InstallationAuthManager;
}

export const registerIpcHandlers = (dependencies: IpcDependencies): EventSubscriptions => {
  const { configuration, database, installationAuth, repositories, review, supervisor } =
    dependencies;
  const subscriptions = new EventSubscriptions();
  const publishLastEvent = (threadId: string): void => {
    const event = database.listEvents(threadId).at(-1);
    if (event) {
      subscriptions.publish(event);
    }
  };

  register('configuration.get', () => configuration.get());
  register('configuration.save', (raw) =>
    configuration.save(IpcSchemas['configuration.save'].input.parse(raw))
  );
  register('configuration.testRouter', (raw) =>
    configuration.test(IpcSchemas['configuration.testRouter'].input.parse(raw))
  );
  register('configuration.status', () => installationAuth.diagnostics());
  register('configuration.signOut', () => {
    if (supervisor.activeThreadId) {
      throw new Error('Stop the active agent task before signing out.');
    }
    return installationAuth.signOut();
  });
  register('configuration.startEnrollment', (raw) =>
    installationAuth.startEnrollment(IpcSchemas['configuration.startEnrollment'].input.parse(raw))
  );
  register('configuration.enrollmentStatus', () => installationAuth.enrollmentStatus());
  register('configuration.cancelEnrollment', () => installationAuth.cancelEnrollment());
  register('configuration.openEnrollment', async () => {
    const url = await installationAuth.approvalUrl();
    await shell.openExternal(url);
    return { ok: true };
  });
  register('configuration.updatePreferences', (raw) =>
    configuration.updatePreferences(IpcSchemas['configuration.updatePreferences'].input.parse(raw))
  );

  register('projects.open', async (raw) => {
    const input = IpcSchemas['projects.open'].input.parse(raw);
    return repositories.open(input.path);
  });
  register('projects.list', () => database.listProjects());
  register('projects.get', (raw) => {
    const project = database.getProject(IpcSchemas['projects.get'].input.parse(raw).id);
    if (!project) {
      throw new Error('Project not found.');
    }
    return project;
  });
  register('projects.update', (raw) => {
    const input = IpcSchemas['projects.update'].input.parse(raw);
    return database.updateProject(input.id, {
      displayName: input.displayName,
      instructions: input.instructions,
      permissionMode: input.permissionMode,
    });
  });
  register('projects.remove', (raw) => {
    database.removeProject(IpcSchemas['projects.remove'].input.parse(raw).id);
    return { ok: true };
  });

  register('threads.create', (raw) => {
    const input = IpcSchemas['threads.create'].input.parse(raw);
    return database.createThread({
      projectId: input.projectId,
      title: input.title,
      model: input.model,
      thinkingLevel: input.thinkingLevel,
    });
  });
  register('threads.list', (raw) =>
    database.listThreads(IpcSchemas['threads.list'].input.parse(raw).projectId)
  );
  register('threads.get', (raw) =>
    ThreadDetailSchema.parse(
      database.getThreadDetail(IpcSchemas['threads.get'].input.parse(raw).id)
    )
  );
  register('threads.archive', (raw) =>
    database.archiveThread(IpcSchemas['threads.archive'].input.parse(raw).id)
  );
  register('threads.delete', (raw) => {
    const id = IpcSchemas['threads.delete'].input.parse(raw).id;
    if (supervisor.activeThreadId === id) throw new Error('A running chat cannot be deleted.');
    database.deleteThread(id);
    return { ok: true };
  });

  register('turns.start', async (raw) => {
    const input = IpcSchemas['turns.start'].input.parse(raw);
    if (supervisor.activeThreadId) {
      throw new Error('Only one agent task can run at a time.');
    }
    const thread = database.getThread(input.threadId);
    if (!thread) {
      throw new Error('Thread not found.');
    }
    const history = database.listEvents(input.threadId).map((event) => ({
      type: event.type,
      turnId: event.turnId,
      payload: event.payload,
      timestamp: event.timestamp,
    }));
    const storedConfiguration = await configuration.get();
    const selectedModel = storedConfiguration.models.find((model) => model.id === input.model);
    if (!selectedModel) throw new Error('The selected model is not available from AdRouter.');
    if (!selectedModel.thinkingLevels.includes(input.thinkingLevel)) {
      throw new Error('The selected thinking level is not supported by this model.');
    }
    const router = await configuration.getRuntimeConfiguration();
    database.updateThreadPreferences(input.threadId, input.model, input.thinkingLevel);
    const turn = database.createTurn(input.threadId, input.input, input.model, input.thinkingLevel);
    const queuedEvent = database.listEvents(input.threadId).at(-1);
    database.updateTurnStatus(turn.id, 'preparing');
    const preparingEvent = database.listEvents(input.threadId).at(-1);
    const userEvent = database.appendEvent(input.threadId, turn.id, 'message.user', {
      role: 'user',
      text: input.input,
    });
    database.updateThreadStatus(input.threadId, 'running');
    const threadRunningEvent = database.listEvents(input.threadId).at(-1);
    for (const event of [queuedEvent, preparingEvent, userEvent, threadRunningEvent]) {
      if (event) {
        subscriptions.publish(event);
      }
    }
    try {
      await supervisor.start({ ...input, turnId: turn.id, history }, router);
    } catch (error) {
      database.updateTurnStatus(
        turn.id,
        'failed',
        error instanceof Error ? error.message : String(error)
      );
      database.updateThreadStatus(input.threadId, 'failed');
      throw error;
    }
    const savedTurn = database.getTurn(turn.id);
    if (!savedTurn) {
      throw new Error('Turn could not be loaded after creation.');
    }
    return savedTurn;
  });
  register('turns.steer', (raw) => {
    const input = IpcSchemas['turns.steer'].input.parse(raw);
    supervisor.steer(input.threadId, input.input);
    return { ok: true };
  });
  register('turns.queueFollowUp', (raw) => {
    const input = IpcSchemas['turns.queueFollowUp'].input.parse(raw);
    supervisor.queueFollowUp(input.threadId, input.input);
    return { ok: true };
  });
  register('turns.stop', (raw) => {
    supervisor.stop(IpcSchemas['turns.stop'].input.parse(raw).threadId);
    return { ok: true };
  });

  register('approvals.resolve', (raw) => {
    const input = IpcSchemas['approvals.resolve'].input.parse(raw);
    supervisor.assertApprovalActive(input.approvalId);
    const approval = database.resolveApproval(input.approvalId, input.decision);
    const event = database.appendEvent(approval.threadId, approval.turnId, 'approval.resolved', {
      approvalId: approval.id,
      decision: approval.decision,
    });
    subscriptions.publish(event);
    database.updateTurnStatus(approval.turnId, 'running');
    publishLastEvent(approval.threadId);
    database.updateThreadStatus(approval.threadId, 'running');
    publishLastEvent(approval.threadId);
    supervisor.resolveApproval(approval.id, input.decision);
    return ApprovalSchema.parse(approval);
  });

  register('review.getDiff', (raw) => {
    const input = IpcSchemas['review.getDiff'].input.parse(raw);
    return review.getDiff(input.threadId, input.path);
  });
  register('review.revertFile', (raw) =>
    review.revertFile(
      IpcSchemas['review.revertFile'].input.parse(raw).threadId,
      IpcSchemas['review.revertFile'].input.parse(raw).path
    )
  );
  register('review.revertAll', (raw) =>
    review.revertAll(IpcSchemas['review.revertAll'].input.parse(raw).threadId)
  );
  register('review.accept', (raw) => {
    review.accept(IpcSchemas['review.accept'].input.parse(raw).threadId);
    return { ok: true };
  });
  register('review.openFile', (raw) => {
    const input = IpcSchemas['review.openFile'].input.parse(raw);
    return review.openFile(input.threadId, input.path).then(() => ({ ok: true }));
  });

  register('events.subscribe', (raw, event) => {
    const input = IpcSchemas['events.subscribe'].input.parse(raw);
    return { subscriptionId: subscriptions.subscribe(event.sender, input.threadId) };
  });
  register('events.unsubscribe', (raw, event) => {
    const input = IpcSchemas['events.unsubscribe'].input.parse(raw);
    if (!subscriptions.unsubscribe(event.sender, input.subscriptionId)) {
      throw new Error('Subscription not found.');
    }
    return { ok: true };
  });

  register('app.getInfo', () => ({
    name: app.getName(),
    version: PUBLIC_RELEASE_VERSION,
    platform: process.platform,
    architecture: process.arch,
    sandbox: sandboxReadiness(),
  }));
  register('app.getVersion', () => ({ version: PUBLIC_RELEASE_VERSION }));
  register('app.getPlatform', () => ({ platform: process.platform }));

  return subscriptions;
};
