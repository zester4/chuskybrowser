/**
 * Billing check for the tab-group delete path, through the customer gateway.
 *
 * Usage (set these in the environment or .env, never in chat):
 *   CHUSKY_GATEWAY_URL=https://<your gateway>
 *   CHUSKY_TEST_CUSTOMER_KEY=cb_live_...   a key on a test account
 *   node scripts/test-group-close-live.mjs  (optional: USAGE_WAIT_SECONDS=60)
 *
 * What it does:
 *   1. Opens two tabs in the same sessionKey (one tab group).
 *   2. Waits USAGE_WAIT_SECONDS.
 *   3. Deletes the whole group with DELETE /v1/tabs/group/:sessionKey.
 *   4. Prints each tab's open time, close time and billable seconds.
 *
 * Compare the printed seconds with the frontend ledger for the printed account prefix.
 * Each tab must show exactly one close with these seconds.
 */
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnvFile } from 'node:process';

const envPath = resolve(process.cwd(), '.env');
if (existsSync(envPath)) loadEnvFile(envPath);

const GATEWAY = (process.env.CHUSKY_GATEWAY_URL || '').trim().replace(/\/+$/, '');
const KEY = (process.env.CHUSKY_TEST_CUSTOMER_KEY || '').trim();
const WAIT_MS = (Number(process.env.USAGE_WAIT_SECONDS) || 60) * 1000;

if (!GATEWAY || !KEY) {
  console.error('Set CHUSKY_GATEWAY_URL and CHUSKY_TEST_CUSTOMER_KEY (in .env or the environment).');
  process.exit(1);
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const user = `group-${randomUUID().slice(0, 8)}`;
const sessionKey = `group-${randomUUID().slice(0, 8)}`;

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

const opened = [];
for (const url of ['https://example.com', 'https://example.org']) {
  const r = await call('/v1/tabs', { method: 'POST', body: { userId: user, sessionKey, url } });
  if (r.status !== 200 || !r.data?.tabId) {
    console.error(`FAIL  could not open a tab (HTTP ${r.status})`);
    process.exit(1);
  }
  opened.push({ tabId: r.data.tabId, openedMs: Date.now() });
  console.log(`Opened ${r.data.tabId} at ${new Date().toISOString()}`);
}

console.log(`Waiting ${WAIT_MS / 1000} s, then deleting the tab group ${sessionKey}...`);
await wait(WAIT_MS);

const del = await call(`/v1/tabs/group/${encodeURIComponent(sessionKey)}?userId=${encodeURIComponent(user)}`, { method: 'DELETE' });
const closedMs = Date.now();
if (del.status !== 200) {
  console.error(`FAIL  group delete returned HTTP ${del.status}`);
  process.exit(1);
}

for (const t of opened) {
  const billable = (closedMs - t.openedMs) / 1000;
  console.log(`tab ${t.tabId}: opened ${new Date(t.openedMs).toISOString()}, group closed ${new Date(closedMs).toISOString()}, billable ~${billable.toFixed(1)} s (the backend's exact times may differ by about a second)`);
}

console.log('');
console.log(`Account prefix for the frontend ledger: ${user}`);
console.log('Expected: two closes, one per tab, each with the seconds above (to within about a second).');
console.log('Group delete sent. Now check the frontend ledger.');
