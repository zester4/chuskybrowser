#!/usr/bin/env node
// Run the agent across five big sites in one browser, and watch it live.
//
//   node scripts/demo-sites-live.mjs                 # all five sites
//   node scripts/demo-sites-live.mjs --only target   # one site by key
//   node scripts/demo-sites-live.mjs --pause 6000    # slower, easier to follow
//   node scripts/demo-sites-live.mjs --dump --only target   # print the first page's snapshot lines, to tune selectors
//
// What it does, per site (one tab each, all in the same browser session):
//   1. Open the site and print a live view link for it straight away.
//   2. Check the page state. If the site shows a captcha, login wall or block,
//      it records that and prints a control link so a person can take over.
//      It does not try to get past the check.
//   3. Up to three actions: search for a product or job, open the first result,
//      and press "add to cart" when the site has one.
//   It stops before checkout. It never enters payment details or places an order.
//
// Needs CHUSKY_BASE_URL and CHUSKY_ACCESS_KEY (or CHUSKY_GATEWAY_URL and
// CHUSKY_TEST_CUSTOMER_KEY) in .env or the environment.

import { loadDotEnv } from '../skills/chuskybrowser-setup/scripts/lib-env.mjs';
import { ChuskyClient } from '../skills/chuskybrowser-setup/scripts/chusky-client.mjs';
import { pickContentLinks } from '../lib/demo-browse.js';

const ENV = { ...loadDotEnv(), ...process.env };

// Curated list. Keep it to sites you have agreed to test against.
const SITES = [
  { key: 'target', url: 'https://www.target.com/', query: 'coffee mug', cart: true },
  { key: 'bestbuy', url: 'https://www.bestbuy.com/', query: 'usb-c cable', cart: true },
  { key: 'walmart', url: 'https://www.walmart.com/', query: 'desk lamp', cart: true },
  { key: 'indeed', url: 'https://www.indeed.com/', query: 'data analyst', cart: false },
  { key: 'zillow', url: 'https://www.zillow.com/', query: 'Austin, TX', cart: false },
];

function parseArgs(argv) {
  const opts = { only: null, pause: 4000, ttl: 3600, dump: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${arg} needs a value`);
      return v;
    };
    switch (arg) {
      case '--only': opts.only = next(); break;
      case '--pause': opts.pause = Number(next()); break;
      case '--ttl': opts.ttl = Number(next()); break;
      case '--dump': opts.dump = true; break;
      case '-h':
      case '--help':
        console.log('Usage: node scripts/demo-sites-live.mjs [--only KEY] [--pause MS] [--ttl SECONDS] [--dump]');
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown option ${arg}`);
    }
  }
  return opts;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function linkFor(baseUrl, accessKey, userId, tabId, { control, ttlSeconds }) {
  const res = await fetch(`${baseUrl}/live-viewer/links`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, tabId, control, ttlSeconds }),
    signal: AbortSignal.timeout(30000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`viewer link failed (HTTP ${res.status}): ${data.error || 'no detail'}`);
  return data.url;
}

// Find a search box in a snapshot. Returns a ref or null.
function findSearchRef(snapshotText) {
  const lines = String(snapshotText || '').split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/- (?:textbox|searchbox|combobox) "([^"]*)" \[([^\]]+)\]/i);
    if (m && /search/i.test(m[1])) return m[2];
  }
  for (const line of lines) {
    const m = line.match(/- (?:textbox|searchbox|combobox) "[^"]*" \[([^\]]+)\]/i);
    if (m) return m[1];
  }
  return null;
}

// Find an "add to cart" button in a snapshot. Returns a ref or null.
function findCartRef(snapshotText) {
  for (const line of String(snapshotText || '').split(/\r?\n/)) {
    const m = line.match(/- button "([^"]*)" \[([^\]]+)\]/i);
    if (m && /add to (cart|bag)/i.test(m[1])) return m[2];
  }
  return null;
}

