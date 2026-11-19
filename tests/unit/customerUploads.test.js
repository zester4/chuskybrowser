import { describe, it, expect } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { customerUploadDir, safeFileName, isInsideDir, sweepOldUploads, MAX_UPLOAD_BYTES } from '../../lib/customer-uploads.js';

describe('customer uploads', () => {
  it('gives each end user its own folder, and never a folder with a colon in it', () => {
    const a = customerUploadDir('/u', 'acct:alice');
    const b = customerUploadDir('/u', 'acct:bob');
    expect(a).not.toEqual(b);
    expect(a.startsWith('/u/customers/')).toBe(true);
    expect(path.basename(a)).toMatch(/^[0-9a-f]{32}$/);
  });

  it('strips path parts and unsafe characters from file names', () => {
    expect(safeFileName('../../etc/passwd')).toBe('passwd');
    expect(safeFileName('my report (final).pdf')).toBe('my_report__final_.pdf');
    expect(safeFileName('')).toBe('file');
    expect(safeFileName('..hidden')).toBe('hidden');
  });

  it('knows when a file is inside a folder, and that the folder itself is not', () => {
    expect(isInsideDir('/u/c/x', '/u/c/x/f.pdf')).toBe(true);
    expect(isInsideDir('/u/c/x', '/u/c/y/f.pdf')).toBe(false);
    expect(isInsideDir('/u/c/x', '/u/c/x/../y/f.pdf')).toBe(false);
    expect(isInsideDir('/u/c/x', '/u/c/x')).toBe(false);
  });

  it('caps uploads at 20 MB', () => {
    expect(MAX_UPLOAD_BYTES).toBe(20 * 1024 * 1024);
  });

  it('sweeps only files older than the cutoff, then removes empty folders', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'uploads-'));
    const dir = customerUploadDir(root, 'acct:alice');
    fs.mkdirSync(dir, { recursive: true });
    const old = path.join(dir, 'old.txt');
    const fresh = path.join(dir, 'fresh.txt');
    fs.writeFileSync(old, 'a');
    fs.writeFileSync(fresh, 'b');
    const past = new Date(Date.now() - 3 * 3600 * 1000);
    fs.utimesSync(old, past, past);
    expect(await sweepOldUploads(root, { maxAgeMs: 3600 * 1000 })).toBe(1);
    expect(fs.existsSync(old)).toBe(false);
    expect(fs.existsSync(fresh)).toBe(true);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
