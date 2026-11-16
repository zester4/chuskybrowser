// Replay links for recorded traces.
//
// A replay link lets a person open a trace in the Playwright trace viewer without
// sending the access key in the browser. The link carries a signed token that names
// one user, one trace file and an expiry time. The token is an HMAC over those fields.
import crypto from 'crypto';
import path from 'path';
import { createRequire } from 'module';

const DEFAULT_TTL_MS = 15 * 60 * 1000;
const MAX_TTL_MS = 60 * 60 * 1000;

// Signing key: derived from the configured API key when there is one, otherwise random
// for this process. Random means links stop working after a restart, which is the safe default.
export function makeReplaySecret(apiKey) {
  if (apiKey) return crypto.createHash('sha256').update(`replay:${apiKey}`).digest();
  return crypto.randomBytes(32);
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

export function signReplayToken(secret, { userId, filename, expiresAt }) {
  const payload = b64url(JSON.stringify({ u: String(userId), f: filename, e: expiresAt }));
  const sig = b64url(crypto.createHmac('sha256', secret).update(payload).digest());
  return `${payload}.${sig}`;
}

// Returns { userId, filename } when valid and unexpired, otherwise null.
export function verifyReplayToken(secret, token, now = Date.now()) {
  if (typeof token !== 'string' || token.length > 2048) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const expected = b64url(crypto.createHmac('sha256', secret).update(payload).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let data;
  try {
    data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!data || typeof data.u !== 'string' || typeof data.f !== 'string' || typeof data.e !== 'number') return null;
  if (now > data.e) return null;
  return { userId: data.u, filename: data.f };
}

export function replayTtlMs(requested) {
  const n = Number(requested);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_TTL_MS;
  return Math.min(n, MAX_TTL_MS);
}

// Directory of the Playwright trace viewer bundled with playwright-core.
export function traceViewerDir() {
  const require = createRequire(import.meta.url);
  const pkgJson = require.resolve('playwright-core/package.json');
  return path.join(path.dirname(pkgJson), 'lib', 'vite', 'traceViewer');
}
