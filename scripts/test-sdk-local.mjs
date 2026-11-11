#!/usr/bin/env node
// Checks the SDK end to end against a running server with a key you paste in.
//
//   node scripts/test-sdk-local.mjs
//
// Prompts for:
//   - the API key (cb_live_...), which is never printed
//   - the base URL, default http://localhost:9377/v1
// Exits 0 only if every check passes.

import readline from 'node:readline';
import { stdin, stdout } from 'node:process';
import { ChuskyClient, ChuskyError } from '../skills/chuskybrowser-setup/scripts/chusky-client.mjs';

// One line reader for both prompts, so typed and piped input both work.
// Close the readline interface itself. Destroying stdin directly crashes Node on Windows.
const rl = readline.createInterface({ input: stdin, output: stdout, terminal: false });
const lines = rl[Symbol.asyncIterator]();
const ask = async (question) => {
  stdout.write(question);
  const { value } = await lines.next();
  return (value ?? '').trim();
};
const apiKey = await ask('API key (cb_live_...): ');
const baseUrl = (await ask('Base URL [http://localhost:9377/v1]: ')) || 'http://localhost:9377/v1';
rl.close();

if (!apiKey.startsWith('cb_live_')) {
  console.log('FAIL key: keys start with cb_live_');
  process.exit(1);
}

const client = new ChuskyClient({ apiKey, baseUrl, userId: `sdk-check-${Date.now()}` });
let passed = 0;
let failed = 0;
const check = async (name, fn) => {
  try {
    const detail = await fn();
    passed++;
    console.log(`PASS ${name}${detail ? ` (${detail})` : ''}`);
    return true;
  } catch (err) {
    failed++;
    const status = err instanceof ChuskyError ? ` [HTTP ${err.status}]` : '';
    console.log(`FAIL ${name}${status}: ${err.message}`);
    return false;
  }
};

let tabId = null;
await check('gateway health', async () => {
  const h = await client.health();
  if (h?.ok !== true) throw new Error('health did not return ok:true');
  return 'ok';
});
await check('open tab', async () => {
  const tab = await client.openTab({ url: 'http://example.com', sessionKey: 'sdk-check' });
  if (!tab?.tabId) throw new Error('no tabId returned');
  tabId = tab.tabId;
  return 'tab opened';
});
if (tabId) {
  await check('page state', async () => {
    const s = await client.state(tabId);
    if (!s?.state?.kind) throw new Error('no state.kind');
    return `state ${s.state.kind}`;
  });
  await check('snapshot contains page text', async () => {
    const s = await client.snapshot(tabId);
    const text = typeof s === 'string' ? s : (s?.snapshot || '');
    if (!/Example Domain/i.test(text)) throw new Error('"Example Domain" not found in snapshot');
    return `${text.length} chars`;
  });
  await check('screenshot returns image bytes', async () => {
    const buf = await client.screenshot(tabId);
    if (!buf?.length) throw new Error('empty screenshot');
    return `${buf.length} bytes`;
  });
  await check('close tab', async () => {
    await client.closeTab(tabId);
    return 'closed';
  });
}
await check('wrong key is refused', async () => {
  const bad = new ChuskyClient({ apiKey: 'cb_live_not-a-real-key', baseUrl, userId: 'sdk-check' });
  try {
    await bad.health().then(() => bad.listTabs());
  } catch (err) {
    if (err.status === 401) return 'refused with 401';
    throw err;
  }
  throw new Error('a wrong key was accepted');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed && failed === 1 && tabId === null) console.log('Hint: a 401 on open tab means the running server does not have this key. Stop every server window, start one with CHUSKY_GATEWAY_STORE=file in the same window, then rerun.');
process.exitCode = failed ? 1 : 0;
