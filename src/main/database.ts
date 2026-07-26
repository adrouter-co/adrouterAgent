import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  type Approval,
  type ApprovalDecision,
  ApprovalSchema,
  type DiffFile,
  EventSchema,
  type EventType,
  type JournalEvent,
  type Project,
  ProjectSchema,
  type Settlement,
  SettlementSchema,
  type Thread,
  ThreadSchema,
  type ThreadStatus,
  type Turn,
  TurnSchema,
  type TurnStatus,
} from '../shared/contracts';
import { createId, now, safeRecord } from '../shared/security';

interface ProjectRow {
  id: string;
  path: string;
  display_name: string;
  instructions: string;
  repository_instructions: string;
  repository_instruction_files: string;
  permission_mode: string;
  git_metadata: string;
  created_at: string;
  updated_at: string;
}

interface ThreadRow {
  id: string;
  project_id: string;
  title: string;
  model: string;
  thinking_level: string;
  status: string;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

interface TurnRow {
  id: string;
  thread_id: string;
  input: string;
  model: string;
  thinking_level: string;
  status: string;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

interface EventRow {
  id: string;
  thread_id: string;
  turn_id: string | null;
  sequence: number;
  type: string;
  timestamp: string;
  payload: string;
}

interface ApprovalRow {
  id: string;
  thread_id: string;
  turn_id: string;
  kind: string;
  argv: string | null;
  path: string | null;
  cwd: string;
  risk: string;
  reason: string;
  decision: string | null;
  created_at: string;
  resolved_at: string | null;
}

interface BaselineRow {
  thread_id: string;
  path: string;
  original_bytes: string | null;
  original_hash: string | null;
  latest_agent_hash: string | null;
  latest_status: string;
}

const migrations = [
  `
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      instructions TEXT NOT NULL,
      permission_mode TEXT NOT NULL,
      git_metadata TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS threads (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      model TEXT NOT NULL,
      thinking_level TEXT NOT NULL,
      status TEXT NOT NULL,
      archived_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS threads_by_project ON threads(project_id, updated_at DESC);
    CREATE TABLE IF NOT EXISTS turns (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      input TEXT NOT NULL,
      status TEXT NOT NULL,
      error TEXT,
      created_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT
    );
    CREATE INDEX IF NOT EXISTS turns_by_thread ON turns(thread_id, created_at ASC);
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      turn_id TEXT REFERENCES turns(id) ON DELETE SET NULL,
      sequence INTEGER NOT NULL,
      type TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      payload TEXT NOT NULL,
      UNIQUE(thread_id, sequence)
    );
    CREATE INDEX IF NOT EXISTS events_by_thread ON events(thread_id, sequence ASC);
    CREATE TABLE IF NOT EXISTS approvals (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      argv TEXT,
      path TEXT,
      cwd TEXT NOT NULL,
      risk TEXT NOT NULL,
      reason TEXT NOT NULL,
      decision TEXT,
      created_at TEXT NOT NULL,
      resolved_at TEXT
    );
    CREATE INDEX IF NOT EXISTS approvals_by_thread ON approvals(thread_id, created_at ASC);
    CREATE TABLE IF NOT EXISTS file_baselines (
      thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      path TEXT NOT NULL,
      original_bytes TEXT,
      original_hash TEXT,
      latest_agent_hash TEXT,
      latest_status TEXT NOT NULL,
      PRIMARY KEY(thread_id, path)
    );
    CREATE TABLE IF NOT EXISTS file_mutations (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      path TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      forward_patch TEXT NOT NULL,
      reverse_patch TEXT NOT NULL,
      before_hash TEXT,
      after_hash TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(thread_id, ordinal)
    );
    CREATE INDEX IF NOT EXISTS mutations_by_thread_path ON file_mutations(thread_id, path, ordinal ASC);
    CREATE TABLE IF NOT EXISTS router_outcomes (
      router_turn_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      turn_id TEXT REFERENCES turns(id) ON DELETE SET NULL,
      settlement TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS outcomes_by_thread ON router_outcomes(thread_id, created_at ASC);
  `,
  `
    ALTER TABLE projects ADD COLUMN repository_instructions TEXT NOT NULL DEFAULT '';
    ALTER TABLE projects ADD COLUMN repository_instruction_files TEXT NOT NULL DEFAULT '[]';
    UPDATE projects
    SET repository_instructions = instructions,
        repository_instruction_files = CASE WHEN instructions = '' THEN '[]' ELSE '["legacy imported instructions"]' END,
        instructions = '';
  `,
  `
    ALTER TABLE turns ADD COLUMN model TEXT NOT NULL DEFAULT '';
    ALTER TABLE turns ADD COLUMN thinking_level TEXT NOT NULL DEFAULT 'medium';
    UPDATE threads
    SET thinking_level = 'none'
    WHERE thinking_level IN ('off', 'minimal', 'low');
    UPDATE turns
    SET model = (SELECT threads.model FROM threads WHERE threads.id = turns.thread_id),
        thinking_level = (SELECT threads.thinking_level FROM threads WHERE threads.id = turns.thread_id);
  `,
];

const fromProjectRow = (row: ProjectRow): Project =>
  ProjectSchema.parse({
    id: row.id,
    path: row.path,
    displayName: row.display_name,
    instructions: row.instructions,
    repositoryInstructions: row.repository_instructions,
    repositoryInstructionFiles: JSON.parse(row.repository_instruction_files),
    permissionMode: row.permission_mode,
    git: JSON.parse(row.git_metadata),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });

const fromThreadRow = (row: ThreadRow): Thread =>
  ThreadSchema.parse({
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    model: row.model,
    thinkingLevel: row.thinking_level,
    status: row.status,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });

const fromTurnRow = (row: TurnRow): Turn =>
  TurnSchema.parse({
    id: row.id,
    threadId: row.thread_id,
    input: row.input,
    model: row.model,
    thinkingLevel: row.thinking_level,
    status: row.status,
    error: row.error,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  });

const fromEventRow = (row: EventRow): JournalEvent =>
  EventSchema.parse({
    id: row.id,
    threadId: row.thread_id,
    turnId: row.turn_id,
    sequence: row.sequence,
    type: row.type,
    timestamp: row.timestamp,
    payload: JSON.parse(row.payload),
  });

const fromApprovalRow = (row: ApprovalRow): Approval =>
  ApprovalSchema.parse({
    id: row.id,
    threadId: row.thread_id,
    turnId: row.turn_id,
    kind: row.kind,
    argv: row.argv ? JSON.parse(row.argv) : null,
    path: row.path,
    cwd: row.cwd,
    risk: row.risk,
    reason: row.reason,
    decision: row.decision,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  });

export class AppDatabase {
  private readonly database: DatabaseSync;

