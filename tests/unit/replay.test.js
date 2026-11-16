import { describe, it, expect } from '@jest/globals';
import fs from 'fs';
import { makeReplaySecret, signReplayToken, verifyReplayToken, replayTtlMs, traceViewerDir } from '../../lib/replay.js';

describe('replay tokens', () => {
  const secret = makeReplaySecret('test-key');
  const future = Date.now() + 60_000;

  it('verifies a fresh token and returns the claim', () => {
    const t = signReplayToken(secret, { userId: 'u1', filename: 'trace-a.zip', expiresAt: future });
    expect(verifyReplayToken(secret, t)).toEqual({ userId: 'u1', filename: 'trace-a.zip' });
  });

  it('rejects a token signed with another secret', () => {
    const other = makeReplaySecret('other-key');
    const t = signReplayToken(other, { userId: 'u1', filename: 'trace-a.zip', expiresAt: future });
    expect(verifyReplayToken(secret, t)).toBeNull();
  });

  it('rejects a tampered payload', () => {
    const t = signReplayToken(secret, { userId: 'u1', filename: 'trace-a.zip', expiresAt: future });
    const [, sig] = t.split('.');
    const forged = Buffer.from(JSON.stringify({ u: 'someone-else', f: 'trace-a.zip', e: future })).toString('base64url');
    expect(verifyReplayToken(secret, `${forged}.${sig}`)).toBeNull();
  });

  it('rejects an expired token', () => {
    const t = signReplayToken(secret, { userId: 'u1', filename: 'trace-a.zip', expiresAt: Date.now() - 1 });
    expect(verifyReplayToken(secret, t)).toBeNull();
  });

  it('rejects malformed input', () => {
    expect(verifyReplayToken(secret, undefined)).toBeNull();
    expect(verifyReplayToken(secret, 'no-dot-here')).toBeNull();
    expect(verifyReplayToken(secret, 'a.b.c')).toBeNull();
  });

  it('caps the requested lifetime at one hour and defaults to 15 minutes', () => {
    expect(replayTtlMs(undefined)).toBe(15 * 60 * 1000);
    expect(replayTtlMs(-5)).toBe(15 * 60 * 1000);
    expect(replayTtlMs(10 * 60 * 60 * 1000)).toBe(60 * 60 * 1000);
    expect(replayTtlMs(120_000)).toBe(120_000);
  });

  it('finds the bundled Playwright trace viewer', () => {
    expect(fs.existsSync(`${traceViewerDir()}/index.html`)).toBe(true);
  });
});
