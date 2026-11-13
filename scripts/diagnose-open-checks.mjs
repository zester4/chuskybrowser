#!/usr/bin/env node
// Diagnoses the two open failures. Reads settings from the repo's .env. Prints outcomes and
// AgentCard's error messages only; never prints keys, secrets or card numbers.
//
//   node scripts/diagnose-open-checks.mjs                              # merchants, both ways, and cards
//   node scripts/diagnose-open-checks.mjs --preparation cprep_...      # also read one preparation

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from 'node:process';
import { ChuskyClient, ChuskyError } from '../skills/chuskybrowser-setup/scripts/chusky-client.mjs';
import { createAgentCardApi, AgentCardError, DEFAULT_BASE_URL } from '../agentcard/src/index.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (existsSync(resolve(root, '.env'))) loadEnvFile(resolve(root, '.env'));
const args = process.argv.slice(2);
const prepId = args[args.indexOf('--preparation') + 1];
const env = (name) => process.env[name]?.trim() || '';
const describe = (err) => {
  if (err instanceof ChuskyError) return `bridge HTTP ${err.status}: ${err.message}`;
  if (err instanceof AgentCardError) return `AgentCard HTTP ${err.status}${err.code ? ` ${err.code}` : ''}: ${err.message}`;
  return err.message;
};

async function attempt(label, fn) {
  try {
    const out = await fn();
    console.log(`PASS ${label}${out ? `  (${out})` : ''}`);
  } catch (err) {
    console.log(`FAIL ${label}  ${describe(err)}`);
  }
}

// 1. Through the bridge, with the test user (the failing check).
const payUser = env('CHUSKY_TEST_PAY_USER');
if (!env('CHUSKYBROWSER_API_KEY') || !payUser) {
  console.log('SKIP bridge checks: CHUSKYBROWSER_API_KEY and CHUSKY_TEST_PAY_USER must be in .env');
} else {
  const pay = new ChuskyClient({ apiKey: env('CHUSKYBROWSER_API_KEY'), userId: payUser });
  await attempt('bridge: merchants for the test user', async () => {
    const r = await pay.merchants({ q: 'Shop Example', limit: 5 });
    return `${(r?.merchants ?? []).length} merchants`;
  });
  await attempt('bridge: cards for the test user', async () => {
    const r = await pay.listCards();
    return `${(r?.cards ?? []).length} card(s)`;
  });
}

// 2. Straight to AgentCard, with the sandbox credentials (no bridge involved).
const clientId = env('AGENTCARD_CLIENT_ID');
const clientSecret = env('AGENTCARD_CLIENT_SECRET');
if (!clientId || !clientSecret) {
  console.log('SKIP AgentCard checks: AGENTCARD_CLIENT_ID and AGENTCARD_CLIENT_SECRET must be in .env');
} else {
  const api = createAgentCardApi({ clientId, clientSecret, baseUrl: env('AGENTCARD_BASE_URL') || DEFAULT_BASE_URL });
  await attempt('AgentCard: merchants, no user', async () => {
    const r = await api.listMerchants({ q: 'Shop Example', limit: 5 });
    return `${(r?.merchants ?? []).length} merchants`;
  });
  if (prepId) {
    await attempt(`AgentCard: read ${prepId}`, async () => {
      const p = await api.getPreparation(prepId);
      const keep = ['status', 'psp', 'merchant_origin', 'amount_cents', 'environment', 'payment_status', 'created_at', 'createdAt', 'ready_expires_at', 'expiresAt', 'cancel_reason', 'failure_reason', 'reason', 'message'];
      for (const k of keep) if (p[k] !== undefined) console.log(`      ${k}: ${typeof p[k] === 'object' ? JSON.stringify(p[k]) : p[k]}`);
      return p.status;
    });
  }
}

console.log('\nWhat to send back: the lines above (they contain no secrets). If the bridge line fails but the AgentCard line passes, the problem is the user mapping on our side. If both fail, it is AgentCard\'s side.');
