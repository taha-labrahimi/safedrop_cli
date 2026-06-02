#!/usr/bin/env node
// cli.js — argument parsing and command dispatch for `safedrop`.

import { runSend } from './send.js';
import { runReceive } from './receive.js';
import { DEFAULT_API_BASE } from './api.js';
import { log, style } from './ui.js';

const VERSION = '1.0.0';

const HELP = `${style.bold('safedrop')} — zero-knowledge encrypted file transfer from your terminal

${style.bold('Usage:')}
  safedrop send <file> [options]
  safedrop receive <code-or-link> [options]

${style.bold('Send options:')}
  --ttl <minutes>     How long the transfer stays available (default 15, max 1440).
  --secure            Enable full-security mode (out-of-band safety-code check).
  --api <base-url>    SafeDrop API base URL (default ${DEFAULT_API_BASE}).

${style.bold('Receive options:')}
  --output, -o <path> Where to save the file: a directory or a file path.
  --api <base-url>    SafeDrop API base URL (default ${DEFAULT_API_BASE}).

${style.bold('Other:')}
  --help, -h          Show this help.
  --version, -v       Show the version.

${style.bold('Examples:')}
  safedrop send ./report.pdf
  safedrop send ./report.pdf --ttl 60 --secure
  safedrop send ./report.pdf --api https://safedrop.ma/api
  safedrop receive eyJ1cGxvYWRDb2RlIjoi...
  safedrop receive "https://safedrop.ma/#code=eyJ1cGxv..." -o ~/Downloads/
`;

/**
 * Tiny flag parser. Supports "--flag value", "--flag=value", short aliases,
 * and boolean flags. Unknown flags are reported.
 */
function parseArgs(argv) {
  const positionals = [];
  const flags = {};
  const aliases = { '-o': '--output', '-h': '--help', '-v': '--version' };
  const booleans = new Set(['--secure', '--help', '--version']);

  for (let i = 0; i < argv.length; i++) {
    let arg = argv[i];
    if (arg.startsWith('-')) {
      let value;
      const eq = arg.indexOf('=');
      if (eq !== -1) { value = arg.slice(eq + 1); arg = arg.slice(0, eq); }
      const name = aliases[arg] || arg;
      if (booleans.has(name)) {
        flags[name.slice(2)] = true;
      } else {
        if (value === undefined) value = argv[++i];
        if (value === undefined) throw new Error(`Missing value for ${name}.`);
        flags[name.slice(2)] = value;
      }
    } else {
      positionals.push(arg);
    }
  }
  return { positionals, flags };
}

async function main() {
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (err) {
    log.error(err.message);
    process.exit(1);
  }
  const { positionals, flags } = parsed;
  const command = positionals[0];

  if (flags.version) { console.log(VERSION); return; }
  if (flags.help || !command) { console.log(HELP); return; }

  const api = flags.api || process.env.SAFEDROP_API || DEFAULT_API_BASE;

  if (command === 'send') {
    const file = positionals[1];
    if (!file) { log.error('Usage: safedrop send <file> [--ttl <minutes>] [--secure] [--api <url>]'); process.exit(1); }

    let ttlMinutes;
    if (flags.ttl !== undefined) {
      ttlMinutes = Number(flags.ttl);
      if (!Number.isFinite(ttlMinutes) || ttlMinutes <= 0) { log.error('--ttl must be a positive number of minutes.'); process.exit(1); }
      if (ttlMinutes > 1440) { log.error('--ttl cannot exceed 1440 minutes (24 hours).'); process.exit(1); }
    }
    await runSend(file, { api, ttlMinutes, fullSecurity: !!flags.secure });
    return;
  }

  if (command === 'receive') {
    const codeOrLink = positionals[1];
    if (!codeOrLink) { log.error('Usage: safedrop receive <code-or-link> [--output <path>] [--api <url>]'); process.exit(1); }
    await runReceive(codeOrLink, { api, output: flags.output });
    return;
  }

  log.error(`Unknown command: ${command}`);
  console.log(`\n${HELP}`);
  process.exit(1);
}

main().catch((err) => {
  log.error(err?.message || String(err));
  process.exit(1);
});
