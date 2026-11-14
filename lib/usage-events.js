/**
 * Reliable delivery of usage events to the frontend (where minutes are recorded and billed later).
 *
 * Each event gets an id, so a retry can never count twice on the receiving side. A failed delivery
 * is retried with backoff. After the last attempt the event is dropped and counted, so the loss is visible.
 * The queue is kept in memory and, when queueFile is set, also written to that file after every change,
 * so events not yet delivered survive a restart and are sent again when the server starts.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function createUsageReporter({
  frontendUrl,
  secret,
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  maxAttempts = 6,
  baseDelayMs = 1000,
  timeoutMs = 5000,
  queueFile = null,
  log = () => {},
} = {}) {
  const base = frontendUrl ? String(frontendUrl).replace(/\/+$/, '') : null;
  const stats = { delivered: 0, dropped: 0, pending: 0, restored: 0 };
  const queue = [];
  let draining = null;

  function persist() {
    if (!queueFile) return;
    try {
      mkdirSync(dirname(queueFile), { recursive: true });
      const tmp = `${queueFile}.tmp`;
      writeFileSync(tmp, JSON.stringify(queue));
      renameSync(tmp, queueFile);
    } catch (err) {
      log('error', 'usage queue could not be saved', { error: err.message });
    }
  }

  function restore() {
    if (!queueFile) return;
    try {
      const saved = JSON.parse(readFileSync(queueFile, 'utf8'));
      if (Array.isArray(saved)) {
        for (const item of saved) if (item && item.event && item.event.id) queue.push({ event: item.event, attempts: Number(item.attempts) || 0 });
      }
    } catch (err) {
      if (err.code !== 'ENOENT') log('error', 'usage queue could not be read', { error: err.message });
    }
    stats.restored = queue.length;
    stats.pending = queue.length;
  }

  async function send(event) {
    const res = await fetchImpl(`${base}/internal/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-chusky-internal': secret },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`frontend answered ${res.status}`);
  }

  async function drain() {
    while (queue.length) {
      const item = queue[0];
      try {
        await send(item.event);
        queue.shift();
        stats.delivered += 1;
        persist();
      } catch (err) {
        item.attempts += 1;
        if (item.attempts >= maxAttempts) {
          queue.shift();
          stats.dropped += 1;
          log('error', 'usage event dropped after retries', { eventId: item.event.id, type: item.event.type, error: err.message });
          persist();
        } else {
          persist();
          await sleep(baseDelayMs * 2 ** (item.attempts - 1));
        }
      }
      stats.pending = queue.length;
    }
  }

  restore();

  return {
    /** Queue an event and start delivering. Resolves when the queue is empty. Never throws. */
    report(fields) {
      if (!base || !secret) return Promise.resolve(false);
      queue.push({ event: { id: randomUUID(), at: new Date(now()).toISOString(), ...fields }, attempts: 0 });
      stats.pending = queue.length;
      persist();
      draining ??= drain().finally(() => { draining = null; });
      return draining.then(() => true);
    },
    /** Resume events saved before a restart. Safe to call once at startup. */
    resume() {
      if (!base || !secret || queue.length === 0) return Promise.resolve(false);
      draining ??= drain().finally(() => { draining = null; });
      return draining.then(() => true);
    },
    stats: () => ({ ...stats }),
  };

}
