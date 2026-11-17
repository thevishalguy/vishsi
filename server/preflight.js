/**
 * `npm run preflight` — checks the things that can realistically fail on a
 * fresh machine: the native PTY module, a Chromium-family browser for the
 * agent's browser tool, and the API key.
 */
import os from 'node:os';
import { getApiKey, DEFAULTS, IS_WINDOWS } from './config.js';
import { getRoot } from './workspace.js';
import * as ptyApi from './pty.js';
import { findBrowserExecutable } from './browser.js';

const pass = (m) => console.log(`  [ ok ] ${m}`);
const warn = (m) => console.log(`  [warn] ${m}`);
const fail = (m) => console.log(`  [FAIL] ${m}`);

console.log('\nVishSi preflight\n');
console.log(`  node ${process.version} on ${os.platform()} ${os.release()}`);
console.log(`  workspace root: ${getRoot()}\n`);

let exitCode = 0;

// 1. PTY
try {
  const term = await ptyApi.createTerminal({
    id: 'preflight',
    cols: 80,
    rows: 24,
  });
  let output = '';
  ptyApi.addTerminalListener('preflight', (d) => {
    output += d;
  });
  const marker = 'PREFLIGHT_PTY_OK';
  await new Promise((r) => setTimeout(r, 1200));
  ptyApi.writeTerminal('preflight', IS_WINDOWS ? `echo ${marker}\r` : `echo ${marker}\n`);
  await new Promise((r) => setTimeout(r, 2500));
  ptyApi.killTerminal('preflight');
  if (output.includes(marker)) {
    pass(`PTY works (${term.shell})`);
  } else {
    fail(`PTY spawned but produced no echo. Raw output length ${output.length}`);
    exitCode = 1;
  }
} catch (err) {
  fail(`PTY unavailable: ${err.message}`);
  warn('The interactive terminal tab will not work. See README > Terminal fallback.');
  exitCode = 1;
}

// 2. Browser for the agent's browser tool
const exe = findBrowserExecutable();
if (exe) {
  pass(`headless browser executable: ${exe}`);
} else {
  warn('No Edge/Chrome found. browser_navigate will fall back to plain fetch (no JS, no screenshots).');
}

// 3. API key
if (getApiKey()) {
  pass(`API key loaded (provider ${DEFAULTS.provider}, base ${DEFAULTS.baseUrl})`);
} else {
  fail('No API key. Create api_key.txt or set API_KEY in .env');
  exitCode = 1;
}

console.log('');
process.exit(exitCode);
