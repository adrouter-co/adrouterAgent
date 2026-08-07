import { callAutomation, pairAutomation } from './automation.mjs';
import { inspectInstallation, install, launch } from './installer.mjs';
import { readManifest, selectArtifact } from './manifest.mjs';
import { applySignedUpdate, checkForUpdate } from './update.mjs';

const USAGE = `Usage: adrouter-agent [command] [options]

  launch       Install if needed, then launch (default)
  install      Download, verify, and cache without launching
  doctor       Report installation and security status [--json]
  pair         Pair this CLI with the running Agent [--json] [--name NAME]
  rpc METHOD   Call a paired local RPC method [--params JSON] [--key KEY_ID] [--json]
  update check Check the fixed-origin signed update channel [--channel beta|stable] [--json]
  update apply Apply a signed update [--channel beta|stable] --confirm [--json]
  --version    Print the release version without downloading
`;

const parseArgs = (args) => {
  const parsed = {
    positional: [],
    json: false,
    params: undefined,
    keyId: undefined,
    name: undefined,
    channel: undefined,
    confirm: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--json') {
      parsed.json = true;
      continue;
    }
    if (argument === '--confirm') {
      if (parsed.confirm) throw new Error('--confirm may be provided only once.');
      parsed.confirm = true;
      continue;
    }
    if (['--params', '--key', '--name', '--channel'].includes(argument)) {
      const value = args[index + 1];
      if (!value || value.startsWith('-'))
        throw new Error(`${argument} requires a value.\n${USAGE}`);
      index += 1;
      const field =
        argument === '--params'
          ? 'params'
          : argument === '--key'
            ? 'keyId'
            : argument === '--name'
              ? 'name'
              : 'channel';
      if (parsed[field] !== undefined) throw new Error(`${argument} may be provided only once.`);
      parsed[field] = value;
      continue;
    }
    if (argument.startsWith('-')) throw new Error(`Unknown option ${argument}.\n${USAGE}`);
    parsed.positional.push(argument);
  }
  return parsed;
};

const parseParams = (text) => {
  if (text === undefined) return {};
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('--params must be valid JSON.');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('--params must be a JSON object.');
  }
  return value;
};

const writeResult = (io, value, json) => {
  io.stdout.write(`${JSON.stringify(value, null, json ? 0 : 2)}\n`);
};

