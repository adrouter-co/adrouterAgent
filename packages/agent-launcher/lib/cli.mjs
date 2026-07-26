import { inspectInstallation, install, launch } from './installer.mjs';
import { readManifest, selectArtifact } from './manifest.mjs';

const USAGE = `Usage: adrouter-agent [launch|install|doctor [--json]|--version]

  launch       Install if needed, then launch (default)
  install      Download, verify, and cache without launching
  doctor       Report installation and security status
  --version    Print the release version without downloading
`;

export async function runCli(args, io = process) {
  const manifest = await readManifest();
  if (args.includes('--version') || args.includes('-v')) {
    io.stdout.write(`${manifest.releaseVersion}\n`);
    return;
  }
  if (args.includes('--help') || args.includes('-h')) {
    io.stdout.write(USAGE);
    return;
  }
  const positional = args.filter((argument) => !argument.startsWith('-'));
  const command = positional[0] ?? 'launch';
  const unknownOptions = args.filter(
    (argument) => argument.startsWith('-') && argument !== '--json'
  );
  if (unknownOptions.length > 0 || positional.length > 1) throw new Error(USAGE.trim());

  if (command === 'doctor') {
    const report = await inspectInstallation(manifest);
    if (args.includes('--json')) io.stdout.write(`${JSON.stringify(report)}\n`);
    else {
      for (const [key, value] of Object.entries(report)) io.stdout.write(`${key}: ${value}\n`);
    }
    return;
  }
  if (args.includes('--json')) throw new Error('--json is supported only by doctor.');
  if (command === 'install') {
    const appPath = await install(manifest);
    io.stdout.write(`Installed and verified ${appPath}\n`);
    const report = await inspectInstallation(manifest);
    if (report.warning) io.stderr.write(`Warning: ${report.warning}\n`);
    return;
  }
  if (command !== 'launch') throw new Error(`Unknown command ${command}.\n${USAGE}`);
  const appPath = await install(manifest);
  const report = await inspectInstallation(manifest);
  if (report.warning) io.stderr.write(`Warning: ${report.warning}\n`);
  await launch(appPath, { artifact: selectArtifact(manifest) });
}
