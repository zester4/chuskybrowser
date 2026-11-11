// In-memory store with the same methods the Supabase store must provide.
// Use it for tests and local runs. Swap in a Supabase-backed store for production.

export function createMemoryStore() {
  const keys = new Map();
  const tabs = new Map();
  const usage = [];

  const dayStart = () => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d.getTime(); };

  return {
    async insertKey(row) { keys.set(row.id, { ...row }); },
    async findKeyByHash(hash) { return [...keys.values()].find((k) => k.keyHash === hash) || null; },
    async touchKey(id) { const k = keys.get(id); if (k) k.lastUsedAt = new Date().toISOString(); },
    async listKeys(accountId) { return [...keys.values()].filter((k) => k.accountId === accountId); },
    async revokeKey(accountId, id) {
      const k = keys.get(id);
      if (!k || k.accountId !== accountId) return false;
      k.revokedAt = new Date().toISOString();
      return true;
    },
    async recordTab(row) { tabs.set(row.tabId, { ...row, closedAt: null }); },
    async markTabClosed(accountId, tabId, closedAt) {
      const t = tabs.get(tabId);
      if (t && t.accountId === accountId) t.closedAt = closedAt;
    },
    // Which account opened this tab, or null. The gateway checks this before any tab call.
    async tabOwner(tabId) { return tabs.get(tabId)?.accountId ?? null; },
    async listOpenTabs(accountId) {
      return [...tabs.values()].filter((t) => t.accountId === accountId && !t.closedAt);
    },
    async recordUsage(accountId, kind) { usage.push({ accountId, kind, at: Date.now() }); },
    async countUsageToday(accountId) {
      const start = dayStart();
      return usage.filter((u) => u.accountId === accountId && u.at >= start).length;
    },
  };
}
