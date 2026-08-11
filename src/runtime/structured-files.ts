import { realpath } from 'node:fs/promises';
import { basename, relative, resolve, sep } from 'node:path';
import { type OperationManifestV1, OperationManifestV1Schema } from '../shared/contracts';
import { sha256 } from '../shared/security';
import { assertOperationManifest, createOperationManifest } from './operation-manifest';
import { resolveWorkspacePath, WorkspaceAccessError } from './workspace';
import {
  deleteBoundWorkspaceFile,
  inspectWorkspacePath,
  listBoundWorkspaceFiles,
  readBoundWorkspaceFile,
  replaceBoundWorkspaceFile,
} from './workspace-broker';

const MAX_OPERATION_BYTES = 10 * 1024 * 1024;
const MAX_RECOVERY_BYTES = 50 * 1024 * 1024;
const MAX_RECOVERY_ENTRIES = 100;
const RECOVERY_DIRECTORY = '.adrouter-recovery';
const RECOVERY_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface TreeInventory {
  digest: string;
  bytes: number;
  entries: number;
  kind: 'file' | 'directory';
}

const inventoryBoundTarget = (workspace: string, path: string): TreeInventory | null => {
  let inspected: ReturnType<typeof inspectWorkspacePath>;
  try {
    inspected = inspectWorkspacePath(workspace, path);
  } catch (error) {
    throw new WorkspaceAccessError(error instanceof Error ? error.message : String(error));
  }
  if (inspected.kind === 'missing') return null;
  if (inspected.kind === 'directory') {
    throw new WorkspaceAccessError(
      'Directory copy, move, delete, and restore are disabled until they use the descriptor-bound broker.'
    );
  }
  let content: Buffer;
  try {
    content = readBoundWorkspaceFile(workspace, path, MAX_OPERATION_BYTES);
  } catch (error) {
    throw new WorkspaceAccessError(error instanceof Error ? error.message : String(error));
  }
  const records = [
    { path: '', kind: 'file' as const, digest: sha256(content), size: content.length },
  ];
  return {
    digest: sha256(JSON.stringify(records)),
    bytes: content.length,
    entries: 1,
    kind: 'file',
  };
};

export interface StructuredTargetSnapshot {
  path: string;
  absolute: string;
  kind: 'file' | 'directory' | 'missing';
  beforeHash: string | null;
  bytes: number;
  entries: number;
}

export const snapshotStructuredTarget = async (
  workspaceRoot: string,
  input: string,
  allowMissing = false,
  allowProtected = false
): Promise<StructuredTargetSnapshot> => {
  const path = await resolveWorkspacePath(workspaceRoot, input, { allowMissing, allowProtected });
  const inventory = inventoryBoundTarget(path.root, path.relative);
  if (!inventory) {
    return {
      path: path.relative,
      absolute: path.absolute,
      kind: 'missing',
      beforeHash: null,
      bytes: 0,
      entries: 0,
    };
  }
  return {
    path: path.relative,
    absolute: path.absolute,
    kind: inventory.kind,
    beforeHash: inventory.digest,
    bytes: inventory.bytes,
    entries: inventory.entries,
  };
};

export const createStructuredFileManifest = async (input: {
  capability: 'file.copy' | 'file.move' | 'file.delete';
  threadId: string;
  turnId: string;
  workspaceRoot: string;
  source: string;
  destination?: string;
}): Promise<OperationManifestV1> => {
  const workspace = await realpath(input.workspaceRoot);
  const source = await snapshotStructuredTarget(workspace, input.source);
  const destination = input.destination
    ? await snapshotStructuredTarget(workspace, input.destination, true)
    : undefined;
  if (destination && destination.kind !== 'missing') {
    throw new WorkspaceAccessError('Structured copy and move never overwrite an existing target.');
  }
  return createOperationManifest({
    capability: input.capability,
    threadId: input.threadId,
    turnId: input.turnId,
    workspace,
    targets: [source, ...(destination ? [destination] : [])].map((target) => ({
      path: target.path,
      kind: target.kind,
      beforeHash: target.beforeHash,
    })),
  });
};

