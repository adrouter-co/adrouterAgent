import { execFile as execFileCallback } from 'node:child_process';
import { readFile, realpath, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';
import { BrowserWindow, dialog, type OpenDialogOptions } from 'electron';
import type { Project } from '../shared/contracts';
import type { AppDatabase } from './database';

const execFile = promisify(execFileCallback);
const MAX_INSTRUCTIONS_BYTES = 100_000;

const git = async (workspace: string, args: string[]): Promise<string> => {
  const { stdout } = await execFile('git', ['-C', workspace, ...args], {
    encoding: 'utf8',
    timeout: 10_000,
    windowsHide: true,
  });
  return stdout.trim();
};

const optionalGit = async (workspace: string, args: string[]): Promise<string | null> => {
  try {
    const value = await git(workspace, args);
    return value || null;
  } catch {
    return null;
  }
};

const readInstruction = async (path: string): Promise<string> => {
  try {
    const bytes = await readFile(path);
    if (bytes.length > MAX_INSTRUCTIONS_BYTES || bytes.includes(0)) {
      return '';
    }
    return bytes.toString('utf8').trim();
  } catch {
    return '';
  }
};

const loadInstructions = async (workspace: string): Promise<{ text: string; files: string[] }> => {
  const candidates = ['AGENTS.md', '.agent/instructions.md'];
  const contents = await Promise.all(
    candidates.map(async (relativePath) => ({
      relativePath,
      content: await readInstruction(join(workspace, relativePath)),
    }))
  );
  const loaded = contents.filter((candidate) => candidate.content);
  return {
    text: loaded.map((candidate) => candidate.content).join('\n\n'),
    files: loaded.map((candidate) => candidate.relativePath),
  };
};

export class RepositoryService {
  public constructor(private readonly database: AppDatabase) {}

  public async open(path?: string): Promise<Project> {
    const selectedPath = path ?? (await this.pickFolder());
    const workspace = await realpath(selectedPath);
    const workspaceStat = await stat(workspace);
    if (!workspaceStat.isDirectory()) {
      throw new Error('Select a local project directory.');
    }
    const insideGit = await optionalGit(workspace, ['rev-parse', '--is-inside-work-tree']);
    const repositoryInstructions = await loadInstructions(workspace);
    const gitMetadata =
      insideGit === 'true'
        ? await (async () => {
            const [branch, status, remote] = await Promise.all([
              optionalGit(workspace, ['branch', '--show-current']),
              optionalGit(workspace, ['status', '--porcelain']),
              optionalGit(workspace, ['remote', 'get-url', 'origin']),
            ]);
            return {
              branch,
              changeCount: status ? status.split(/\r?\n/).filter(Boolean).length : 0,
              isDirty: Boolean(status),
              remote,
            };
          })()
        : null;
    const existing = this.database.getProjectByPath(workspace);
    if (existing) {
      return this.database.updateProject(existing.id, {
        git: gitMetadata,
        repositoryInstructions: repositoryInstructions.text,
        repositoryInstructionFiles: repositoryInstructions.files,
      });
    }
    return this.database.createProject({
      path: workspace,
      displayName: basename(workspace),
      instructions: '',
      repositoryInstructions: repositoryInstructions.text,
      repositoryInstructionFiles: repositoryInstructions.files,
      permissionMode: 'workspace-write',
      git: gitMetadata,
    });
  }

  private async pickFolder(): Promise<string> {
    if (__ADROUTER_E2E__ && process.env.ADROUTER_E2E_WORKSPACE) {
      return process.env.ADROUTER_E2E_WORKSPACE;
    }
    const focused = BrowserWindow.getFocusedWindow();
    const options: OpenDialogOptions = {
      title: 'Open a project folder',
      properties: ['openDirectory', 'createDirectory'],
      buttonLabel: 'Open Folder',
    };
    const response = focused
      ? await dialog.showOpenDialog(focused, options)
      : await dialog.showOpenDialog(options);
    if (response.canceled || !response.filePaths[0]) {
      throw new Error('Folder selection was cancelled.');
    }
    return response.filePaths[0];
  }
}
