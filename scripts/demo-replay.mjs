/**
 * Demo: run a short browser session, then print a replay link you can open in a browser.
 *
 * Needs CHUSKY_BASE_URL and CHUSKY_ACCESS_KEY in .env (or the environment).
 *
 *   npm run demo:replay
 *
 * What it does, on a public test site (the-internet.herokuapp.com):
 *   1. Opens the login page with tracing on
 *   2. Types a username and password, and submits the form
 *   3. Checks the secure area page loads
 *   4. Scrolls, then opens the checkboxes page and ticks the first box
 *   5. Closes the session, which saves the trace
 *   6. Prints a replay link valid for one hour
 *
 * Opening the link shows every step in the Playwright trace viewer.
 */
import { randomUUID } from 'node:crypto';
import { BASE, call, makeReporter } from './lib-env.mjs';

const report = makeReporter();
const user = `replay-demo-${randomUUID().slice(0, 8)}`;
const sessionKey = 'demo';
const enc = encodeURIComponent;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// 1. Open the login page with tracing on
const opened = await call('/tabs', {
  method: 'POST',
  body: { userId: user, sessionKey, url: 'https://the-internet.herokuapp.com/login', trace: true },
  timeoutMs: 90_000,
});
const tabId = opened.data?.tabId;
report.check('opened the login page with tracing on', !!tabId, tabId ? '' : `HTTP ${opened.status}: ${opened.data?.error ?? 'no detail'}`);

if (tabId) {
  await wait(3000);

  // 2. Fill the form and submit it
  const typeUser = await call(`/tabs/${tabId}/type`, { method: 'POST', body: { userId: user, selector: '#username', text: 'tomsmith' } });
  report.check('typed the username', typeUser.status === 200, `HTTP ${typeUser.status}`);
  const pass = await call(`/tabs/${tabId}/type`, { method: 'POST', body: { userId: user, selector: '#password', text: 'SuperSecretPassword!' } });
  report.check('typed the password', pass.status === 200, `HTTP ${pass.status}`);
  const submit = await call(`/tabs/${tabId}/click`, { method: 'POST', body: { userId: user, selector: 'button[type="submit"]' } });
  report.check('submitted the login form', submit.status === 200, `HTTP ${submit.status}`);
  await wait(2500);

  // 3. Check we landed on the secure area
  const area = await call(`/tabs/${tabId}/state?userId=${enc(user)}`);
  const areaText = JSON.stringify(area.data ?? {});
  const onSecure = area.status === 200 && (/secure area/i.test(areaText) || /\/secure/.test(area.data?.url ?? ''));
  report.check('reached the secure area page', onSecure, `state: ${area.data?.state?.kind ?? 'unknown'}`);

  // 4. Scroll, then tick a checkbox on another page
  const scroll = await call(`/tabs/${tabId}/scroll`, { method: 'POST', body: { userId: user, direction: 'down', amount: 300 } });
  report.check('scrolled the page', scroll.status === 200, `HTTP ${scroll.status}`);

  const nav = await call(`/tabs/${tabId}/navigate`, { method: 'POST', body: { userId: user, url: 'https://the-internet.herokuapp.com/checkboxes' } });
  report.check('opened the checkboxes page', nav.status === 200, `HTTP ${nav.status}`);
  await wait(1500);

  // The selector click route fails when a selector matches more than one element, and this
  // page has two checkboxes. So the page itself clicks each checkbox in turn.
  const clicked = await evaluate(tabId, `(() => {
    const boxes = [...document.querySelectorAll('form#checkboxes input[type="checkbox"]')];
    boxes.forEach((box) => box.click());
    return JSON.stringify({ found: boxes.length, states: boxes.map((b) => b.checked) });
  })()`);
  const info = JSON.parse(clicked || '{"found":0,"states":[]}');
  report.check('found and clicked the checkboxes', info.found >= 2, `${info.found} checkbox(es), now: ${info.states.join(', ') || 'none'}`);
  await wait(1000);
}

// 5. Close the session so the trace is written
await call(`/sessions/${enc(user)}`, { method: 'DELETE' });
await wait(2000);

// 6. Replay link for the newest trace
const list = await call(`/sessions/${enc(user)}/traces`);
const filename = (list.data?.traces ?? [])[0]?.filename;
report.check('trace saved', !!filename, filename ? filename : 'no trace (is a browser running on the server?)');

if (filename) {
  const link = await call(`/sessions/${enc(user)}/traces/${enc(filename)}/replay`, { method: 'POST', body: { ttlMs: 60 * 60 * 1000 } });
  report.check('replay link created', link.status === 200 && !!link.data?.url, `HTTP ${link.status}`);
  if (link.data?.url) {
    console.log('\nOpen this link in your browser to replay the session (valid one hour):\n');
    console.log(`${BASE}${link.data.url}\n`);
  }
}

report.finish();
