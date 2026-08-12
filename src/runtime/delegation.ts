import { realpath } from 'node:fs/promises';
import type { OperationCapability, OperationManifestV1 } from '../shared/contracts';
import { IdSchema, OperationManifestV1Schema } from '../shared/contracts';
import { assertOperationManifest, createOperationManifest } from './operation-manifest';

export const createDelegationManifest = async (input: {
  threadId: string;
  turnId: string;
  workspaceRoot: string;
  title: string;
  prompt: string;
}): Promise<OperationManifestV1> => {
  const title = input.title.trim();
  const prompt = input.prompt.trim();
  if (!title || title.length > 120 || /[\r\n\0]/.test(title)) {
    throw new Error('Delegated task titles must be a bounded single line.');
  }
  if (!prompt || prompt.length > 8_192 || prompt.includes('\0')) {
    throw new Error('Delegated task prompts must contain between one and 8,192 safe characters.');
  }
  return createOperationManifest({
    capability: 'delegation.start',
    threadId: input.threadId,
    turnId: input.turnId,
    workspace: await realpath(input.workspaceRoot),
    argv: [title, prompt],
  });
};

export const delegationArguments = (
  rawManifest: unknown
): { manifest: OperationManifestV1; title: string; prompt: string } => {
  const parsed = OperationManifestV1Schema.parse(rawManifest);
  const manifest = assertOperationManifest(parsed, {
    operationId: parsed.operationId,
    threadId: parsed.threadId,
    turnId: parsed.turnId,
    capability: 'delegation.start',
  });
  if (
    manifest.targets.length !== 0 ||
    manifest.network !== null ||
    manifest.git !== null ||
    manifest.argv?.length !== 2
  ) {
    throw new Error('The delegated task manifest has invalid authority.');
  }
  const [title = '', prompt = ''] = manifest.argv;
  if (!title || title.length > 120 || /[\r\n\0]/.test(title)) {
    throw new Error('The delegated task title binding is invalid.');
  }
  if (!prompt || prompt.length > 8_192 || prompt.includes('\0')) {
    throw new Error('The delegated task prompt binding is invalid.');
  }
  return { manifest, title, prompt };
};

const createManagementManifest = async (input: {
  capability: Extract<
    OperationCapability,
    'delegation.status' | 'delegation.message' | 'delegation.cancel'
  >;
  threadId: string;
  turnId: string;
  workspaceRoot: string;
  argv?: string[];
}): Promise<OperationManifestV1> =>
  createOperationManifest({
    capability: input.capability,
    threadId: input.threadId,
    turnId: input.turnId,
    workspace: await realpath(input.workspaceRoot),
    argv: input.argv,
  });

export const createDelegationStatusManifest = async (
  input: Omit<Parameters<typeof createManagementManifest>[0], 'capability' | 'argv'>
): Promise<OperationManifestV1> =>
  createManagementManifest({ ...input, capability: 'delegation.status' });

export const createDelegationMessageManifest = async (
  input: Omit<Parameters<typeof createManagementManifest>[0], 'capability' | 'argv'> & {
    childThreadId: string;
    prompt: string;
  }
): Promise<OperationManifestV1> => {
  const childThreadId = IdSchema.parse(input.childThreadId);
  const prompt = input.prompt.trim();
  if (!prompt || prompt.length > 8_192 || prompt.includes('\0')) {
    throw new Error('Delegated follow-ups must contain between one and 8,192 safe characters.');
  }
  return createManagementManifest({
    ...input,
    capability: 'delegation.message',
    argv: [childThreadId, prompt],
  });
};

export const createDelegationCancelManifest = async (
  input: Omit<Parameters<typeof createManagementManifest>[0], 'capability' | 'argv'> & {
    childThreadId: string;
  }
): Promise<OperationManifestV1> =>
  createManagementManifest({
    ...input,
    capability: 'delegation.cancel',
    argv: [IdSchema.parse(input.childThreadId)],
  });

const managementManifest = (
  rawManifest: unknown,
  capability: 'delegation.status' | 'delegation.message' | 'delegation.cancel',
  argvLength: number
): OperationManifestV1 => {
  const parsed = OperationManifestV1Schema.parse(rawManifest);
  const manifest = assertOperationManifest(parsed, {
    operationId: parsed.operationId,
    threadId: parsed.threadId,
    turnId: parsed.turnId,
    capability,
  });
  if (
    manifest.targets.length !== 0 ||
    manifest.network !== null ||
    manifest.git !== null ||
    (argvLength === 0 ? manifest.argv !== null : manifest.argv?.length !== argvLength)
  ) {
    throw new Error('The delegated lifecycle manifest has invalid authority.');
  }
  return manifest;
};

export const delegationStatusArguments = (
  rawManifest: unknown
): { manifest: OperationManifestV1 } => ({
  manifest: managementManifest(rawManifest, 'delegation.status', 0),
});

export const delegationMessageArguments = (
  rawManifest: unknown
): { manifest: OperationManifestV1; childThreadId: string; prompt: string } => {
  const manifest = managementManifest(rawManifest, 'delegation.message', 2);
  const [rawChildThreadId = '', prompt = ''] = manifest.argv ?? [];
  const childThreadId = IdSchema.parse(rawChildThreadId);
  if (!prompt || prompt.length > 8_192 || prompt.includes('\0')) {
    throw new Error('The delegated follow-up binding is invalid.');
  }
  return { manifest, childThreadId, prompt };
};

export const delegationCancelArguments = (
  rawManifest: unknown
): { manifest: OperationManifestV1; childThreadId: string } => {
  const manifest = managementManifest(rawManifest, 'delegation.cancel', 1);
  return { manifest, childThreadId: IdSchema.parse(manifest.argv?.[0]) };
};