  public constructor(private readonly databasePath: string) {
    mkdirSync(dirname(databasePath), { recursive: true });
    const isExisting = existsSync(databasePath);
    this.database = new DatabaseSync(databasePath, {
      enableForeignKeyConstraints: true,
      timeout: 5_000,
    });
    this.migrate(isExisting);
  }

  public close(): void {
    this.database.close();
  }

  public createProject(
    input: Omit<
      Project,
      'id' | 'createdAt' | 'updatedAt' | 'repositoryInstructions' | 'repositoryInstructionFiles'
    > &
      Partial<Pick<Project, 'repositoryInstructions' | 'repositoryInstructionFiles'>>
  ): Project {
    const createdAt = now();
    const project: Project = {
      ...input,
      repositoryInstructions: input.repositoryInstructions ?? '',
      repositoryInstructionFiles: input.repositoryInstructionFiles ?? [],
      id: createId(),
      createdAt,
      updatedAt: createdAt,
    };
    this.database
      .prepare(
        `INSERT INTO projects (id, path, display_name, instructions, repository_instructions, repository_instruction_files, permission_mode, git_metadata, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        project.id,
        project.path,
        project.displayName,
        project.instructions,
        project.repositoryInstructions,
        JSON.stringify(project.repositoryInstructionFiles),
        project.permissionMode,
        JSON.stringify(project.git),
        project.createdAt,
        project.updatedAt
      );
    return project;
  }

  public listProjects(): Project[] {
    return (
      this.database
        .prepare('SELECT * FROM projects ORDER BY updated_at DESC')
        .all() as unknown as ProjectRow[]
    ).map(fromProjectRow);
  }

  public getProject(id: string): Project | undefined {
    const row = this.database.prepare('SELECT * FROM projects WHERE id = ?').get(id) as unknown as
      | ProjectRow
      | undefined;
    return row ? fromProjectRow(row) : undefined;
  }

  public getProjectByPath(path: string): Project | undefined {
    const row = this.database
      .prepare('SELECT * FROM projects WHERE path = ?')
      .get(path) as unknown as ProjectRow | undefined;
    return row ? fromProjectRow(row) : undefined;
  }

  public updateProject(
    id: string,
    patch: Partial<
      Pick<
        Project,
        | 'displayName'
        | 'instructions'
        | 'repositoryInstructions'
        | 'repositoryInstructionFiles'
        | 'permissionMode'
        | 'git'
      >
    >
  ): Project {
    const project = this.getProject(id);
    if (!project) {
      throw new Error('Project not found.');
    }
    const updated: Project = {
      ...project,
      ...(patch.displayName === undefined ? {} : { displayName: patch.displayName }),
      ...(patch.instructions === undefined ? {} : { instructions: patch.instructions }),
      ...(patch.repositoryInstructions === undefined
        ? {}
        : { repositoryInstructions: patch.repositoryInstructions }),
      ...(patch.repositoryInstructionFiles === undefined
        ? {}
        : { repositoryInstructionFiles: patch.repositoryInstructionFiles }),
      ...(patch.permissionMode === undefined ? {} : { permissionMode: patch.permissionMode }),
      ...(patch.git === undefined ? {} : { git: patch.git }),
      updatedAt: now(),
    };
    this.database
      .prepare(
        `UPDATE projects SET display_name = ?, instructions = ?, repository_instructions = ?, repository_instruction_files = ?, permission_mode = ?, git_metadata = ?, updated_at = ? WHERE id = ?`
      )
      .run(
        updated.displayName,
        updated.instructions,
        updated.repositoryInstructions,
        JSON.stringify(updated.repositoryInstructionFiles),
        updated.permissionMode,
        JSON.stringify(updated.git),
        updated.updatedAt,
        updated.id
      );
    return updated;
  }

  public removeProject(id: string): void {
    this.database.prepare('DELETE FROM projects WHERE id = ?').run(id);
  }

  public createThread(
    input: Omit<Thread, 'id' | 'status' | 'archivedAt' | 'createdAt' | 'updatedAt'>
  ): Thread {
    const createdAt = now();
    const thread: Thread = {
      ...input,
      id: createId(),
      status: 'idle',
      archivedAt: null,
      createdAt,
      updatedAt: createdAt,
    };
    this.database
      .prepare(
        `INSERT INTO threads (id, project_id, title, model, thinking_level, status, archived_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        thread.id,
        thread.projectId,
        thread.title,
        thread.model,
        thread.thinkingLevel,
        thread.status,
        thread.archivedAt,
        thread.createdAt,
        thread.updatedAt
      );
    this.appendEvent(thread.id, null, 'thread.lifecycle', { status: 'idle' });
    return thread;
  }

  public listThreads(projectId: string): Thread[] {
    return (
      this.database
        .prepare(
          'SELECT * FROM threads WHERE project_id = ? AND archived_at IS NULL ORDER BY updated_at DESC'
        )
        .all(projectId) as unknown as ThreadRow[]
    ).map(fromThreadRow);
  }

  public getThread(id: string): Thread | undefined {
    const row = this.database.prepare('SELECT * FROM threads WHERE id = ?').get(id) as unknown as
      | ThreadRow
      | undefined;
    return row ? fromThreadRow(row) : undefined;
  }

  public updateThreadStatus(id: string, status: ThreadStatus): Thread {
    const thread = this.getThread(id);
    if (!thread) {
      throw new Error('Thread not found.');
    }
    const updatedAt = now();
    this.database
      .prepare('UPDATE threads SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, updatedAt, id);
    this.appendEvent(id, null, 'thread.lifecycle', { status });
    return { ...thread, status, updatedAt };
  }

  public updateThreadPreferences(
    id: string,
    model: string,
    thinkingLevel: Thread['thinkingLevel']
  ): Thread {
    const thread = this.getThread(id);
    if (!thread) throw new Error('Thread not found.');
    const updatedAt = now();
    this.database
      .prepare('UPDATE threads SET model = ?, thinking_level = ?, updated_at = ? WHERE id = ?')
      .run(model, thinkingLevel, updatedAt, id);
    return { ...thread, model, thinkingLevel, updatedAt };
  }

  public archiveThread(id: string): Thread {
    const thread = this.getThread(id);
    if (!thread) {
      throw new Error('Thread not found.');
    }
    const archivedAt = now();
    this.database
      .prepare('UPDATE threads SET archived_at = ?, updated_at = ? WHERE id = ?')
      .run(archivedAt, archivedAt, id);
    return { ...thread, archivedAt, updatedAt: archivedAt };
  }

  public deleteThread(id: string): void {
    const thread = this.getThread(id);
    if (!thread) throw new Error('Thread not found.');
    if (thread.status === 'running' || thread.status === 'awaiting_approval') {
      throw new Error('A running chat cannot be deleted.');
    }
    this.database.prepare('DELETE FROM threads WHERE id = ?').run(id);
  }

  public createTurn(
    threadId: string,
    input: string,
    model?: string,
    thinkingLevel?: Turn['thinkingLevel']
  ): Turn {
    const thread = this.getThread(threadId);
    if (!thread) throw new Error('Thread not found.');
    const createdAt = now();
    const turn: Turn = {
      id: createId(),
      threadId,
      input,
      model: model ?? thread.model,
      thinkingLevel: thinkingLevel ?? thread.thinkingLevel,
      status: 'queued',
      error: null,
      createdAt,
      startedAt: null,
      finishedAt: null,
    };
    this.database
      .prepare(
        `INSERT INTO turns (id, thread_id, input, model, thinking_level, status, error, created_at, started_at, finished_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        turn.id,
        turn.threadId,
        turn.input,
        turn.model,
        turn.thinkingLevel,
        turn.status,
        turn.error,
        turn.createdAt,
        turn.startedAt,
        turn.finishedAt
      );
    this.appendEvent(threadId, turn.id, 'turn.lifecycle', { status: 'queued' });
    return turn;
  }

  public listTurns(threadId: string): Turn[] {
    return (
      this.database
        .prepare('SELECT * FROM turns WHERE thread_id = ? ORDER BY created_at ASC')
        .all(threadId) as unknown as TurnRow[]
    ).map(fromTurnRow);
  }

  public getTurn(id: string): Turn | undefined {
    const row = this.database.prepare('SELECT * FROM turns WHERE id = ?').get(id) as unknown as
      | TurnRow
      | undefined;
    return row ? fromTurnRow(row) : undefined;
  }

  public updateTurnStatus(id: string, status: TurnStatus, error: string | null = null): Turn {
    const turn = this.getTurn(id);
    if (!turn) {
      throw new Error('Turn not found.');
    }
    const startedAt =
      turn.startedAt ?? (status === 'preparing' || status === 'running' ? now() : null);
    const finishedAt = ['completed', 'failed', 'cancelled', 'interrupted'].includes(status)
      ? now()
      : null;
    this.database
      .prepare(
        'UPDATE turns SET status = ?, error = ?, started_at = ?, finished_at = ? WHERE id = ?'
      )
      .run(status, error, startedAt, finishedAt, id);
    this.appendEvent(turn.threadId, id, 'turn.lifecycle', { status, error });
    return { ...turn, status, error, startedAt, finishedAt };
  }

  public appendEvent(
    threadId: string,
    turnId: string | null,
    type: EventType,
    payload: Record<string, unknown>
  ): JournalEvent {
    const timestamp = now();
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const current = this.database
        .prepare('SELECT COALESCE(MAX(sequence), 0) AS sequence FROM events WHERE thread_id = ?')
        .get(threadId) as { sequence: number };
      const event: JournalEvent = {
        id: createId(),
        threadId,
        turnId,
        sequence: current.sequence + 1,
        type,
        timestamp,
        payload: safeRecord(payload),
      };
      this.database
        .prepare(
          'INSERT INTO events (id, thread_id, turn_id, sequence, type, timestamp, payload) VALUES (?, ?, ?, ?, ?, ?, ?)'
        )
        .run(
          event.id,
          event.threadId,
          event.turnId,
          event.sequence,
          event.type,
          event.timestamp,
          JSON.stringify(event.payload)
        );
      this.database
        .prepare('UPDATE threads SET updated_at = ? WHERE id = ?')
        .run(timestamp, threadId);
      this.database.exec('COMMIT');
      return event;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  public listEvents(threadId: string): JournalEvent[] {
    return (
      this.database
        .prepare('SELECT * FROM events WHERE thread_id = ? ORDER BY sequence ASC')
        .all(threadId) as unknown as EventRow[]
    ).map(fromEventRow);
  }

  public createApproval(approval: Approval): Approval {
    ApprovalSchema.parse(approval);
    this.database
      .prepare(
        `INSERT INTO approvals (id, thread_id, turn_id, kind, argv, path, cwd, risk, reason, decision, created_at, resolved_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        approval.id,
        approval.threadId,
        approval.turnId,
        approval.kind,
        approval.argv ? JSON.stringify(approval.argv) : null,
        approval.path,
        approval.cwd,
        approval.risk,
        approval.reason,
        approval.decision,
        approval.createdAt,
        approval.resolvedAt
      );
    return approval;
  }

  public getApproval(id: string): Approval | undefined {
    const row = this.database.prepare('SELECT * FROM approvals WHERE id = ?').get(id) as unknown as
      | ApprovalRow
      | undefined;
    return row ? fromApprovalRow(row) : undefined;
  }

  public listApprovals(threadId: string): Approval[] {
    return (
      this.database
        .prepare('SELECT * FROM approvals WHERE thread_id = ? ORDER BY created_at ASC')
        .all(threadId) as unknown as ApprovalRow[]
    ).map(fromApprovalRow);
  }

  public resolveApproval(id: string, decision: ApprovalDecision): Approval {
    const approval = this.getApproval(id);
    if (!approval || approval.decision) {
      throw new Error('Approval is not pending.');
    }
    const resolvedAt = now();
    this.database
      .prepare('UPDATE approvals SET decision = ?, resolved_at = ? WHERE id = ?')
      .run(decision, resolvedAt, id);
    return { ...approval, decision, resolvedAt };
  }

  public denyPendingApprovalsForTurn(turnId: string): Approval[] {
    const pending = (
      this.database
        .prepare(
          'SELECT * FROM approvals WHERE turn_id = ? AND decision IS NULL ORDER BY created_at ASC'
        )
        .all(turnId) as unknown as ApprovalRow[]
    ).map(fromApprovalRow);
    if (pending.length === 0) {
      return [];
    }

    const resolvedAt = now();
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const update = this.database.prepare(
        'UPDATE approvals SET decision = ?, resolved_at = ? WHERE id = ? AND decision IS NULL'
      );
      for (const approval of pending) {
        update.run('deny', resolvedAt, approval.id);
      }
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
    return pending.map((approval) => ({ ...approval, decision: 'deny', resolvedAt }));
  }

  public recordFileMutation(input: {
    threadId: string;
    path: string;
    status: string;
    beforeBase64: string | null;
    afterBase64: string | null;
    beforeHash: string | null;
    afterHash: string | null;
  }): void {
    const existing = this.database
      .prepare('SELECT * FROM file_baselines WHERE thread_id = ? AND path = ?')
      .get(input.threadId, input.path) as unknown as BaselineRow | undefined;
    if (!existing) {
      this.database
        .prepare(
          `INSERT INTO file_baselines (thread_id, path, original_bytes, original_hash, latest_agent_hash, latest_status)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(
          input.threadId,
          input.path,
          input.beforeBase64,
          input.beforeHash,
          input.afterHash,
          input.status
        );
    } else {
      this.database
        .prepare(
          'UPDATE file_baselines SET latest_agent_hash = ?, latest_status = ? WHERE thread_id = ? AND path = ?'
        )
        .run(input.afterHash, input.status, input.threadId, input.path);
    }
    const ordinal =
      (
        this.database
          .prepare(
            'SELECT COALESCE(MAX(ordinal), 0) AS ordinal FROM file_mutations WHERE thread_id = ?'
          )
          .get(input.threadId) as { ordinal: number }
      ).ordinal + 1;
    const forward = JSON.stringify({
      before: input.beforeBase64,
      after: input.afterBase64,
      status: input.status,
    });
    const reverse = JSON.stringify({
      before: input.afterBase64,
      after: input.beforeBase64,
      status: 'reverted',
    });
    this.database
      .prepare(
        `INSERT INTO file_mutations (id, thread_id, path, ordinal, forward_patch, reverse_patch, before_hash, after_hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        createId(),
        input.threadId,
        input.path,
        ordinal,
        forward,
        reverse,
        input.beforeHash,
        input.afterHash,
        now()
      );
  }

  public listBaselines(threadId: string): BaselineRow[] {
    return this.database
      .prepare('SELECT * FROM file_baselines WHERE thread_id = ? ORDER BY path ASC')
      .all(threadId) as unknown as BaselineRow[];
  }

  public updateBaselineStatus(
    threadId: string,
    path: string,
    status: string,
    latestAgentHash: string | null
  ): void {
    this.database
      .prepare(
        'UPDATE file_baselines SET latest_status = ?, latest_agent_hash = ? WHERE thread_id = ? AND path = ?'
      )
      .run(status, latestAgentHash, threadId, path);
  }

  public addRouterOutcome(
    threadId: string,
    turnId: string | null,
    settlement: Settlement
  ): boolean {
    const result = this.database
      .prepare(
        `INSERT OR IGNORE INTO router_outcomes (router_turn_id, thread_id, turn_id, settlement, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        settlement.routerTurnId,
        threadId,
        turnId,
        JSON.stringify(settlement),
        settlement.timestamp
      );
    return Number(result.changes) > 0;
  }

  public listRouterOutcomes(threadId: string): Settlement[] {
    const rows = this.database
      .prepare('SELECT settlement FROM router_outcomes WHERE thread_id = ? ORDER BY created_at ASC')
      .all(threadId) as unknown as { settlement: string }[];
    return rows.map((row) => SettlementSchema.parse(JSON.parse(row.settlement)));
  }

  public recoverInterruptedRuns(): Turn[] {
    const nonTerminal = ['queued', 'preparing', 'running', 'awaiting_approval'];
    const rows = this.database
      .prepare(`SELECT * FROM turns WHERE status IN (${nonTerminal.map(() => '?').join(', ')})`)
      .all(...nonTerminal) as unknown as TurnRow[];
    const interrupted = rows.map((row) =>
      this.updateTurnStatus(row.id, 'interrupted', 'The desktop runtime was interrupted.')
    );
    for (const threadId of new Set(interrupted.map((turn) => turn.threadId))) {
      const thread = this.getThread(threadId);
      if (thread && (thread.status === 'running' || thread.status === 'awaiting_approval')) {
        this.updateThreadStatus(threadId, 'idle');
      }
    }
    return interrupted;
  }

  public getThreadDetail(threadId: string): {
    thread: Thread;
    turns: Turn[];
    events: JournalEvent[];
    approvals: Approval[];
  } {
    const thread = this.getThread(threadId);
    if (!thread) {
      throw new Error('Thread not found.');
    }
    return {
      thread,
      turns: this.listTurns(threadId),
      events: this.listEvents(threadId),
      approvals: this.listApprovals(threadId),
    };
  }

  public buildEvidence(threadId: string, turnId?: string): Record<string, unknown> {
    const allEvents = this.listEvents(threadId);
    const events = turnId ? allEvents.filter((event) => event.turnId === turnId) : allEvents;
    const baselines = this.listBaselines(threadId);
    const outcomes = this.listRouterOutcomes(threadId);
    const commands = events
      .filter(
        (event) =>
          event.type === 'tool.result' &&
          event.payload.name === 'run_command' &&
          event.payload.recordKind === 'command-completion'
      )
      .map((event) => event.payload);
    const failures = commands.filter(
      (command) => command.exitCode !== 0 || command.timedOut === true || command.cancelled === true
    );
    const testsExecuted = commands
      .filter((command) => {
        const argv = Array.isArray(command.argv) ? command.argv.map(String) : [];
        const executable = argv[0]?.split('/').at(-1)?.toLowerCase();
        return (
          ['pytest', 'cargo', 'go'].includes(executable ?? '') ||
          (['npm', 'pnpm', 'yarn', 'bun'].includes(executable ?? '') &&
            (argv[1] === 'test' ||
              (argv[1] === 'run' && /^(test|lint|typecheck|check)$/i.test(argv[2] ?? ''))))
        );
      })
      .map((command) => ({
        argv: command.argv,
        passed: command.exitCode === 0 && command.timedOut !== true && command.cancelled !== true,
      }));
    return {
      outcome:
        events.findLast((event) => event.type === 'turn.lifecycle')?.payload.status ?? 'unknown',
      filesChanged: baselines.map((baseline) => ({
        path: baseline.path,
        status: baseline.latest_status,
      })),
      commands,
      testsExecuted,
      pass: failures.length === 0,
      knownLimitations: events
        .filter((event) => event.type === 'diagnostic')
        .map((event) => event.payload.message),
      manualReviewSuggestions: baselines.map(
        (baseline) => `Review ${baseline.path} before committing.`
      ),
      economics: outcomes.reduce(
        (total, outcome) => ({
          cost: total.cost + outcome.cost,
          subsidy: total.subsidy + outcome.subsidy,
          paid: total.paid + outcome.paid,
          cacheRead: total.cacheRead + outcome.cacheRead,
          cacheWrite: total.cacheWrite + outcome.cacheWrite,
          tokens: total.tokens + outcome.totalTokens,
        }),
        { cost: 0, subsidy: 0, paid: 0, cacheRead: 0, cacheWrite: 0, tokens: 0 }
      ),
    };
  }

  public asDiffFiles(threadId: string): DiffFile[] {
    return this.listBaselines(threadId).map((baseline) => ({
      path: baseline.path,
      status: baseline.latest_status as DiffFile['status'],
      original: baseline.original_bytes
        ? Buffer.from(baseline.original_bytes, 'base64').toString('utf8')
        : '',
      current: '',
      baselineHash: baseline.original_hash,
      latestAgentHash: baseline.latest_agent_hash,
      currentHash: null,
    }));
  }

  private migrate(backupExistingDatabase: boolean): void {
    const version = this.database.prepare('PRAGMA user_version').get() as { user_version: number };
    const hasTurns = this.database
      .prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'turns'")
      .get() as { present: number } | undefined;
    if (version.user_version > 0 && !hasTurns) {
      const baseSchema = migrations[0];
      if (!baseSchema) throw new Error('Missing base database schema.');
      this.database.exec(baseSchema);
    }
    if (backupExistingDatabase && version.user_version < migrations.length) {
      cpSync(this.databasePath, `${this.databasePath}.backup-${Date.now()}`);
    }
    for (let index = version.user_version; index < migrations.length; index += 1) {
      this.database.exec('BEGIN IMMEDIATE');
      try {
        const migration = migrations[index];
        if (!migration) {
          throw new Error(`Missing database migration ${index + 1}.`);
        }
        this.database.exec(migration);
        this.database.exec(`PRAGMA user_version = ${index + 1}`);
        this.database.exec('COMMIT');
      } catch (error) {
        this.database.exec('ROLLBACK');
        throw error;
      }
    }
  }

  public get path(): string {
    return join(this.databasePath);
  }
}
