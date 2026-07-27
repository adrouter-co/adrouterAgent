import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (process.env.ADROUTER_API_KEY) {
  throw new Error('Manual Desktop smoke checks do not accept bearer credentials.');
}
const executable = process.env.ADROUTER_AGENT_EXECUTABLE;
if (!executable || !existsSync(executable)) {
  throw new Error(
    'Set ADROUTER_AGENT_EXECUTABLE to the exact installed candidate executable after approving this Agent in the WebUI.'
  );
}
const environment = { ...process.env };
delete environment.ADROUTER_API_KEY;
const result = spawnSync(executable, ['--installation-auth-smoke'], {
  encoding: 'utf8',
  env: environment,
  maxBuffer: 1024 * 1024,
});
const line = result.stdout
  .split(/\r?\n/)
  .map((candidate) => candidate.trim())
  .findLast((candidate) => candidate.startsWith('{'));
if (!line) throw new Error('The packaged Agent returned no smoke diagnostic.');
const diagnostic = JSON.parse(line);
if (
  result.status !== 0 ||
  diagnostic.schema !== 1 ||
  !diagnostic.authenticated ||
  diagnostic.modelCount < 1 ||
  diagnostic.authentication?.mode !== 'installation' ||
  diagnostic.authentication?.state !== 'connected' ||
  diagnostic.authentication?.storageClassification !== 'os_encrypted' ||
  !diagnostic.authentication?.signedRequestSupport ||
  !diagnostic.authentication?.refreshHealthy
) {
  throw new Error('The packaged installation-authentication smoke check did not pass.');
}
process.stdout.write(`${JSON.stringify(diagnostic)}\n`);
