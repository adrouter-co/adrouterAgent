import type { z } from 'zod';
import {
  type TaskPolicySnapshotV1,
  TaskPresetCreateInputSchema,
  TaskPresetUpdateInputSchema,
  type TaskPresetV1,
} from '../shared/contracts';
import { createTaskPreset, presetPolicySnapshot } from '../shared/task-policy';
import type { ConfigurationStore } from './configuration-store';
import type { AppDatabase } from './database';

const MAX_PRESETS = 64;

export class PresetService {
  public constructor(
    private readonly database: AppDatabase,
    private readonly configuration: ConfigurationStore
  ) {}

  public list(): TaskPresetV1[] {
    return this.database.listTaskPresets();
  }

  public async create(raw: z.input<typeof TaskPresetCreateInputSchema>): Promise<TaskPresetV1> {
    const input = TaskPresetCreateInputSchema.parse(raw);
    if (this.database.listTaskPresets().length >= MAX_PRESETS) {
      throw new Error(`At most ${MAX_PRESETS} task presets can be stored.`);
    }
    await this.assertModel(input.model, input.thinkingLevel);
    this.assertUniqueName(input.name);
    return this.database.saveTaskPreset(createTaskPreset(input));
  }

  public async update(raw: z.input<typeof TaskPresetUpdateInputSchema>): Promise<TaskPresetV1> {
    const input = TaskPresetUpdateInputSchema.parse(raw);
    const existing = this.database.getTaskPreset(input.id);
    if (!existing) throw new Error('Task preset not found.');
    await this.assertModel(input.model, input.thinkingLevel);
    this.assertUniqueName(input.name, input.id);
    return this.database.saveTaskPreset(createTaskPreset(input, existing));
  }

  public delete(id: string): void {
    if (!this.database.deleteTaskPreset(id)) throw new Error('Task preset not found.');
  }

  public async resolveSnapshot(
    presetId: string,
    requested?: { model: string; thinkingLevel: TaskPresetV1['thinkingLevel'] }
  ): Promise<TaskPolicySnapshotV1> {
    const preset = this.database.getTaskPreset(presetId);
    if (!preset) throw new Error('The selected task preset is unavailable.');
    if (
      requested &&
      (requested.model !== preset.model || requested.thinkingLevel !== preset.thinkingLevel)
    ) {
      throw new Error('The task model and thinking level must match the selected preset.');
    }
    await this.assertModel(preset.model, preset.thinkingLevel);
    return presetPolicySnapshot(preset);
  }

  private assertUniqueName(name: string, ignoredId?: string): void {
    const key = name.normalize('NFKC').trim().toLocaleLowerCase('en-US');
    if (
      this.database
        .listTaskPresets()
        .some(
          (preset) =>
            preset.id !== ignoredId &&
            preset.name.normalize('NFKC').toLocaleLowerCase('en-US') === key
        )
    ) {
      throw new Error('Task preset names must be unique, ignoring letter case.');
    }
  }

  private async assertModel(
    modelId: string,
    thinkingLevel: TaskPresetV1['thinkingLevel']
  ): Promise<void> {
    const configuration = await this.configuration.get();
    const model = configuration.models.find((candidate) => candidate.id === modelId);
    if (!model) throw new Error('The preset model is not in the validated router catalog.');
    if (!model.thinkingLevels.includes(thinkingLevel)) {
      throw new Error('The preset thinking level is not supported by its model.');
    }
  }
}
