import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AppDatabase } from '@/main/database';
import { GuidanceService } from '@/main/guidance-service';

const directories: string[] = [];

const createFixture = async (): Promise<{
  workspace: string;
  database: AppDatabase;
  service: GuidanceService;
  projectId: string;
}> => {
  const workspace = await mkdtemp(join(tmpdir(), 'adrouter-guidance-'));
  directories.push(workspace);
  const database = new AppDatabase(join(workspace, 'agent.sqlite'));
  const project = database.createProject({
    path: workspace,
    displayName: 'guidance-project',
    instructions: '',
    permissionMode: 'workspace-write',
    git: null,
  });
  return { workspace, database, service: new GuidanceService(database), projectId: project.id };
};

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

describe('trusted project Markdown guidance', () => {
  it('pins skills and prompts to exact content snapshots and disables them after source changes', async () => {
    const { workspace, database, service, projectId } = await createFixture();
    const skillDirectory = join(workspace, '.adrouter', 'skills', 'safe-review');
    const promptDirectory = join(workspace, '.adrouter', 'prompts');
    await mkdir(skillDirectory, { recursive: true });
    await mkdir(promptDirectory, { recursive: true });
    const skillPath = join(skillDirectory, 'SKILL.md');
    const skillContent = `---
name: Safe review
description: Inspect changes without modifying the workspace.
---
# Safe review

Read the diff and report concrete findings.
`;
    await writeFile(skillPath, skillContent);
    await writeFile(
      join(promptDirectory, 'fix-tests.md'),
      `---
id: fix-tests
title: Fix failing tests
description: Ask for a focused test repair.
---
Find the smallest cause of the failing tests and verify the repair.
`
    );

    const discovered = await service.list(projectId);
    expect(discovered).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'skill', id: 'safe-review', active: false }),
        expect.objectContaining({ kind: 'prompt', id: 'fix-tests', active: false }),
      ])
    );
    const skill = discovered.find((resource) => resource.kind === 'skill');
    const prompt = discovered.find((resource) => resource.kind === 'prompt');
    if (!skill || !prompt) throw new Error('Expected discovered guidance fixtures.');

    await expect(
      service.trust(
        projectId,
        skill.kind,
        skill.id,
        '.adrouter/skills/moved/SKILL.md',
        skill.digest
      )
    ).rejects.toThrow('exact current project guidance');
    await service.trust(projectId, skill.kind, skill.id, skill.path, skill.digest);
    await service.trust(projectId, prompt.kind, prompt.id, prompt.path, prompt.digest);
    expect(await service.runtimeSkillIndex(projectId)).toEqual([
      expect.objectContaining({ id: skill.id, digest: skill.digest, kind: 'skill' }),
    ]);
    expect(JSON.stringify(await service.runtimeSkillIndex(projectId))).not.toContain(
      'Read the diff'
    );
    expect((await service.readSkill(projectId, skill.id, skill.digest)).content).toBe(skillContent);
    expect((await service.readPrompt(projectId, prompt.id, prompt.digest)).content).toBe(
      'Find the smallest cause of the failing tests and verify the repair.\n'
    );

    await writeFile(skillPath, skillContent.replace('concrete findings', 'actionable findings'));
    expect(await service.list(projectId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'skill',
          id: skill.id,
          trusted: true,
          active: false,
          trustReason: expect.stringContaining('digest changed'),
        }),
      ])
    );
    await expect(service.readSkill(projectId, skill.id, skill.digest)).rejects.toThrow(
      'changed or was revoked'
    );
    expect(await service.runtimeSkillIndex(projectId)).toEqual([]);
    await service.revoke(projectId, 'skill', skill.id);
    expect(
      (await service.list(projectId)).find((resource) => resource.id === skill.id)
    ).toMatchObject({ trusted: false, active: false });
    database.close();
  });

  it('rejects symlinks, executable-shaped files, and duplicate IDs during bounded discovery', async () => {
    const first = await createFixture();
    const skills = join(first.workspace, '.adrouter', 'skills');
    await mkdir(skills, { recursive: true });
    await symlink(first.workspace, join(skills, 'linked-workspace'));
    await expect(first.service.list(first.projectId)).rejects.toThrow('symlink');
    first.database.close();

    const second = await createFixture();
    const prompts = join(second.workspace, '.adrouter', 'prompts');
    await mkdir(prompts, { recursive: true });
    await writeFile(join(prompts, 'run.md'), '#!/usr/bin/env node\nDo not run this.\n');
    await expect(second.service.list(second.projectId)).rejects.toThrow('shebang');
    second.database.close();

    const third = await createFixture();
    for (const directory of ['one', 'two']) {
      const path = join(third.workspace, '.adrouter', 'skills', directory);
      await mkdir(path, { recursive: true });
      await writeFile(
        join(path, 'SKILL.md'),
        `---
id: duplicate
name: ${directory}
description: Duplicate fixture ${directory}.
---
Guidance.
`
      );
    }
    await expect(third.service.list(third.projectId)).rejects.toThrow('Duplicate project guidance');
    third.database.close();
  });
});
