import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { optimizeDesktopPrompt, resolveCacheOptimizationMode } from '@/runtime/cache-optimizer';

describe('desktop-native cache optimization', () => {
  it('defaults to byte-neutral stats and treats an invalid override as stats-only', () => {
    expect(resolveCacheOptimizationMode(undefined)).toEqual({
      mode: 'stats-only',
      source: 'default',
    });
    expect(resolveCacheOptimizationMode('off')).toEqual({
      mode: 'off',
      source: 'environment',
    });
    expect(resolveCacheOptimizationMode('unexpected')).toEqual({
      mode: 'stats-only',
      source: 'invalid-environment',
    });

    const prompt = 'Stable\r\nRules\r\n\r\nDYNAMIC\r\nBYTES';
    for (const mode of ['off', 'stats-only'] as const) {
      expect(
        optimizeDesktopPrompt({
          systemPrompt: prompt,
          stablePrefixEnd: 'Stable\r\nRules'.length,
          modelId: 'deepseek-v4-flash',
          mode,
        })
      ).toMatchObject({ systemPrompt: prompt, changed: false, mode });
    }
  });

  it('rewrites only a DeepSeek stable prefix and preserves every dynamic byte', () => {
    const stable = 'Stable\r\nRules';
    const dynamic = '\r\n\r\nRepository instructions:\r\nDYNAMIC\r\nBYTES';
    const optimized = optimizeDesktopPrompt({
      systemPrompt: stable + dynamic,
      stablePrefixEnd: stable.length,
      modelId: 'deepseek-v4-pro',
      mode: 'prompt-rewrite',
    });
    expect(optimized).toMatchObject({ eligible: true, changed: true });
    expect(optimized.systemPrompt).toBe(`Stable\nRules${dynamic}`);
    expect(optimized.systemPrompt.slice('Stable\nRules'.length)).toBe(dynamic);

    const ineligible = optimizeDesktopPrompt({
      systemPrompt: stable + dynamic,
      stablePrefixEnd: stable.length,
      modelId: 'mimo-v2.5',
      mode: 'prompt-rewrite',
    });
    expect(ineligible).toMatchObject({
      systemPrompt: stable + dynamic,
      eligible: false,
      changed: false,
    });
  });

  it('has no provider mutation, hosted cache fields, persistence, or network authority', () => {
    const source = readFileSync(resolve('src', 'runtime', 'cache-optimizer.ts'), 'utf8');
    for (const forbidden of [
      'models.json',
      'registerProvider(',
      'promptCacheKey',
      'cacheRetention',
      'fetch(',
      'writeFile',
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });
});
