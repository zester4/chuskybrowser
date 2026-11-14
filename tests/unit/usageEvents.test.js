import { jest } from '@jest/globals';
import { createUsageReporter } from '../../lib/usage-events.js';

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
