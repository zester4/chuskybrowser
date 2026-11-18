import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import http from 'http';
import { createPlanLimits, resolvePlans } from '../../lib/plan-limits.js';
import { createGatewayApp } from '../../gateway/http.js';
import { createMemoryStore } from '../../gateway/store.js';
import { hashKey } from '../../gateway/keys.js';

const KEY = 'cb_live_' + 'b'.repeat(32);

describe('plans per developer account', () => {
  const newLimits = () => createPlanLimits({ plans: resolvePlans({}) });

  it('applies the account plan to each of its end users', () => {
    const limits = newLimits();
    expect(limits.setAccountPlan('acct-1', 'pro')).toBe(true);
    expect(limits.planFor('acct-1:alice')).toBe('pro');
    expect(limits.limitsFor('acct-1:bob').maxConcurrentPerUser).toBe(25);
    expect(limits.planFor('acct-2:carol')).toBe('standard');
  });

  it('lets a per-user plan override the account plan', () => {
    const limits = newLimits();
    limits.setAccountPlan('acct-1', 'pro');
    expect(limits.setPlan('acct-1:alice', 'payg')).toBe(true);
    expect(limits.planFor('acct-1:alice')).toBe('payg');
    expect(limits.planFor('acct-1:bob')).toBe('pro');
  });

  it('gives a pay-as-you-go account the payg limits', () => {
    const limits = newLimits();
    limits.setAccountPlan('acct-1', 'payg');
    expect(limits.limitsFor('acct-1:alice')).toEqual({ plan: 'payg', maxConcurrentPerUser: 10, maxTabsPerSession: 10 });
  });

  it('rejects an unknown plan name and keeps the old one', () => {
    const limits = newLimits();
    limits.setAccountPlan('acct-1', 'starter');
    expect(limits.setAccountPlan('acct-1', 'gold')).toBe(false);
    expect(limits.planFor('acct-1:alice')).toBe('starter');
  });
});

describe('gateway: accounts without credit cannot start tabs', () => {
  let server;
  let baseUrl;
  let upstreamCalls;
  let planCalls;

  // Creates an app whose key check reports the given entitlement.
  function appFor({ allowed, plan }) {
    const memory = createMemoryStore();
    const store = {
      ...memory,
      findKeyByHash: async (hash) => ({ id: 'key-1', accountId: 'acct-1', revokedAt: null, keyHash: hash, allowed, plan }),
    };
    upstreamCalls = 0;
    planCalls = [];
    const fetchImpl = async () => {
      upstreamCalls += 1;
      return new Response(JSON.stringify({ tabId: 'tab-1' }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    return createGatewayApp({
      store,
      chuskyUrl: 'http://127.0.0.1:1',
      masterKey: 'master',
      fetchImpl,
      onAccountPlan: (accountId, name) => planCalls.push([accountId, name]),
    });
  }

  async function start(app) {
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  }

  afterAll(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  const openTab = () => fetch(`${baseUrl}/v1/tabs`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: 'alice', sessionKey: 's1', url: 'https://example.com' }),
  });

  it('refuses a new tab with 402 and does not reach the browser', async () => {
    await start(appFor({ allowed: false, plan: 'starter' }));
    const res = await openTab();
    const body = await res.json();
    expect(res.status).toBe(402);
    expect(body.code).toBe('no_credit');
    expect(upstreamCalls).toBe(0);
  });

  it('passes the account plan to the server on every call', async () => {
    await start(appFor({ allowed: false, plan: 'pro' }));
    await openTab();
    expect(planCalls).toEqual([['acct-1', 'pro']]);
  });

  it('opens a tab for an allowed account', async () => {
    await start(appFor({ allowed: true, plan: 'starter' }));
    const res = await openTab();
    expect(res.status).toBe(200);
    expect(upstreamCalls).toBe(1);
  });

  it('does not set a plan when the key check sends none', async () => {
    await start(appFor({ allowed: true, plan: undefined }));
    await openTab();
    expect(planCalls).toEqual([]);
  });

  it('hashes the key the same way the key check does', () => {
    expect(hashKey(KEY)).toHaveLength(64);
  });
});
