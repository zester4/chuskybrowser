// Local key store for testing. API keys (hashed) live in a JSON file, so a key made by
// the CLI is seen by the running server. The file is the only source of truth: every call
// reads it first, so two processes never overwrite each other's keys.
// Tabs and usage stay in memory. Not for production.
import fs from 'node:fs';
import path from 'node:path';
import { createMemoryStore } from './store.js';

export function createFileKeyStore({ file }) {
  if (!file) throw new Error('The file key store needs a file path.');

  const read = () => {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
  };
  const write = (rows) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(rows, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, file);
  };

  return {
    ...createMemoryStore(),
    async insertKey(row) {
      const rows = read();
      rows.push({ ...row });
      write(rows);
    },
    async findKeyByHash(hash) {
      return read().find((k) => k.keyHash === hash) || null;
    },
    async touchKey(id) {
      const rows = read();
      const k = rows.find((r) => r.id === id);
      if (!k) return;
      k.lastUsedAt = new Date().toISOString();
      write(rows);
    },
    async listKeys(accountId) {
      return read().filter((k) => k.accountId === accountId);
    },
    async revokeKey(accountId, id) {
      const rows = read();
      const k = rows.find((r) => r.id === id);
      if (!k || k.accountId !== accountId) return false;
      k.revokedAt = new Date().toISOString();
      write(rows);
      return true;
    },
  };
}
