import { describe, it, expect } from '@jest/globals';
import { findOrphanTabs } from '../../lib/tab-reaper.js';

const NOW = Date.parse('2026-11-19T01:00:00Z');
const ago = (ms) => new Date(NOW - ms).toISOString();

describe('findOrphanTabs', () => {
  it('returns a ledger tab that no session holds, once past the grace period', () => {
    const ledger = [{ tabId: 't1', userId: 'a:alice', openedAt: ago(5 * 60000) }];
    expect(findOrphanTabs({ ledger, liveTabIds: new Set(), now: NOW })).toEqual(ledger);
  });

  it('keeps a tab that a session still holds', () => {
    const ledger = [{ tabId: 't1', userId: 'a:alice', openedAt: ago(5 * 60000) }];
    expect(findOrphanTabs({ ledger, liveTabIds: new Set(['t1']), now: NOW })).toEqual([]);
  });

  it('leaves a tab alone during the grace period', () => {
    const ledger = [{ tabId: 't1', userId: 'a:alice', openedAt: ago(10000) }];
    expect(findOrphanTabs({ ledger, liveTabIds: new Set(), now: NOW, graceMs: 60000 })).toEqual([]);
  });

  it('ignores an entry with a bad open time', () => {
    const ledger = [{ tabId: 't1', userId: 'a:alice', openedAt: 'not a date' }];
    expect(findOrphanTabs({ ledger, liveTabIds: new Set(), now: NOW })).toEqual([]);
  });
});
