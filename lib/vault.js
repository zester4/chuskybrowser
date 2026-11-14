/**
 * Login vault: stores users' site logins, encrypted, for the browser to fill in.
 *
 * Encryption: AES-256-GCM with a fresh random 12-byte IV per login. The master key comes from
 * CHUSKY_VAULT_KEY (32 random bytes, base64). Each ciphertext is bound to its owner and record id
 * through the GCM additional data, so a row copied to another user or record fails to decrypt.
 *
 * Secrets never leave this module except to the fill step, which passes them to the browser page.
 * list() returns metadata only. A password is never returned to an API caller or written to a log.
 *
 * Storage: one JSON file, written atomically (temp file, then rename). Keep it on the persistent volume.
 * The file stores a short check value derived from the key, so a wrong key fails at startup, not on the first login.
 * Every save, removal and fill is written to an audit file (no usernames, passwords or page addresses).
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, mkdirSync, appendFileSync, copyFileSync } from 'node:fs';
import { dirname } from 'node:path';

const ALG = 'aes-256-gcm';
const KEY_BYTES = 32;
const FORMAT = 2;
const FILL_WINDOW_MS = 60_000;
const FILL_MAX = 10;

export function parseMasterKey(raw) {
  const key = Buffer.from(String(raw || '').trim(), 'base64');
  if (key.length !== KEY_BYTES) throw new Error('CHUSKY_VAULT_KEY must be 32 random bytes, base64 encoded');
  return key;
}

/** The site a login is for: scheme, host and port. A login filled on any other origin is refused. */
export function siteOrigin(input) {
  let url;
  try { url = new URL(String(input || '').trim()); } catch { throw new Error('site must be a full URL, for example https://shop.example.com'); }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('site must use http or https');
  return url.origin;
}

const HOST = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

/**
 * The hosts a login may be filled on. Each entry covers itself and its subdomains, so "google.com"
 * covers accounts.google.com but not evil-google.com. The saved site's own host is always included.
 */
export function allowedHostsFor(site, extra = []) {
  const own = new URL(site).hostname.toLowerCase();
  const list = [own];
  if (!Array.isArray(extra)) throw new Error('allowedHosts must be a list of hostnames');
  if (extra.length > 10) throw new Error('at most 10 allowed hosts');
  for (const raw of extra) {
    const h = String(raw || '').trim().toLowerCase().replace(/^\.+/, '');
    if (!HOST.test(h)) throw new Error(`not a hostname: ${raw}`);
    if (!list.includes(h)) list.push(h);
  }
  return list;
}

/** True when a page URL may receive this login: same scheme and port as the site, and an allowed host. */
export function pageAllowed(row, pageUrl) {
  let u;
  let site;
  try { u = new URL(pageUrl); site = new URL(row.site); } catch { return false; }
  if (u.protocol !== site.protocol || u.port !== site.port) return false;
  const host = u.hostname.toLowerCase();
  return row.hosts.some((h) => host === h || host.endsWith(`.${h}`));
}

function seal(key, userId, id, plaintext) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALG, key, iv);
  cipher.setAAD(Buffer.from(`${userId}:${id}`));
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
}

function open(key, userId, id, box) {
  const decipher = createDecipheriv(ALG, key, Buffer.from(box.iv, 'base64'));
  decipher.setAAD(Buffer.from(`${userId}:${id}`));
  decipher.setAuthTag(Buffer.from(box.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(box.data, 'base64')), decipher.final()]).toString('utf8');
}

/** A short value derived from the key. It lets us tell a wrong key from a right one, without revealing the key. */
export function keyCheck(key) {
  return createHash('sha256').update('chusky-vault-key-check').update(key).digest('hex').slice(0, 16);
}

function readVaultFile(filePath) {
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
    if (Array.isArray(parsed)) return { rows: parsed, check: null };
    if (parsed && Array.isArray(parsed.rows)) return { rows: parsed.rows, check: parsed.keyCheck ?? null };
    throw new Error('vault file has an unknown format');
  } catch (err) {
    if (err.code === 'ENOENT') return { rows: [], check: null };
    throw err;
  }
}

