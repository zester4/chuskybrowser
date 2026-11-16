import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pickProxyGeo, createProxyPool } from '../../lib/proxy.js';
import { createProxyUsageStore } from '../../lib/proxy-usage.js';
import { createPlanLimits, resolvePlans, DEFAULT_PLANS } from '../../lib/plan-limits.js';

describe('pickProxyGeo', () => {
  it('keeps valid location and session fields, lowercases the country', () => {
    expect(pickProxyGeo({ country: 'US', city: 'New York', sessionDurationMinutes: 30 })).toEqual({
      country: 'us', city: 'new_york', sessionDurationMinutes: 30,
    });
  });

  it('drops a country that is not two letters', () => {
    expect(pickProxyGeo({ country: 'usa' })).toEqual({});
    expect(pickProxyGeo({ country: 'u1' })).toEqual({});
  });

  it('clamps session length to 1..1440 minutes', () => {
    expect(pickProxyGeo({ sessionDurationMinutes: 0 }).sessionDurationMinutes).toBe(1);
    expect(pickProxyGeo({ sessionDurationMinutes: 99999 }).sessionDurationMinutes).toBe(1440);
  });

  it('ignores endpoint or credential fields', () => {
    expect(pickProxyGeo({ backconnectHost: 'evil.example', password: 'x', username: 'y' })).toEqual({});
  });
});

describe('backconnect getNext with overrides', () => {
  const config = {
    strategy: 'backconnect',
    providerName: 'decodo',
    backconnectHost: 'gate.example',
    backconnectPort: 7000,
    username: 'user',
    password: 'pw',
    protocol: 'http',
    country: 'gb',
    sessionDurationMinutes: 10,
  };

  it('uses the user override for country in the username', () => {
    const pool = createProxyPool(config);
    const withUs = pool.getNext('sess-1', { country: 'us' });
    const withDefault = pool.getNext('sess-2');
    expect(withUs.username).toContain('country-us');
    expect(withDefault.username).toContain('country-gb');
  });

  it('keeps the same endpoint regardless of overrides', () => {
    const pool = createProxyPool(config);
    expect(pool.getNext('s', { country: 'de' }).server).toBe('http://gate.example:7000');
  });
});

describe('proxy usage store', () => {
  let dir;
  let file;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chusky-proxy-usage-'));
    file = path.join(dir, 'proxy-usage.json');
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('adds bytes per user and ignores bad input', () => {
    const store = createProxyUsageStore({ filePath: null });
    store.recordBytes('u1', 100);
    store.recordBytes('u1', 50);
    store.recordBytes('u1', NaN);
    store.recordBytes('u2', -5);
    expect(store.getUsage('u1').bytes).toBe(150);
    expect(store.getUsage('u1').requests).toBe(2);
    expect(store.getUsage('u2').bytes).toBe(0);
  });

  it('saves totals and settings, and reloads them after a restart', async () => {
    const first = createProxyUsageStore({ filePath: file, saveDelayMs: 10_000 });
    first.recordBytes('u1', 2048);
    first.setGeo('u1', { country: 'us' });
    await first.flush();

    const second = createProxyUsageStore({ filePath: file });
    expect(second.getUsage('u1').bytes).toBe(2048);
    expect(second.getGeo('u1')).toEqual({ country: 'us' });
  });

  it('clears settings when given an empty object', () => {
    const store = createProxyUsageStore({ filePath: null });
    store.setGeo('u1', { country: 'us' });
    store.setGeo('u1', {});
    expect(store.getGeo('u1')).toEqual({});
  });
});

describe('plan limits', () => {
  it('keeps the standard plan at the configured values', () => {
    const plans = resolvePlans({}, { standardOverride: { maxConcurrentPerUser: 3, maxTabsPerSession: 10 } });
    expect(plans.standard).toEqual({ maxConcurrentPerUser: 3, maxTabsPerSession: 10 });
    expect(plans.pro).toEqual(DEFAULT_PLANS.pro);
  });

  it('lets config override a plan and ignores bad numbers', () => {
    const plans = resolvePlans({ pro: { maxConcurrentPerUser: 12, maxTabsPerSession: -1 } });
    expect(plans.pro).toEqual({ maxConcurrentPerUser: 12, maxTabsPerSession: 25 });
  });

  it('uses the default plan for users with no assignment', () => {
    const limits = createPlanLimits({ plans: resolvePlans({}), defaultPlan: 'standard' });
    expect(limits.limitsFor('nobody').plan).toBe('standard');
  });

  it('keeps plan assignments across a restart when a file is given', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chusky-plans-'));
    const file = path.join(dir, 'plans.json');
    try {
      const plans = resolvePlans({});
      createPlanLimits({ plans, filePath: file }).setPlan('u9', 'scale');
      const reloaded = createPlanLimits({ plans, filePath: file });
      expect(reloaded.limitsFor('u9').plan).toBe('scale');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('assigns a known plan and rejects an unknown one', () => {
    const limits = createPlanLimits({ plans: resolvePlans({}), defaultPlan: 'standard' });
    expect(limits.setPlan('u1', 'pro')).toBe(true);
    expect(limits.limitsFor('u1')).toEqual({ plan: 'pro', ...DEFAULT_PLANS.pro });
    expect(limits.setPlan('u1', 'platinum')).toBe(false);
    expect(limits.limitsFor('u1').plan).toBe('pro');
  });
});
