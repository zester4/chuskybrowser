/**
 * Diagnostic: which CreepJS sub-checks produce the "% like headless" score.
 *
 * Usage (needs a running server, CHUSKY_BASE_URL and CHUSKY_ACCESS_KEY in .env):
 *   node scripts/diagnose-creepjs.mjs
 *   node scripts/diagnose-creepjs.mjs --runs 2
 *
 * It opens CreepJS, waits for the scores to settle, and saves two files per run
 * to bench-results/ (git-ignored):
 *   creepjs-diag-<ts>-run<n>.txt       the full visible page text
 *   creepjs-diag-<ts>-run<n>-headless.txt  only the Headless section, with the
 *                                      lines that carry a score or a true/false
 * It prints the Headless section so the sub-check lines can be read directly.
 *
 * Nothing is changed on CreepJS and no threshold is set here. This script only reads.
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { call } from './lib-env.mjs';

const URL_TO_TEST = 'https://abrahamjuliot.github.io/creepjs/';
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};
const runs = Math.max(1, parseInt(flag('--runs', '1'), 10));
const settleMs = Math.max(5000, parseInt(flag('--settle-ms', '20000'), 10));

// Full visible text, so the Headless section can be cut out on this side.
const READ_TEXT = `(() => (document.body && document.body.innerText) || '')()`;

// The section heading is "Headless" followed by a hash (for example "Headlessacd47299").
// The next heading in the page order is "Resistance".
function headlessSection(text) {
  const start = text.search(/^Headless[0-9a-f]{6,}$/m);
  if (start < 0) return { found: false, section: '' };
  const rest = text.slice(start);
  const end = rest.search(/^Resistance[0-9a-f]{6,}$/m);
  return { found: true, section: end > 0 ? rest.slice(0, end) : rest.slice(0, 1500) };
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = resolve('bench-results');
mkdirSync(outDir, { recursive: true });

for (let run = 1; run <= runs; run += 1) {
  const userId = `diag-${randomUUID()}`;
  let tabId = null;
  try {
    const opened = await call('/tabs', { method: 'POST', body: { userId, sessionKey: `s-${randomUUID()}`, url: URL_TO_TEST }, timeoutMs: 90_000 });
    tabId = opened.data?.tabId ?? null;
    if (!tabId) { console.log(`run ${run}: could not open tab (HTTP ${opened.status})`); continue; }
    await new Promise((r) => setTimeout(r, settleMs));
    const ev = await call(`/tabs/${tabId}/evaluate`, { method: 'POST', body: { userId, expression: READ_TEXT } });
    const text = typeof ev.data?.result === 'string' ? ev.data.result : '';
    if (!text) { console.log(`run ${run}: no page text (evaluate HTTP ${ev.status})`); continue; }

    const { found, section } = headlessSection(text);
    const base = `creepjs-diag-${stamp}-run${run}`;
    writeFileSync(resolve(outDir, `${base}.txt`), text);
    writeFileSync(resolve(outDir, `${base}-headless.txt`), section);

    const score = text.match(/(\d+)% like headless/);
    console.log(`\n=== run ${run}: "% like headless" = ${score ? score[1] + '%' : 'not found'} (Headless section ${found ? 'found' : 'NOT found'}) ===`);
    console.log(section.split('\n').filter((l) => l.trim()).join('\n'));
    console.log(`saved: ${resolve(outDir, base + '.txt')}`);
    console.log(`saved: ${resolve(outDir, base + '-headless.txt')}`);
  } catch (err) {
    console.log(`run ${run}: ${err.message}`);
  } finally {
    if (tabId) await call(`/tabs/${tabId}?userId=${encodeURIComponent(userId)}`, { method: 'DELETE' });
    await call(`/sessions/${encodeURIComponent(userId)}`, { method: 'DELETE' });
  }
}
