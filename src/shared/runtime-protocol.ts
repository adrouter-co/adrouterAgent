import { z } from 'zod';
import {
  ApprovalDecisionSchema,
  EventTypeSchema,
  IdSchema,
  JsonObjectSchema,
  PermissionModeSchema,
  RuntimeModeSchema,
  ThinkingLevelSchema,
} from './contracts';

export const RuntimeStartSchema = z.object({
  type: z.literal('start'),
  threadId: IdSchema,
  turnId: IdSchema,
  project: z.object({
    id: IdSchema,
    path: z.string().min(1),
    displayName: z.string().min(1),
    instructions: z.string(),
    repositoryInstructions: z.string(),
    permissionMode: PermissionModeSchema,
  }),
  model: z.string().min(1),
  thinkingLevel: ThinkingLevelSchema,
  runtimeMode: RuntimeModeSchema,
  sponsoredCompute: z.boolean(),
  router: z.object({ serverUrl: z.string().url(), token: z.string().min(1) }),
  input: z.string().min(1),
  history: z.array(
    z.object({
      type: EventTypeSchema,
      turnId: IdSchema.nullable(),
      payload: JsonObjectSchema,
      timestamp: z.string().datetime({ offset: true }),
    })
  ),
  allowedCommands: z.array(z.array(z.string().min(1)).min(1)),
});

export const RuntimeSteerSchema = z.object({ type: z.literal('steer'), input: z.string().min(1) });
export const RuntimeQueueSchema = z.object({
  type: z.literal('queue-follow-up'),
  input: z.string().min(1),
});
export const RuntimeStopSchema = z.object({ type: z.literal('stop') });
export const RuntimeApprovalSchema = z.object({
  type: z.literal('approval'),
  approvalId: IdSchema,
  decision: ApprovalDecisionSchema,
});

export const RuntimeRequestSchema = z.discriminatedUnion('type', [
  RuntimeStartSchema,
  RuntimeSteerSchema,
  RuntimeQueueSchema,
  RuntimeStopSchema,
  RuntimeApprovalSchema,
]);
export type RuntimeRequest = z.infer<typeof RuntimeRequestSchema>;

export const RuntimeEventSchema = z.object({
  type: EventTypeSchema,
  turnId: IdSchema.nullable(),
  payload: JsonObjectSchema,
  timestamp: z.string().datetime({ offset: true }),
});
export type RuntimeEvent = z.infer<typeof RuntimeEventSchema>;

export const RuntimePortMessageSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('request'), request: RuntimeRequestSchema }),
  z.object({ kind: z.literal('event'), event: RuntimeEventSchema }),
  z.object({ kind: z.literal('ready') }),
]);
export type RuntimePortMessage = z.infer<typeof RuntimePortMessageSchema>;
