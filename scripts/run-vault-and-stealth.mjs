#!/usr/bin/env node
// Runs the checks for the login vault and the stealth benchmark, in one go.
//
//   node scripts/run-vault-and-stealth.mjs            # vault unit tests, vault live test, both stealth runs
//   node scripts/run-vault-and-stealth.mjs --no-stealth   # skip the stealth benchmark (it takes a few minutes)
//
// Reads CHUSKY_BASE_URL and CHUSKY_ACCESS_KEY from .env. Live steps are skipped with a reason if those are missing.
// Exit code is 0 only when every step that ran passed.

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from 'node:process';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = resolve(root, '.env');
if (existsSync(envPath)) loadEnvFile(envPath);

const noStealth = process.argv.includes('--no-stealth');
const results = [];

function run(label, args, { env = {} } = {}) {
  console.log(`\n===== ${label} =====`);
  const r = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } });
  results.push({ label, status: r.status === 0 ? 'PASS' : 'FAIL' });
}
function skip(label, why) {
  console.log(`\n===== ${label} =====\nSKIP: ${why}`);
  results.push({ label, status: 'SKIP' });
}

const jest = resolve(root, 'node_modules', 'jest', 'bin', 'jest.js');
const hasLive = Boolean(process.env.CHUSKY_BASE_URL?.trim() && process.env.CHUSKY_ACCESS_KEY?.trim());

// 1. Offline unit tests for the vault and the usage queue.
run('Vault and usage queue unit tests', [jest, '--forceExit', 'tests/unit/vault.test.js', 'tests/unit/usageEvents.test.js'], {
  env: { NODE_OPTIONS: '--experimental-vm-modules' },
});

// 2. Live vault test.
if (hasLive) run('Vault live test', [resolve(root, 'scripts', 'test-vault-live.mjs')]);
else skip('Vault live test', 'set CHUSKY_BASE_URL and CHUSKY_ACCESS_KEY in .env');

// 3. Stealth benchmark: default targets, then the harder targets.
if (noStealth) {
  skip('Stealth benchmark (default targets)', '--no-stealth given');
  skip('Stealth benchmark (hard targets)', '--no-stealth given');
} else if (hasLive) {
  run('Stealth benchmark (default targets)', [resolve(root, 'scripts', 'test-stealth-bench.mjs'), '--runs', '3', '--label', 'baseline']);
  run('Stealth benchmark (hard targets)', [resolve(root, 'scripts', 'test-stealth-bench.mjs'), '--targets', resolve(root, 'scripts', 'bench-targets-hard.json'), '--runs', '3', '--label', 'baseline-hard']);
} else {
  skip('Stealth benchmark (default targets)', 'set CHUSKY_BASE_URL and CHUSKY_ACCESS_KEY in .env');
  skip('Stealth benchmark (hard targets)', 'set CHUSKY_BASE_URL and CHUSKY_ACCESS_KEY in .env');
}

console.log('\n===== Summary =====');
for (const r of results) console.log(`${r.status.padEnd(5)} ${r.label}`);
const failed = results.filter((r) => r.status === 'FAIL').length;
process.exitCode = failed === 0 ? 0 : 1;
