import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOpenTabLedger } from '../../lib/open-tabs.js';

describe('open tab ledger', () => {
  test('keeps open tabs on disk and returns them as leftovers after a restart', () => {
    const dir = mkdtempSync(join(tmpdir(), 'open-tabs-'));
    const file = join(dir, 'open-tabs.json');
    const first = createOpenTabLedger({ filePath: file });
    first.open('t1', 'acc:alice');
    first.open('t2', 'acc:bob');
    first.close('t1');

    // A new process reads what the old one left behind.
    const second = createOpenTabLedger({ filePath: file });
    const leftovers = second.takeLeftovers();
    expect(leftovers.map((t) => t.tabId)).toEqual(['t2']);
    expect(leftovers[0].userId).toBe('acc:bob');
  });

  test('takeLeftovers clears the saved list so a tab is closed only once', () => {
    const dir = mkdtempSync(join(tmpdir(), 'open-tabs-'));
    const file = join(dir, 'open-tabs.json');
    const ledger = createOpenTabLedger({ filePath: file });
    ledger.open('t9', 'acc:carol');
    expect(createOpenTabLedger({ filePath: file }).takeLeftovers()).toHaveLength(1);
    expect(createOpenTabLedger({ filePath: file }).takeLeftovers()).toHaveLength(0);
  });

  test('ignores a damaged file and starts empty', () => {
    const dir = mkdtempSync(join(tmpdir(), 'open-tabs-'));
    const file = join(dir, 'open-tabs.json');
    writeFileSync(file, '{not json');
    expect(createOpenTabLedger({ filePath: file }).takeLeftovers()).toEqual([]);
  });

  test('with no file path it keeps nothing on disk', () => {
    const ledger = createOpenTabLedger({ filePath: null });
    ledger.open('t1', 'acc:dan');
    expect(ledger.size()).toBe(1);
    expect(ledger.takeLeftovers()).toEqual([]);
  });

  test('writes the file after each change', () => {
    const dir = mkdtempSync(join(tmpdir(), 'open-tabs-'));
    const file = join(dir, 'open-tabs.json');
    const ledger = createOpenTabLedger({ filePath: file });
    ledger.open('t1', 'acc:eve');
    expect(existsSync(file)).toBe(true);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual([expect.objectContaining({ tabId: 't1', userId: 'acc:eve' })]);
  });
});
