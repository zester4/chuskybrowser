/**
 * Billing accuracy check through the customer gateway.
 *
 * Usage (set these in the environment or .env, never in chat):
 *   CHUSKY_GATEWAY_URL=https://<your gateway>      e.g. the Railway URL
 *   CHUSKY_TEST_CUSTOMER_KEY=cb_live_... (or cb_test_...)  a key on a test account
 *   npm run test:usage                              (optional: USAGE_WAIT_SECONDS=90)
 *
 * What it does:
 *   1. Opens a tab through /v1/tabs and waits USAGE_WAIT_SECONDS.
 *   2. Closes the tab with DELETE /v1/tabs/:id. This is the normal path.
 *   3. Opens a second tab, waits, then ends the session with DELETE /v1/sessions/:userId.
 *      This is the path that used to leave tabs unbilled.
 *   4. Prints, for each tab, the open time, close time, and billable minutes
 *      (tab lifetime, rounded up to a whole minute, minimum one minute).
 *
 * The script cannot see the frontend's ledger. Compare the printed minutes
 * with the usage the frontend shows for this test account. They must match.
 */
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnvFile } from 'node:process';

const envPath = resolve(process.cwd(), '.env');
if (existsSync(envPath)) loadEnvFile(envPath);

const GATEWAY = (process.env.CHUSKY_GATEWAY_URL || '').trim().replace(/\/+$/, '');
const KEY = (process.env.CHUSKY_TEST_CUSTOMER_KEY || '').trim();
const WAIT_MS = (Number(process.env.USAGE_WAIT_SECONDS) || 90) * 1000;

if (!GATEWAY || !KEY) {
  console.error('Set CHUSKY_GATEWAY_URL and CHUSKY_TEST_CUSTOMER_KEY (in .env or the environment).');
  process.exit(1);
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const user = `usage-${randomUUID().slice(0, 8)}`;

async function call(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${GATEWAY}${path}`, {
    method,
    headers: { Authorization: `Bearer ${KEY}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(120_000),
  });
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  return { status: res.status, data };
}

// Billing is per second. The account's monthly total is rounded to 0.01 hours, not each tab.
function seconds(openedMs, closedMs) {
  return (closedMs - openedMs) / 1000;
}

const results = [];
let ok = true;

// Case 1: normal close
const a = await call('/v1/tabs', { method: 'POST', body: { userId: user, sessionKey: 'usage-a', url: 'https://example.com/' } });
if (a.status !== 200 && a.status !== 201) {
  console.error(`FAIL  open tab (HTTP ${a.status}): ${JSON.stringify(a.data)}`);
  process.exit(1);
}
const openedA = Date.now();
console.log(`Opened tab A at ${new Date(openedA).toISOString()}. Waiting ${WAIT_MS / 1000} s...`);
await wait(WAIT_MS);
const closeA = await call(`/v1/tabs/${a.data.tabId}?userId=${encodeURIComponent(user)}`, { method: 'DELETE' });
const closedA = Date.now();
results.push({ name: 'tab A (closed with DELETE)', opened: openedA, closed: closedA, ok: closeA.status === 200 });

// Case 2: session end closes the tab
const b = await call('/v1/tabs', { method: 'POST', body: { userId: user, sessionKey: 'usage-b', url: 'https://example.org/' } });
if (b.status === 200 || b.status === 201) {
  const openedB = Date.now();
  console.log(`Opened tab B at ${new Date(openedB).toISOString()}. Waiting ${WAIT_MS / 1000} s, then ending the session...`);
  await wait(WAIT_MS);
  const endB = await call(`/v1/sessions/${encodeURIComponent(user)}`, { method: 'DELETE' });
  const closedB = Date.now();
  results.push({ name: 'tab B (closed by session end)', opened: openedB, closed: closedB, ok: endB.status === 200 });
} else {
  results.push({ name: 'tab B (closed by session end)', opened: null, closed: null, ok: false, note: `open failed, HTTP ${b.status}` });
}

console.log('');
for (const r of results) {
  if (!r.ok) ok = false;
  if (r.opened && r.closed) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}: ${new Date(r.opened).toISOString()} to ${new Date(r.closed).toISOString()}, billable ${seconds(r.opened, r.closed).toFixed(1)} s`);
  } else {
    console.log(`FAIL  ${r.name}${r.note ? ` (${r.note})` : ''}`);
  }
}
console.log('\nNow compare these minutes with the usage the frontend shows for this test account:');
console.log(`  account user prefix: ${user}`);
console.log(ok ? '\nAll requests succeeded. The frontend totals are the check.' : '\nSome requests failed. See above.');
process.exitCode = ok ? 0 : 1;
