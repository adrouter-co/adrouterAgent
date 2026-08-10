import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const walk = (directory, excludedDirectories = new Set()) =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return excludedDirectories.has(entry.name) ? [] : walk(path, excludedDirectories);
    }
    return [path];
  });

export const reviewedProductFiles = () =>
  [
    ...readdirSync('assets')
      .filter((name) => /^icon\.(?:icns|ico|png|svg)$/.test(name))
      .map((name) => join('assets', name)),
    'entitlements.mac.plist',
    'forge.config.ts',
    'package.json',
    'scripts/build-workspace-broker.mjs',
    ...walk('native/workspace-broker', new Set(['build'])).filter((name) =>
      /\.(?:c|gyp|h)$/.test(name)
    ),
    ...walk('src').filter(
      (name) => /\.(?:ts|tsx)$/.test(name) && name !== join('src', 'main', 'ipc.ts')
    ),
  ].sort();
