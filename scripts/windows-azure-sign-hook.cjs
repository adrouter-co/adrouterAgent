'use strict';

const { spawnSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const { isAbsolute, resolve } = require('node:path');

module.exports = async function signWithProtectedAzureProvider(fileToSign) {
  const tool = process.env.ADROUTER_WINDOWS_SIGN_TOOL;
  const argumentsFile = process.env.ADROUTER_WINDOWS_SIGN_ARGUMENTS_FILE;
  const expectedSubject = process.env.ADROUTER_WINDOWS_SIGNER_SUBJECT;
  if (
    !tool ||
    !argumentsFile ||
    !expectedSubject ||
    !isAbsolute(tool) ||
    !isAbsolute(argumentsFile)
  ) {
    throw new Error('Protected Windows signing configuration is incomplete or not absolute.');
  }
  const configuration = JSON.parse(readFileSync(argumentsFile, 'utf8'));
  if (
    configuration?.schema !== 1 ||
    configuration?.provider !== 'azure-artifact-signing' ||
    !Array.isArray(configuration.arguments) ||
    configuration.arguments.length < 1 ||
    configuration.arguments.length > 64 ||
    configuration.arguments.filter((argument) => argument === '{file}').length !== 1 ||
    configuration.arguments.some(
      (argument) => typeof argument !== 'string' || argument.length < 1 || argument.length > 4096
    )
  ) {
    throw new Error('Protected Azure Artifact Signing arguments are invalid.');
  }
  const absoluteFile = resolve(fileToSign);
  const result = spawnSync(
    tool,
    configuration.arguments.map((argument) => (argument === '{file}' ? absoluteFile : argument)),
    { encoding: 'utf8', windowsHide: true, timeout: 120_000, maxBuffer: 1024 * 1024 }
  );
  if (result.status !== 0) {
    throw new Error('Azure Artifact Signing failed; protected tool output was suppressed.');
  }
  const verification = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '& { param([string]$path,[string]$subject) $s=Get-AuthenticodeSignature -LiteralPath $path; if ([string]$s.Status -ne "Valid" -or [string]$s.SignerCertificate.Subject -ne $subject) { exit 1 } }',
      absoluteFile,
      expectedSubject,
    ],
    { encoding: 'utf8', windowsHide: true, timeout: 30_000, maxBuffer: 64 * 1024 }
  );
  if (verification.status !== 0) {
    throw new Error('The protected Windows signature did not match the configured signer.');
  }
};
