import { jest } from '@jest/globals';
import { createUsageReporter } from '../../lib/usage-events.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const instant = async () => {};

describe('usage event delivery', () => {
  test('every event carries an id and reaches the frontend once', async () => {
    const seen = [];
    const fetchImpl = async (url, init) => {
      seen.push({ url, body: JSON.parse(init.body), secret: init.headers['x-chusky-internal'] });
      return new Response('{}', { status: 200 });
    };
    const r = createUsageReporter({ frontendUrl: 'https://front.example/', secret: 's3cret', fetchImpl, sleep: instant });
    await r.report({ type: 'tab_close', accountId: 'acc', tabId: 't1', closedAt: '2026-11-14T00:00:00.000Z' });
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe('https://front.example/internal/events');
    expect(seen[0].secret).toBe('s3cret');
    expect(typeof seen[0].body.id).toBe('string');
    expect(seen[0].body.tabId).toBe('t1');
    expect(r.stats().delivered).toBe(1);
  });

  test('a failed delivery is retried until it succeeds, with the same event id', async () => {
    const ids = [];
    let calls = 0;
    const fetchImpl = async (_url, init) => {
      ids.push(JSON.parse(init.body).id);
      calls += 1;
      return new Response('', { status: calls < 3 ? 503 : 200 });
    };
    const r = createUsageReporter({ frontendUrl: 'https://front.example', secret: 's', fetchImpl, sleep: instant });
    await r.report({ type: 'usage', accountId: 'acc', kind: 'request' });
    expect(calls).toBe(3);
    expect(new Set(ids).size).toBe(1);
    expect(r.stats()).toMatchObject({ delivered: 1, dropped: 0, pending: 0 });
  });

  test('after the last attempt the event is dropped and counted, never thrown', async () => {
    const fetchImpl = async () => new Response('', { status: 500 });
    const r = createUsageReporter({ frontendUrl: 'https://front.example', secret: 's', fetchImpl, sleep: instant, maxAttempts: 3 });
    await expect(r.report({ type: 'tab_close', accountId: 'acc', tabId: 't2' })).resolves.toBe(true);
    expect(r.stats()).toMatchObject({ delivered: 0, dropped: 1, pending: 0 });
  });

  test('without a frontend address or secret, nothing is sent and nothing throws', async () => {
    const fetchImpl = jest.fn();
    const r = createUsageReporter({ frontendUrl: null, secret: '', fetchImpl, sleep: instant });
    await expect(r.report({ type: 'usage' })).resolves.toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('usage event queue survives a restart', () => {
  test('an undelivered event is saved, then delivered by a new reporter after restart', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-q-'));
    const queueFile = path.join(dir, 'queue.json');
    const down = async () => new Response('', { status: 503 });
    const first = createUsageReporter({ frontendUrl: 'https://front.example', secret: 's', fetchImpl: down, sleep: instant, maxAttempts: 2, queueFile });
    await first.report({ type: 'tab_close', accountId: 'acc', tabId: 't9', closedAt: '2026-11-14T00:00:00.000Z' });
    expect(JSON.parse(fs.readFileSync(queueFile, 'utf8'))).toHaveLength(0);

    const saved = [];
    const up = async (url, init) => { saved.push(JSON.parse(init.body)); return new Response('{}', { status: 200 }); };
    fs.writeFileSync(queueFile, JSON.stringify([{ event: { id: 'evt-1', at: '2026-11-14T00:00:00.000Z', type: 'tab_close', accountId: 'acc', tabId: 't9' }, attempts: 1 }]));
    const second = createUsageReporter({ frontendUrl: 'https://front.example', secret: 's', fetchImpl: up, sleep: instant, queueFile });
    expect(second.stats().restored).toBe(1);
    await second.resume();
    expect(saved.map((e) => e.id)).toEqual(['evt-1']);
    expect(JSON.parse(fs.readFileSync(queueFile, 'utf8'))).toHaveLength(0);
  });
});
