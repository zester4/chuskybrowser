/**
 * Remembers which customer tabs are open, on disk, so a restart can still bill them.
 *
 * A restart clears the browser and the in-memory tab records. A tab open at that moment
 * would otherwise never get a close event and would be billed until the frontend's cap.
 * This ledger is written on every open and close. On startup, whatever is left in it
 * was open when the server stopped, and the caller closes those tabs in billing.
 *
 * Only customer tabs are recorded (userId "accountId:endUserId"). When filePath is null,
 * the ledger stays in memory and nothing is saved.
 */
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function createOpenTabLedger({ filePath = null, log = () => {} } = {}) {
  const tabs = new Map(); // tabId -> { userId, openedAt }

  function persist() {
    if (!filePath) return;
    try {
      mkdirSync(dirname(filePath), { recursive: true });
      const tmp = `${filePath}.tmp`;
      const rows = [...tabs.entries()].map(([tabId, v]) => ({ tabId, ...v }));
      writeFileSync(tmp, JSON.stringify(rows));
      renameSync(tmp, filePath);
    } catch (err) {
      log('error', 'open tab ledger could not be saved', { error: err.message });
    }
  }

  function readSaved() {
    if (!filePath) return [];
    try {
      const saved = JSON.parse(readFileSync(filePath, 'utf8'));
      return Array.isArray(saved) ? saved.filter((t) => t && typeof t.tabId === 'string' && typeof t.userId === 'string') : [];
    } catch (err) {
      if (err.code !== 'ENOENT') log('error', 'open tab ledger could not be read', { error: err.message });
      return [];
    }
  }

  return {
    /** A customer tab was opened. */
    open(tabId, userId) {
      tabs.set(tabId, { userId, openedAt: new Date().toISOString() });
      persist();
    },
    /** A tab closed normally, or was destroyed by the server. */
    close(tabId) {
      if (tabs.delete(tabId)) persist();
    },
    /**
     * Call once at startup, before any tab is opened. Returns the tabs that were open
     * when the server last stopped, and clears the saved list.
     */
    takeLeftovers() {
      const leftovers = readSaved();
      tabs.clear();
      persist();
      return leftovers;
    },
    size: () => tabs.size,
    /** Every tab the ledger still counts as open: [{ tabId, userId, openedAt }]. */
    entries: () => [...tabs.entries()].map(([tabId, v]) => ({ tabId, ...v })),
  };
}
