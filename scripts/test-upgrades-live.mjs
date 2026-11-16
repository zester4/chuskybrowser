/**
 * Live check for the browser upgrades, against a running Chusky server.
 *
 * Needs CHUSKY_BASE_URL and CHUSKY_ACCESS_KEY in .env (or the environment).
 * Optional:
 *   CHUSKY_INTERNAL_SECRET   the server's internal secret, to test the plan route
 *   EXPECT_PROXY=1           fail (not just warn) when the proxy is not configured
 *
 *   npm run test:upgrades
 *   node scripts/test-upgrades-live.mjs
 *
 * Covers:
 *   1. Server health
 *   2. Browser starts and loads a page (needs Camoufox installed on the server)
 *   3. Reconnect: status lists the open tab ids, and is empty after the session closes
 *   4. Replay: a traced session is saved, a signed link opens it, a tampered link is refused
 *   5. Proxy: location settings are accepted, and bytes are counted after a page load
 *   6. Plans: the internal route sets a plan, refuses customer keys and unknown plans
 *
 * Nothing is submitted, logged in, or paid for. Each run uses a fresh test user.
 */
import { randomUUID } from 'node:crypto';
import { BASE, ACCESS_KEY, call, makeReporter } from './lib-env.mjs';

const report = makeReporter();
const user = `upgrade-test-${randomUUID().slice(0, 8)}`;
const internalSecret = (process.env.CHUSKY_INTERNAL_SECRET || '').trim();
const expectProxy = process.env.EXPECT_PROXY === '1';
const TEST_PAGE = process.env.UPGRADE_TEST_URL || 'https://example.com/';

const enc = encodeURIComponent;
const listOf = (data, key) => (Array.isArray(data) ? data : (data?.[key] ?? []));

// 1. Health
{
  const r = await call('/health', { key: null });
  report.check('server is up (/health)', r.status === 200, `HTTP ${r.status}`);
}

// 2. Browser starts and loads a page. Later checks depend on this.
let tabId = null;
{
  const opened = await call('/tabs', {
    method: 'POST',
    body: { userId: user, sessionKey: 'upgrade-check', url: TEST_PAGE, trace: true },
    timeoutMs: 90_000,
  });
  tabId = opened.data?.tabId ?? null;
  report.check('browser opens a tab with tracing on', !!tabId, tabId ? 'tab opened' : `HTTP ${opened.status}: ${opened.data?.error ?? 'no detail'} (is Camoufox installed?)`);
  if (tabId) {
    await new Promise((r) => setTimeout(r, 4000));
    const state = await call(`/tabs/${tabId}/state?userId=${enc(user)}`);
    const kind = state.data?.state?.kind ?? 'unknown';
    report.check('page loads with content', state.status === 200 && kind === 'ok', `state: ${kind}`);
  }
}

// 3. Reconnect: status lists the open session and tab
{
  const s = await call(`/sessions/${enc(user)}/status`);
  const tabs = s.data?.tabs ?? [];
  report.check('status route answers', s.status === 200, `HTTP ${s.status}`);
  if (tabId) {
    report.check('status lists the open tab id', tabs.some((t) => t.tabId === tabId), `${tabs.length} tab(s)`);
  }
  report.check('status reports the plan for this user', !!s.data?.plan?.plan, s.data?.plan?.plan ?? 'missing');
}

// 4. Replay: close the session so the trace is written, then open it through a signed link
{
  await call(`/sessions/${enc(user)}`, { method: 'DELETE' });
  await new Promise((r) => setTimeout(r, 1500));
  const list = await call(`/sessions/${enc(user)}/traces`);
  const traces = listOf(list.data, 'traces');
  const filename = traces[0]?.filename;
  report.check('a trace file is saved for the traced session', !!filename, filename ? 'found' : `${traces.length} trace(s) (needs a browser run)`);
  if (filename) {
    const link = await call(`/sessions/${enc(user)}/traces/${enc(filename)}/replay`, { method: 'POST', body: { ttlMs: 60_000 } });
    report.check('replay link is created', link.status === 200 && !!link.data?.url, `HTTP ${link.status}`);
    if (link.data?.url) {
      const traceParam = new URL(link.data.url, BASE).searchParams.get('trace');
      const zip = await fetch(`${BASE}${traceParam}`, { redirect: 'manual' });
      const bytes = (await zip.arrayBuffer()).byteLength;
      report.check('replay link opens the trace without an access key', zip.status === 200 && bytes > 0, `HTTP ${zip.status}, ${bytes} bytes`);
      const tampered = `${traceParam.slice(0, -4)}AAAA`;
      const bad = await fetch(`${BASE}${tampered}`, { redirect: 'manual' });
      report.check('a tampered replay link is refused', bad.status === 404, `HTTP ${bad.status}`);
    }
    const viewer = await fetch(`${BASE}/replay/`, { redirect: 'manual' });
    report.check('trace viewer page is served at /replay/', viewer.status === 200, `HTTP ${viewer.status}`);
  }
}

// 5. Proxy: location is accepted, and bytes are counted after a page load
{
  const set = await call(`/sessions/${enc(user)}/proxy`, { method: 'POST', body: { country: 'us', sessionDurationMinutes: 5 } });
  if (set.status === 409) {
    report.check('proxy is configured on the server', !expectProxy, expectProxy ? 'not configured, and EXPECT_PROXY=1' : 'not configured: set the PROXY_* variables to test it');
  } else {
    report.check('proxy location is accepted', set.status === 200 && set.data?.proxy?.country === 'us', `HTTP ${set.status}`);
    const bad = await call(`/sessions/${enc(user)}/proxy`, { method: 'POST', body: { country: 'usa' } });
    report.check('invalid country is dropped, not applied', bad.status === 200 && !bad.data?.proxy?.country, `HTTP ${bad.status}`);
    const usage = await call(`/sessions/${enc(user)}/proxy-usage`);
    report.check('usage route answers', usage.status === 200, `HTTP ${usage.status}`);
    if (tabId) {
      report.check('bytes are counted after a page load through the proxy', (usage.data?.bytes ?? 0) > 0, `${usage.data?.bytes ?? 0} bytes`);
    }
  }
}

// 6. Plans: only the internal secret can set one
{
  if (!internalSecret) {
    report.check('plan route tested', true, 'skipped: CHUSKY_INTERNAL_SECRET not set in .env');
  } else {
    const okRes = await fetch(`${BASE}/internal/users/${enc(user)}/plan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-chusky-internal': internalSecret },
      body: JSON.stringify({ plan: 'pro' }),
    });
    const okData = await okRes.json().catch(() => null);
    report.check('internal secret sets the pro plan', okRes.status === 200 && okData?.plan === 'pro', `HTTP ${okRes.status}`);
    const denied = await fetch(`${BASE}/internal/users/${enc(user)}/plan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${ACCESS_KEY}` },
      body: JSON.stringify({ plan: 'scale' }),
    });
    report.check('customer key cannot set a plan', denied.status === 404, `HTTP ${denied.status}`);
    const unknown = await fetch(`${BASE}/internal/users/${enc(user)}/plan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-chusky-internal': internalSecret },
      body: JSON.stringify({ plan: 'platinum' }),
    });
    report.check('unknown plan is refused', unknown.status === 400, `HTTP ${unknown.status}`);
  }
}

// Clean up the test user's session
await call(`/sessions/${enc(user)}`, { method: 'DELETE' });

report.finish();
