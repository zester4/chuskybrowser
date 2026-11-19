/**
 * Files customers send to the browser. A customer uploads bytes through POST /v1/uploads,
 * gets back a server path, and then attaches that path to a file input with the upload route.
 *
 * Each customer end user gets its own folder, named by a hash of its user ID, so one user
 * cannot reach another user's files. Old files are swept away.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export function customerUploadDir(uploadsDir, userId) {
  const folder = crypto.createHash('sha256').update(String(userId)).digest('hex').slice(0, 32);
  return path.join(uploadsDir, 'customers', folder);
}

export function safeFileName(name) {
  const base = path.basename(String(name || '')).replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '').slice(0, 120);
  return base || 'file';
}

// True when file sits inside dir (both real paths). The directory itself does not count.
export function isInsideDir(dir, file) {
  const rel = path.relative(dir, file);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

// Deletes files older than maxAgeMs under the customers folder, then removes empty folders.
export async function sweepOldUploads(uploadsDir, { maxAgeMs, now = Date.now() } = {}) {
  const root = path.join(uploadsDir, 'customers');
  let removed = 0;
  let folders = [];
  try { folders = await fs.promises.readdir(root, { withFileTypes: true }); } catch { return 0; }
  for (const folder of folders) {
    if (!folder.isDirectory()) continue;
    const dir = path.join(root, folder.name);
    for (const entry of await fs.promises.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (!entry.isFile()) continue;
      const file = path.join(dir, entry.name);
      const stat = await fs.promises.stat(file).catch(() => null);
      if (stat && now - stat.mtimeMs > maxAgeMs) {
        await fs.promises.rm(file, { force: true }).catch(() => {});
        removed++;
      }
    }
    if ((await fs.promises.readdir(dir).catch(() => ['x'])).length === 0) await fs.promises.rmdir(dir).catch(() => {});
  }
  return removed;
}
