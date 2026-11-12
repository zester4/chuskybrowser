import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { createRemoteStore } from '../../gateway/remote-store.js';
import { createGatewayStore } from '../../gateway/index.js';
import { verifyApiKey, hashKey } from '../../gateway/keys.js';

const FRONTEND = 'https://frontend.example.test';
const SECRET = 'shared-secret';
const KEY = 'cb_live_' + 'a'.repeat(32);
const HASH = hashKey(KEY);

// Fake frontend: knows one key and records every event it is sent.
function fakeFrontend({ revoked = false, down = false } = {}) {
  const seen = [];
  const fetchImpl = async (url, init) => {
    if (down) throw new Error('connect ECONNREFUSED');
    const path = new URL(url).pathname;
    const headers = new Headers(init.headers);
    if (headers.get('x-chusky-internal') !== SECRET) return new Response('no', { status: 401 });
    const body = JSON.parse(init.body);
    seen.push({ path, body });
    if (path === '/internal/keys/verify') {
      if (body.keyHash !== HASH) return new Response('', { status: 404 });
      return new Response(JSON.stringify({ id: 'key-1', accountId: 'acct-1', revokedAt: revoked ? '2026-11-12T00:00:00Z' : null }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { fetchImpl, seen };
}

describe('remote store', () => {
  let errorSpy;
  beforeEach(() => { errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {}); });
  afterEach(() => errorSpy.mockRestore());

  it('accepts a key the frontend knows, with the same account and key id', async () => {
    const { fetchImpl } = fakeFrontend();
    const store = createRemoteStore({ frontendUrl: FRONTEND, secret: SECRET, fetchImpl });
    expect(await verifyApiKey(store, KEY)).toEqual({ accountId: 'acct-1', keyId: 'key-1' });
  });

  it('refuses a key the frontend does not know, and a revoked one', async () => {
    const store = createRemoteStore({ frontendUrl: FRONTEND, secret: SECRET, fetchImpl: fakeFrontend().fetchImpl });
    expect(await verifyApiKey(store, 'cb_live_' + 'b'.repeat(32))).toBeNull();
    const revoked = createRemoteStore({ frontendUrl: FRONTEND, secret: SECRET, fetchImpl: fakeFrontend({ revoked: true }).fetchImpl });
    expect(await verifyApiKey(revoked, KEY)).toBeNull();
  });

  it('fails closed when the frontend cannot be reached', async () => {
    const store = createRemoteStore({ frontendUrl: FRONTEND, secret: SECRET, fetchImpl: fakeFrontend({ down: true }).fetchImpl });
    await expect(verifyApiKey(store, KEY)).rejects.toThrow();
  });

  it('sends the secret on every call, and never sends the customer key', async () => {
    const { fetchImpl, seen } = fakeFrontend();
    const store = createRemoteStore({ frontendUrl: FRONTEND, secret: SECRET, fetchImpl });
    await verifyApiKey(store, KEY);
    expect(JSON.stringify(seen)).not.toContain(KEY);
    expect(seen[0].body).toEqual({ keyHash: HASH });
  });

  it('caches the answer briefly', async () => {
    const { fetchImpl, seen } = fakeFrontend();
    const store = createRemoteStore({ frontendUrl: FRONTEND, secret: SECRET, fetchImpl, cacheMs: 60_000 });
    await verifyApiKey(store, KEY);
    await verifyApiKey(store, KEY);
    expect(seen.filter((e) => e.path === '/internal/keys/verify').length).toBe(1);
  });

  it('reports tab and usage events to the frontend, and keeps tab ownership here', async () => {
    const { fetchImpl, seen } = fakeFrontend();
    const store = createRemoteStore({ frontendUrl: FRONTEND, secret: SECRET, fetchImpl });
    await store.recordTab({ accountId: 'acct-1', endUserId: 'alice', tabId: 'tab-9', sessionKey: 's', url: 'https://example.com', openedAt: '2026-11-12T00:00:00Z' });
    await store.markTabClosed('acct-1', 'tab-9', '2026-11-12T00:05:00Z');
    await store.recordUsage('acct-1', 'POST open');
    await new Promise((r) => setTimeout(r, 10));
    expect(seen.map((e) => e.body.type)).toEqual(['tab_open', 'tab_close', 'usage']);
    expect(seen[0].body).toMatchObject({ accountId: 'acct-1', endUserId: 'alice', tabId: 'tab-9' });
    expect(await store.tabOwner('tab-9')).toBe('acct-1');
  });

  it('does not let the gateway create or list keys on this server', async () => {
    const store = createRemoteStore({ frontendUrl: FRONTEND, secret: SECRET, fetchImpl: fakeFrontend().fetchImpl });
    await expect(store.insertKey({})).rejects.toThrow(/frontend/);
    await expect(store.listKeys('acct-1')).rejects.toThrow(/frontend/);
  });

  it('needs the frontend address and the secret', () => {
    expect(() => createRemoteStore({ frontendUrl: '', secret: SECRET })).toThrow(/CHUSKY_FRONTEND_URL/);
    expect(() => createGatewayStore({ gatewayStore: 'remote', frontendUrl: FRONTEND, internalSecret: '' })).toThrow();
  });
});
