/**
 * Restart test, step 1: open a tab through the gateway and leave it open.
 *
 * Reads from .env or the environment:
 *   CHUSKY_TEST_CUSTOMER_KEY   the customer API key
 *   CHUSKY_GATEWAY_URL         the gateway address
 *
 *   npm run test:restart-open
 *
 * Then restart the chuskybrowser service on Railway while this tab is still open.
 * After the restart, the dashboard should show this tab closed at the restart time,
 * with the usage recorded up to that point. The key itself is never printed.
 */
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnvFile } from 'node:process';

const envPath = resolve(process.cwd(), '.env');
if (existsSync(envPath)) loadEnvFile(envPath);

const KEY = (process.env.CHUSKY_TEST_CUSTOMER_KEY || '').trim();
const GATEWAY = (process.env.CHUSKY_GATEWAY_URL || process.env.CHUSKY_BASE_URL || '').trim().replace(/\/+$/, '');
const user = `restart-${randomUUID().slice(0, 8)}`;

if (!KEY || !GATEWAY) {
  console.error('FAIL  Set CHUSKY_TEST_CUSTOMER_KEY and CHUSKY_GATEWAY_URL in .env.');
  process.exit(1);
}

const res = await fetch(`${GATEWAY}/v1/tabs`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ userId: user, sessionKey: 'restart-test', url: 'https://example.com/' }),
  signal: AbortSignal.timeout(90_000),
});
const data = await res.json().catch(() => null);

if ((res.status !== 200 && res.status !== 201) || !data?.tabId) {
  console.error(`FAIL  could not open a tab (HTTP ${res.status})`);
  process.exit(1);
}

console.log(`PASS  tab opened and left open (HTTP ${res.status})`);
console.log(`      opened at: ${new Date().toISOString()}`);
console.log(`      tab id:    ${data.tabId}`);
console.log(`      user id:   ${user}`);
console.log('');
console.log('Now restart the chuskybrowser service on Railway, then check the dashboard for this user id.');
