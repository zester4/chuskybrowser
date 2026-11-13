#!/usr/bin/env node
/**
 * Live check of approve-before-Pay on a store that needs it (Braintree, Square, Worldpay, Bambora, Mercado Pago).
 * Runs on Firefox (Camoufox), through the same payment code the bridge uses.
 *
 *   node agentcard/scripts/approve-first-check.mjs --user camo-check \
 *     --store https://store.example.com/checkout --psp braintree \
 *     --merchant "Example Store" --amount 2306 --currency usd
 *
 * Needs sandbox credentials in .env (values never printed) and the Camoufox binary (npm run fetch-bin).
 * The user must already have a card stored: run camoufox-pay-check.mjs --user <same user> first if not.
 *
 * What it does:
 *   1. opens the store page in Firefox
 *   2. prepares the approval first and prints the approval link. Approve it on your device (passkey).
 *   3. waits until the approval is ready, then prints the card to type into the store's form
 *   4. you fill the store's form with that card, and press Pay on the store page
 *   5. checks the card request was bound to the approval and the store received the approved answer
 *
 * Exit code is 0 only when every check passed. Card digits and tokens are masked in the output.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadEnvFile } from 'node:process';
import { firefox } from 'playwright-core';
import { launchOptions } from 'camoufox-js';
import { createAgentCardService } from '../src/index.js';

const ENV_PATH = resolve(process.cwd(), '.env');
if (existsSync(ENV_PATH)) loadEnvFile(ENV_PATH);

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined && !args[i + 1].startsWith('--') ? args[i + 1] : null;
};
const userId = flag('--user') ?? 'camo-check';
const store = flag('--store');
const psp = flag('--psp');
const merchant = flag('--merchant') ?? 'Approve-first check';
const amount = Number(flag('--amount') ?? 100);
const currency = (flag('--currency') ?? 'usd').toLowerCase();

let failures = 0;
const results = [];
function check(name, ok, detail = '') {
  if (!ok) failures += 1;
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!store || !psp) {
  console.log('Usage: --store <https store checkout page> --psp <braintree|square|worldpay|bambora|mercado_pago> [--user --merchant --amount --currency]');
  process.exit(2);
}
if (!/^https:\/\//.test(store) || !/^[a-z_]{2,40}$/.test(psp) || !Number.isInteger(amount) || amount <= 0) {
  console.log('--store must be an https address, --psp a processor name, --amount a whole number in minor units');
  process.exit(2);
}
if (psp === 'stripe') {
  console.log('Stripe does not need approve-before-Pay. For shop.agentcard.sh (Stripe), run agentcard/scripts/firefox-store-purchase.mjs.');
  process.exit(2);
}
const storeOrigin = new URL(store).origin;

const clientId = process.env.AGENTCARD_CLIENT_ID?.trim();
const clientSecret = process.env.AGENTCARD_CLIENT_SECRET?.trim();
check('sandbox credentials present', Boolean(clientId && clientSecret));
if (!clientId || !clientSecret) process.exit(1);

const service = createAgentCardService({
  config: { clientId, clientSecret, baseUrl: process.env.AGENTCARD_BASE_URL },
  stateFile: null,
  log: (level, msg) => { if (level !== 'debug') console.log(`      log ${level}: ${msg}`); },
});

const cards = await service.vault.listCards(userId);
check('card on file for the user', cards.enrolled && cards.cards.length > 0, `${cards.cards.length} card(s)`);
if (!cards.enrolled || cards.cards.length === 0) process.exit(1);
const cardId = cards.cards[0].cardId;

let browser;
try {
  const options = await launchOptions({ headless: false });
  options.handleSIGTERM = false;
  options.handleSIGINT = false;
  options.handleSIGHUP = false;
  browser = await firefox.launch(options);
  const page = await browser.newPage();
  await page.goto(store, { waitUntil: 'domcontentloaded' });
  check('store page opens in Firefox', true, storeOrigin);

  // 2. Approval first. The checkout key stays here; only the approval link is printed.
  const checkoutKey = randomUUID();
  const prep = await service.preparePayment(userId, {
    merchant, amount, currency, psp, cardId, merchantOrigin: storeOrigin, checkoutKey,
  });
  check('approval prepared before Pay', Boolean(prep.purchaseId && prep.approvalUrl), prep.status);
  console.log(`\n      approve this on your device (passkey):\n      ${prep.approvalUrl}\n`);

  // 3. Wait for the approval.
  const readyDeadline = Date.now() + 10 * 60_000;
  let status = prep.status;
  while (status !== 'ready' && Date.now() < readyDeadline) {
    await sleep(2000);
    status = (await service.checkout.refresh(userId, prep.purchaseId)).status;
    if (['cancelled', 'expired'].includes(status)) break;
  }
  check('user approved: the approval is ready', status === 'ready', status);
  if (status !== 'ready') process.exit(1);

  const placeholder = await service.placeholders.get(userId, cardId);
  console.log(`\n      Ready. Fill the store's card form with this card, then press Pay on the store page:`);
  console.log(`      number ${placeholder.number}   expiry ${placeholder.expiry ?? `${placeholder.expiryMonth}/${placeholder.expiryYear}`}   security code ${placeholder.securityCode}\n`);

  // 4. Pause the card request and bind it to the approval.
  const handle = await service.attachPayment(page, {
    userId, cardId, merchant, amount, currency, checkoutOrigin: storeOrigin,
    preparation: { id: prep.purchaseId, checkoutKey, merchantOrigin: storeOrigin, psp },
    timeoutMs: 10 * 60_000,
    onApprovalUrl: () => check('no second approval link was issued', false, 'a bound request asked for one'),
  });

  // 5. Wait for the store's card request to finish.
  const payDeadline = Date.now() + 10 * 60_000;
  let outcome = [];
  while (Date.now() < payDeadline) {
    outcome = handle.results();
    if (outcome.some((r) => ['approved', 'submitted_on_device', 'declined', 'expired', 'refused', 'failed'].includes(r.status))) break;
    await sleep(1000);
  }
  await handle.detach();

  const last = outcome[outcome.length - 1];
  check('the store card request was bound to the approval', Boolean(last) && !String(last.reason ?? '').startsWith('preparation_'), last ? last.status : 'no card request seen');
  const paid = last?.status === 'approved' || last?.status === 'submitted_on_device';
  check('the store received the approved answer', paid, last?.status ?? 'no outcome');
  if (last && !paid) console.log(`      reason: ${last.reason ?? '(none)'}`);
} catch (err) {
  check('approve-first check', false, err.code ?? err.message);
} finally {
  if (browser) await browser.close().catch(() => {});
  service.flush();
}

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} checks passed${failures ? `, ${failures} failed` : ''}`);
process.exit(failures ? 1 : 0);
