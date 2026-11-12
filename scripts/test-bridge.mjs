#!/usr/bin/env node
// End-to-end check of the bridge: customer key -> Railway browser server -> frontend key check
// and usage events. Run this before anything is pushed.
//
//   node scripts/test-bridge.mjs
//
// Asks for:
//   - a customer key (cb_live_...), created in the frontend dashboard
//   - the shared internal secret (the same value as CHUSKY_INTERNAL_SECRET on both sides)
//   - the frontend address (default https://chuskybrowser.lovable.app)
// The browser address is the built-in one the SDK already uses.
// Exits 0 only if every check passes. The key and secret are never printed.

import readline from 'node:readline';
import { createHash } from 'node:crypto';
import { stdin, stdout } from 'node:process';
import { ChuskyClient, ChuskyError } from '../skills/chuskybrowser-setup/scripts/chusky-client.mjs';

const BROWSER_V1 = 'https://chuskybrowser-production.up.railway.app/v1';
const DEFAULT_FRONTEND = 'https://chuskybrowser.lovable.app';

const lines = readline.createInterface({ input: stdin, output: stdout, terminal: false })[Symbol.asyncIterator]();
const ask = async (q) => { stdout.write(q); const { value } = await lines.next(); return (value ?? '').trim(); };
const apiKey = await ask('Customer key (cb_live_...): ');
const secret = await ask('Internal secret: ');
const frontend = ((await ask(`Frontend address [${DEFAULT_FRONTEND}]: `)) || DEFAULT_FRONTEND).replace(/\/+$/, '');
const payUser = await ask('End user ID with a stored card, for AgentCard checks (blank to skip the purchase checks): ');
process.stdin.pause();

if (!apiKey.startsWith('cb_live_') || !secret) {
  console.log('FAIL inputs: a cb_live_ key and the internal secret are both required');
  process.exit(1);
}

let passed = 0;
let failed = 0;
const check = async (name, fn) => {
  try {
    const detail = await fn();
    passed++;
    console.log(`PASS ${name}${detail ? ` (${detail})` : ''}`);
  } catch (err) {
    failed++;
    const status = err instanceof ChuskyError ? ` [HTTP ${err.status}]` : '';
    console.log(`FAIL ${name}${status}: ${err.message}`);
  }
};