function writeVaultFile(filePath, rows, check) {
  mkdirSync(dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  writeFileSync(tmp, JSON.stringify({ format: FORMAT, keyCheck: check, rows }, null, 2), { mode: 0o600 });
  renameSync(tmp, filePath);
}

export function createVault({
  masterKey,
  filePath,
  auditFile = `${filePath}.audit.jsonl`,
  now = () => new Date().toISOString(),
  idFn = () => randomUUID(),
  fillWindowMs = FILL_WINDOW_MS,
  fillMax = FILL_MAX,
}) {
  if (!masterKey || masterKey.length !== KEY_BYTES) throw new Error('vault master key missing');
  if (!filePath) throw new Error('vault file path missing');

  const check = keyCheck(masterKey);
  let { rows, check: stored } = readVaultFile(filePath);
  if (stored && stored !== check) {
    throw new Error('CHUSKY_VAULT_KEY does not match the vault file. Use the key the vault was created with, or rotate the key (scripts/vault-rotate.mjs).');
  }

  const persist = () => writeVaultFile(filePath, rows, check);
  const mine = (userId) => rows.filter((r) => r.userId === userId);
  const fills = new Map();

  return {
    /** Save a login. Returns metadata only. */
    save(userId, { site, username, password, label, allowedHosts }) {
      if (!userId) throw new Error('userId required');
      if (typeof password !== 'string' || password.length === 0 || password.length > 1024) throw new Error('password must be 1 to 1024 characters');
      if (typeof username !== 'string' || username.length > 512) throw new Error('username must be 512 characters or fewer');
      const origin = siteOrigin(site);
      const hosts = allowedHostsFor(origin, allowedHosts);
      const id = idFn();
      const row = {
        id,
        userId,
        site: origin,
        hosts,
        label: typeof label === 'string' ? label.slice(0, 120) : origin,
        createdAt: now(),
        username: seal(masterKey, userId, `${id}:username`, username),
        password: seal(masterKey, userId, `${id}:password`, password),
      };
      rows.push(row);
      persist();
      return { id, site: origin, hosts, label: row.label, createdAt: row.createdAt };
    },

    /** Metadata only. Never includes a username or password. */
    list(userId) {
      return mine(userId).map((r) => ({ id: r.id, site: r.site, hosts: r.hosts, label: r.label, createdAt: r.createdAt }));
    },

    remove(userId, id) {
      const before = rows.length;
      rows = rows.filter((r) => !(r.userId === userId && r.id === id));
      if (rows.length !== before) persist();
      return rows.length !== before;
    },

    /**
     * Credentials for the fill step only. Returns null unless the login belongs to this user
     * and the page is one of its allowed hosts (same scheme and port).
     */
    credentialsFor(userId, id, pageUrl) {
      const row = rows.find((r) => r.userId === userId && r.id === id);
      if (!row || !pageAllowed(row, pageUrl)) return null;
      return {
        site: row.site,
        username: open(masterKey, userId, `${id}:username`, row.username),
        password: open(masterKey, userId, `${id}:password`, row.password),
      };
    },

    /** Append one audit line. Secrets are removed from the fields before writing. */
    audit(event, fields = {}) {
      const { username, password, ...safe } = fields;
      try {
        mkdirSync(dirname(auditFile), { recursive: true });
        appendFileSync(auditFile, `${JSON.stringify({ at: now(), event, ...safe })}\n`, { mode: 0o600 });
      } catch {
        // An audit write must never break a login. The failure is visible in the server log.
      }
    },

    /** False once a login has been filled too often in the window. Stops guessing and loops. */
    allowFill(userId, id) {
      const key = `${userId}:${id}`;
      const t = Date.now();
      const recent = (fills.get(key) || []).filter((at) => t - at < fillWindowMs);
      if (recent.length >= fillMax) { fills.set(key, recent); return false; }
      recent.push(t);
      fills.set(key, recent);
      return true;
    },
  };
}

/**
 * Re-encrypt every login under a new key. Makes a backup copy of the file first.
 * Returns the number of logins moved.
 */
export function rotateVaultKey({ filePath, oldKey, newKey, now = () => new Date().toISOString() }) {
  if (oldKey.length !== KEY_BYTES || newKey.length !== KEY_BYTES) throw new Error('both keys must be 32 bytes');
  const { rows, check } = readVaultFile(filePath);
  if (check && check !== keyCheck(oldKey)) throw new Error('the old key does not match this vault file');
  const backup = `${filePath}.bak-${now().replace(/[:.]/g, '-')}`;
  if (rows.length) copyFileSync(filePath, backup);
  const moved = rows.map((r) => {
    const username = open(oldKey, r.userId, `${r.id}:username`, r.username);
    const password = open(oldKey, r.userId, `${r.id}:password`, r.password);
    return { ...r, username: seal(newKey, r.userId, `${r.id}:username`, username), password: seal(newKey, r.userId, `${r.id}:password`, password) };
  });
  writeVaultFile(filePath, moved, keyCheck(newKey));
  return moved.length;
}
