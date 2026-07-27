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
  it('uses staging only as the fresh unconfigured default', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'adrouter-config-'));
    directories.push(directory);
    const store = new ConfigurationStore(join(directory, 'configuration.json'));
    await expect(store.get()).resolves.toMatchObject({
      serverUrl: 'https://api-staging.adrouter.co',
      configured: false,
      tokenStored: false,
    });
  });

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
    expect(persisted).toMatchObject({ version: 4, encryptedToken: 'preserve-ciphertext' });
  });

  it('migrates a previously signed-out configuration without treating it as corrupted', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'adrouter-config-'));
    directories.push(directory);
    const path = join(directory, 'configuration.json');
    await writeFile(
      path,
      JSON.stringify({
        version: 3,
        serverUrl: 'https://api-staging.adrouter.co',
        sponsoredCompute: true,
        encryptedToken: null,
        models: [],
        selectedModel: null,
        selectedThinkingLevel: 'medium',
        lastCheckedAt: null,
      })
    );

    const store = new ConfigurationStore(path);
    await expect(store.get()).resolves.toMatchObject({
      configured: false,
      tokenStored: false,
      authentication: { mode: 'unconfigured', state: 'none' },
    });
  });

  it('signs out locally while preserving non-secret settings and cached preferences', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'adrouter-config-'));
    directories.push(directory);
    const path = join(directory, 'configuration.json');
    await writeFile(
      path,
      JSON.stringify({
        version: 2,
        serverUrl: 'https://router.example',
        sponsoredCompute: false,
        encryptedToken: 'remove-ciphertext',
        models: [
          {
            id: 'model-pro',
            provider: 'router',
            displayName: 'Model Pro',
            providerLabel: 'AdRouter',
            thinkingLevels: ['medium', 'high'],
            defaultThinkingLevel: 'medium',
            configured: true,
          },
        ],
        selectedModel: 'model-pro',
        selectedThinkingLevel: 'high',
        lastCheckedAt: '2026-07-26T00:00:00.000Z',
      })
    );

    const store = new ConfigurationStore(path);
    await expect(store.signOutLocal()).resolves.toMatchObject({
      serverUrl: 'https://router.example',
      sponsoredCompute: false,
      tokenStored: false,
      configured: false,
      selectedModel: 'model-pro',
      selectedThinkingLevel: 'high',
    });
    await expect(store.getRuntimeConfiguration()).rejects.toThrow(
      'Complete AdRouter onboarding before starting an agent task.'
    );

    const persisted = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
    expect(persisted).toMatchObject({
      version: 4,
      serverUrl: 'https://router.example',
      sponsoredCompute: false,
      encryptedToken: null,
      selectedModel: 'model-pro',
      selectedThinkingLevel: 'high',
    });
  });
});
