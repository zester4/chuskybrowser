#!/usr/bin/env node
// Runs every check that is still open, reading settings from the repo's .env file.
// Prints the names of settings that are missing, never their values.
//
//   node scripts/run-all-checks.mjs            # offline tests + bridge checks (no approvals needed)
//   node scripts/run-all-checks.mjs --live     # also the checks where you approve on your device
//
// Exit code is 0 only when every check that ran passed.

import { existsSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from 'node:process';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = resolve(root, '.env');
if (existsSync(envPath)) loadEnvFile(envPath);

const live = process.argv.includes('--live');
const has = (name) => Boolean(process.env[name]?.trim());
const results = [];

function run(label, cmd, args, { env = {} } = {}) {
  console.log(`\n===== ${label} =====`);
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } });
  const ok = r.status === 0;
  results.push({ label, status: ok ? 'PASS' : r.status === null ? 'ERROR' : 'FAIL' });
}
function skip(label, why) {
  console.log(`\n===== ${label} =====\nSKIP: ${why}`);
  results.push({ label, status: 'SKIP' });
}

// 1. Which settings are present (names only).
console.log('Settings in .env (names only):');
const groups = {
  'Bridge (customer key and internal secret)': ['CHUSKYBROWSER_API_KEY', 'CHUSKY_INTERNAL_SECRET'],
  'AgentCard (sandbox credentials)': ['AGENTCARD_CLIENT_ID', 'AGENTCARD_CLIENT_SECRET'],
  'Test user for card checks': ['CHUSKY_TEST_PAY_USER'],
};
for (const [group, names] of Object.entries(groups)) {
  for (const n of names) console.log(`  ${has(n) ? 'set    ' : 'MISSING'} ${n}  (${group})`);
}
const bridgeReady = has('CHUSKYBROWSER_API_KEY') && has('CHUSKY_INTERNAL_SECRET');
const agentReady = has('AGENTCARD_CLIENT_ID') && has('AGENTCARD_CLIENT_SECRET');

// 2. Offline tests (no network).
const offlineTests = readdirSync(resolve(root, 'agentcard/test')).filter((f) => f.endsWith('.test.js')).map((f) => `agentcard/test/${f}`);
run('AgentCard offline tests', 'node', ['--test', ...offlineTests]);

// 3. Bridge checks through the built-in address (no approvals).
if (bridgeReady) run('Bridge checks (test-bridge.mjs)', 'node', ['scripts/test-bridge.mjs']);
else skip('Bridge checks (test-bridge.mjs)', 'CHUSKYBROWSER_API_KEY and CHUSKY_INTERNAL_SECRET must be in .env');

// 4. Live checks that need you to approve on your device.
if (!live) {
  console.log('\nLive approval checks not run. Add --live to run them.');
} else if (!agentReady) {
  skip('Approve-first check (preparation-check.mjs)', 'AgentCard credentials must be in .env');
  skip('Payment on a checkout page (camoufox-pay-check.mjs)', 'AgentCard credentials must be in .env');
} else {
  const user = process.env.CHUSKY_TEST_PAY_USER?.trim();
  if (!user) {
    skip('Approve-first check (preparation-check.mjs)', 'CHUSKY_TEST_PAY_USER must be in .env');
  } else {
    run('Approve-first check (preparation-check.mjs)', 'node',
      ['agentcard/scripts/preparation-check.mjs', '--user', user, '--psp', 'square', '--environment', 'sandbox']);
  }
  run('Payment on a checkout page (camoufox-pay-check.mjs)', 'node',
    ['agentcard/scripts/camoufox-pay-check.mjs', '--user', user || 'camo-check']);
}

// 5. What no script here covers yet.
console.log(`
===== Not covered by this script =====
- Paying after approval, through the bridge, on a live checkout.
- Production AgentCard environment (switch and one small real payment).
- Vault mapping for real customers (polling or webhook).
- Usage events after a failed call to the frontend (best-effort, no retry).
- Tab records after a Railway redeploy.
- buy, reportOutcome, refreshPurchase and the untested purchase statuses.`);

console.log('\n===== Summary =====');
for (const r of results) console.log(`${r.status.padEnd(6)} ${r.label}`);
const failed = results.filter((r) => r.status === 'FAIL' || r.status === 'ERROR').length;
const skipped = results.filter((r) => r.status === 'SKIP').length;
console.log(`\n${failed === 0 ? 'No failures in the checks that ran.' : `${failed} check(s) failed.`}${skipped ? ` ${skipped} check(s) skipped; see above.` : ''}`);
process.exitCode = failed ? 1 : 0;