export const verifyStructuredTargets = async (manifest: OperationManifestV1): Promise<void> => {
  for (const expected of manifest.targets) {
    if (expected.kind === 'git-ref') continue;
    const allowProtected =
      manifest.capability === 'file.restore' && expected.path.startsWith(`${RECOVERY_DIRECTORY}/`);
    const current = await snapshotStructuredTarget(
      manifest.workspace,
      expected.path,
      true,
      allowProtected
    );
    if (current.kind !== expected.kind || current.beforeHash !== expected.beforeHash) {
      throw new WorkspaceAccessError(
        `The reviewed state for ${expected.path} changed before execution.`
      );
    }
  }
};

interface RecoveryRecord {
  version: 1;
  operationId: string;
  capability: 'file.move' | 'file.delete';
  originalPath: string;
  destinationPath: string | null;
  beforeHash: string;
  createdAt: string;
}

const recoveryRoot = (workspace: string): string => resolve(workspace, RECOVERY_DIRECTORY);

const readBound = (workspace: string, path: string, maxBytes = MAX_OPERATION_BYTES): Buffer => {
  try {
    return readBoundWorkspaceFile(workspace, path, maxBytes);
  } catch (error) {
    throw new WorkspaceAccessError(error instanceof Error ? error.message : String(error));
  }
};

const replaceBound = (
  workspace: string,
  path: string,
  expected: Uint8Array | null,
  replacement: Uint8Array
): void => {
  try {
    replaceBoundWorkspaceFile(workspace, path, expected, replacement);
  } catch (error) {
    throw new WorkspaceAccessError(error instanceof Error ? error.message : String(error));
  }
};

const deleteBound = (workspace: string, path: string, expected: Uint8Array): void => {
  try {
    deleteBoundWorkspaceFile(workspace, path, expected);
  } catch (error) {
    throw new WorkspaceAccessError(error instanceof Error ? error.message : String(error));
  }
};

const recoveryUsage = async (workspace: string): Promise<{ bytes: number; entries: number }> => {
  let recovery: ReturnType<typeof inspectWorkspacePath>;
  try {
    recovery = inspectWorkspacePath(workspace, RECOVERY_DIRECTORY);
  } catch (error) {
    throw new WorkspaceAccessError(error instanceof Error ? error.message : String(error));
  }
  if (recovery.kind === 'missing') return { bytes: 0, entries: 0 };
  if (recovery.kind !== 'directory') {
    throw new WorkspaceAccessError('The recovery vault path is not a directory.');
  }
  let files: string[];
  try {
    files = listBoundWorkspaceFiles(workspace, RECOVERY_DIRECTORY, MAX_RECOVERY_ENTRIES + 1).files;
  } catch (error) {
    throw new WorkspaceAccessError(error instanceof Error ? error.message : String(error));
  }
  let bytes = 0;
  for (const file of files) {
    bytes += inspectWorkspacePath(workspace, file).size;
    if (bytes > MAX_RECOVERY_BYTES) break;
  }
  return { bytes, entries: files.length };
};

const prepareRecovery = async (
  manifest: OperationManifestV1,
  source: StructuredTargetSnapshot,
  destinationPath: string | null
): Promise<{
  directory: string;
  stored: string;
  recordPath: string;
  recordBytes: Buffer;
  record: RecoveryRecord;
}> => {
  const usage = await recoveryUsage(manifest.workspace);
  if (
    usage.entries + source.entries + 1 > MAX_RECOVERY_ENTRIES ||
    usage.bytes + source.bytes > MAX_RECOVERY_BYTES
  ) {
    throw new WorkspaceAccessError(
      'The bounded recovery vault is full; recover or remove old entries first.'
    );
  }
  const absoluteDirectory = resolve(recoveryRoot(manifest.workspace), manifest.operationId);
  const relativeDirectory = relative(recoveryRoot(manifest.workspace), absoluteDirectory);
  if (relativeDirectory.startsWith(`..${sep}`) || relativeDirectory === '..') {
    throw new WorkspaceAccessError('Invalid recovery vault target.');
  }
  const directory = `${RECOVERY_DIRECTORY}/${manifest.operationId}`;
  const record: RecoveryRecord = {
    version: 1,
    operationId: manifest.operationId,
    capability: manifest.capability as RecoveryRecord['capability'],
    originalPath: source.path,
    destinationPath,
    beforeHash: source.beforeHash ?? '',
    createdAt: new Date().toISOString(),
  };
  const recordPath = `${directory}/record.json`;
  const recordBytes = Buffer.from(JSON.stringify(record), 'utf8');
  replaceBound(manifest.workspace, recordPath, null, recordBytes);
  return {
    directory,
    stored: `${directory}/${basename(source.path)}`,
    recordPath,
    recordBytes,
    record,
  };
};

