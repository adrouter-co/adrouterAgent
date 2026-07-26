import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ConfigurationStore } from '@/main/configuration-store';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

describe('ConfigurationStore', () => {
  it('migrates cached model IDs without changing the encrypted token', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'adrouter-config-'));
    directories.push(directory);
    const path = join(directory, 'configuration.json');
    await writeFile(
      path,
      JSON.stringify({
        version: 1,
        serverUrl: 'https://router.example',
        sponsoredCompute: true,
        encryptedToken: 'preserve-ciphertext',
        models: ['model-flash'],
      })
    );

    const store = new ConfigurationStore(path);
    await expect(store.get()).resolves.toMatchObject({
      models: [{ id: 'model-flash', thinkingLevels: ['none', 'medium', 'high'] }],
      selectedModel: 'model-flash',
      selectedThinkingLevel: 'medium',
    });
    await expect(
      store.updatePreferences({ model: 'model-flash', thinkingLevel: 'high' })
    ).resolves.toMatchObject({ selectedModel: 'model-flash', selectedThinkingLevel: 'high' });

    const persisted = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
    expect(persisted).toMatchObject({ version: 2, encryptedToken: 'preserve-ciphertext' });
  });
});
