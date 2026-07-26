import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import {
  access,
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { sha256 } from '../shared/security';

export const MAX_TEXT_FILE_BYTES = 1024 * 1024;
const MAX_LISTED_FILES = 5_000;
const MAX_SEARCH_RESULTS = 200;
const SECRET_NAMES = new Set([
  'id_rsa',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
  'credentials',
  'credentials.json',
  'service-account.json',
  'secrets.json',
  'secret.json',
  '.netrc',
]);

export class WorkspaceAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkspaceAccessError';
  }
}

export interface WorkspacePath {
  root: string;
  absolute: string;
  relative: string;
}

export interface TextFile {
  path: WorkspacePath;
  content: string;
  hash: string;
  size: number;
}

export interface SearchResult {
  path: string;
  line: number;
  column: number;
  preview: string;
}

export interface Replacement {
  original: string;
  replacement: string;
}

const exists = async (filePath: string): Promise<boolean> => {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
};

const normalizeRelative = (input: string): string => {
  if (!input || isAbsolute(input)) {
    throw new WorkspaceAccessError('A workspace path must be a non-empty relative path.');
  }

  const normalized = input
    .split(/[\\/]+/)
    .filter(Boolean)
    .join(sep);
  if (
    !normalized ||
    normalized === '.' ||
    normalized.split(sep).some((segment) => segment === '..')
  ) {
    throw new WorkspaceAccessError('Path traversal is not permitted.');
  }

  return normalized;
};

export const isProtectedPath = (input: string): boolean => {
  const segments = input.split(/[\\/]+/).filter(Boolean);
  const fileName = segments.at(-1)?.toLowerCase() ?? '';

  return (
    segments.some((segment) => segment === '.git' || segment === '.ssh' || segment === '.aws') ||
    fileName.startsWith('.env') ||
    SECRET_NAMES.has(fileName) ||
    /\.(pem|key|p12|pfx)$/i.test(fileName)
  );
};

const isContained = (root: string, candidate: string): boolean => {
  const pathRelative = relative(root, candidate);
  return (
    pathRelative === '' ||
    (!pathRelative.startsWith(`..${sep}`) && pathRelative !== '..' && !isAbsolute(pathRelative))
  );
};

const nearestExistingParent = async (path: string): Promise<string> => {
  let current = path;
  while (!(await exists(current))) {
    const next = dirname(current);
    if (next === current) {
      throw new WorkspaceAccessError('Unable to resolve workspace parent.');
    }
    current = next;
  }
  return current;
};

export const resolveWorkspacePath = async (
  workspaceRoot: string,
  input: string,
  options: { allowMissing?: boolean; allowProtected?: boolean } = {}
): Promise<WorkspacePath> => {
  const root = await realpath(workspaceRoot);
  const normalized = normalizeRelative(input);

  if (!options.allowProtected && isProtectedPath(normalized)) {
    throw new WorkspaceAccessError('This file is protected and unavailable to the agent.');
  }

  const absolute = resolve(root, normalized);
  if (!isContained(root, absolute)) {
    throw new WorkspaceAccessError('The requested path escapes the workspace.');
  }

  const present = await exists(absolute);
  if (!present && !options.allowMissing) {
    throw new WorkspaceAccessError('The requested file does not exist.');
  }

  const existingPath = present ? absolute : await nearestExistingParent(absolute);
  const resolvedExistingPath = await realpath(existingPath);
  if (!isContained(root, resolvedExistingPath)) {
    throw new WorkspaceAccessError('Symlinks outside the workspace are not permitted.');
  }

  if (present) {
    const fileStat = await lstat(absolute);
    if (fileStat.isSymbolicLink()) {
      const resolved = await realpath(absolute);
      if (!isContained(root, resolved)) {
        throw new WorkspaceAccessError('Symlinks outside the workspace are not permitted.');
      }
    }
  }

  return { root, absolute, relative: normalized.split(sep).join('/') };
};

export const isBinary = (content: Uint8Array): boolean => {
  const sample = content.subarray(0, Math.min(content.length, 8_192));
  return sample.some((byte) => byte === 0);
};

export const readWorkspaceTextFile = async (
  workspaceRoot: string,
  input: string
): Promise<TextFile> => {
  const path = await resolveWorkspacePath(workspaceRoot, input);
  const fileStat = await stat(path.absolute);
  if (!fileStat.isFile()) {
    throw new WorkspaceAccessError('Only regular files may be read.');
  }
  if (fileStat.size > MAX_TEXT_FILE_BYTES) {
    throw new WorkspaceAccessError(`File exceeds the ${MAX_TEXT_FILE_BYTES} byte safety limit.`);
  }

  const bytes = await readFile(path.absolute);
  if (isBinary(bytes)) {
    throw new WorkspaceAccessError('Binary files are unavailable to the agent.');
  }

  return {
    path,
    content: bytes.toString('utf8'),
    hash: sha256(bytes),
    size: bytes.length,
  };
};