export interface StructuredFileResult {
  capability: OperationManifestV1['capability'];
  source: string;
  destination: string | null;
  beforeHash: string;
  recoveryId: string | null;
}

export const executeStructuredFileOperation = async (
  rawManifest: unknown
): Promise<StructuredFileResult> => {
  const parsed = OperationManifestV1Schema.parse(rawManifest);
  const manifest = assertOperationManifest(parsed, {
    operationId: parsed.operationId,
    threadId: parsed.threadId,
    turnId: parsed.turnId,
    capability: parsed.capability,
  });
  if (!['file.copy', 'file.move', 'file.delete'].includes(manifest.capability)) {
    throw new WorkspaceAccessError('The manifest is not a structured file operation.');
  }
  if ((await realpath(manifest.workspace)) !== manifest.workspace) {
    throw new WorkspaceAccessError('The workspace canonical path changed before execution.');
  }
  await verifyStructuredTargets(manifest);
  const sourceTarget = manifest.targets[0];
  if (!sourceTarget || sourceTarget.kind === 'missing' || sourceTarget.kind === 'git-ref') {
    throw new WorkspaceAccessError('Structured file operation requires an existing source.');
  }
  const source = await snapshotStructuredTarget(manifest.workspace, sourceTarget.path);
  const destinationTarget = manifest.targets[1];
  const destination = destinationTarget
    ? await resolveWorkspacePath(manifest.workspace, destinationTarget.path, { allowMissing: true })
    : undefined;
  const sourceBytes = readBound(manifest.workspace, source.path);

  if (manifest.capability === 'file.copy') {
    if (!destination) throw new WorkspaceAccessError('Copy requires a destination.');
    replaceBound(manifest.workspace, destination.relative, null, sourceBytes);
    return {
      capability: manifest.capability,
      source: source.path,
      destination: destination.relative,
      beforeHash: source.beforeHash ?? '',
      recoveryId: null,
    };
  }

  const recovery = await prepareRecovery(manifest, source, destination?.relative ?? null);
  let destinationCreated = false;
  let recoveryStored = false;
  try {
    replaceBound(manifest.workspace, recovery.stored, null, sourceBytes);
    recoveryStored = true;
    if (manifest.capability === 'file.move') {
      if (!destination) throw new WorkspaceAccessError('Move requires a destination.');
      replaceBound(manifest.workspace, destination.relative, null, sourceBytes);
      destinationCreated = true;
    }
    deleteBound(manifest.workspace, source.path, sourceBytes);
  } catch (error) {
    if (destinationCreated && destination) {
      try {
        deleteBound(manifest.workspace, destination.relative, sourceBytes);
      } catch {
        // Preserve the original failure; the recovery payload remains available.
      }
    }
    if (recoveryStored) {
      try {
        deleteBound(manifest.workspace, recovery.stored, sourceBytes);
      } catch {
        // Preserve the original failure; cleanup can be retried explicitly.
      }
    }
    try {
      deleteBound(manifest.workspace, recovery.recordPath, recovery.recordBytes);
    } catch {
      // Preserve the original failure; an inert recovery record is safer than pathname cleanup.
    }
    throw error;
  }
  return {
    capability: manifest.capability,
    source: source.path,
    destination: destination?.relative ?? null,
    beforeHash: source.beforeHash ?? '',
    recoveryId: manifest.operationId,
  };
};

