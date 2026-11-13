#!/usr/bin/env node
/**
 * End-to-end purchase on AgentCard's demo store (shop.agentcard.sh), in Firefox (Camoufox),
 * with AgentCard's SDK attached. Stripe test mode. No real money moves.
 *
 *   npm install --no-save @agent-cards/sdk@0.24.2          # once
 *   node agentcard/scripts/firefox-store-purchase.mjs --user usr_... [--wait 600]
 *
 * Steps: open the store, buy the cheapest item ($5.83), fill Stripe's test card (4242 4242 4242 4242),
 * submit, approve on your device, then call checkout.reconcile(). PASS only when it reports 'completed'.
 * If a field or button is not found, the script prints the page's buttons, inputs and frames (no values)
 * so the selectors can be fixed from the real page.
 * Reads AGENTCARD_CLIENT_ID and AGENTCARD_CLIENT_SECRET from .env. Values are never printed.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import { firefox } from 'playwright-core';
import { launchOptions } from 'camoufox-js';

const ENV_PATH = resolve(process.cwd(), '.env');
if (existsSync(ENV_PATH)) loadEnvFile(ENV_PATH);

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};
const user = flag('--user', null);
const waitSeconds = Number(flag('--wait', '600'));
const STORE = 'https://shop.agentcard.sh';
const ITEM_CENTS = 583; // Enamel Camp Mug, $5.83

let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const clientId = process.env.AGENTCARD_CLIENT_ID?.trim();
const clientSecret = process.env.AGENTCARD_CLIENT_SECRET?.trim();
check('sandbox credentials present', Boolean(clientId && clientSecret));
check('an AgentCard user id was given', Boolean(user), user ? 'from --user' : 'pass --user usr_...');
let Agentcard;
try {
  ({ Agentcard } = await import('@agent-cards/sdk'));
  check('AgentCard SDK installed', typeof Agentcard === 'function');
} catch {
  check('AgentCard SDK installed', false, 'run: npm install --no-save @agent-cards/sdk@0.24.2');
}
if (!clientId || !clientSecret || !user || !Agentcard) {
  console.log(`\n${failures} failed`);
  process.exit(1);
}

// Print what is on the page (structure only, never values), so selectors can be fixed from it.
async function describePage(page) {
  for (const frame of page.frames()) {
    const info = await frame.evaluate(() => ({
      buttons: [...document.querySelectorAll('button, [role=button], input[type=submit]')].slice(0, 25).map((b) => (b.textContent || b.value || '').trim().slice(0, 40)),
      inputs: [...document.querySelectorAll('input, select, textarea')].slice(0, 30).map((i) => `${i.tagName.toLowerCase()} name="${i.name}" autocomplete="${i.autocomplete}" placeholder="${i.placeholder}"`),
    })).catch(() => null);
    if (info) console.log(`  frame ${frame.url().slice(0, 80)}\n    buttons: ${JSON.stringify(info.buttons)}\n    inputs: ${JSON.stringify(info.inputs)}`);
  }
}

// Fill a field by trying several selectors, in the page and in its frames (Stripe fields are often in frames).
async function fillField(page, selectors, value) {
  for (const frame of page.frames()) {
    for (const sel of selectors) {
      const loc = frame.locator(sel).first();
      if (await loc.count().catch(() => 0)) {
        await loc.fill(value, { timeout: 5000 }).catch(() => {});
        return true;
      }
    }
  }
  return false;
}

let browser;
try {
  const options = await launchOptions({ headless: true });
  options.handleSIGTERM = false;
  options.handleSIGINT = false;
  options.handleSIGHUP = false;
  browser = await firefox.launch(options);
  check('Firefox (Camoufox) launches', true, `version ${browser.version()}`);
} catch (err) {
  check('Firefox (Camoufox) launches', false, err.message);
  console.log(`\n${failures} failed`);
  process.exit(1);
}

const page = await (await browser.newContext()).newPage();
const seen = [];
page.on('request', (req) => {
  const u = new URL(req.url());
  if (/stripe|agentcard|square|braintree/i.test(u.host)) seen.push(`${req.method()} ${u.host}${u.pathname.slice(0, 60)}`);
});
const agentcard = new Agentcard({ clientId, clientSecret });
let approvalUrl = null;
let checkout;
try {
  checkout = await agentcard.checkout.attachToPlaywright(page, {
    user,
    merchant: 'shop.agentcard.sh',
    amount: ITEM_CENTS,
    currency: 'usd',
    onApprovalUrl: (u) => {
      approvalUrl = u;
      console.log(`\n  approve on your device: ${u}\n`);
    },
    onStateChange: (s) => console.log(`  sdk state: ${s.status ?? 'unknown'}${s.reason ? ` (reason: ${s.reason})` : ''}`),
  });
  check('SDK attaches before the store loads', true);
} catch (err) {
  check('SDK attaches before the store loads', false, err.message);
}

if (checkout) {
  await page.goto(STORE, { waitUntil: 'domcontentloaded' });
  const buy = page.getByRole('button', { name: /buy now/i }).first();
  const bought = await buy.click({ timeout: 15000 }).then(() => true).catch(() => false);
  check('buy the Enamel Camp Mug', bought);
  if (!bought) await describePage(page);

  // Card fields: Stripe's usual names and autocomplete values, in the page or in a frame.
  const number = await fillField(page, ['input[autocomplete="cc-number"]', 'input[name="cardnumber"]', 'input[name="card_number"]', 'input[placeholder*="card number" i]'], '4242424242424242');
  const expiry = await fillField(page, ['input[autocomplete="cc-exp"]', 'input[name="exp-date"]', 'input[name="exp_date"]', 'input[placeholder*="MM" i]'], '1230');
  const cvc = await fillField(page, ['input[autocomplete="cc-csc"]', 'input[name="cvc"]', 'input[placeholder*="CVC" i]'], '123');
  check('card fields found and filled', number && expiry && cvc, `number ${number}, expiry ${expiry}, cvc ${cvc}`);
  if (!(number && expiry && cvc)) await describePage(page);

  const pay = page.getByRole('button', { name: /pay|place order|submit|buy/i }).last();
  const payText = await pay.textContent().catch(() => '(none)');
  const paid = await pay.click({ timeout: 15000 }).then(() => true).catch(() => false);
  check('submit the purchase', paid, `clicked "${(payText ?? '').trim()}"`);
  await sleep(8000); // give the store time to send its card request
  if (!paid) await describePage(page);

  // Wait for the approval link, then for the user to approve it.
  const linkDeadline = Date.now() + 60_000;
  while (!approvalUrl && Date.now() < linkDeadline) await sleep(500);
  check('approval link issued', Boolean(approvalUrl));
  if (!approvalUrl) {
    console.log(`  page url: ${page.url().replace(/\?.*$/, '')}`);
    console.log(`  payment-host requests seen after submit: ${seen.length ? seen.join(' | ') : 'none'}`);
    const text = await page.evaluate(() => document.body?.innerText?.slice(0, 400) ?? '').catch(() => '');
    console.log(`  visible text (first 400 chars): ${JSON.stringify(text.replace(/\s+/g, ' '))}`);
    await describePage(page);
  }

  if (approvalUrl) {
    console.log(`  waiting up to ${waitSeconds}s for your approval...`);
    const end = Date.now() + waitSeconds * 1000;
    let result = null;
    while (Date.now() < end) {
      try {
        result = await checkout.reconcile();
        if (result?.status === 'completed' || result?.status === 'failed' || result?.status === 'declined') break;
      } catch (err) {
        result = { status: 'error', reason: err.message };
      }
      await sleep(3000);
    }
    for (const k of ['status', 'reason', 'orderId', 'authorizationId', 'chargedKind', 'amountAuthority']) {
      if (result?.[k] !== undefined) console.log(`    ${k}: ${result[k]}`);
    }
    check('purchase completed', result?.status === 'completed', `status ${result?.status ?? 'none'}`);
  }
}

await browser.close();
console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} check(s) failed`}`);
process.exit(failures === 0 ? 0 : 1);
