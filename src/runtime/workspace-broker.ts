import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

interface NativeWorkspaceBroker {
  inspectPath(
    root: string,
    relativePath: string
  ): { kind: 'file' | 'directory' | 'missing'; size: number };
  readFile(root: string, relativePath: string, maxBytes: number): Buffer;
  replaceFile(
    root: string,
    relativePath: string,
    expected: Buffer | null,
    replacement: Buffer
  ): void;
  deleteFile(root: string, relativePath: string, expected: Buffer): void;
  listFiles(
    root: string,
    relativePath: string,
    maxEntries: number
  ): { files: string[]; truncated: boolean; rejected: boolean };
}

const nativeFilename = 'adrouter_workspace_broker.node';
let loadedBroker: NativeWorkspaceBroker | undefined;

const brokerCandidates = (): string[] => {
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  const sourceRoot = resolve(moduleDirectory, '..', '..');
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  const packagedPlatform =
    process.platform === 'darwin' ? 'darwin-universal' : `${process.platform}-${process.arch}`;
  return [
    resourcesPath
      ? join(resourcesPath, 'vendor', 'workspace-broker', packagedPlatform, nativeFilename)
      : undefined,
    join(sourceRoot, 'native', 'workspace-broker', 'build', 'Release', nativeFilename),
  ].filter((candidate): candidate is string => Boolean(candidate));
};

const nativeBroker = (): NativeWorkspaceBroker => {
  if (loadedBroker) return loadedBroker;
  const require = createRequire(import.meta.url);
  for (const candidate of brokerCandidates()) {
    if (!existsSync(candidate)) continue;
    try {
      loadedBroker = require(candidate) as NativeWorkspaceBroker;
      return loadedBroker;
    } catch {
      // A wrong-architecture or invalid native artifact must not trigger a pathname fallback.
    }
  }
  throw new Error(
    'The descriptor-bound workspace broker is unavailable; workspace filesystem access is disabled.'
  );
};

export const inspectWorkspacePath = (
  root: string,
  relativePath: string
): { kind: 'file' | 'directory' | 'missing'; size: number } =>
  nativeBroker().inspectPath(root, relativePath);

export const readBoundWorkspaceFile = (
  root: string,
  relativePath: string,
  maxBytes: number
): Buffer => Buffer.from(nativeBroker().readFile(root, relativePath, maxBytes));

export const replaceBoundWorkspaceFile = (
  root: string,
  relativePath: string,
  expected: Uint8Array | null,
  replacement: Uint8Array
): void =>
  nativeBroker().replaceFile(
    root,
    relativePath,
    expected === null ? null : Buffer.from(expected),
    Buffer.from(replacement)
  );

export const deleteBoundWorkspaceFile = (
  root: string,
  relativePath: string,
  expected: Uint8Array
): void => nativeBroker().deleteFile(root, relativePath, Buffer.from(expected));

export const listBoundWorkspaceFiles = (
  root: string,
  relativePath: string,
  maxEntries: number
): { files: string[]; truncated: boolean; rejected: boolean } =>
  nativeBroker().listFiles(root, relativePath, maxEntries);