export const createRestoreManifest = async (input: {
  threadId: string;
  turnId: string;
  workspaceRoot: string;
  recoveryId: string;
}): Promise<OperationManifestV1> => {
  if (!RECOVERY_ID_PATTERN.test(input.recoveryId)) {
    throw new WorkspaceAccessError('The recovery identifier is invalid.');
  }
  const workspace = await realpath(input.workspaceRoot);
  const directory = resolve(recoveryRoot(workspace), input.recoveryId);
  const recordPath = relative(workspace, resolve(directory, 'record.json')).split(sep).join('/');
  const recordSnapshot = await snapshotStructuredTarget(workspace, recordPath, false, true);
  const record = JSON.parse(readBound(workspace, recordPath).toString('utf8')) as RecoveryRecord;
  if (record.version !== 1 || record.operationId !== input.recoveryId) {
    throw new WorkspaceAccessError('The recovery record is invalid.');
  }
  const storedPath = relative(workspace, resolve(directory, basename(record.originalPath)))
    .split(sep)
    .join('/');
  const storedSnapshot = await snapshotStructuredTarget(workspace, storedPath, false, true);
  if (storedSnapshot.beforeHash !== record.beforeHash) {
    throw new WorkspaceAccessError('The recovery payload does not match its record.');
  }
  const target = await snapshotStructuredTarget(workspace, record.originalPath, true);
  if (target.kind !== 'missing') {
    throw new WorkspaceAccessError('Recovery never overwrites an existing path.');
  }
  return createOperationManifest({
    capability: 'file.restore',
    threadId: input.threadId,
    turnId: input.turnId,
    workspace,
    targets: [target, recordSnapshot, storedSnapshot].map((snapshot) => ({
      path: snapshot.path,
      kind: snapshot.kind,
      beforeHash: snapshot.beforeHash,
    })),
    argv: [input.recoveryId],
  });
};

export const executeRestoreOperation = async (
  rawManifest: unknown
): Promise<StructuredFileResult> => {
  const parsed = OperationManifestV1Schema.parse(rawManifest);
  const manifest = assertOperationManifest(parsed, {
    operationId: parsed.operationId,
    threadId: parsed.threadId,
    turnId: parsed.turnId,
    capability: 'file.restore',
  });
  const recoveryId = manifest.argv?.[0];
  const target = manifest.targets[0];
  const recordTarget = manifest.targets[1];
  const storedTarget = manifest.targets[2];
  if (
    !recoveryId ||
    !RECOVERY_ID_PATTERN.test(recoveryId) ||
    !target ||
    target.kind !== 'missing' ||
    !recordTarget ||
    !recordTarget.path.startsWith(`${RECOVERY_DIRECTORY}/${recoveryId}/`) ||
    !storedTarget ||
    !storedTarget.path.startsWith(`${RECOVERY_DIRECTORY}/${recoveryId}/`)
  ) {
    throw new WorkspaceAccessError('The restore binding is incomplete.');
  }
  await verifyStructuredTargets(manifest);
  const directory = `${RECOVERY_DIRECTORY}/${recoveryId}`;
  const recordPath = `${directory}/record.json`;
  const recordBytes = readBound(manifest.workspace, recordPath);
  const record = JSON.parse(recordBytes.toString('utf8')) as RecoveryRecord;
  const stored = `${directory}/${basename(record.originalPath)}`;
  const destination = await resolveWorkspacePath(manifest.workspace, record.originalPath, {
    allowMissing: true,
  });
  const recovered = inventoryBoundTarget(manifest.workspace, stored);
  if (!recovered) {
    throw new WorkspaceAccessError('The recovery payload is unavailable.');
  }
  if (recovered.digest !== record.beforeHash) {
    throw new WorkspaceAccessError('The recovery payload changed and cannot be restored.');
  }
  const storedBytes = readBound(manifest.workspace, stored);
  replaceBound(manifest.workspace, destination.relative, null, storedBytes);
  deleteBound(manifest.workspace, stored, storedBytes);
  deleteBound(manifest.workspace, recordPath, recordBytes);
  return {
    capability: 'file.restore',
    source: record.originalPath,
    destination: record.originalPath,
    beforeHash: record.beforeHash,
    recoveryId,
  };
};
