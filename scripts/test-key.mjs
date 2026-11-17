/**
 * Key-only check: can this customer key open a tab and take an action through the gateway?
 *
 * Reads from .env or the environment:
 *   CHUSKY_TEST_CUSTOMER_KEY   the customer API key (cb_test_... or cb_live_...)
 *   CHUSKY_GATEWAY_URL         the gateway address (defaults to CHUSKY_BASE_URL)
 *
 *   npm run test:key
 *
 * It prints each step's result. The key itself is never printed, only its prefix and length.
 */
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnvFile } from 'node:process';

const envPath = resolve(process.cwd(), '.env');
if (existsSync(envPath)) loadEnvFile(envPath);

const KEY = (process.env.CHUSKY_TEST_CUSTOMER_KEY || '').trim();
const GATEWAY = (process.env.CHUSKY_GATEWAY_URL || process.env.CHUSKY_BASE_URL || '').trim().replace(/\/+$/, '');
const user = `keytest-${randomUUID().slice(0, 8)}`;
const enc = encodeURIComponent;

if (!KEY) {
  console.error('FAIL  CHUSKY_TEST_CUSTOMER_KEY is empty or missing in .env. Check the line is exactly CHUSKY_TEST_CUSTOMER_KEY=<key>.');
  process.exit(1);
}
if (!GATEWAY) {
  console.error('FAIL  Set CHUSKY_GATEWAY_URL (or CHUSKY_BASE_URL) in .env.');
  process.exit(1);
}

console.log(`Gateway: ${GATEWAY}`);
console.log(`Key: prefix "${KEY.slice(0, 8)}", length ${KEY.length}`);
console.log('');

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

let failed = false;
function step(name, res, ok) {
  const pass = ok(res);
  if (!pass) failed = true;
  const detail = pass ? '' : ` -> ${typeof res.data === 'string' ? res.data : JSON.stringify(res.data)}`;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name} (HTTP ${res.status})${detail}`);
  return pass;
}

// 1. Does the key pass the gateway's check at all?
const auth = await call(`/v1/tabs?userId=${enc(user)}`);
if (!step('key accepted by the gateway', auth, (r) => r.status !== 401 && r.status !== 403)) {
  console.log('\nThe gateway rejected the key. Nothing else can work until this passes.');
  process.exit(1);
}

// 2. Open a tab
const opened = await call('/v1/tabs', { method: 'POST', body: { userId: user, sessionKey: 'keytest', url: 'https://example.com/' } });
step('opened a tab', opened, (r) => (r.status === 200 || r.status === 201) && !!r.data?.tabId);
const tabId = opened.data?.tabId;

if (tabId) {
  // 3. Take an action: scroll, then read the page state
  const scroll = await call(`/v1/tabs/${tabId}/scroll`, { method: 'POST', body: { userId: user, direction: 'down', amount: 200 } });
  step('scrolled the tab (an action)', scroll, (r) => r.status === 200);

  const state = await call(`/v1/tabs/${tabId}/state?userId=${enc(user)}`);
  step('read the page state', state, (r) => r.status === 200);
  if (state.data?.url) console.log(`      page: ${state.data.url}`);

  // 4. Close the tab
  const closed = await call(`/v1/tabs/${tabId}?userId=${enc(user)}`, { method: 'DELETE' });
  step('closed the tab', closed, (r) => r.status === 200);
}

// 5. Clean up the session
await call(`/v1/sessions/${enc(user)}`, { method: 'DELETE' });

console.log('');
console.log(failed ? 'Some steps failed. The output above shows where.' : 'The key can open a tab and take an action.');
process.exitCode = failed ? 1 : 0;
