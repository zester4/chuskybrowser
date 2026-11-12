#!/usr/bin/env node
/**
 * Live check of the approve-first flow (checkout preparations). Run it with SANDBOX credentials.
 *
 *   node agentcard/scripts/preparation-check.mjs --user usr_... [--psp adyen] [--environment sandbox] [--wait 600]
 *
 * --user is an AgentCard user id whose vault already holds a card (sandbox-check prints one).
 * The script creates a $0.01 preparation, prints its approval link, and waits for you to
 * approve it on your device. Then it confirms the preparation is "ready", and cancels it.
 *
 * It does NOT check the final payment step. That needs a live checkout page for the same
 * processor, which is a separate test.
 *
 * Reads AGENTCARD_CLIENT_ID, AGENTCARD_CLIENT_SECRET (and AGENTCARD_BASE_URL) from the
 * environment or the repo's .env. Values are never printed.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadEnvFile } from 'node:process';
import { createAgentCardApi, AgentCardError, DEFAULT_BASE_URL } from '../src/index.js';

const ENV_PATH = resolve(process.cwd(), '.env');
if (existsSync(ENV_PATH)) loadEnvFile(ENV_PATH);

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};
const userId = flag('--user', null);
const psp = flag('--psp', 'adyen');
const environment = flag('--environment', 'sandbox');
const waitSeconds = Number(flag('--wait', '600'));

let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}
function describeError(err) {
  if (err instanceof AgentCardError) {
    return `HTTP ${err.status}${err.code ? ` ${err.code}` : ''}: ${err.message}`;
  }
  return err.message;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const clientId = process.env.AGENTCARD_CLIENT_ID?.trim();
const clientSecret = process.env.AGENTCARD_CLIENT_SECRET?.trim();
check('configuration present', Boolean(clientId && clientSecret));
check('an AgentCard user id was given', Boolean(userId), userId ? 'from --user' : 'pass --user usr_...');
if (!clientId || !clientSecret || !userId) {
  console.log(`\n${failures} failed`);
  process.exit(1);
}

const api = createAgentCardApi({
  clientId,
  clientSecret,
  baseUrl: process.env.AGENTCARD_BASE_URL?.trim() || DEFAULT_BASE_URL,
});

// 1. create the preparation
let prep;
try {
  prep = await api.createPreparation({
    user: userId,
    merchant: 'Preparation Check',
    amount: 1,
    currency: 'usd',
    psp,
    mode: 'token',
    environment,
    merchant_origin: 'https://example.com',
    checkout_key: randomUUID(),
  });
  check('preparation created', Boolean(prep?.id), `status ${prep.status}, psp ${psp}, environment ${environment}`);
} catch (err) {
  check('preparation created', false, describeError(err));
  console.log(`\n${failures} failed`);
  process.exit(1);
}

// 2. approval link
check('approval link returned', typeof prep.approvalUrl === 'string' && prep.approvalUrl.startsWith('https://'));
if (prep.approvalUrl) console.log(`\n  approve on your device: ${prep.approvalUrl}\n  waiting up to ${waitSeconds}s for approval...\n`);

// 3. wait for "ready" (or a terminal status)
const deadline = Date.now() + waitSeconds * 1000;
let latest = prep;
let becameReady = false;
while (Date.now() < deadline) {
  try {
    latest = await api.getPreparation(prep.id);
  } catch (err) {
    check('read the preparation', false, describeError(err));
    break;
  }
  if (latest.status === 'ready') { becameReady = true; break; }
  if (['cancelled', 'expired', 'bound'].includes(latest.status)) break;
  await sleep(5000);
}
check('approval makes the preparation ready', becameReady, `last status ${latest?.status ?? 'unknown'}`);
if (becameReady) {
  check('ready window is reported', Boolean(latest.ready_expires_at), latest.ready_expires_at ? 'ready_expires_at present' : 'missing');
}

// 4. cancel (confirms the cancel path, which is not verified yet)
if (latest?.status !== 'bound' && latest?.status !== 'cancelled') {
  try {
    const cancelled = await api.cancelPreparation(prep.id);
    check('cancel the preparation', cancelled?.status === 'cancelled', `status ${cancelled?.status}`);
  } catch (err) {
    check('cancel the preparation', false, describeError(err));
  }
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} check(s) failed`}`);
process.exit(failures === 0 ? 0 : 1);
