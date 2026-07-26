import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { safeStorage } from 'electron';
import { AdRouterClient } from '../runtime/router-client';
import { DEFAULT_ADROUTER_SERVER_URL } from '../shared/constants';
import type {
  RouterConfiguration,
  RouterDiagnostics,
  RouterModelDescriptor,
  ThinkingLevel,
} from '../shared/contracts';
import { assertSecureCredentialStorage } from './credential-storage';

interface PersistedConfiguration {
  version: 3;
  serverUrl: string;
  sponsoredCompute: boolean;
  encryptedToken: string | null;
  models: RouterModelDescriptor[];
  selectedModel: string | null;
  selectedThinkingLevel: ThinkingLevel;
  lastCheckedAt: string | null;
}

const legacyModel = (id: string): RouterModelDescriptor => ({
  id,
  provider: 'router',
  displayName: id,
  providerLabel: 'AdRouter',
  thinkingLevels: ['none', 'medium', 'high'],
  defaultThinkingLevel: 'medium',
  configured: false,
});

const allowRouterUrl = (value: string): string => {
  const url = new URL(value);
  const localHost =
    url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && localHost)) {
    throw new Error('Use HTTPS for AdRouter, except a local development server.');
  }
  if (url.username || url.password || url.hash) {
    throw new Error('AdRouter URLs cannot contain credentials or fragments.');
  }
  return url.toString().replace(/\/$/, '');
};

export class ConfigurationStore {
  public constructor(private readonly path: string) {}

  public async get(): Promise<RouterConfiguration> {
    const configuration = await this.read();
    return {
      serverUrl: configuration?.serverUrl ?? DEFAULT_ADROUTER_SERVER_URL,
      sponsoredCompute: configuration?.sponsoredCompute ?? true,
      tokenStored: Boolean(configuration?.encryptedToken),
      configured: Boolean(configuration?.serverUrl && configuration.encryptedToken),
      models: configuration?.models ?? [],
      selectedModel: configuration?.selectedModel ?? configuration?.models[0]?.id ?? null,
      selectedThinkingLevel: configuration?.selectedThinkingLevel ?? 'medium',
      lastCheckedAt: configuration?.lastCheckedAt ?? null,
    };
  }

  public async save(input: {
    serverUrl: string;
    token: string;
    sponsoredCompute: boolean;
  }): Promise<RouterConfiguration> {
    const existing = await this.read();
    if (__ADROUTER_E2E__) {
      const serverUrl = allowRouterUrl(input.serverUrl);
      const diagnostics = await new AdRouterClient({ serverUrl, token: input.token }).diagnostics();
      this.assertConnected(diagnostics);
      await this.write({
        version: 3,
        serverUrl,
        sponsoredCompute: input.sponsoredCompute,
        encryptedToken: 'e2e-runtime-token',
        models: diagnostics.models,
        ...this.selectPreferences(existing, diagnostics.models),
        lastCheckedAt: diagnostics.checkedAt,
      });
      return this.get();
    }
    await assertSecureCredentialStorage();
    const serverUrl = allowRouterUrl(input.serverUrl);
    const diagnostics = await new AdRouterClient({ serverUrl, token: input.token }).diagnostics();
    this.assertConnected(diagnostics);
    const encryptedToken = (await safeStorage.encryptStringAsync(input.token)).toString('base64');
    const configuration: PersistedConfiguration = {
      version: 3,
      serverUrl,
      sponsoredCompute: input.sponsoredCompute,
      encryptedToken,
      models: diagnostics.models,
      ...this.selectPreferences(existing, diagnostics.models),
      lastCheckedAt: diagnostics.checkedAt,
    };
    await this.write(configuration);
    return this.get();
  }

  public async signOut(): Promise<RouterConfiguration> {
    const configuration = await this.read();
    if (!configuration) {
      return this.get();
    }
    await this.write({ ...configuration, encryptedToken: null });
    return this.get();
  }

