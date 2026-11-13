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

// Print what AgentCard reports about a preparation that did not become ready, without secrets.
const SECRET_KEY = /secret|token|password|card_number|pan|cvv|authorization|key/i;
function printWhyStopped(created, latest) {
  const elapsed = latest?.updated_at && created?.created_at
    ? `${Math.round((Date.parse(latest.updated_at) - Date.parse(created.created_at)) / 1000)}s after creation`
    : 'time not reported';
  console.log(`\n  why it stopped (${elapsed}):`);
  for (const [key, value] of Object.entries(latest ?? {})) {
    if (key === 'approvalUrl' || SECRET_KEY.test(key)) continue;
    const shown = typeof value === 'object' && value !== null ? JSON.stringify(value).slice(0, 300) : String(value);
    console.log(`    ${key}: ${shown}`);
  }
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

// 3. wait for "ready" (or a terminal status). Poll every 1.5 seconds, the most the API allows,
// and record every status change, so a fast ready-then-cancelled sequence is still visible.
const deadline = Date.now() + waitSeconds * 1000;
let latest = prep;
let becameReady = false;
const timeline = [];
let lastStatus = null;
while (Date.now() < deadline) {
  try {
    latest = await api.getPreparation(prep.id);
  } catch (err) {
    check('read the preparation', false, describeError(err));
    break;
  }
  if (latest.status !== lastStatus) {
    timeline.push(`${new Date().toISOString()}  ${latest.status}`);
    lastStatus = latest.status;
  }
  // Only a real "ready" status passes. ready_expires_at can also appear on a cancelled preparation, so it is not proof.
  if (latest.status === 'ready') { becameReady = true; break; }
  if (['cancelled', 'expired', 'bound'].includes(latest.status)) break;
  await sleep(1500);
}
if (timeline.length) console.log(`\n  status timeline:\n${timeline.map((t) => `    ${t}`).join('\n')}`);
check('approval makes the preparation ready', becameReady, `last status ${latest?.status ?? 'unknown'}`);
if (!becameReady) printWhyStopped(prep, latest);
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