export async function runCli(args, io = process, overrides = {}) {
  const dependencies = {
    readManifest,
    selectArtifact,
    inspectInstallation,
    install,
    launch,
    pairAutomation,
    callAutomation,
    checkForUpdate,
    applySignedUpdate,
    ...overrides,
  };
  const manifest = await dependencies.readManifest();
  if (args.includes('--version') || args.includes('-v')) {
    io.stdout.write(`${manifest.releaseVersion}\n`);
    return;
  }
  if (args.includes('--help') || args.includes('-h')) {
    io.stdout.write(USAGE);
    return;
  }
  const parsed = parseArgs(args);
  const command = parsed.positional[0] ?? 'launch';

  if (command === 'update') {
    const action = parsed.positional[1];
    if (
      !['check', 'apply'].includes(action) ||
      parsed.positional.length !== 2 ||
      parsed.params ||
      parsed.keyId ||
      parsed.name ||
      (parsed.channel !== undefined && !['beta', 'stable'].includes(parsed.channel)) ||
      (action === 'check' && parsed.confirm)
    ) {
      throw new Error(USAGE.trim());
    }
    const channel = parsed.channel ?? (manifest.releaseVersion.includes('-') ? 'beta' : 'stable');
    const result =
      action === 'check'
        ? await dependencies.checkForUpdate(manifest.releaseVersion, channel)
        : await dependencies.applySignedUpdate(manifest.releaseVersion, channel, {
            userConfirmed: parsed.confirm,
            installImpl: dependencies.install,
            launchImpl: dependencies.launch,
            selectArtifactImpl: dependencies.selectArtifact,
          });
    const output = {
      channel: result.channel,
      currentVersion: result.currentVersion,
      latestVersion: result.latestVersion,
      available: result.available,
      ...(action === 'apply' ? { applied: result.applied } : {}),
    };
    if (parsed.json) writeResult(io, output, true);
    else {
      io.stdout.write(
        result.available
          ? `Signed ${channel} update ${result.latestVersion} is available.\n`
          : `AdRouter Agent ${result.currentVersion} is current on ${channel}.\n`
      );
    }
    return;
  }

  if (command === 'doctor') {
    if (
      parsed.positional.length !== 1 ||
      parsed.params ||
      parsed.keyId ||
      parsed.name ||
      parsed.channel ||
      parsed.confirm
    ) {
      throw new Error(USAGE.trim());
    }
    const report = await dependencies.inspectInstallation(manifest);
    if (parsed.json) io.stdout.write(`${JSON.stringify(report)}\n`);
    else {
      for (const [key, value] of Object.entries(report)) io.stdout.write(`${key}: ${value}\n`);
    }
    return;
  }
  if (command === 'install') {
    if (
      parsed.positional.length !== 1 ||
      parsed.json ||
      parsed.params ||
      parsed.keyId ||
      parsed.name ||
      parsed.channel ||
      parsed.confirm
    ) {
      throw new Error(USAGE.trim());
    }
    const appPath = await dependencies.install(manifest);
    io.stdout.write(`Installed and verified ${appPath}\n`);
    const report = await dependencies.inspectInstallation(manifest);
    if (report.warning) io.stderr.write(`Warning: ${report.warning}\n`);
    return;
  }
  if (command === 'pair') {
    if (
      parsed.positional.length !== 1 ||
      parsed.params ||
      parsed.keyId ||
      parsed.channel ||
      parsed.confirm
    )
      throw new Error(USAGE.trim());
    const artifact = dependencies.selectArtifact(manifest);
    const appPath = await dependencies.install(manifest);
    const report = await dependencies.inspectInstallation(manifest);
    if (report.warning) io.stderr.write(`Warning: ${report.warning}\n`);
    await dependencies.launch(appPath, { artifact });
    const result = await dependencies.pairAutomation(appPath, artifact, {
      displayName: parsed.name,
      onPairing: (pairing) => {
        const message = `Pairing comparison code: ${pairing.comparisonCode}. Approve it in AdRouter Agent.\n`;
        (parsed.json ? io.stderr : io.stdout).write(message);
      },
    });
    const output = {
      protocolVersion: 1,
      clientId: result.pairing.clientId,
      keyId: result.keyId,
      scopes: result.pairing.scopes,
    };
    if (parsed.json) writeResult(io, output, true);
    else io.stdout.write(`Paired client ${output.clientId} with protected key ${output.keyId}.\n`);
    return;
  }
  if (command === 'rpc') {
    if (parsed.positional.length !== 2 || parsed.name || parsed.channel || parsed.confirm)
      throw new Error(USAGE.trim());
    const report = await dependencies.inspectInstallation(manifest);
    if (!report.installed || !report.receiptMatches || !report.bundleIntegrity) {
      throw new Error(
        'A verified launcher-managed Agent installation is required; run adrouter-agent install.'
      );
    }
    const result = await dependencies.callAutomation(
      report.applicationPath,
      dependencies.selectArtifact(manifest),
      parsed.positional[1],
      parseParams(parsed.params),
      { keyId: parsed.keyId }
    );
    writeResult(io, result, parsed.json);
    return;
  }
  if (command !== 'launch') throw new Error(`Unknown command ${command}.\n${USAGE}`);
  if (
    parsed.positional.length > 1 ||
    parsed.json ||
    parsed.params ||
    parsed.keyId ||
    parsed.name ||
    parsed.channel ||
    parsed.confirm
  ) {
    throw new Error(USAGE.trim());
  }
  const appPath = await dependencies.install(manifest);
  const report = await dependencies.inspectInstallation(manifest);
  if (report.warning) io.stderr.write(`Warning: ${report.warning}\n`);
  await dependencies.launch(appPath, { artifact: dependencies.selectArtifact(manifest) });
}