const sha256 = (s) => createHash('sha256').update(s).digest('hex');
async function frontendCall(path, body) {
  const res = await fetch(`${frontend}/internal${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-chusky-internal': secret },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

let accountId = null;
let usageBefore = 0;

await check('browser server health', async () => {
  const res = await fetch(`${BROWSER_V1}/health`);
  const data = await res.json();
  if (data?.ok !== true) throw new Error(`health answered ${res.status}`);
  return 'ok';
});

await check('frontend recognises the key', async () => {
  const { status, data } = await frontendCall('/keys/verify', { keyHash: sha256(apiKey) });
  if (status === 401) throw new Error('the internal secret was refused by the frontend');
  if (status === 404) throw new Error('the frontend does not know this key');
  if (status !== 200 || !data.accountId) throw new Error(`frontend answered ${status}`);
  if (data.revokedAt) throw new Error('this key is revoked');
  accountId = data.accountId;
  return 'account found';
});

await check('frontend usage counter is readable', async () => {
  if (!accountId) throw new Error('skipped: no account');
  const { status, data } = await frontendCall('/usage/count', { accountId });
  if (status !== 200) throw new Error(`frontend answered ${status}`);
  usageBefore = data.count;
  return `${usageBefore} today`;
});

const client = new ChuskyClient({ apiKey, userId: `bridge-check-${Date.now()}` });
let tabId = null;

await check('open a tab through the built-in address, with the key only', async () => {
  const tab = await client.openTab({ url: 'https://example.com', sessionKey: 'bridge-check' });
  if (!tab?.tabId) throw new Error('no tabId returned');
  tabId = tab.tabId;
  return 'tab opened';
});

if (tabId) {
  await check('the page text comes back through the bridge', async () => {
    let text = '';
    for (let i = 0; i < 15; i++) {
      const s = await client.snapshot(tabId);
      text = typeof s === 'string' ? s : (s?.snapshot || '');
      if (/documentation examples|Example Domain/i.test(text)) return `after ${i + 1}s`;
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error(`page text not found after 15s. Snapshot starts: "${text.replace(/\s+/g, ' ').slice(0, 120) || '(empty)'}"`);
  });

  await check('close the tab', async () => {
    await client.closeTab(tabId);
    return 'closed';
  });
}

await check('a made-up key is refused by the browser server', async () => {
  const bad = new ChuskyClient({ apiKey: 'cb_live_' + 'x'.repeat(32), userId: 'bridge-check' });
  try {
    await bad.openTab({ url: 'https://example.com', sessionKey: 'bridge-check' });
  } catch (err) {
    if (err instanceof ChuskyError && err.status === 401) return 'refused with 401';
    throw err;
  }
  throw new Error('a made-up key was accepted');
});

await check('the frontend received the usage events', async () => {
  if (!accountId) throw new Error('skipped: no account');
  const deadline = Date.now() + 15000;
  let count = usageBefore;
  while (Date.now() < deadline) {
    const { data } = await frontendCall('/usage/count', { accountId });
    count = data.count;
    if (count > usageBefore) return `${usageBefore} -> ${count}`;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`usage did not grow (still ${count}). Check CHUSKY_FRONTEND_URL and CHUSKY_INTERNAL_SECRET on the browser server.`);
});

// ----- AgentCard, through the bridge. Creates and cancels one approval request; no money moves. -----
console.log('\nAgentCard checks (through the bridge)');
const pay = new ChuskyClient({ apiKey, userId: payUser || `bridge-check-pay-${Date.now()}` });

await check('merchant check answers', async () => {
  await pay.merchants({ q: 'Shop Example', limit: 5 });
  return 'answered';
});

await check('processor list answers', async () => {
  await pay.processors();
  return 'answered';
});

if (!payUser) {
  console.log('SKIP purchase checks: no end user ID given. Run again with a user who has a stored card.');
} else {
  let cardCount = 0;

  await check('enrolment answers (has_card, or a vault link)', async () => {
    const r = await pay.enrolCard();
    if (!r?.status) throw new Error('no status in the answer');
    return r.status;
  });

  await check('the user has a stored card', async () => {
    const c = await pay.listCards();
    cardCount = (c?.cards ?? []).length;
    if (cardCount === 0) throw new Error('no card on file for this user. Open the vault link, store a card, then run again.');
    return `${cardCount} card(s)`;
  });

  await check('spending preset: set, read and delete', async () => {
    await pay.setPreset('bridge-check', { perDayCents: 100, currencies: ['usd'] });
    const p = await pay.getPreset('bridge-check');
    if (!p) throw new Error('preset not returned after set');
    await pay.deletePreset('bridge-check');
    return 'ok';
  });

  let prep = null;
  await check('prepare a purchase for approval (1 cent, not sent to the user)', async () => {
    if (cardCount === 0) throw new Error('skipped: no card');
    prep = await pay.preparePurchase({
      merchant: 'Bridge Check Store',
      amount: 1,
      currency: 'usd',
      psp: 'stripe',
      merchantOrigin: 'https://example.com',
    });
    if (!prep?.purchaseId) throw new Error('no purchaseId returned');
    if (typeof prep.approvalUrl !== 'string' || !prep.approvalUrl.startsWith('https://')) throw new Error('no approval link returned');
    return `status ${prep.status}`;
  });

  await check('read the prepared purchase back', async () => {
    if (!prep) throw new Error('skipped: no purchase');
    const p = await pay.getPurchase(prep.purchaseId);
    if (p?.purchaseId !== prep.purchaseId) throw new Error('purchase id does not match');
    return `status ${p.status}`;
  });

  await check('cancel the prepared purchase', async () => {
    if (!prep) throw new Error('skipped: no purchase');
    const c = await pay.cancelPurchase(prep.purchaseId);
    if (c?.status !== 'cancelled') throw new Error(`still ${c?.status} after cancel`);
    return 'cancelled';
  });

  await check('purchase list includes it', async () => {
    if (!prep) throw new Error('skipped: no purchase');
    const list = await pay.listPurchases();
    if (!(list?.purchases ?? []).some((p) => p.purchaseId === prep.purchaseId)) throw new Error('not in the list');
    return 'found';
  });

  // Information only, not counted: shows what the SDK's createPurchase sends today.
  try {
    const made = await pay.createPurchase({ merchant: 'Bridge Check Store', amount: 1, currency: 'usd', checkoutOrigin: 'https://example.com' });
    if (made?.purchaseId) await pay.cancelPurchase(made.purchaseId);
    console.log('INFO createPurchase (current SDK fields): accepted, and cancelled again');
  } catch (err) {
    const why = err instanceof ChuskyError ? `HTTP ${err.status} ${err.message}` : err.message;
    console.log(`INFO createPurchase (current SDK fields): not accepted, ${why}`);
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
