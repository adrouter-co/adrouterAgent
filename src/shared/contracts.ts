import { z } from 'zod';

export const IdSchema = z.string().uuid();
export const TimestampSchema = z.string().datetime({ offset: true });
export const JsonObjectSchema = z.record(z.string(), z.unknown());

export const PermissionModeSchema = z.enum(['read-only', 'workspace-write']);
export type PermissionMode = z.infer<typeof PermissionModeSchema>;

export const ThreadStatusSchema = z.enum(['idle', 'running', 'awaiting_approval', 'failed']);
export type ThreadStatus = z.infer<typeof ThreadStatusSchema>;

export const TurnStatusSchema = z.enum([
  'queued',
  'preparing',
  'running',
  'awaiting_approval',
  'completed',
  'failed',
  'cancelled',
  'interrupted',
]);
export type TurnStatus = z.infer<typeof TurnStatusSchema>;

export const ThinkingLevelSchema = z.enum(['none', 'medium', 'high']);
export type ThinkingLevel = z.infer<typeof ThinkingLevelSchema>;

export const RuntimeModeSchema = z.enum(['auto', 'mock', 'live']);
export type RuntimeMode = z.infer<typeof RuntimeModeSchema>;

export const SponsorTierSchema = z.enum(['A', 'B', 'C', 'NONE']);
export type SponsorTier = z.infer<typeof SponsorTierSchema>;

export const RouterModelDescriptorSchema = z.object({
  id: z.string().min(1).max(300),
  provider: z.string().min(1).max(120),
  displayName: z.string().min(1).max(200),
  providerLabel: z.string().min(1).max(120),
  thinkingLevels: z.array(ThinkingLevelSchema).min(1),
  defaultThinkingLevel: ThinkingLevelSchema,
  configured: z.boolean(),
});
export type RouterModelDescriptor = z.infer<typeof RouterModelDescriptorSchema>;

export const GitMetadataSchema = z.object({
  branch: z.string().nullable(),
  changeCount: z.number().int().nonnegative(),
  isDirty: z.boolean(),
  remote: z.string().nullable(),
});

