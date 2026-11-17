/**
 * Handoff test: the agent opens X (Twitter), a person signs in through the live view,
 * and the agent carries on afterwards.
 *
 * Reads from .env or the environment:
 *   CHUSKY_TEST_CUSTOMER_KEY   the customer API key
 *   CHUSKY_GATEWAY_URL         the gateway address
 *
 *   npm run test:handoff
 *
 * What it does:
 *   1. Opens https://x.com/login through the gateway and reads the page state.
 *   2. Hands the tab to you and prints the live viewer link straight away.
 *      Open it in another window and watch. Sign in there, not in this terminal.
 *   3. Waits until you press Done on the viewer, or the handoff ends. The agent then
 *      gets control back: it checks the page state and takes a snapshot.
 *   4. Prints the result and closes the tab.
 *
 * The viewer link is a credential for this one tab. Send it to nobody. The key is never printed.
 */
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnvFile } from 'node:process';

const envPath = resolve(process.cwd(), '.env');
if (existsSync(envPath)) loadEnvFile(envPath);

const KEY = (process.env.CHUSKY_TEST_CUSTOMER_KEY || '').trim();
const GATEWAY = (process.env.CHUSKY_GATEWAY_URL || process.env.CHUSKY_BASE_URL || '').trim().replace(/\/+$/, '');
const user = `handoff-${randomUUID().slice(0, 8)}`;
const WAIT_LIMIT_MS = 15 * 60 * 1000;
const POLL_MS = 3000;

if (!KEY || !GATEWAY) {
  console.error('FAIL  Set CHUSKY_TEST_CUSTOMER_KEY and CHUSKY_GATEWAY_URL in .env.');
  process.exit(1);
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${GATEWAY}${path}`, {
    method,
    headers: { Authorization: `Bearer ${KEY}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(90_000),
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = text.slice(0, 200); }
  return { status: res.status, data };
}

function fail(msg, extra) {
  console.error(`FAIL  ${msg}${extra ? `: ${extra}` : ''}`);
  process.exitCode = 1;
}

// 1. Open X's sign-in page
const opened = await call('/v1/tabs', { method: 'POST', body: { userId: user, sessionKey: 'handoff-x', url: 'https://x.com/login' } });
if (opened.status !== 200 && opened.status !== 201) {
  fail(`could not open a tab (HTTP ${opened.status})`, JSON.stringify(opened.data));
  process.exit(1);
}
const tabId = opened.data.tabId;
console.log(`PASS  opened x.com/login (tab ${tabId})`);

const state = await call(`/v1/tabs/${tabId}/state?userId=${encodeURIComponent(user)}`);
console.log(`      page state: ${state.data?.kind ?? `HTTP ${state.status}`}${state.data?.url ? `, ${state.data.url}` : ''}`);

// 2. Hand the tab to the person
const handoff = await call(`/v1/tabs/${tabId}/handoff`, { method: 'POST', body: { userId: user } });
if (handoff.status !== 200 && handoff.status !== 201) {
  fail(`handoff did not start (HTTP ${handoff.status})`, JSON.stringify(handoff.data));
  await call(`/v1/tabs/${tabId}?userId=${encodeURIComponent(user)}`, { method: 'DELETE' });
  process.exit(1);
}
console.log('PASS  handoff started. The agent is paused on this tab.');

const link = await call('/v1/live-viewer/links', { method: 'POST', body: { userId: user, tabId, control: true } });
if ((link.status !== 200 && link.status !== 201) || !link.data?.url) {
  fail(`could not create the live viewer link (HTTP ${link.status})`, JSON.stringify(link.data));
  await call(`/v1/tabs/${tabId}/handoff/release`, { method: 'POST', body: { userId: user } });
  await call(`/v1/tabs/${tabId}?userId=${encodeURIComponent(user)}`, { method: 'DELETE' });
  process.exit(1);
}

console.log('');
console.log('==========================================================');
console.log('LIVE VIEW (open in another window now, sign in there):');
console.log(link.data.url);
console.log('==========================================================');
console.log('');
console.log('Sign in to X in the live view, then press Done on that page.');
console.log('The script continues by itself after Done.');
console.log('');

// 3. Wait for the person to press Done. While a person holds the tab, snapshot returns 409.
const started = Date.now();
let released = false;
while (Date.now() - started < WAIT_LIMIT_MS) {
  await wait(POLL_MS);
  const probe = await call(`/v1/tabs/${tabId}/snapshot?userId=${encodeURIComponent(user)}`);
  if (probe.status === 200) { released = true; break; }
  if (probe.status !== 409) {
    fail(`unexpected response while waiting (HTTP ${probe.status})`, JSON.stringify(probe.data));
    break;
  }
}

if (!released) {
  if (!process.exitCode) fail('timed out waiting for Done (15 minutes)');
  await call(`/v1/tabs/${tabId}?userId=${encodeURIComponent(user)}`, { method: 'DELETE' });
  process.exit(1);
}
console.log('PASS  handed back to the agent after Done.');

// 4. The agent carries on: check the page and take a snapshot
const after = await call(`/v1/tabs/${tabId}/state?userId=${encodeURIComponent(user)}`);
const url = after.data?.url || '';
const loggedIn = after.status === 200 && after.data?.kind === 'ok' && !/\/login|\/i\/flow/.test(url);
console.log(`${loggedIn ? 'PASS' : 'CHECK'}  page after sign-in: ${after.data?.kind ?? `HTTP ${after.status}`}, ${url}`);
if (!loggedIn) process.exitCode = 1;

const snap = await call(`/v1/tabs/${tabId}/snapshot?userId=${encodeURIComponent(user)}`);
console.log(`${snap.status === 200 ? 'PASS' : 'FAIL'}  took a snapshot after handoff (HTTP ${snap.status})`);
if (snap.status !== 200) process.exitCode = 1;

// 5. Clean up
const closed = await call(`/v1/tabs/${tabId}?userId=${encodeURIComponent(user)}`, { method: 'DELETE' });
console.log(`${closed.status === 200 ? 'PASS' : 'FAIL'}  closed the tab (HTTP ${closed.status})`);
if (closed.status !== 200) process.exitCode = 1;

console.log('');
console.log(process.exitCode ? 'Some steps need a look. The output above shows where.' : 'Handoff worked end to end.');
