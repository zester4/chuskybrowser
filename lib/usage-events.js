/**
 * Reliable delivery of usage events to the frontend (where minutes are recorded and billed later).
 *
 * Each event gets an id, so a retry can never count twice on the receiving side. A failed delivery
 * is retried with backoff. After the last attempt the event is dropped and counted, so the loss is visible.
 * Events are kept in memory: a restart loses the queue, which the counters report as dropped.
 */
import { randomUUID } from 'node:crypto';

export function createUsageReporter({
  frontendUrl,
  secret,
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  maxAttempts = 6,
  baseDelayMs = 1000,
  timeoutMs = 5000,
  log = () => {},
} = {}) {
  const base = frontendUrl ? String(frontendUrl).replace(/\/+$/, '') : null;
  const stats = { delivered: 0, dropped: 0, pending: 0 };
  const queue = [];
  let draining = null;

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
      } catch (err) {
        item.attempts += 1;
        if (item.attempts >= maxAttempts) {
          queue.shift();
          stats.dropped += 1;
          log('error', 'usage event dropped after retries', { eventId: item.event.id, type: item.event.type, error: err.message });
        } else {
          await sleep(baseDelayMs * 2 ** (item.attempts - 1));
        }
      }
      stats.pending = queue.length;
    }
  }

  return {
    /** Queue an event and start delivering. Resolves when the queue is empty. Never throws. */
    report(fields) {
      if (!base || !secret) return Promise.resolve(false);
      queue.push({ event: { id: randomUUID(), at: new Date(now()).toISOString(), ...fields }, attempts: 0 });
      stats.pending = queue.length;
      draining ??= drain().finally(() => { draining = null; });
      return draining.then(() => true);
    },
    stats: () => ({ ...stats }),
  };
}
