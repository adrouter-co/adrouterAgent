import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { AppDatabase } from '@/main/database';
import { RepositoryService } from '@/main/repository-service';

const execFile = promisify(execFileCallback);
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

describe('repository instruction registration', () => {
  it('opens a readable non-Git directory with nullable Git metadata', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'adrouter-folder-'));
    const state = await mkdtemp(join(tmpdir(), 'adrouter-folder-state-'));
    directories.push(workspace, state);
    const database = new AppDatabase(join(state, 'agent.sqlite'));
    const opened = await new RepositoryService(database).open(workspace);

    expect(opened.path).toBe(await realpath(workspace));
    expect(opened.git).toBeNull();
    database.close();
  });

  it('refreshes repository instructions without discarding user-authored instructions', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'adrouter-repository-'));
    const state = await mkdtemp(join(tmpdir(), 'adrouter-repository-state-'));
    directories.push(workspace, state);
    await execFile('git', ['-C', workspace, 'init']);
    await writeFile(join(workspace, 'AGENTS.md'), 'Repository rule one.');

    const database = new AppDatabase(join(state, 'agent.sqlite'));
    const repositories = new RepositoryService(database);
    const opened = await repositories.open(workspace);
    expect(opened.repositoryInstructionFiles).toEqual(['AGENTS.md']);
    expect(opened.repositoryInstructions).toBe('Repository rule one.');

    database.updateProject(opened.id, { instructions: 'Always preserve the public API.' });
    await writeFile(join(workspace, 'AGENTS.md'), 'Repository rule two.');
    const reopened = await repositories.open(workspace);

    expect(reopened.instructions).toBe('Always preserve the public API.');
    expect(reopened.repositoryInstructions).toBe('Repository rule two.');
    expect(reopened.repositoryInstructionFiles).toEqual(['AGENTS.md']);
    database.close();
  });
});
