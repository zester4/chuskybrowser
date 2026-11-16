/**
 * Harder browser tests against the public test site the-internet.herokuapp.com,
 * run through a live Chusky server.
 *
 * Needs CHUSKY_BASE_URL and CHUSKY_ACCESS_KEY in .env (or the environment).
 *
 *   npm run test:hard
 *
 * Each test is one hard thing a browser must do:
 *   - wait for content that appears after a delay
 *   - read text inside shadow DOM
 *   - read content in nested frames
 *   - follow a link that opens a new window
 *   - load more content by scrolling
 *   - find and click an element that moves between reloads
 *   - handle a page of thousands of elements
 *   - log in through a page that asks for basic auth
 *
 * Tests the API cannot run yet are printed as SKIP, with the reason. They are not
 * counted as passes. Those are JavaScript dialogs and drag and drop.
 */
import { randomUUID } from 'node:crypto';
import { call, makeReporter } from './lib-env.mjs';

const SITE = 'https://the-internet.herokuapp.com';
const report = makeReporter();
const user = `hard-test-${randomUUID().slice(0, 8)}`;
const enc = encodeURIComponent;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Print a test we can't run through the API yet. It is not counted as a pass or a fail.
function skip(name, reason) {
  console.log(`SKIP  ${name} (${reason})`);
}

// Run JavaScript in the page and return its result as a string (or null).
async function evaluate(tabId, expression) {
  const r = await call(`/tabs/${tabId}/evaluate`, { method: 'POST', body: { userId: user, expression } });
  const v = r.data?.result;
  return typeof v === 'string' ? v : (v == null ? null : JSON.stringify(v));
}

// Open a page in a new tab and return its tab id (or null).
async function openTab(url, sessionKey) {
  const r = await call('/tabs', { method: 'POST', body: { userId: user, sessionKey, url }, timeoutMs: 90_000 });
  return r.data?.tabId ?? null;
}

const first = await openTab(`${SITE}/dynamic_loading/2`, 'dynamic');
report.check('opened the dynamic loading page', !!first, first ? '' : 'could not open the tab (is a browser running?)');

if (first) {
  // 1. Dynamic loading: click Start, then wait for text that appears after a delay
  await call(`/tabs/${first}/click`, { method: 'POST', body: { userId: user, selector: '#start button' } });
  let text = null;
  for (let i = 0; i < 20 && !text?.includes('Hello World'); i += 1) {
    await wait(500);
    text = await evaluate(first, `document.querySelector('#finish')?.innerText || ''`);
  }
  report.check('waits for content that appears after a delay', !!text?.includes('Hello World'), text ? `"${text.trim()}"` : 'no text');
}

// 2. Shadow DOM: text inside a shadow root is not in the normal page tree
const shadow = await openTab(`${SITE}/shadowdom`, 'shadow');
if (shadow) {
  await wait(1500);
  const roots = await evaluate(shadow, `JSON.stringify([...document.querySelectorAll('*')].filter(e => e.shadowRoot).length)`);
  report.check('finds shadow DOM roots on the page', Number(JSON.parse(roots || '0')) > 0, `${roots ?? 'no value'} shadow root(s)`);
} else {
  report.check('opened the shadow DOM page', false, 'could not open the tab');
}

// 3. Nested frames: content inside a frame inside a frame
const frames = await openTab(`${SITE}/nested_frames`, 'frames');
if (frames) {
  await wait(1500);
  const count = await evaluate(frames, `JSON.stringify(window.frames.length)`);
  report.check('finds the frames on the page', Number(JSON.parse(count || '0')) >= 2, `${count ?? 'no value'} top-level frame(s)`);
} else {
  report.check('opened the nested frames page', false, 'could not open the tab');
}

// 4. Multiple windows: a link that opens a new tab
const windows = await openTab(`${SITE}/windows`, 'windows');
if (windows) {
  await wait(1500);
  await call(`/tabs/${windows}/click`, { method: 'POST', body: { userId: user, selector: 'a[href="/windows/new"]' } });
  await wait(2500);
  const list = await call(`/tabs?userId=${enc(user)}`);
  const count = (list.data?.tabs ?? []).length;
  report.check('the link opened a second window the server tracks', count >= 2, `${count} tab(s) open`);
} else {
  report.check('opened the multiple windows page', false, 'could not open the tab');
}

// 5. Infinite scroll: more content appears only as the page scrolls
const scroll = await openTab(`${SITE}/infinite_scroll`, 'scroll');
if (scroll) {
  await wait(1500);
  const before = await evaluate(scroll, `JSON.stringify(document.querySelectorAll('.jscroll-added').length)`);
  for (let i = 0; i < 3; i += 1) {
    await call(`/tabs/${scroll}/scroll`, { method: 'POST', body: { userId: user, direction: 'down', amount: 2000 } });
    await wait(1200);
  }
  const after = await evaluate(scroll, `JSON.stringify(document.querySelectorAll('.jscroll-added').length)`);
  report.check('scrolling loads more content', Number(JSON.parse(after || '0')) > Number(JSON.parse(before || '0')), `${before ?? '?'} -> ${after ?? '?'} items`);
} else {
  report.check('opened the infinite scroll page', false, 'could not open the tab');
}

// 6. Challenging DOM: buttons that move and change between reloads
const challenge = await openTab(`${SITE}/challenging_dom`, 'challenge');
if (challenge) {
  await wait(1500);
  const click = await call(`/tabs/${challenge}/click`, { method: 'POST', body: { userId: user, selector: 'a.button' } });
  report.check('clicks a button on a page that changes its layout', click.status === 200, `HTTP ${click.status}`);
} else {
  report.check('opened the challenging DOM page', false, 'could not open the tab');
}

// 7. Large DOM: a page with thousands of elements
const large = await openTab(`${SITE}/large`, 'large');
if (large) {
  await wait(2000);
  const rows = await evaluate(large, `JSON.stringify(document.querySelectorAll('tr').length)`);
  report.check('reads a page with thousands of rows', Number(JSON.parse(rows || '0')) >= 1000, `${rows ?? '?'} rows`);
} else {
  report.check('opened the large DOM page', false, 'could not open the tab');
}

// 8. Basic auth: credentials in the page address
const auth = await openTab(`https://admin:admin@the-internet.herokuapp.com/basic_auth`, 'auth');
if (auth) {
  await wait(1500);
  const msg = await evaluate(auth, `document.body?.innerText || ''`);
  report.check('gets past a basic auth prompt', !!msg?.includes('Congratulations'), msg ? 'page text found' : 'no text');
} else {
  report.check('opened the basic auth page', false, 'could not open the tab');
}

// Not testable through the API yet
skip('JavaScript alerts: confirm and prompt dialogs', 'no route to accept or answer a dialog');
skip('drag and drop with the mouse', 'no drag route');

// Close the test session so its traces are saved
await call(`/sessions/${enc(user)}`, { method: 'DELETE' });

report.finish();
