import type {
  OperationCapability,
  PermissionMode,
  Project,
  TaskCapabilityPolicyV1,
  TaskPolicySnapshotV1,
  TaskPolicySummaryV1,
  TaskPresetV1,
  ThinkingLevel,
} from './contracts';
import {
  TaskCapabilityPolicyV1Schema,
  TaskPolicySnapshotV1Schema,
  TaskPolicySummaryV1Schema,
  TaskPresetV1Schema,
} from './contracts';
import { createId, now, sha256 } from './security';

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalize(nested)])
  );
};

const digest = (value: unknown): string => sha256(JSON.stringify(canonicalize(value)));

export const fullTaskCapabilityPolicy = (
  workspaceAccess: PermissionMode,
  delegation: boolean
): TaskCapabilityPolicyV1 =>
  TaskCapabilityPolicyV1Schema.parse({
    schemaVersion: 1,
    workspaceAccess,
    fileMutations: true,
    generalCommands: true,
    networkFetch: true,
    dependencyChanges: true,
    gitWrites: true,
    delegation,
  });

export const effectiveTaskCapabilityPolicy = (
  value: TaskCapabilityPolicyV1
): TaskCapabilityPolicyV1 => {
  const policy = TaskCapabilityPolicyV1Schema.parse(value);
  if (policy.workspaceAccess === 'workspace-write') return policy;
  return {
    ...policy,
    fileMutations: false,
    dependencyChanges: false,
    gitWrites: false,
  };
};

const presetDigestValue = (input: {
  name: string;
  model: string;
  thinkingLevel: ThinkingLevel;
  extraInstructions: string;
  capabilityPolicy: TaskCapabilityPolicyV1;
}): string =>
  digest({
    schemaVersion: 1,
    name: input.name,
    model: input.model,
    thinkingLevel: input.thinkingLevel,
    extraInstructions: input.extraInstructions,
    capabilityPolicy: input.capabilityPolicy,
  });

export const createTaskPreset = (
  input: {
    name: string;
    model: string;
    thinkingLevel: ThinkingLevel;
    extraInstructions: string;
    capabilityPolicy: TaskCapabilityPolicyV1;
  },
  existing?: Pick<TaskPresetV1, 'id' | 'createdAt'>,
  timestamp = now()
): TaskPresetV1 => {
  const normalized = {
    name: input.name.normalize('NFKC').trim(),
    model: input.model,
    thinkingLevel: input.thinkingLevel,
    extraInstructions: input.extraInstructions,
    capabilityPolicy: TaskCapabilityPolicyV1Schema.parse(input.capabilityPolicy),
  };
  return TaskPresetV1Schema.parse({
    schemaVersion: 1,
    id: existing?.id ?? createId(),
    ...normalized,
    digest: presetDigestValue(normalized),
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  });
};

const finalizeSnapshot = (
  input: Omit<TaskPolicySnapshotV1, 'snapshotDigest'>
): TaskPolicySnapshotV1 =>
  TaskPolicySnapshotV1Schema.parse({
    ...input,
    snapshotDigest: digest(input),
  });

export const projectDefaultPolicySnapshot = (
  project: Pick<Project, 'permissionMode' | 'delegationEnabled'>,
  capturedAt = now()
): TaskPolicySnapshotV1 =>
  finalizeSnapshot({
    schemaVersion: 1,
    source: 'project-defaults',
    presetId: null,
    presetName: null,
    presetDigest: null,
    extraInstructions: '',
    capabilityPolicy: fullTaskCapabilityPolicy(project.permissionMode, project.delegationEnabled),
    capturedAt,
  });

export const presetPolicySnapshot = (
  preset: TaskPresetV1,
  capturedAt = now()
): TaskPolicySnapshotV1 =>
  finalizeSnapshot({
    schemaVersion: 1,
    source: 'preset',
    presetId: preset.id,
    presetName: preset.name,
    presetDigest: preset.digest,
    extraInstructions: preset.extraInstructions,
    capabilityPolicy: preset.capabilityPolicy,
    capturedAt,
  });

export const inheritedPolicySnapshot = (
  parent: TaskPolicySnapshotV1,
  options: { disableDelegation?: boolean } = {},
  capturedAt = now()
): TaskPolicySnapshotV1 => {
  const parsed = TaskPolicySnapshotV1Schema.parse(parent);
  return finalizeSnapshot({
    ...parsed,
    source: 'inherited',
    capabilityPolicy: options.disableDelegation
      ? { ...parsed.capabilityPolicy, delegation: false }
      : parsed.capabilityPolicy,
    capturedAt,
  });
};

export const taskPolicySummary = (snapshot: TaskPolicySnapshotV1): TaskPolicySummaryV1 => {
  const parsed = TaskPolicySnapshotV1Schema.parse(snapshot);
  const { extraInstructions, ...redacted } = parsed;
  return TaskPolicySummaryV1Schema.parse({
    ...redacted,
    hasExtraInstructions: extraInstructions.length > 0,
    extraInstructionsBytes: Buffer.byteLength(extraInstructions, 'utf8'),
  });
};

export const operationCapabilityAllowed = (
  rawPolicy: TaskCapabilityPolicyV1,
  capability: OperationCapability
): boolean => {
  const policy = effectiveTaskCapabilityPolicy(rawPolicy);
  if (capability.startsWith('file.')) return policy.fileMutations;
  if (capability === 'script.run') return policy.generalCommands;
  if (capability.startsWith('dependency.')) return policy.dependencyChanges;
  if (capability.startsWith('git.')) return policy.gitWrites;
  if (capability === 'network.fetch') return policy.networkFetch;
  if (capability.startsWith('delegation.')) return policy.delegation;
  return false;
};
