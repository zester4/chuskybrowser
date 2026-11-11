// End-to-end: the real SDK client -> Chusky Gateway -> a fake browser server.
// Run: NODE_OPTIONS='--experimental-vm-modules' npx jest tests/unit/gateway.e2e.test.js
import http from 'node:http';
import { createGatewayApp } from '../../gateway/http.js';
import { createMemoryStore } from '../../gateway/store.js';
import { createApiKey, revokeApiKey } from '../../gateway/keys.js';
import { ChuskyClient } from '../../skills/chuskybrowser-setup/scripts/chusky-client.mjs';

const MASTER = 'MASTER_KEY_SECRET';
const COOKIE = 'COOKIE_KEY_SECRET';
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)));
}

function fakeBrowser(seen) {
  return http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      const body = raw ? JSON.parse(raw) : null;
      seen.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), auth: req.headers.authorization, body });
      if (req.method === 'POST' && url.pathname === '/tabs') {
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify({ tabId: `tab-${seen.length}` }));
      }
      if (req.method === 'GET' && /\/screenshot$/.test(url.pathname)) {
        res.setHeader('Content-Type', 'image/png');
        return res.end(PNG);
      }
      if (req.method === 'POST' && url.pathname === '/live-viewer/links') {
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify({ url: `http://browser.internal/live-viewer/view?t=tok123`, control: false }));
      }
      if (req.method === 'GET' && url.pathname === '/live-viewer/view') {
        res.setHeader('Content-Type', 'text/html');
        return res.end('<html>viewer</html>');
      }
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true, echoed: { path: url.pathname, query: Object.fromEntries(url.searchParams) } }));
    });
  });
}

describe('gateway end to end', () => {
  let fake, gwServer, gwUrl, store, seen;

  beforeAll(async () => {
    seen = [];
    fake = fakeBrowser(seen);
    const fakeUrl = await listen(fake);
    store = createMemoryStore();
    gwServer = http.createServer(createGatewayApp({ store, chuskyUrl: fakeUrl, masterKey: MASTER, cookieKey: COOKIE }));
    gwUrl = await listen(gwServer);
  });

  afterAll(() => { fake.close(); gwServer.close(); });

  const sdkFor = (key, user = 'alice') => new ChuskyClient({ baseUrl: gwUrl + '/v1', accessKey: key, userId: user });

  test('the SDK works with only the customer key, and the browser sees the namespaced user and the master key', async () => {
    const made = await createApiKey(store, 'acct-A', 'sdk');
    const tab = await sdkFor(made.key).openTab({ url: 'https://example.com', sessionKey: 's1' });
    expect(tab.tabId).toBeTruthy();
    const call = seen.at(-1);
    expect(call.auth).toBe(`Bearer ${MASTER}`);
    expect(call.body.userId).toBe('acct-A:alice');
    expect(call.body.sessionKey).toBe('s1');
  });

  test('screenshots come back as image bytes, not JSON', async () => {
    const made = await createApiKey(store, 'acct-A', 'shot');
    const { tabId } = await sdkFor(made.key).openTab({ sessionKey: 's1' });
    const res = await fetch(`${gwUrl}/v1/tabs/${tabId}/screenshot?userId=alice`, { headers: { Authorization: `Bearer ${made.key}` } });
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await res.arrayBuffer()).equals(PNG)).toBe(true);
  });

  test('one account cannot touch another account\'s tab', async () => {
    const a = await createApiKey(store, 'acct-A', 'a');
    const b = await createApiKey(store, 'acct-B', 'b');
    const { tabId } = await sdkFor(a.key).openTab({ sessionKey: 's1' });
    await expect(sdkFor(b.key).snapshot(tabId)).rejects.toMatchObject({ status: 404 });
    await expect(sdkFor(b.key).closeTab(tabId)).rejects.toMatchObject({ status: 404 });
    await expect(sdkFor(a.key).snapshot(tabId)).resolves.toBeTruthy();
  });

  test('a revoked key is refused, and a made-up key is refused', async () => {
    const made = await createApiKey(store, 'acct-C', 'c');
    await expect(sdkFor(made.key).openTab({ sessionKey: 's' })).resolves.toBeTruthy();
    await revokeApiKey(store, 'acct-C', made.id);
    await expect(sdkFor(made.key).openTab({ sessionKey: 's' })).rejects.toMatchObject({ status: 401 });
    await expect(sdkFor('cb_live_nope').openTab({ sessionKey: 's' })).rejects.toMatchObject({ status: 401 });
  });

  test('the live-view link points at the gateway, and the viewer page is served through it', async () => {
    const made = await createApiKey(store, 'acct-V', 'v');
    const sdk = sdkFor(made.key);
    const { tabId } = await sdk.openTab({ sessionKey: 's1' });
    const url = await sdk.controlLink(tabId);
    expect(url.startsWith(gwUrl + '/live-viewer/view?t=tok123')).toBe(true);
    const page = await fetch(url);
    expect(await page.text()).toContain('viewer');
  });

  test('cookie import uses the server\'s cookie key, which the customer never sees', async () => {
    const made = await createApiKey(store, 'acct-K', 'k');
    const res = await fetch(`${gwUrl}/v1/sessions/alice/cookies`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${made.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ cookies: [] }),
    });
    expect(res.status).toBe(200);
    const call = seen.at(-1);
    expect(call.path).toBe('/sessions/acct-K%3Aalice/cookies');
    expect(call.auth).toBe(`Bearer ${COOKIE}`);
  });

  test('AgentCard calls are forwarded with the namespaced user', async () => {
    const made = await createApiKey(store, 'acct-AC', 'ac');
    const res = await fetch(`${gwUrl}/v1/agentcard/merchants?q=coffee&userId=alice`, { headers: { Authorization: `Bearer ${made.key}` } });
    expect(res.status).toBe(200);
    const call = seen.at(-1);
    expect(call.path).toBe('/agentcard/merchants');
    expect(call.query.userId).toBe('acct-AC:alice');
    expect(call.query.q).toBe('coffee');
  });

  test('routes that are not for customers are never forwarded', async () => {
    const made = await createApiKey(store, 'acct-X', 'x');
    const before = seen.length;
    for (const [method, path] of [['POST', '/agentcard/webhooks'], ['GET', '/metrics'], ['POST', '/pressure/cleanup'], ['POST', '/start'], ['POST', '/tabs/open']]) {
      const res = await fetch(`${gwUrl}/v1${path}`, { method, headers: { Authorization: `Bearer ${made.key}`, 'Content-Type': 'application/json' }, body: method === 'GET' ? undefined : '{"userId":"alice"}' });
      expect(res.status).toBe(404);
    }
    expect(seen.length).toBe(before);
  });

  test('a request without a userId is rejected', async () => {
    const made = await createApiKey(store, 'acct-U', 'u');
    const res = await fetch(`${gwUrl}/v1/tabs`, { method: 'POST', headers: { Authorization: `Bearer ${made.key}`, 'Content-Type': 'application/json' }, body: '{"url":"https://example.com"}' });
    expect(res.status).toBe(400);
  });

  test('health works without a key', async () => {
    const res = await fetch(`${gwUrl}/v1/health`);
    expect(res.status).toBe(200);
  });
});