  public async test(input: { serverUrl: string; token: string }): Promise<RouterDiagnostics> {
    try {
      const client = new AdRouterClient({
        serverUrl: allowRouterUrl(input.serverUrl),
        token: input.token,
      });
      const result = await client.diagnostics();
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        health: false,
        authenticated: false,
        mode: 'unknown',
        models: [],
        modelsStale: false,
        checkedAt: new Date().toISOString(),
        error: message,
      };
    }
  }

  public async status(): Promise<RouterDiagnostics> {
    const configuration = await this.read();
    if (!configuration) {
      return {
        health: false,
        authenticated: false,
        mode: 'unknown',
        models: [],
        modelsStale: false,
        checkedAt: new Date().toISOString(),
        error: 'AdRouter is not configured.',
      };
    }
    try {
      const runtime = await this.getRuntimeConfiguration();
      const diagnostics = await new AdRouterClient({
        serverUrl: runtime.serverUrl,
        token: runtime.token,
      }).diagnostics();
      if (diagnostics.health && diagnostics.authenticated && diagnostics.models.length > 0) {
        configuration.models = diagnostics.models;
        configuration.lastCheckedAt = diagnostics.checkedAt;
        if (
          !configuration.selectedModel ||
          !diagnostics.models.some((model) => model.id === configuration.selectedModel)
        ) {
          configuration.selectedModel = diagnostics.models[0]?.id ?? null;
          configuration.selectedThinkingLevel =
            diagnostics.models[0]?.defaultThinkingLevel ?? 'medium';
        }
        await this.write(configuration);
        return diagnostics;
      }
      return {
        ...diagnostics,
        models: diagnostics.models.length > 0 ? diagnostics.models : configuration.models,
        modelsStale: diagnostics.models.length === 0 && configuration.models.length > 0,
      };
    } catch (error) {
      return {
        health: false,
        authenticated: false,
        mode: 'unknown',
        models: configuration.models,
        modelsStale: configuration.models.length > 0,
        checkedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  public async updatePreferences(input: {
    model: string;
    thinkingLevel: ThinkingLevel;
  }): Promise<RouterConfiguration> {
    const configuration = await this.read();
    if (!configuration) throw new Error('AdRouter is not configured.');
    const model = configuration.models.find((candidate) => candidate.id === input.model);
    if (!model) throw new Error('The selected model is not in the cached router catalog.');
    if (!model.thinkingLevels.includes(input.thinkingLevel)) {
      throw new Error('The selected thinking level is not supported by this model.');
    }
    configuration.selectedModel = model.id;
    configuration.selectedThinkingLevel = input.thinkingLevel;
    await this.write(configuration);
    return this.get();
  }

  public async getRuntimeConfiguration(): Promise<{
    serverUrl: string;
    token: string;
    sponsoredCompute: boolean;
  }> {
    const configuration = await this.read();
    if (!configuration?.encryptedToken) {
      throw new Error('Complete AdRouter onboarding before starting an agent task.');
    }
    if (__ADROUTER_E2E__) {
      const token = process.env.ADROUTER_E2E_TOKEN;
      if (!token) throw new Error('The deterministic E2E router token is unavailable.');
      return {
        serverUrl: configuration.serverUrl,
        token,
        sponsoredCompute: configuration.sponsoredCompute,
      };
    }
    await assertSecureCredentialStorage();
    const decrypted = await safeStorage.decryptStringAsync(
      Buffer.from(configuration.encryptedToken, 'base64')
    );
    if (decrypted.shouldReEncrypt) {
      configuration.encryptedToken = (
        await safeStorage.encryptStringAsync(decrypted.result)
      ).toString('base64');
      await this.write(configuration);
    }
    return {
      serverUrl: configuration.serverUrl,
      token: decrypted.result,
      sponsoredCompute: configuration.sponsoredCompute,
    };
  }

  private async read(): Promise<PersistedConfiguration | undefined> {
    if (!existsSync(this.path)) {
      return undefined;
    }
    const parsed = JSON.parse(await readFile(this.path, 'utf8')) as Record<string, unknown>;
    if (
      parsed.version === 1 &&
      typeof parsed.serverUrl === 'string' &&
      typeof parsed.sponsoredCompute === 'boolean' &&
      typeof parsed.encryptedToken === 'string' &&
      Array.isArray(parsed.models) &&
      parsed.models.every((model) => typeof model === 'string')
    ) {
      const models = (parsed.models as string[]).map(legacyModel);
      const migrated: PersistedConfiguration = {
        version: 3,
        serverUrl: allowRouterUrl(parsed.serverUrl),
        sponsoredCompute: parsed.sponsoredCompute,
        encryptedToken: parsed.encryptedToken,
        models,
        selectedModel: models[0]?.id ?? null,
        selectedThinkingLevel: 'medium',
        lastCheckedAt: null,
      };
      await this.write(migrated);
      return migrated;
    }
    if (
      parsed.version === 2 &&
      typeof parsed.serverUrl === 'string' &&
      typeof parsed.sponsoredCompute === 'boolean' &&
      typeof parsed.encryptedToken === 'string' &&
      Array.isArray(parsed.models) &&
      parsed.models.every(
        (model) =>
          model &&
          typeof model === 'object' &&
          typeof (model as RouterModelDescriptor).id === 'string' &&
          Array.isArray((model as RouterModelDescriptor).thinkingLevels)
      ) &&
      (parsed.selectedModel === null || typeof parsed.selectedModel === 'string') &&
      ['none', 'medium', 'high'].includes(String(parsed.selectedThinkingLevel)) &&
      (parsed.lastCheckedAt === null || typeof parsed.lastCheckedAt === 'string')
    ) {
      const migrated: PersistedConfiguration = {
        version: 3,
        serverUrl: allowRouterUrl(parsed.serverUrl),
        sponsoredCompute: parsed.sponsoredCompute,
        encryptedToken: parsed.encryptedToken,
        models: parsed.models as RouterModelDescriptor[],
        selectedModel: parsed.selectedModel as string | null,
        selectedThinkingLevel: parsed.selectedThinkingLevel as ThinkingLevel,
        lastCheckedAt: parsed.lastCheckedAt as string | null,
      };
      await this.write(migrated);
      return migrated;
    }
    if (
      parsed.version !== 3 ||
      typeof parsed.serverUrl !== 'string' ||
      typeof parsed.sponsoredCompute !== 'boolean' ||
      !(parsed.encryptedToken === null || typeof parsed.encryptedToken === 'string') ||
      !Array.isArray(parsed.models) ||
      !parsed.models.every(
        (model) =>
          model &&
          typeof model === 'object' &&
          typeof (model as RouterModelDescriptor).id === 'string' &&
          Array.isArray((model as RouterModelDescriptor).thinkingLevels)
      ) ||
      !(parsed.selectedModel === null || typeof parsed.selectedModel === 'string') ||
      !['none', 'medium', 'high'].includes(String(parsed.selectedThinkingLevel)) ||
      !(parsed.lastCheckedAt === null || typeof parsed.lastCheckedAt === 'string')
    ) {
      throw new Error('AdRouter configuration is corrupted. Re-enter the server settings.');
    }
    return {
      version: 3,
      serverUrl: allowRouterUrl(parsed.serverUrl),
      sponsoredCompute: parsed.sponsoredCompute,
      encryptedToken: parsed.encryptedToken as string | null,
      models: parsed.models as RouterModelDescriptor[],
      selectedModel: parsed.selectedModel as string | null,
      selectedThinkingLevel: parsed.selectedThinkingLevel as ThinkingLevel,
      lastCheckedAt: parsed.lastCheckedAt as string | null,
    };
  }

  private assertConnected(diagnostics: RouterDiagnostics): void {
    if (!diagnostics.health || !diagnostics.authenticated) {
      throw new Error(diagnostics.error ?? 'AdRouter connection verification failed.');
    }
  }

  private selectPreferences(
    existing: PersistedConfiguration | undefined,
    models: RouterModelDescriptor[]
  ): Pick<PersistedConfiguration, 'selectedModel' | 'selectedThinkingLevel'> {
    const previous = models.find((model) => model.id === existing?.selectedModel);
    if (previous) {
      return {
        selectedModel: previous.id,
        selectedThinkingLevel: previous.thinkingLevels.includes(
          existing?.selectedThinkingLevel ?? previous.defaultThinkingLevel
        )
          ? (existing?.selectedThinkingLevel ?? previous.defaultThinkingLevel)
          : previous.defaultThinkingLevel,
      };
    }
    return {
      selectedModel: models[0]?.id ?? null,
      selectedThinkingLevel: models[0]?.defaultThinkingLevel ?? 'medium',
    };
  }

  private async write(configuration: PersistedConfiguration): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = resolve(dirname(this.path), `.config-${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, JSON.stringify(configuration), { encoding: 'utf8', mode: 0o600 });
      await rename(temporary, this.path);
    } finally {
      if (existsSync(temporary)) {
        await unlink(temporary).catch(() => undefined);
      }
    }
  }
}
