#!/usr/bin/env node
/**
 * Question: does AgentCard's SDK pause a card request on Firefox (Camoufox)?
 * Its docs validate Chromium. This runs the same test on our Firefox.
 *
 *   npm install --no-save @agent-cards/sdk@0.24.2          # once, does not change package.json
 *   node agentcard/scripts/firefox-sdk-check.mjs --user usr_... [--wait 600]
 *
 * --psp stripe (default) or square. Stripe is the route the Camoufox payment check passes on.
 * --user is an AgentCard user id whose vault holds a card (the sandbox user from earlier).
 * Steps:
 *   1. launch Firefox (Camoufox), the same way the server does
 *   2. serve a page whose button posts to Square's sandbox card URL
 *   3. attach the AgentCard SDK to that page with attachToPlaywright
 *   4. press the button. PASS when the request is paused and an approval link arrives.
 * With --wait, you also approve on your device, and it checks the page receives an answer.
 * Reads AGENTCARD_CLIENT_ID and AGENTCARD_CLIENT_SECRET from .env. Values are never printed.
 */
import { createServer } from 'node:http';
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
const psp = flag('--psp', 'stripe'); // stripe: the route the Camoufox payment check passes on; square needs a Square sandbox app id
const waitSeconds = Number(flag('--wait', '0'));
const SQUARE_CARD_URL = 'https://pci-connect.squareupsandbox.com/v2/card-nonce';

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
} catch (err) {
  check('AgentCard SDK installed', false, 'run: npm install --no-save @agent-cards/sdk@0.24.2');
}
if (!clientId || !clientSecret || !user || !Agentcard) {
  console.log(`\n${failures} failed`);
  process.exit(1);
}

// Each processor's page posts a card request to that processor's own endpoint. The SDK pauses it there.
const CHECKOUTS = {
  // Stripe test mode: the route Stripe's quickstart and our Camoufox payment check use.
  stripe: `const body = new URLSearchParams({ 'card[number]': '4242424242424242', 'card[exp_month]': '12', 'card[exp_year]': '2030', 'card[cvc]': '123' });
    const res = await fetch('https://api.stripe.com/v1/tokens', { method: 'POST', body });`,
  // Square sandbox. Needs a real Square sandbox application id; a placeholder is refused with 401.
  square: `const res = await fetch('${SQUARE_CARD_URL}', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      client_id: 'sandbox-check', session_id: 'sandbox-check-session', location_id: 'sandbox-check-location', idempotency_key: crypto.randomUUID(),
      card_data: { number: '4111111111111111', exp_month: 12, exp_year: 2030, cvv: '111', billing_postal_code: '94103' } }) });`,
};
if (!CHECKOUTS[psp]) { check('processor is stripe or square', false, psp); console.log('\n1 failed'); process.exit(1); }

// A page with one button. Pressing it sends the processor's card request.
const PAGE = `<!doctype html><meta charset="utf-8"><title>Firefox check</title>
<button id="pay">Pay</button> <span id="result">waiting</span>
<script>
document.getElementById('pay').onclick = async () => {
  document.getElementById('result').textContent = 'sending';
  try {
    ${CHECKOUTS[psp]}
    document.getElementById('result').textContent = 'answered ' + res.status;
  } catch (err) {
    document.getElementById('result').textContent = 'failed: ' + err.message;
  }
};
</script>`;

const server = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(PAGE);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;

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
  server.close();
  console.log(`\n${failures} failed`);
  process.exit(1);
}

const page = await (await browser.newContext()).newPage();
await page.goto(url);

const agentcard = new Agentcard({ clientId, clientSecret });
let approvalUrl = null;
const states = [];
let checkout;
try {
  checkout = await agentcard.checkout.attachToPlaywright(page, {
    user,
    merchant: 'Firefox Check',
    amount: 1,
    currency: 'usd',
    onApprovalUrl: (u) => {
      approvalUrl = u;
      console.log(`\n  approve on your device: ${u}\n`);
    },
    onStateChange: (state) => {
      const line = `${state.status ?? 'unknown'}${state.reason ? ` (reason: ${state.reason})` : ''}`;
      states.push(state.status ?? 'unknown');
      console.log(`  sdk state: ${line}`);
    },
  });
  check('SDK attaches to the Firefox page', true);
} catch (err) {
  check('SDK attaches to the Firefox page', false, err.message);
}

if (checkout) {
  await page.click('#pay');
  const deadline = Date.now() + 60_000;
  while (!approvalUrl && Date.now() < deadline) await sleep(500);
  check('card request paused and approval link issued on Firefox', Boolean(approvalUrl));

  if (approvalUrl && waitSeconds > 0) {
    console.log(`  waiting up to ${waitSeconds}s for your approval...`);
    const end = Date.now() + waitSeconds * 1000;
    let result = '';
    while (Date.now() < end) {
      result = (await page.textContent('#result')) ?? '';
      if (/^(answered|failed)/.test(result)) break;
      await sleep(1000);
    }
    const finalState = states.at(-1) ?? 'none';
    console.log(`  final sdk state: ${finalState}`);
    // Ask the SDK for its own account of the checkout. Printed without any card data.
    try {
      const reconciled = await checkout.reconcile();
      const keep = ['status', 'reason', 'authorizationId', 'chargedKind', 'amountAuthority'];
      for (const k of keep) if (reconciled?.[k] !== undefined) console.log(`    ${k}: ${reconciled[k]}`);
    } catch (err) {
      console.log(`    reconcile() failed: ${err.message}`);
    }
    // A pass needs a successful answer from the processor (HTTP 2xx) and no decline from the SDK.
    const answered = result.match(/^answered (\d{3})$/);
    const okAnswer = answered && Number(answered[1]) >= 200 && Number(answered[1]) < 300;
    check('page receives a successful answer after approval', Boolean(okAnswer && finalState !== 'declined'),
      `page: ${result.trim() || 'no answer'}; sdk: ${finalState}`);
  }
}

await browser.close();
server.close();
console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} check(s) failed`}`);
process.exit(failures === 0 ? 0 : 1);
