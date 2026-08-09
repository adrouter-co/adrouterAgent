import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ConfigurationStore } from '@/main/configuration-store';
import { AppDatabase } from '@/main/database';
import { PresetService } from '@/main/preset-service';
import type { RouterModelDescriptor, TaskCapabilityPolicyV1 } from '@/shared/contracts';

const directories: string[] = [];
const model: RouterModelDescriptor = {
  id: 'model-pro',
  provider: 'fixture',
  modelClass: 'pro',
  displayName: 'Model Pro',
  providerLabel: 'Fixture',
  description: 'Preset fixture model.',
  thinkingLevels: ['medium', 'high'],
  defaultThinkingLevel: 'medium',
  inputModalities: ['text'],
  toolCalling: true,
  contextWindow: 131_072,
  maxInputTokens: 126_976,
  maxOutputTokens: 4_096,
  configured: true,
};
const policy: TaskCapabilityPolicyV1 = {
  schemaVersion: 1,
  workspaceAccess: 'workspace-write',
  fileMutations: true,
  generalCommands: false,
  networkFetch: false,
  dependencyChanges: false,
  gitWrites: true,
  delegation: false,
};

const createFixture = async (): Promise<{
  database: AppDatabase;
  service: PresetService;
  projectId: string;
}> => {
  const directory = await mkdtemp(join(tmpdir(), 'adrouter-presets-'));
  directories.push(directory);
  const database = new AppDatabase(join(directory, 'agent.sqlite'));
  const project = database.createProject({
    path: join(directory, 'workspace'),
    displayName: 'workspace',
    instructions: '',
    permissionMode: 'workspace-write',
    git: null,
  });
  const configuration = {
    get: async () => ({ models: [model] }),
  } as unknown as ConfigurationStore;
  return { database, service: new PresetService(database, configuration), projectId: project.id };
};

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

describe('task presets', () => {
  it('validates catalog choices and case-insensitive unique names', async () => {
    const { database, service } = await createFixture();
    const created = await service.create({
      name: '  Review only  ',
      model: model.id,
      thinkingLevel: 'high',
      extraInstructions: 'Inspect carefully and report findings.',
      capabilityPolicy: policy,
    });
    expect(created).toMatchObject({ name: 'Review only', model: model.id, thinkingLevel: 'high' });
    expect(created.digest).toMatch(/^[a-f0-9]{64}$/);
    await expect(
      service.create({
        name: 'review ONLY',
        model: model.id,
        thinkingLevel: 'medium',
        extraInstructions: '',
        capabilityPolicy: policy,
      })
    ).rejects.toThrow('unique');
    await expect(
      service.create({
        name: 'Unknown model',
        model: 'missing',
        thinkingLevel: 'medium',
        extraInstructions: '',
        capabilityPolicy: policy,
      })
    ).rejects.toThrow('validated router catalog');
    await expect(
      service.create({
        name: 'Unsupported thinking',
        model: model.id,
        thinkingLevel: 'none',
        extraInstructions: '',
        capabilityPolicy: policy,
      })
    ).rejects.toThrow('not supported');
    database.close();
  });

  it('snapshots exact policy and instructions so later preset edits or deletion cannot mutate a task', async () => {
    const { database, service, projectId } = await createFixture();
    const preset = await service.create({
      name: 'Guarded implementation',
      model: model.id,
      thinkingLevel: 'medium',
      extraInstructions: 'Do not change generated files.',
      capabilityPolicy: policy,
    });
    const snapshot = await service.resolveSnapshot(preset.id, {
      model: model.id,
      thinkingLevel: 'medium',
    });
    const thread = database.createThread({
      projectId,
      title: 'Immutable policy',
      model: model.id,
      thinkingLevel: 'medium',
      policySnapshot: snapshot,
    });

    const updated = await service.update({
      id: preset.id,
      name: preset.name,
      model: model.id,
      thinkingLevel: 'high',
      extraInstructions: 'Changed later.',
      capabilityPolicy: { ...policy, generalCommands: true },
    });
    expect(updated.digest).not.toBe(preset.digest);
    service.delete(preset.id);

    expect(database.getTaskPolicySnapshot(thread.id)).toEqual(snapshot);
    expect(database.getThreadDetail(thread.id).policy).toMatchObject({
      presetId: preset.id,
      presetDigest: preset.digest,
      hasExtraInstructions: true,
      capabilityPolicy: policy,
    });
    expect(database.getThreadDetail(thread.id).policy).not.toHaveProperty('extraInstructions');
    await expect(
      service.resolveSnapshot(preset.id, { model: model.id, thinkingLevel: 'medium' })
    ).rejects.toThrow('unavailable');
    database.close();
  });

  it('rejects a caller that tries to pair a preset with different turn defaults', async () => {
    const { database, service } = await createFixture();
    const preset = await service.create({
      name: 'Exact defaults',
      model: model.id,
      thinkingLevel: 'medium',
      extraInstructions: '',
      capabilityPolicy: policy,
    });
    await expect(
      service.resolveSnapshot(preset.id, { model: model.id, thinkingLevel: 'high' })
    ).rejects.toThrow('must match');
    database.close();
  });
});
