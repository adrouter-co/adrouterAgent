import type { CacheOptimizationMode } from '../shared/contracts';

export const CACHE_OPTIMIZATION_ENV = 'ADROUTER_CACHE_OPTIMIZER';

export interface CacheOptimizationResolution {
  mode: CacheOptimizationMode;
  source: 'default' | 'environment' | 'invalid-environment';
}

export interface OptimizedPrompt {
  systemPrompt: string;
  mode: CacheOptimizationMode;
  eligible: boolean;
  changed: boolean;
  stablePrefixBytes: number;
}

const MODES: readonly CacheOptimizationMode[] = ['off', 'stats-only', 'prompt-rewrite'];

const isMode = (value: string): value is CacheOptimizationMode =>
  MODES.includes(value as CacheOptimizationMode);

/**
 * Resolve one process-level, non-secret cache setting. Invalid values fail closed to the
 * request-byte-neutral stats-only mode.
 */
export const resolveCacheOptimizationMode = (
  raw = process.env[CACHE_OPTIMIZATION_ENV]
): CacheOptimizationResolution => {
  if (raw === undefined) return { mode: 'stats-only', source: 'default' };
  const normalized = raw.trim().toLowerCase();
  return isMode(normalized)
    ? { mode: normalized, source: 'environment' }
    : { mode: 'stats-only', source: 'invalid-environment' };
};

/**
 * Canonicalize line endings only in the app-owned stable instruction prefix. Project,
 * repository, bundle, skill-index, and task-preset bytes begin at stablePrefixEnd and are never
 * rewritten. Hosted request fields and provider configuration are outside this function.
 */
export const optimizeDesktopPrompt = (input: {
  systemPrompt: string;
  stablePrefixEnd: number;
  modelId: string;
  mode: CacheOptimizationMode;
}): OptimizedPrompt => {
  const stablePrefixEnd = Math.max(0, Math.min(input.systemPrompt.length, input.stablePrefixEnd));
  const eligible = input.modelId.startsWith('deepseek-');
  const stablePrefix = input.systemPrompt.slice(0, stablePrefixEnd);
  if (input.mode !== 'prompt-rewrite' || !eligible) {
    return {
      systemPrompt: input.systemPrompt,
      mode: input.mode,
      eligible,
      changed: false,
      stablePrefixBytes: Buffer.byteLength(stablePrefix, 'utf8'),
    };
  }
  const canonicalPrefix = stablePrefix.replace(/\r\n?/g, '\n');
  const systemPrompt = canonicalPrefix + input.systemPrompt.slice(stablePrefixEnd);
  return {
    systemPrompt,
    mode: input.mode,
    eligible,
    changed: systemPrompt !== input.systemPrompt,
    stablePrefixBytes: Buffer.byteLength(canonicalPrefix, 'utf8'),
  };
};
