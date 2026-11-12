// Remote store: customer keys live in the frontend (Supabase). This server asks the frontend
// to check each key, so customers only need their key and the built-in address.
// Tabs stay here for ownership checks. Tab and usage events are also sent to the frontend
// so its dashboard can show them. Every call to the frontend is server-to-server, with a secret.
import { createMemoryStore } from './store.js';

const KEY_CHECK_PATH = '/internal/keys/verify';
const EVENT_PATH = '/internal/events';

export function createRemoteStore({ frontendUrl, secret, fetchImpl = globalThis.fetch, cacheMs = 30_000, timeoutMs = 5_000 }) {
  if (!frontendUrl || !secret) throw new Error('The remote store needs CHUSKY_FRONTEND_URL and CHUSKY_INTERNAL_SECRET.');
  const base = frontendUrl.replace(/\/+$/, '');
  const local = createMemoryStore();
  const cache = new Map(); // keyHash -> { at, row }

  async function call(path, body) {
    const res = await fetchImpl(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-chusky-internal': secret },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`frontend ${path} answered ${res.status}`);
    return res.json();
  }

  // Events are best-effort: a failed report must never fail a customer's call.
  function report(body) {
    call(EVENT_PATH, body).catch((err) => console.error(`[remote-store] event not sent: ${err.message}`));
  }

  return {
    ...local,

    // Throws when the frontend cannot be reached. The gateway then refuses the call, so nothing is let through unchecked.
    async findKeyByHash(hash) {
      const hit = cache.get(hash);
      if (hit && Date.now() - hit.at < cacheMs) return hit.row;
      const data = await call(KEY_CHECK_PATH, { keyHash: hash });
      const row = data ? { id: data.id, accountId: data.accountId, revokedAt: data.revokedAt ?? null, keyHash: hash } : null;
      cache.set(hash, { at: Date.now(), row });
      return row;
    },
    async touchKey() {},

    // Keys are created and revoked in the frontend only.
    async insertKey() { throw new Error('Keys are created in the frontend, not on this server.'); },
    async listKeys() { throw new Error('Keys are listed in the frontend, not on this server.'); },
    async revokeKey() { throw new Error('Keys are revoked in the frontend, not on this server.'); },

    async recordTab(row) {
      await local.recordTab(row);
      report({ type: 'tab_open', accountId: row.accountId, endUserId: row.endUserId ?? 'unknown', tabId: row.tabId, url: row.url, openedAt: row.openedAt });
    },
    async markTabClosed(accountId, tabId, closedAt) {
      await local.markTabClosed(accountId, tabId, closedAt);
      report({ type: 'tab_close', accountId, tabId, closedAt });
    },
    async recordUsage(accountId, kind) {
      await local.recordUsage(accountId, kind);
      report({ type: 'usage', accountId, kind });
    },
  };
}
