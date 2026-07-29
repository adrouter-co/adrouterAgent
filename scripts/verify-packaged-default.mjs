import { parse } from 'acorn';

export const CANONICAL_STAGING_ORIGIN = 'https://api-staging.adrouter.co';
const MAIN_BUNDLE = '/.vite/build/main.js';
const RENDERER_BUNDLE = /^\/\.vite\/renderer\/main_window\/assets\/[^/]+\.js$/;

function stringLiterals(source, filename) {
  let tree;
  try {
    tree = parse(source, {
      allowHashBang: true,
      ecmaVersion: 'latest',
      sourceType: 'module',
    });
  } catch (error) {
    throw new Error(`Unable to parse packaged JavaScript ${filename}: ${error.message}`);
  }
  const values = new Set();
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'Literal' && typeof node.value === 'string') values.add(node.value);
    if (node.type === 'TemplateLiteral' && node.expressions?.length === 0) {
      values.add(node.quasis?.[0]?.value?.cooked ?? '');
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === 'start' || key === 'end') continue;
      if (Array.isArray(value)) {
        for (const child of value) visit(child);
      } else {
        visit(value);
      }
    }
  };
  visit(tree);
  return values;
}

export function verifyPackagedStagingDefault(packagedFiles, readText) {
  if (!packagedFiles.includes(MAIN_BUNDLE)) {
    throw new Error(`Packaged application is missing expected main bundle ${MAIN_BUNDLE}.`);
  }
  const rendererBundles = packagedFiles.filter((filename) => RENDERER_BUNDLE.test(filename));
  if (rendererBundles.length === 0) {
    throw new Error('Packaged application is missing expected renderer JavaScript bundles.');
  }

  const mainValues = stringLiterals(readText(MAIN_BUNDLE), MAIN_BUNDLE);
  if (!mainValues.has(CANONICAL_STAGING_ORIGIN)) {
    throw new Error('Packaged main bundle does not contain the exact canonical staging default.');
  }

  const rendererHasDefault = rendererBundles.some((filename) =>
    stringLiterals(readText(filename), filename).has(CANONICAL_STAGING_ORIGIN)
  );
  if (!rendererHasDefault) {
    throw new Error(
      'Packaged renderer bundles do not contain the exact canonical staging default.'
    );
  }

  return { mainBundle: MAIN_BUNDLE, rendererBundles };
}
