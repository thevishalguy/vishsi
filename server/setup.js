/**
 * `npm run setup` — first-run helper.
 *
 * Creates api_key.txt and endpoint.txt from the committed .example templates
 * if they are missing. Never overwrites a file that already exists, so running
 * it twice is safe and your key is never clobbered.
 */
import fs from 'node:fs';
import path from 'node:path';
import { PROJECT_DIR } from './config.js';

const PAIRS = [
  ['api_key.example.txt', 'api_key.txt'],
  ['endpoint.example.txt', 'endpoint.txt'],
  ['.env.example', '.env'],
];

console.log('\nVishSi setup\n');

let created = 0;
for (const [source, target] of PAIRS) {
  const from = path.join(PROJECT_DIR, source);
  const to = path.join(PROJECT_DIR, target);
  if (fs.existsSync(to)) {
    console.log(`  [skip] ${target} already exists`);
    continue;
  }
  if (!fs.existsSync(from)) {
    console.log(`  [warn] ${source} is missing, cannot create ${target}`);
    continue;
  }
  fs.copyFileSync(from, to);
  console.log(`  [ new] ${target} created from ${source}`);
  created += 1;
}

console.log(
  created
    ? '\nNow open api_key.txt and endpoint.txt and fill in your key and base URL.\nThen run:  npm run preflight\n'
    : '\nNothing to create. Run:  npm run preflight\n'
);
