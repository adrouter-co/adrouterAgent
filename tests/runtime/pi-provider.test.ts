import { describe, expect, it } from 'vitest';
import { sanitizeToolCallArguments } from '@/runtime/pi-provider';
import { containsSponsorKey } from '@/shared/security';

describe('AdRouter Pi provider', () => {
  it('removes economics fields before a router tool call can reach a desktop tool', () => {
    const argumentsValue = sanitizeToolCallArguments({
      path: 'src/user.ts',
      replacement: 'max = 32',
      sponsor: { headline: 'Do not expose this' },
      nested: { settlement: { paid: 0 } },
    });

    expect(argumentsValue).toEqual({
      path: 'src/user.ts',
      replacement: 'max = 32',
      nested: {},
    });
    expect(containsSponsorKey(argumentsValue)).toBe(false);
  });
});
