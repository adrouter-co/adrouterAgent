import { describe, expect, it } from 'vitest';
import catalog from '@/shared/catalog/adrouter-model-catalog.v2.json';
import {
  ADROUTER_CATALOG_DIGEST,
  bundledCatalogModels,
  computeCatalogDigest,
  type ModelCatalogError,
  validateLiveCatalog,
} from '@/shared/model-catalog';

const livePayload = (): unknown => ({
  schema_version: catalog.schema_version,
  catalog_digest: catalog.catalog_digest,
  models: catalog.models.map((model) => ({ ...model, configured: true })),
});

const expectCatalogError = (operation: () => unknown, code: ModelCatalogError['code']): void => {
  try {
    operation();
  } catch (error) {
    expect(error).toMatchObject({ code });
    return;
  }

  throw new Error(`Expected ${code}`);
};

describe('canonical AdRouter model catalog', () => {
  it('matches the exact ordered tool-capable hosted contract', () => {
    const validated = validateLiveCatalog(livePayload(), true);

    expect(validated.digest).toBe(ADROUTER_CATALOG_DIGEST);
    expect(validated.models.map((model) => model.id)).toEqual([
      'deepseek-v4-flash',
      'deepseek-v4-pro',
      'mimo-v2.5',
      'mimo-v2.5-pro',
      'agnes-2.0-flash',
      'agnes-2.5-flash',
    ]);
    expect(bundledCatalogModels()).toEqual(
      validated.models.map((model) => ({ ...model, configured: false }))
    );
  });

  it('rejects hosted catalog drift instead of inferring compatibility', () => {
    const payload = livePayload() as { models: Array<Record<string, unknown>> };
    payload.models[0] = { ...payload.models[0], description: 'Changed after packaging.' };

    expectCatalogError(() => validateLiveCatalog(payload, true), 'catalog_incompatible');
  });

  it('requires every v2 descriptor field while accepting digest-bound additive fields', () => {
    const missing = livePayload() as { models: Array<Record<string, unknown>> };
    delete missing.models[0]?.max_output_tokens;
    expectCatalogError(() => validateLiveCatalog(missing, false), 'catalog_invalid');

    const extra = livePayload() as {
      schema_version: 2;
      catalog_digest: string;
      models: Array<Record<string, unknown>>;
      response_note?: string;
    };
    extra.models[0] = { ...extra.models[0], inferred_reasoning: true };
    extra.response_note = 'safe additive envelope field';
    extra.catalog_digest = computeCatalogDigest({
      schema_version: 2,
      models: extra.models.map(({ configured: _configured, ...model }) => model),
    });
    expect(validateLiveCatalog(extra, true).models).toHaveLength(6);
  });

  it('allows a legacy server-scoped custom catalog without hosted ID inference', () => {
    const payload = {
      models: [{ ...catalog.models[0], id: 'custom-flash', configured: true }],
    };

    const validated = validateLiveCatalog(payload, false);
    expect(validated.models).toHaveLength(1);
    expect(validated.models[0]).toMatchObject({
      id: 'custom-flash',
      contextWindow: 1_048_576,
      maxInputTokens: 917_504,
      maxOutputTokens: 65_536,
    });
    expect(validated.digest).not.toBe(ADROUTER_CATALOG_DIGEST);
  });

  it('classifies a legacy official envelope as incompatible instead of corrupt', () => {
    const payload = { models: catalog.models.map((model) => ({ ...model, configured: true })) };
    expectCatalogError(() => validateLiveCatalog(payload, true), 'catalog_incompatible');
  });
});