async function runSite(client, site, tabId, opts, ctx) {
  const log = (msg) => console.log(`  [${site.key}] ${msg}`);
  const result = { site: site.key, state: 'unknown', actions: [] };

  // Check the page state first. Captcha, login walls and blocks stop here.
  const st = await client.state(tabId).catch(() => null);
  result.state = st?.state?.kind || 'unknown';
  if (opts.dump) {
    const snap = await client.snapshot(tabId);
    console.log(`  [${site.key}] snapshot, first 60 lines:`);
    String(snap.snapshot || '').split(/\r?\n/).slice(0, 60).forEach((l) => console.log(`    ${l}`));
    return result;
  }
  if (result.state !== 'ok' && result.state !== 'no_results') {
    log(`page state is "${result.state}". Not continuing. Take over with the control link below if you want to go further.`);
    const controlUrl = await linkFor(ctx.baseUrl, ctx.accessKey, ctx.userId, tabId, { control: true, ttlSeconds: opts.ttl }).catch(() => null);
    if (controlUrl) console.log(`  control link (${site.key}): ${controlUrl}`);
    return result;
  }

  // Action 1: search.
  const start = await client.snapshot(tabId);
  const searchRef = findSearchRef(start.snapshot);
  if (!searchRef) {
    log('no search box found on the page');
    return result;
  }
  await client.type(tabId, { ref: searchRef, text: site.query, pressEnter: true });
  result.actions.push(`searched "${site.query}"`);
  log(`searched for "${site.query}"`);
  await sleep(opts.pause);

  // Action 2: open the first result.
  const results = await client.snapshot(tabId);
  const first = pickContentLinks(results.snapshot)[0];
  if (!first) {
    log('no result links found');
    return result;
  }
  await client.click(tabId, { ref: first.ref });
  result.actions.push(`opened "${first.text.slice(0, 60)}"`);
  log(`opened "${first.text.slice(0, 60)}"`);
  await sleep(opts.pause);

  // Action 3: add to cart, only for shopping sites. Stops before checkout.
  if (site.cart) {
    const page = await client.snapshot(tabId);
    const cartRef = findCartRef(page.snapshot);
    if (cartRef) {
      await client.click(tabId, { ref: cartRef });
      result.actions.push('added to cart');
      log('added to cart (stopping before checkout)');
    } else {
      log('no add-to-cart button on this page');
    }
    await sleep(opts.pause);
  }
  return result;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const baseUrl = (ENV.CHUSKY_BASE_URL || ENV.CHUSKY_GATEWAY_URL || '').replace(/\/+$/, '');
  const accessKey = ENV.CHUSKY_ACCESS_KEY || ENV.CHUSKY_TEST_CUSTOMER_KEY || '';
  if (!baseUrl || !accessKey) throw new Error('Set CHUSKY_BASE_URL and CHUSKY_ACCESS_KEY in .env first.');

  const sites = opts.only ? SITES.filter((s) => s.key === opts.only) : SITES;
  if (sites.length === 0) throw new Error(`No site called "${opts.only}". Options: ${SITES.map((s) => s.key).join(', ')}`);

  const userId = `sites-${Date.now()}`;
  const sessionKey = 'sites-live';
  const client = new ChuskyClient({ baseUrl, accessKey, userId });
  await client.health().catch((err) => { throw new Error(`Chusky server not reachable: ${err.message}`); });
  const ctx = { baseUrl, accessKey, userId };

  // Open every tab first, so each live link is printed straight away.
  const tabs = [];
  for (const site of sites) {
    const { tabId } = await client.openTab({ url: site.url, sessionKey });
    const link = await linkFor(baseUrl, accessKey, userId, tabId, { control: false, ttlSeconds: opts.ttl });
    tabs.push({ site, tabId, link });
    console.log(`Watch ${site.key} live: ${link}`);
  }
  console.log('');

  const summary = [];
  for (const { site, tabId } of tabs) {
    console.log(`Running ${site.key}`);
    try {
      summary.push(await runSite(client, site, tabId, opts, ctx));
    } catch (err) {
      console.log(`  [${site.key}] failed: ${String(err.message).slice(0, 160)}`);
      summary.push({ site: site.key, state: 'error', actions: [] });
    }
    console.log('');
  }

  console.log('Summary');
  for (const s of summary) {
    console.log(`  ${s.site.padEnd(8)} state: ${s.state.padEnd(12)} actions: ${s.actions.length ? s.actions.join('; ') : 'none'}`);
  }

  for (const { tabId } of tabs) await client.closeTab(tabId).catch(() => {});
  await client.endSession().catch(() => {});
  console.log('\nDone. Tabs closed.');
}

main().catch((err) => {
  console.error(`demo-sites-live: ${err.message}`);
  process.exit(1);
});
