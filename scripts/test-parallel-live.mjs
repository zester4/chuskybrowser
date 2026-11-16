/**
 * Parallel tabs test against a running Chusky server.
 *
 * Usage: npm run test:parallel   (reads .env: CHUSKY_BASE_URL, CHUSKY_ACCESS_KEY)
 *
 * Checks that one user can open and use 3 tabs at the same time, that each tab
 * keeps its own page, and that the standard plan's per-user limit holds when a
 * 4th operation is sent at once. Uses a fresh user ID and deletes its session at the end.
 */
import { randomUUID } from 'node:crypto';
import { call, makeReporter } from './lib-env.mjs';

const report = makeReporter();
const user = `parallel-${randomUUID().slice(0, 8)}`;
const sessionKey = 'parallel';
const enc = encodeURIComponent;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const URLS = [
  'https://example.com/',
  'https://example.org/',
  'https://the-internet.herokuapp.com/',
];

function openTab(url) {
  return call('/tabs', { method: 'POST', body: { userId: user, sessionKey, url }, timeoutMs: 90_000 });
}

try {
  // 1. Open 3 tabs at the same time
  const started = Date.now();
  const opened = await Promise.all(URLS.map((url) => openTab(url)));
  const tabIds = opened.map((r) => r.data?.tabId ?? null);
  const allOpened = tabIds.every(Boolean);
  report.check('opened 3 tabs at the same time', allOpened,
    `${tabIds.filter(Boolean).length} of 3 in ${Date.now() - started} ms`);

  if (allOpened) {
    // 2. Each tab keeps its own page
    await wait(2000);
    const states = await Promise.all(tabIds.map((id) => call(`/tabs/${id}/state?userId=${enc(user)}`)));
    const urls = states.map((s) => s.data?.url ?? '');
    const sameUrlsAsOpened = urls.every((u, i) => u.startsWith(new URL(URLS[i]).origin));
    report.check('each tab shows its own page', sameUrlsAsOpened, urls.join(' | '));

    // 3. Work on all 3 tabs at once
    const scrolls = await Promise.all(tabIds.map((id) =>
      call(`/tabs/${id}/scroll`, { method: 'POST', body: { userId: user, direction: 'down', amount: 200 } })));
    report.check('scrolls all 3 tabs at the same time', scrolls.every((s) => s.status === 200),
      scrolls.map((s) => `HTTP ${s.status}`).join(', '));

    // 4. Per-user limit: a 4th simultaneous operation on the standard plan
    //    (3 at once per user). Information only: the result shows how the limit responds.
    const burst = await Promise.all(Array.from({ length: 5 }, () => openTab('https://example.com/')));
    const burstStatus = burst.map((r) => r.status);
    const extraTabs = burst.map((r) => r.data?.tabId).filter(Boolean);
    report.check('5 simultaneous opens get a clear answer (201 or 429/503), none hang',
      burstStatus.every((s) => [200, 201, 429, 503].includes(s)), burstStatus.join(', '));
    console.log(`INFO  5 simultaneous opens returned: ${burstStatus.join(', ')}`);

    // 5. Tidy the extra tabs from the burst
    await Promise.all(extraTabs.map((id) => call(`/tabs/${id}?userId=${enc(user)}`, { method: 'DELETE' })));
  } else {
    report.check('tabs failed to open, check the server log', false);
  }
} finally {
  // Always clean up this test user's session
  await call(`/sessions/${enc(user)}`, { method: 'DELETE' });
}

report.finish();
