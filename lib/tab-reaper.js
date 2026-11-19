/**
 * Finds customer tabs that the billing ledger still counts as open, but that no browser
 * session holds any more. Such a tab was closed without a close report, so billing would
 * keep counting it until the frontend's 24-hour cap. A grace period protects tabs that are
 * still being created.
 */
export function findOrphanTabs({ ledger, liveTabIds, now = Date.now(), graceMs = 60000 }) {
  return ledger.filter((t) => !liveTabIds.has(t.tabId) && now - Date.parse(t.openedAt) > graceMs);
}
