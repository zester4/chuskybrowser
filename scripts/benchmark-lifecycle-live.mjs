/**
 * Lifecycle benchmark through the customer gateway, scored like ComputeSDK's browser benchmark.
 *
 * Usage (set these in the environment or .env, never in chat):
 *   CHUSKY_GATEWAY_URL=https://<your gateway>
 *   CHUSKY_TEST_CUSTOMER_KEY=cb_live_...   a key on a test account
 *   node scripts/benchmark-lifecycle-live.mjs
 *   (optional: BENCH_ITERATIONS=100, BENCH_URL=https://example.com)
 *
 * Each iteration runs three phases on one tab:
 *   create    POST /v1/tabs with no URL
 *   navigate  POST /v1/tabs/:id/navigate to BENCH_URL
 *   release   DELETE /v1/tabs/:id
 *
 * ComputeSDK's benchmark also has a "connect" phase over CDP. Our API is HTTP, so there is
 * no connect phase here. Their total includes connect, so our totals run slightly lower.
 *
 * Scoring (the same formula ComputeSDK publishes):
 *   each latency scores 100 * (1 - ms / 10000), with a 10-second ceiling
 *   composite = (0.40 * score(total median) + 0.30 * score(create median)
 *               + 0.20 * score(total P95) + 0.10 * score(total P99)) * success rate
 *
 * Every iteration closes its tab, even when a phase fails, so the test does not leave tabs open.
 */
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnvFile } from 'node:process';

const envPath = resolve(process.cwd(), '.env');
if (existsSync(envPath)) loadEnvFile(envPath);

const GATEWAY = (process.env.CHUSKY_GATEWAY_URL || '').trim().replace(/\/+$/, '');
const KEY = (process.env.CHUSKY_TEST_CUSTOMER_KEY || '').trim();
const ITERATIONS = Number(process.env.BENCH_ITERATIONS) || 100;
const TARGET = (process.env.BENCH_URL || 'https://example.com').trim();

if (!GATEWAY || !KEY) {
  console.error('Set CHUSKY_GATEWAY_URL and CHUSKY_TEST_CUSTOMER_KEY (in .env or the environment).');
  process.exit(1);
}

async function call(path, { method = 'GET', body } = {}) {
  const started = performance.now();
  try {
    const res = await fetch(`${GATEWAY}${path}`, {
      method,
      headers: { Authorization: `Bearer ${KEY}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(120_000),
    });
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    return { ok: res.ok, status: res.status, data, ms: performance.now() - started };
  } catch (err) {
    return { ok: false, status: 0, data: null, ms: performance.now() - started, error: err.message };
  }
}

// Nearest-rank percentile on a sorted array.
function percentile(sorted, p) {
  if (!sorted.length) return NaN;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

const latencyScore = (ms) => 100 * (1 - Math.min(ms, 10000) / 10000);
const median = (arr) => percentile(arr, 50);

const runId = randomUUID().slice(0, 8);
const userId = `bench-${runId}`;
const sessionKey = `bench-${runId}`;

const create = [];
const navigate = [];
const release = [];
const total = [];
let successes = 0;
const failures = [];

for (let i = 1; i <= ITERATIONS; i++) {
  const started = performance.now();
  const c = await call('/v1/tabs', { method: 'POST', body: { userId, sessionKey } });
  const tabId = c.data?.tabId;
  let ok = c.ok && !!tabId;
  let nav = { ok: false, ms: 0 };
  let rel = { ok: false, ms: 0 };

  if (ok) {
    nav = await call(`/v1/tabs/${encodeURIComponent(tabId)}/navigate`, { method: 'POST', body: { userId, url: TARGET } });
    ok = nav.ok;
  }

  if (tabId) {
    rel = await call(`/v1/tabs/${encodeURIComponent(tabId)}?userId=${encodeURIComponent(userId)}`, { method: 'DELETE' });
    ok = ok && rel.ok;
  }

  const elapsed = performance.now() - started;
  create.push(c.ms);
  navigate.push(nav.ms);
  release.push(rel.ms);
  total.push(elapsed);
  if (ok) successes++;
  else failures.push({ iteration: i, create: c.status, navigate: nav.status, release: rel.status, error: c.error || nav.error || rel.error || null });

  if (i % 10 === 0 || i === ITERATIONS) console.log(`  ${i}/${ITERATIONS} done, ${successes} succeeded so far`);
}

const sorted = (arr) => [...arr].sort((a, b) => a - b);
const stats = (arr) => {
  const s = sorted(arr);
  return { median: median(s), p95: percentile(s, 95), p99: percentile(s, 99) };
};

const totalStats = stats(total);
const createStats = stats(create);
const navStats = stats(navigate);
const relStats = stats(release);
const successRate = successes / ITERATIONS;

const composite = (0.4 * latencyScore(totalStats.median)
  + 0.3 * latencyScore(createStats.median)
  + 0.2 * latencyScore(totalStats.p95)
  + 0.1 * latencyScore(totalStats.p99)) * successRate;

const ms = (v) => `${(v / 1000).toFixed(2)} s`;

console.log('');
console.log(`Lifecycle benchmark, ${ITERATIONS} iterations, target ${TARGET}`);
console.log(`Success: ${successes}/${ITERATIONS} (${(successRate * 100).toFixed(1)}%)`);
console.log('');
console.log('Phase      median    P95       P99');
console.log(`create     ${ms(createStats.median).padEnd(9)} ${ms(createStats.p95).padEnd(9)} ${ms(createStats.p99)}`);
console.log(`navigate   ${ms(navStats.median).padEnd(9)} ${ms(navStats.p95).padEnd(9)} ${ms(navStats.p99)}`);
console.log(`release    ${ms(relStats.median).padEnd(9)} ${ms(relStats.p95).padEnd(9)} ${ms(relStats.p99)}`);
console.log(`total      ${ms(totalStats.median).padEnd(9)} ${ms(totalStats.p95).padEnd(9)} ${ms(totalStats.p99)}`);
console.log('');
console.log(`Composite score: ${composite.toFixed(1)} (ComputeSDK's Tilion scores 99.0, Kernel 97.3, Notte 86.5)`);
console.log('ComputeSDK has no connect phase in our run, so compare the composite with care.');

if (failures.length) {
  console.log('');
  console.log(`First failures (${failures.length} total):`);
  for (const f of failures.slice(0, 5)) console.log(`  iteration ${f.iteration}: create ${f.create}, navigate ${f.navigate}, release ${f.release}${f.error ? `, ${f.error}` : ''}`);
}
