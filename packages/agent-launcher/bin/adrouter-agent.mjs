#!/usr/bin/env node

import { runCli } from '../lib/cli.mjs';

runCli(process.argv.slice(2)).catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`adrouter-agent: ${message}\n`);
  process.exitCode = 1;
});
