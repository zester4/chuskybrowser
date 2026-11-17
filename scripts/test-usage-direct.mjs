/**
 * Billing path check that calls the browser server directly, with the server's access key.
 *
 * It skips the gateway's customer-key check, so it does NOT prove a customer key works.
 * It proves that tab opens, closes and proxy bytes for a developer account reach the
 * frontend's ledger the same way they do for real customer calls.
 *
 * Usage (in .env or the environment, never in chat):
 *   CHUSKY_BASE_URL=https://chuskybrowser-production.up.railway.app
 *   CHUSKY_ACCESS_KEY=...                 the server's access key
 *   USAGE_ACCOUNT_ID=...                  the developer account ID to bill (a test account)
 *   USAGE_WAIT_SECONDS=60                 optional
 *
 *   npm run test:usage-direct
 */
import { randomUUID } from 'node:crypto';
import { call, makeReporter } from './lib-env.mjs';

const report = makeReporter();
const accountId = (process.env.USAGE_ACCOUNT_ID || '').trim();
if (!accountId) {
  console.error('Set USAGE_ACCOUNT_ID to the developer account ID to bill (a test account).');
  process.exit(1);
}

const WAIT_MS = (Number(process.env.USAGE_WAIT_SECONDS) || 60) * 1000;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const enc = encodeURIComponent;
// Same shape the gateway uses: "accountId:endUserId" is how billing identifies the account.
const user = `${accountId}:usage-${randomUUID().slice(0, 8)}`;

const minutes = (openMs, closeMs) => Math.max(1, Math.ceil((closeMs - openMs) / 60000));
const iso = (ms) => new Date(ms).toISOString();
const rows = [];

// Case 1: open, wait, close the tab explicitly
const a = await call('/tabs', { method: 'POST', body: { userId: user, sessionKey: 'usage-a', url: 'https://example.com/' }, timeoutMs: 90_000 });
report.check('opened tab A', a.status === 200 || a.status === 201, `HTTP ${a.status}`);
if (a.data?.tabId) {
  const openA = Date.now();
  console.log(`Tab A open at ${iso(openA)}, waiting ${WAIT_MS / 1000} s`);
  await wait(WAIT_MS);
  const closeA = await call(`/tabs/${a.data.tabId}?userId=${enc(user)}`, { method: 'DELETE' });
  const closedA = Date.now();
  report.check('closed tab A explicitly', closeA.status === 200, `HTTP ${closeA.status}`);
  rows.push({ name: 'tab A (explicit close)', openA, closedA });
}

// Case 2: open, wait, end the session (the path that used to leave tabs unbilled)
const b = await call('/tabs', { method: 'POST', body: { userId: user, sessionKey: 'usage-b', url: 'https://example.org/' }, timeoutMs: 90_000 });
report.check('opened tab B', b.status === 200 || b.status === 201, `HTTP ${b.status}`);
if (b.data?.tabId) {
  const openB = Date.now();
  console.log(`Tab B open at ${iso(openB)}, waiting ${WAIT_MS / 1000} s, then ending the session`);
  await wait(WAIT_MS);
  const endB = await call(`/sessions/${enc(user)}`, { method: 'DELETE' });
  const closedB = Date.now();
  report.check('ended the session with tab B open', endB.status === 200, `HTTP ${endB.status}`);
  rows.push({ name: 'tab B (closed by session end)', openB, closedB });
}

console.log('\nExpected billable minutes (tab lifetime, rounded up, minimum 1):');
for (const r of rows) {
  const open = r.openA ?? r.openB;
  const close = r.closedA ?? r.closedB;
  console.log(`  ${r.name}: ${iso(open)} to ${iso(close)} = ${minutes(open, close)} min`);
}
console.log(`\nCheck the frontend ledger for account ${accountId}. Both tabs should appear with these minutes.`);

report.finish();
