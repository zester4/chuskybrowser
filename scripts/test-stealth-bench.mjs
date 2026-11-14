/**
 * Stealth benchmark against a running Chusky server.
 *
 * Usage:
 *   node scripts/test-stealth-bench.mjs                     (default targets, 3 runs each)
 *   node scripts/test-stealth-bench.mjs --runs 5 --label direct
 *   node scripts/test-stealth-bench.mjs --targets my-targets.json
 *
 * Run it once before any stealth change, and again after. Run it once with no
 * proxy and once with the proxy set on the server, then compare the two result
 * files. Results go to bench-results/ (git-ignored).
 *
 * The default targets are PROPOSED ONLY. Plan decision P1 asks you to approve
 * the list. Replace them with --targets before relying on the numbers.
 *
 * For each target and run it records:
 *   - whether the page loaded, and the page-state kind (ok, captcha, block, ...)
 *   - a fingerprint probe: navigator.webdriver, platform, timezone, languages,
 *     WebGL renderer. Software renderers (SwiftShader, llvmpipe) are flagged.
 *   - time to first state.
 *   - CreepJS: the "% like headless" score (must be at most --max-headless, default 10).
 *   - the page has real content (at least minText characters, default 200).
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { call, makeReporter } from './lib-env.mjs';

const DEFAULT_TARGETS = [
  // PROPOSED, pending approval (plan decision P1).
  { id: 'sannysoft', url: 'https://bot.sannysoft.com/' },
  { id: 'creepjs', url: 'https://abrahamjuliot.github.io/creepjs/' },
  { id: 'bestbuy', url: 'https://www.bestbuy.com/' },
];

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};
const runs = Math.max(1, parseInt(flag('--runs', '3'), 10));
const label = flag('--label', 'run');
const targetsFile = flag('--targets', null);
let targets = DEFAULT_TARGETS;
if (targetsFile) {
  const { readFileSync } = await import('node:fs');
  targets = JSON.parse(readFileSync(resolve(targetsFile), 'utf8'));
}

// Read only what a fingerprint check needs. Nothing is typed or submitted.
const PROBE = `(() => {
  let webgl = null;
  try {
    const g = document.createElement('canvas').getContext('webgl');
    const d = g && g.getExtension('WEBGL_debug_renderer_info');
    if (d) webgl = g.getParameter(d.UNMASKED_RENDERER_WEBGL);
  } catch (e) {}
  const full = (document.body && document.body.innerText) || '';
  const hp = full.match(/(\\d+)% like headless/);
  return JSON.stringify({
    headlessPct: hp ? Number(hp[1]) : null,
    webdriver: navigator.webdriver ?? null,
    platform: navigator.platform,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    languages: navigator.languages,
    webglRenderer: webgl,
    hardwareConcurrency: navigator.hardwareConcurrency,
    bodyText: document.body ? document.body.innerText.slice(0, 1200) : '',
  });
})()`;

const maxHeadless = Math.max(0, parseInt(flag('--max-headless', '10'), 10));
const SOFTWARE_RENDERERS = /swiftshader|llvmpipe|software/i;
const BLOCKED_TEXT = /access denied|verify you are human|checking your browser|unusual traffic|are you a robot|just a moment|additional verification required|troubleshooting cloudflare|attention required|ray id for this request/i;
const BLOCKED_TITLE = /just a moment|attention required|access denied|forbidden/i;
const report = makeReporter();
const results = [];

async function runOnce(target) {
  const userId = `bench-${randomUUID()}`;
  let tabId = null;
  const started = Date.now();
  try {
    const opened = await call('/tabs', { method: 'POST', body: { userId, sessionKey: `s-${randomUUID()}`, url: target.url }, timeoutMs: 90_000 });
    tabId = opened.data?.tabId ?? null;
    if (!tabId) return { target: target.id, loaded: false, error: `open HTTP ${opened.status}` };
    await new Promise((r) => setTimeout(r, 5000));
    const state = await call(`/tabs/${tabId}/state?userId=${encodeURIComponent(userId)}`);
    const elapsedMs = Date.now() - started;
    const kind = state.data?.state?.kind ?? 'unknown';
    let probe = null;
    const ev = await call(`/tabs/${tabId}/evaluate`, { method: 'POST', body: { userId, expression: PROBE } });
    if (typeof ev.data?.result === 'string') {
      try { probe = JSON.parse(ev.data.result); } catch { probe = null; }
    }
    const softwareGpu = !!(probe?.webglRenderer && SOFTWARE_RENDERERS.test(probe.webglRenderer));
    return {
      headlessPct: probe?.headlessPct ?? null,
      textLength: (probe?.bodyText ?? '').trim().length,
      target: target.id,
      loaded: state.status === 200,
      error: state.status === 200 ? undefined : `state HTTP ${state.status}: ${state.data?.error ?? 'no detail'}`,
      kind,
      title: state.data?.title ?? '',
      elapsedMs,
      probe,
      softwareGpu,
      webdriverExposed: probe?.webdriver === true,
      visibleText: probe?.bodyText ?? '',
    };
  } catch (err) {
    return { target: target.id, loaded: false, error: err.message };
  } finally {
    if (tabId) await call(`/tabs/${tabId}?userId=${encodeURIComponent(userId)}`, { method: 'DELETE' });
    await call(`/sessions/${encodeURIComponent(userId)}`, { method: 'DELETE' });
  }
}

for (const target of targets) {
  for (let i = 1; i <= runs; i += 1) {
    const r = await runOnce(target);
    results.push({ ...r, run: i });
    let detail = r.error
      ? r.error
      : `kind=${r.kind}, ${r.elapsedMs}ms${r.softwareGpu ? ', software GPU' : ''}${r.webdriverExposed ? ', webdriver exposed' : ''}`;
    const blockedText = BLOCKED_TEXT.test(r.visibleText ?? '') || BLOCKED_TITLE.test(r.title ?? '');
    if (blockedText) detail += ', block text on page';
    // Real content, not an empty shell or a challenge page. Each target can set its own minimum (minText).
    const hasContent = (r.textLength ?? 0) >= (target.minText ?? 200);
    if (!hasContent && r.loaded) detail += `, only ${r.textLength ?? 0} chars of content`;
    // CreepJS reports how much of its fingerprint looks like headless Firefox. Lower is better.
    const isCreep = target.id === 'creepjs';
    const headlessOk = !isCreep || (r.headlessPct !== null && r.headlessPct <= maxHeadless);
    if (isCreep) detail += `, headless ${r.headlessPct ?? 'not found'}% (max ${maxHeadless}%)`;
    report.check(`${target.id} run ${i}`, !!r.loaded && r.kind === 'ok' && !blockedText && !r.softwareGpu && !r.webdriverExposed && hasContent && headlessOk, detail);
  }
}

const outDir = resolve('bench-results');
mkdirSync(outDir, { recursive: true });
const outFile = resolve(outDir, `${label}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
writeFileSync(outFile, JSON.stringify({ label, runs, results }, null, 2));
console.log(`\nResults written to ${outFile}`);
report.finish();
