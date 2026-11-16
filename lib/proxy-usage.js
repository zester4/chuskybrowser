// Per-user proxy settings and byte metering.
//
// Settings: a user can choose a proxy country, state, city, zip and session length.
// They apply the next time a proxied session is created for that user.
// Metering: bytes that pass through the proxy are added up per user. Totals are saved
// to a JSON file so they survive a restart. Writes are debounced and atomic (temp file + rename).
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';

export function createProxyUsageStore({ filePath, saveDelayMs = 2000 } = {}) {
  const totals = new Map(); // userId -> { bytes, requests, updatedAt }
  const geo = new Map(); // userId -> { country, state, city, zip, sessionDurationMinutes }
  let timer = null;
  let loaded = false;

  function load() {
    if (loaded || !filePath) return;
    loaded = true;
    try {
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      for (const [userId, row] of Object.entries(raw.totals || {})) totals.set(userId, row);
      for (const [userId, g] of Object.entries(raw.geo || {})) geo.set(userId, g);
    } catch {
      // no file yet, or unreadable: start empty
    }
  }

  async function save() {
    if (!filePath) return;
    const body = JSON.stringify({
      totals: Object.fromEntries(totals),
      geo: Object.fromEntries(geo),
    });
    const tmp = `${filePath}.${process.pid}.tmp`;
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    await fsp.writeFile(tmp, body);
    await fsp.rename(tmp, filePath);
  }

  function scheduleSave() {
    if (!filePath || timer) return;
    timer = setTimeout(() => {
      timer = null;
      save().catch(() => {});
    }, saveDelayMs);
    timer.unref?.();
  }

  return {
    load,
    recordBytes(userId, bytes, requests = 1) {
      load();
      const n = Number(bytes);
      if (!Number.isFinite(n) || n <= 0) return;
      const key = String(userId);
      const row = totals.get(key) || { bytes: 0, requests: 0, updatedAt: null };
      row.bytes += Math.round(n);
      row.requests += requests;
      row.updatedAt = new Date().toISOString();
      totals.set(key, row);
      scheduleSave();
    },
    getUsage(userId) {
      load();
      return totals.get(String(userId)) || { bytes: 0, requests: 0, updatedAt: null };
    },
    getGeo(userId) {
      load();
      return geo.get(String(userId)) || {};
    },
    setGeo(userId, value) {
      load();
      const key = String(userId);
      if (!value || Object.keys(value).length === 0) geo.delete(key);
      else geo.set(key, value);
      scheduleSave();
    },
    async flush() {
      if (timer) { clearTimeout(timer); timer = null; }
      await save();
    },
  };
}