export const ProjectSchema = z.object({
  id: IdSchema,
  path: z.string().min(1),
  displayName: z.string().min(1).max(120),
  instructions: z.string().max(100_000),
  repositoryInstructions: z.string().max(200_000),
  repositoryInstructionFiles: z.array(z.string().min(1).max(500)).max(20),
  permissionMode: PermissionModeSchema,
  git: GitMetadataSchema.nullable(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type Project = z.infer<typeof ProjectSchema>;

export const ThreadSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  title: z.string().min(1).max(240),
  model: z.string().min(1).max(300),
  thinkingLevel: ThinkingLevelSchema,
  status: ThreadStatusSchema,
  archivedAt: TimestampSchema.nullable(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type Thread = z.infer<typeof ThreadSchema>;

export const TurnSchema = z.object({
  id: IdSchema,
  threadId: IdSchema,
  input: z.string().min(1).max(200_000),
  model: z.string().min(1).max(300),
  thinkingLevel: ThinkingLevelSchema,
  status: TurnStatusSchema,
  error: z.string().nullable(),
  createdAt: TimestampSchema,
  startedAt: TimestampSchema.nullable(),
  finishedAt: TimestampSchema.nullable(),
});
export type Turn = z.infer<typeof TurnSchema>;

export const EventTypeSchema = z.enum([
  'thread.lifecycle',
  'turn.lifecycle',
  'message.user',
  'message.delta',
  'message.complete',
  'thinking.delta',
  'tool.activity',
  'tool.result',
  'command.output',
  'approval.request',
  'approval.resolved',
  'file.change',
  'diff.change',
  'sponsor.update',
  'settlement',
  'compaction',
  'retry',
  'runtime.crash',
  'final.evidence',
  'diagnostic',
]);
export type EventType = z.infer<typeof EventTypeSchema>;

export const EventSchema = z.object({
  id: IdSchema,
  threadId: IdSchema,
  turnId: IdSchema.nullable(),
  sequence: z.number().int().positive(),
  type: EventTypeSchema,
  timestamp: TimestampSchema,
  payload: JsonObjectSchema,
});
export type JournalEvent = z.infer<typeof EventSchema>;

export const ApprovalKindSchema = z.enum(['command', 'file-delete', 'file-mutation']);
export const ApprovalDecisionSchema = z.enum(['allow-once', 'allow-thread', 'deny']);
export type ApprovalDecision = z.infer<typeof ApprovalDecisionSchema>;

export const ApprovalSchema = z.object({
  id: IdSchema,
  threadId: IdSchema,
  turnId: IdSchema,
  kind: ApprovalKindSchema,
  argv: z.array(z.string()).min(1).nullable(),
  path: z.string().nullable(),
  cwd: z.string(),
  risk: z.enum(['low', 'medium', 'high']),
  reason: z.string(),
  decision: ApprovalDecisionSchema.nullable(),
  createdAt: TimestampSchema,
  resolvedAt: TimestampSchema.nullable(),
});
export type Approval = z.infer<typeof ApprovalSchema>;

export const SponsorSchema = z.object({
  routerTurnId: z.string().min(1).max(300).nullable().default(null),
  tier: SponsorTierSchema,
  sponsorName: z.string().min(1).max(120).nullable(),
  headline: z.string().max(240).nullable(),
  body: z.string().max(1_000).nullable(),
  url: z
    .string()
    .url()
    .refine((url) => new URL(url).protocol === 'https:', 'Expected HTTPS URL')
    .nullable(),
  reason: z.string().max(1_000).default(''),
  provisionalSavings: z.number().nonnegative().default(0),
  subsidyPercent: z.number().min(0).max(100),
});
export type Sponsor = z.infer<typeof SponsorSchema>;

export const SettlementSchema = z.object({
  routerTurnId: z.string().min(1).max(300),
  cost: z.number().nonnegative(),
  subsidy: z.number().nonnegative(),
  paid: z.number().nonnegative(),
  cacheRead: z.number().nonnegative(),
  cacheWrite: z.number().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  inferencePurpose: z.string().max(240).default('agent'),
  sponsor: SponsorSchema.nullable(),
  timestamp: TimestampSchema,
});
export type Settlement = z.infer<typeof SettlementSchema>;

export const FileStatusSchema = z.enum(['modified', 'created', 'deleted', 'reverted', 'conflict']);
export const DiffFileSchema = z.object({
  path: z.string().min(1),
  status: FileStatusSchema,
  original: z.string(),
  current: z.string(),
  baselineHash: z.string().nullable(),
  latestAgentHash: z.string().nullable(),
  currentHash: z.string().nullable(),
});
export type DiffFile = z.infer<typeof DiffFileSchema>;

export const RouterConfigurationSchema = z.object({
  serverUrl: z.string(),
  sponsoredCompute: z.boolean(),
  tokenStored: z.boolean(),
  configured: z.boolean(),
  models: z.array(RouterModelDescriptorSchema),
  selectedModel: z.string().min(1).max(300).nullable(),
  selectedThinkingLevel: ThinkingLevelSchema,
  lastCheckedAt: TimestampSchema.nullable(),
});
export type RouterConfiguration = z.infer<typeof RouterConfigurationSchema>;

export const RouterDiagnosticsSchema = z.object({
  health: z.boolean(),
  authenticated: z.boolean(),
  mode: z.enum(['live', 'mock', 'unknown']),
  models: z.array(RouterModelDescriptorSchema),
  modelsStale: z.boolean(),
  checkedAt: TimestampSchema,
  error: z.string().nullable(),
});
export type RouterDiagnostics = z.infer<typeof RouterDiagnosticsSchema>;

export const RouterConfigurationInputSchema = z.object({
  serverUrl: z.string().url(),
  token: z.string().min(1).max(16_384),
  sponsoredCompute: z.boolean(),
});

export const RouterTestInputSchema = z.object({
  serverUrl: z.string().url(),
  token: z.string().min(1).max(16_384),
});

export const ProjectOpenInputSchema = z.object({
  path: z.string().min(1).optional(),
});
export const ProjectIdInputSchema = z.object({ id: IdSchema });
export const ProjectUpdateInputSchema = z.object({
  id: IdSchema,
  displayName: z.string().min(1).max(120).optional(),
  instructions: z.string().max(100_000).optional(),
  permissionMode: PermissionModeSchema.optional(),
});

export const ThreadCreateInputSchema = z.object({
  projectId: IdSchema,
  title: z.string().min(1).max(240),
  model: z.string().min(1).max(300),
  thinkingLevel: ThinkingLevelSchema.default('medium'),
});
export const ThreadListInputSchema = z.object({ projectId: IdSchema });
export const ThreadIdInputSchema = z.object({ id: IdSchema });

export const RouterPreferencesInputSchema = z.object({
  model: z.string().min(1).max(300),
  thinkingLevel: ThinkingLevelSchema,
});

export const TurnStartInputSchema = z.object({
  threadId: IdSchema,
  input: z.string().min(1).max(200_000),
  model: z.string().min(1).max(300),
  thinkingLevel: ThinkingLevelSchema,
  runtimeMode: RuntimeModeSchema.default('auto'),
});
export const TurnMessageInputSchema = z.object({
  threadId: IdSchema,
  input: z.string().min(1).max(200_000),
});
export const TurnStopInputSchema = z.object({ threadId: IdSchema });
export const ApprovalResolveInputSchema = z.object({
  approvalId: IdSchema,
  decision: ApprovalDecisionSchema,
});

export const ReviewDiffInputSchema = z.object({
  threadId: IdSchema,
  path: z.string().min(1).optional(),
});
export const ReviewRevertFileInputSchema = z.object({
  threadId: IdSchema,
  path: z.string().min(1),
});
export const ReviewRevertAllInputSchema = z.object({ threadId: IdSchema });
export const ReviewAcceptInputSchema = z.object({ threadId: IdSchema });
export const ReviewOpenFileInputSchema = z.object({ threadId: IdSchema, path: z.string().min(1) });

export const EventsSubscribeInputSchema = z.object({ threadId: IdSchema });
export const EventsUnsubscribeInputSchema = z.object({ subscriptionId: IdSchema });

export const OkSchema = z.object({ ok: z.literal(true) });
export const SubscriptionSchema = z.object({ subscriptionId: IdSchema });
export const ApplicationInfoSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  platform: z.string().min(1),
  architecture: z.string().min(1),
  sandbox: z.object({
    status: z.enum(['ready', 'setup-required', 'unsupported']),
    detail: z.string().min(1),
    setupCommands: z.array(z.string().min(1)),
  }),
});
export type ApplicationInfo = z.infer<typeof ApplicationInfoSchema>;
export const RevertResultSchema = z.object({
  reverted: z.array(z.string()),
  conflicts: z.array(z.string()),
});

export const ThreadDetailSchema = z.object({
  thread: ThreadSchema,
  turns: z.array(TurnSchema),
  events: z.array(EventSchema),
  approvals: z.array(ApprovalSchema),
});

export const IpcSchemas = {
  'configuration.get': { input: z.object({}), output: RouterConfigurationSchema },
  'configuration.save': {
    input: RouterConfigurationInputSchema,
    output: RouterConfigurationSchema,
  },
  'configuration.testRouter': { input: RouterTestInputSchema, output: RouterDiagnosticsSchema },
  'configuration.status': { input: z.object({}), output: RouterDiagnosticsSchema },
  'configuration.signOut': { input: z.object({}), output: RouterConfigurationSchema },
  'configuration.updatePreferences': {
    input: RouterPreferencesInputSchema,
    output: RouterConfigurationSchema,
  },
  'projects.open': { input: ProjectOpenInputSchema, output: ProjectSchema },
  'projects.list': { input: z.object({}), output: z.array(ProjectSchema) },
  'projects.get': { input: ProjectIdInputSchema, output: ProjectSchema },
  'projects.update': { input: ProjectUpdateInputSchema, output: ProjectSchema },
  'projects.remove': { input: ProjectIdInputSchema, output: OkSchema },
  'threads.create': { input: ThreadCreateInputSchema, output: ThreadSchema },
  'threads.list': { input: ThreadListInputSchema, output: z.array(ThreadSchema) },
  'threads.get': { input: ThreadIdInputSchema, output: ThreadDetailSchema },
  'threads.archive': { input: ThreadIdInputSchema, output: ThreadSchema },
  'threads.delete': { input: ThreadIdInputSchema, output: OkSchema },
  'turns.start': { input: TurnStartInputSchema, output: TurnSchema },
  'turns.steer': { input: TurnMessageInputSchema, output: OkSchema },
  'turns.queueFollowUp': { input: TurnMessageInputSchema, output: OkSchema },
  'turns.stop': { input: TurnStopInputSchema, output: OkSchema },
  'approvals.resolve': { input: ApprovalResolveInputSchema, output: ApprovalSchema },
  'review.getDiff': { input: ReviewDiffInputSchema, output: z.array(DiffFileSchema) },
  'review.revertFile': { input: ReviewRevertFileInputSchema, output: RevertResultSchema },
  'review.revertAll': { input: ReviewRevertAllInputSchema, output: RevertResultSchema },
  'review.accept': { input: ReviewAcceptInputSchema, output: OkSchema },
  'review.openFile': { input: ReviewOpenFileInputSchema, output: OkSchema },
  'events.subscribe': { input: EventsSubscribeInputSchema, output: SubscriptionSchema },
  'events.unsubscribe': { input: EventsUnsubscribeInputSchema, output: OkSchema },
  'app.getInfo': { input: z.object({}), output: ApplicationInfoSchema },
  'app.getVersion': { input: z.object({}), output: z.object({ version: z.string() }) },
  'app.getPlatform': { input: z.object({}), output: z.object({ platform: z.string() }) },
} as const;

export type IpcMethod = keyof typeof IpcSchemas;

export type InferIpcInput<T extends IpcMethod> = z.infer<(typeof IpcSchemas)[T]['input']>;
export type InferIpcOutput<T extends IpcMethod> = z.infer<(typeof IpcSchemas)[T]['output']>;

export interface AdrouterApi {
  configuration: {
    get(): Promise<RouterConfiguration>;
    save(input: z.input<typeof RouterConfigurationInputSchema>): Promise<RouterConfiguration>;
    testRouter(input: z.input<typeof RouterTestInputSchema>): Promise<RouterDiagnostics>;
    status(): Promise<RouterDiagnostics>;
    signOut(): Promise<RouterConfiguration>;
    updatePreferences(
      input: z.input<typeof RouterPreferencesInputSchema>
    ): Promise<RouterConfiguration>;
  };
  projects: {
    open(input?: z.input<typeof ProjectOpenInputSchema>): Promise<Project>;
    list(): Promise<Project[]>;
    get(input: z.input<typeof ProjectIdInputSchema>): Promise<Project>;
    update(input: z.input<typeof ProjectUpdateInputSchema>): Promise<Project>;
    remove(input: z.input<typeof ProjectIdInputSchema>): Promise<{ ok: true }>;
  };
  threads: {
    create(input: z.input<typeof ThreadCreateInputSchema>): Promise<Thread>;
    list(input: z.input<typeof ThreadListInputSchema>): Promise<Thread[]>;
    get(input: z.input<typeof ThreadIdInputSchema>): Promise<z.infer<typeof ThreadDetailSchema>>;
    archive(input: z.input<typeof ThreadIdInputSchema>): Promise<Thread>;
    delete(input: z.input<typeof ThreadIdInputSchema>): Promise<{ ok: true }>;
  };
  turns: {
    start(input: z.input<typeof TurnStartInputSchema>): Promise<Turn>;
    steer(input: z.input<typeof TurnMessageInputSchema>): Promise<{ ok: true }>;
    queueFollowUp(input: z.input<typeof TurnMessageInputSchema>): Promise<{ ok: true }>;
    stop(input: z.input<typeof TurnStopInputSchema>): Promise<{ ok: true }>;
  };
  approvals: {
    resolve(input: z.input<typeof ApprovalResolveInputSchema>): Promise<Approval>;
  };
  review: {
    getDiff(input: z.input<typeof ReviewDiffInputSchema>): Promise<DiffFile[]>;
    revertFile(
      input: z.input<typeof ReviewRevertFileInputSchema>
    ): Promise<z.infer<typeof RevertResultSchema>>;
    revertAll(
      input: z.input<typeof ReviewRevertAllInputSchema>
    ): Promise<z.infer<typeof RevertResultSchema>>;
    accept(input: z.input<typeof ReviewAcceptInputSchema>): Promise<{ ok: true }>;
    openFile(input: z.input<typeof ReviewOpenFileInputSchema>): Promise<{ ok: true }>;
  };
  events: {
    subscribe(
      input: z.input<typeof EventsSubscribeInputSchema>,
      listener: (event: JournalEvent) => void
    ): Promise<string>;
    unsubscribe(input: z.input<typeof EventsUnsubscribeInputSchema>): Promise<{ ok: true }>;
  };
  app: {
    getInfo(): Promise<ApplicationInfo>;
    getVersion(): Promise<{ version: string }>;
    getPlatform(): Promise<{ platform: string }>;
  };
}