const walk = async (root: string, directory: string, files: string[]): Promise<void> => {
  if (files.length >= MAX_LISTED_FILES) {
    return;
  }

  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (files.length >= MAX_LISTED_FILES) {
      return;
    }
    const absolute = resolve(directory, entry.name);
    const fromRoot = relative(root, absolute).split(sep).join('/');
    if (isProtectedPath(fromRoot)) {
      continue;
    }
    if (entry.isSymbolicLink()) {
      try {
        const resolved = await realpath(absolute);
        if (!isContained(root, resolved)) {
          continue;
        }
      } catch {
        continue;
      }
    }
    if (entry.isDirectory()) {
      await walk(root, absolute, files);
    } else if (entry.isFile()) {
      files.push(fromRoot);
    }
  }
};

export const listWorkspaceFiles = async (workspaceRoot: string, input = '.'): Promise<string[]> => {
  const root = await realpath(workspaceRoot);
  const target =
    input === '.'
      ? { root, absolute: root, relative: '' }
      : await resolveWorkspacePath(root, input);
  const fileStat = await stat(target.absolute);
  if (!fileStat.isDirectory()) {
    throw new WorkspaceAccessError('list_files requires a directory.');
  }
  const files: string[] = [];
  await walk(root, target.absolute, files);
  return files.sort();
};

export const searchWorkspaceText = async (
  workspaceRoot: string,
  query: string,
  input = '.'
): Promise<SearchResult[]> => {
  if (!query.trim()) {
    throw new WorkspaceAccessError('Search text cannot be empty.');
  }

  const files = await listWorkspaceFiles(workspaceRoot, input);
  const results: SearchResult[] = [];
  for (const file of files) {
    if (results.length >= MAX_SEARCH_RESULTS) {
      break;
    }
    try {
      const text = await readWorkspaceTextFile(workspaceRoot, file);
      const lines = text.content.split(/\r?\n/);
      for (const [index, line] of lines.entries()) {
        const column = line.indexOf(query);
        if (column >= 0) {
          results.push({
            path: file,
            line: index + 1,
            column: column + 1,
            preview: line.slice(0, 500),
          });
          if (results.length >= MAX_SEARCH_RESULTS) {
            break;
          }
        }
      }
    } catch (error) {
      if (!(error instanceof WorkspaceAccessError)) {
        throw error;
      }
    }
  }
  return results;
};

const applyReplacements = (current: string, replacements: readonly Replacement[]): string => {
  let next = current;
  for (const replacement of replacements) {
    if (!replacement.original) {
      throw new WorkspaceAccessError('Patch replacements require a non-empty original block.');
    }
    const first = next.indexOf(replacement.original);
    if (
      first === -1 ||
      next.indexOf(replacement.original, first + replacement.original.length) !== -1
    ) {
      throw new WorkspaceAccessError('Patch original block must occur exactly once.');
    }
    next = `${next.slice(0, first)}${replacement.replacement}${next.slice(first + replacement.original.length)}`;
  }
  return next;
};

const atomicWrite = async (filePath: string, contents: string): Promise<void> => {
  const temp = resolve(dirname(filePath), `.${basename(filePath)}.adrouter-${randomUUID()}.tmp`);
  try {
    await writeFile(temp, contents, { encoding: 'utf8', mode: 0o600 });
    await rename(temp, filePath);
  } finally {
    if (await exists(temp)) {
      await unlink(temp);
    }
  }
};

export interface ApplyPatchInput {
  path: string;
  expectedBeforeHash: string | null;
  replacements?: Replacement[];
  createContent?: string;
  deleteFile?: boolean;
}

export interface AppliedPatch {
  path: string;
  before: string | null;
  after: string | null;
  beforeHash: string | null;
  afterHash: string | null;
}

export const applyWorkspacePatch = async (
  workspaceRoot: string,
  input: ApplyPatchInput,
  options: { deletionApproved: boolean }
): Promise<AppliedPatch> => {
  const path = await resolveWorkspacePath(workspaceRoot, input.path, { allowMissing: true });
  const filePresent = await exists(path.absolute);
  const before = filePresent ? await readWorkspaceTextFile(workspaceRoot, input.path) : undefined;

  if (before && input.expectedBeforeHash !== before.hash) {
    throw new WorkspaceAccessError(
      'The file changed since the agent read it. Refresh before applying a patch.'
    );
  }
  if (!before && input.expectedBeforeHash !== null) {
    throw new WorkspaceAccessError('Expected hash must be null when creating a file.');
  }

  if (input.deleteFile) {
    if (!before) {
      throw new WorkspaceAccessError('Cannot delete a file that does not exist.');
    }
    if (!options.deletionApproved) {
      throw new WorkspaceAccessError('File deletion requires explicit approval.');
    }
    await unlink(path.absolute);
    return {
      path: path.relative,
      before: before.content,
      after: null,
      beforeHash: before.hash,
      afterHash: null,
    };
  }

  const after = before
    ? applyReplacements(before.content, input.replacements ?? [])
    : (input.createContent ??
      (() => {
        throw new WorkspaceAccessError('Creating a file requires createContent.');
      })());

  if (Buffer.byteLength(after, 'utf8') > MAX_TEXT_FILE_BYTES) {
    throw new WorkspaceAccessError(
      `Patched file exceeds the ${MAX_TEXT_FILE_BYTES} byte safety limit.`
    );
  }

  await mkdir(dirname(path.absolute), { recursive: true });
  await atomicWrite(path.absolute, after);
  return {
    path: path.relative,
    before: before?.content ?? null,
    after,
    beforeHash: before?.hash ?? null,
    afterHash: sha256(after),
  };
};
