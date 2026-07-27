import { execFileSync } from 'node:child_process';
import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import { MakerZIP } from '@electron-forge/maker-zip';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { VitePlugin } from '@electron-forge/plugin-vite';
import type { ForgeConfig } from '@electron-forge/shared-types';

const enableInspectorForE2E = process.env.ADROUTER_E2E_BUILD === '1';

async function removeEmbeddedCodeSignatures(directory: string): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      const child = join(directory, entry.name);
      if (!entry.isDirectory() || entry.isSymbolicLink()) return;
      if (entry.name === '_CodeSignature') {
        await rm(child, { recursive: true, force: true });
        return;
      }
      await removeEmbeddedCodeSignatures(child);
    })
  );
}

async function finalizeMacSignatures(
  buildPath: string,
  platform: string,
  arch: string
): Promise<void> {
  if (platform !== 'darwin') return;

  // The prebuilt Electron archives carry architecture-specific ad-hoc resource
  // signatures. They must be removed before @electron/universal joins the two
  // slices; the final universal app is then ad-hoc signed without Apple
  // credentials.
  const isUniversalSlice = buildPath.includes('electron-packager-universal-');
  if ((arch === 'x64' || arch === 'arm64') && isUniversalSlice) {
    await removeEmbeddedCodeSignatures(buildPath);
    return;
  }

  const entries = await readdir(buildPath, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.endsWith('.app')) continue;
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', join(buildPath, entry.name)], {
      stdio: 'inherit',
    });
  }
}

function finalizeMacSignaturesHook(
  buildPath: string,
  _electronVersion: string,
  platform: string,
  arch: string,
  done: (error?: Error | null) => void
): void {
  finalizeMacSignatures(buildPath, platform, arch).then(
    () => done(),
    (error: unknown) => done(error instanceof Error ? error : new Error(String(error)))
  );
}

function hardenMacInfoPlistHook(
  buildPath: string,
  _electronVersion: string,
  platform: string,
  _arch: string,
  done: (error?: Error | null) => void
): void {
  if (platform !== 'darwin') {
    done();
    return;
  }

  try {
    const infoPlist = join(buildPath, 'AdRouter Agent.app', 'Contents', 'Info.plist');
    for (const key of [
      'NSAudioCaptureUsageDescription',
      'NSBluetoothAlwaysUsageDescription',
      'NSBluetoothPeripheralUsageDescription',
      'NSCameraUsageDescription',
      'NSMicrophoneUsageDescription',
    ]) {
      execFileSync('plutil', ['-remove', key, infoPlist]);
    }
    done();
  } catch (error: unknown) {
    done(error instanceof Error ? error : new Error(String(error)));
  }
}

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    afterComplete: [finalizeMacSignaturesHook],
    beforeCopyExtraResources: [hardenMacInfoPlistHook],
    appBundleId: 'com.adrouter.agent',
    appVersion: '0.1.0',
    buildVersion: '10008',
    appCategoryType: 'public.app-category.developer-tools',
    appCopyright: 'Copyright 2026 AdRouter Agent contributors',
    extraResource: ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'PRIVACY.md'],
    icon: 'assets/icon',
    extendInfo: {
      LSMinimumSystemVersion: '12.0.0',
      NSAppTransportSecurity: {
        NSAllowsArbitraryLoads: false,
        NSAllowsLocalNetworking: true,
      },
      NSHighResolutionCapable: true,
    },
    osxSign: {
      identity: '-',
      identityValidation: false,
      optionsForFile: () => ({ hardenedRuntime: false }),
    },
  },
  rebuildConfig: {},
  makers: [new MakerZIP({}, ['darwin', 'linux', 'win32'])],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new VitePlugin({
      build: [
        {
          entry: 'src/main/index.ts',
          config: 'vite.main.config.ts',
        },
        {
          entry: 'src/preload/index.ts',
          config: 'vite.preload.config.ts',
        },
        {
          entry: 'src/runtime/index.ts',
          config: 'vite.runtime.config.ts',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      // Playwright's Electron driver attaches through --inspect. This opt-in
      // build flag is used only by `npm run test:e2e`; release builds keep the
      // inspector disabled.
      [FuseV1Options.EnableNodeCliInspectArguments]: enableInspectorForE2E,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      // Electron 43's universal Forge output fails to launch when this fuse
      // is enabled, even though the same ASAR passes embedded-integrity
      // validation. Keep archive integrity validation on and do not emit an
      // unpacked application directory; revisit this when Electron fixes the
      // universal package interaction.
      [FuseV1Options.OnlyLoadAppFromAsar]: false,
      [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
    }),
  ],
};

export default config;
