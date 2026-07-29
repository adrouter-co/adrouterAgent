import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CANONICAL_STAGING_ORIGIN,
  verifyPackagedStagingDefault,
} from './verify-packaged-default.mjs';

const main = '/.vite/build/main.js';
const renderer = '/.vite/renderer/main_window/assets/index-reviewed.js';

function verify(mainValue, rendererValue, overrides = {}) {
  const files = overrides.files ?? [main, renderer];
  const sources = {
    [main]: `export const defaultOrigin = ${JSON.stringify(mainValue)};`,
    [renderer]: `const defaultOrigin = ${JSON.stringify(rendererValue)};`,
    ...overrides.sources,
  };
  return verifyPackagedStagingDefault(files, (filename) => sources[filename]);
}

test('accepts the exact canonical origin in main and renderer bundles', () => {
  assert.deepEqual(verify(CANONICAL_STAGING_ORIGIN, CANONICAL_STAGING_ORIGIN), {
    mainBundle: main,
    rendererBundles: [renderer],
  });
});

for (const [name, value] of [
  ['host suffix', `${CANONICAL_STAGING_ORIGIN}.evil`],
  ['prefix', `prefix-${CANONICAL_STAGING_ORIGIN}`],
  ['path embedding', `https://example.test/${CANONICAL_STAGING_ORIGIN}`],
  ['query embedding', `https://example.test/?next=${CANONICAL_STAGING_ORIGIN}`],
]) {
  test(`rejects ${name}`, () => {
    assert.throws(
      () => verify(value, value),
      /does not contain the exact canonical staging default/
    );
  });
}

test('rejects a missing main or renderer bundle', () => {
  assert.throws(
    () => verifyPackagedStagingDefault([renderer], () => ''),
    /missing expected main bundle/
  );
  assert.throws(
    () => verifyPackagedStagingDefault([main], () => ''),
    /missing expected renderer JavaScript bundles/
  );
});

test('rejects malformed expected JavaScript', () => {
  assert.throws(
    () =>
      verify(CANONICAL_STAGING_ORIGIN, CANONICAL_STAGING_ORIGIN, {
        sources: { [main]: 'const broken = ;' },
      }),
    /Unable to parse packaged JavaScript/
  );
});
