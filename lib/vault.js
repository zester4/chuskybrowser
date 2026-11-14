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
 */
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const ALG = 'aes-256-gcm';
const KEY_BYTES = 32;

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

export function createVault({ masterKey, filePath, now = () => new Date().toISOString(), idFn = () => randomUUID() }) {
  if (!masterKey || masterKey.length !== KEY_BYTES) throw new Error('vault master key missing');
  if (!filePath) throw new Error('vault file path missing');

  let rows = [];
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
    if (Array.isArray(parsed)) rows = parsed;
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  function persist() {
    mkdirSync(dirname(filePath), { recursive: true });
    const tmp = `${filePath}.tmp`;
    writeFileSync(tmp, JSON.stringify(rows, null, 2), { mode: 0o600 });
    renameSync(tmp, filePath);
  }

  const mine = (userId) => rows.filter((r) => r.userId === userId);

  return {
    /** Save a login. Returns metadata only. */
    save(userId, { site, username, password, label }) {
      if (!userId) throw new Error('userId required');
      if (typeof password !== 'string' || password.length === 0 || password.length > 1024) throw new Error('password must be 1 to 1024 characters');
      if (typeof username !== 'string' || username.length > 512) throw new Error('username must be 512 characters or fewer');
      const origin = siteOrigin(site);
      const id = idFn();
      rows.push({
        id,
        userId,
        site: origin,
        label: typeof label === 'string' ? label.slice(0, 120) : origin,
        createdAt: now(),
        username: seal(masterKey, userId, `${id}:username`, username),
        password: seal(masterKey, userId, `${id}:password`, password),
      });
      persist();
      return { id, site: origin, label: rows[rows.length - 1].label, createdAt: rows[rows.length - 1].createdAt };
    },

    /** Metadata only. Never includes a username or password. */
    list(userId) {
      return mine(userId).map((r) => ({ id: r.id, site: r.site, label: r.label, createdAt: r.createdAt }));
    },

    remove(userId, id) {
      const before = rows.length;
      rows = rows.filter((r) => !(r.userId === userId && r.id === id));
      if (rows.length !== before) persist();
      return rows.length !== before;
    },

    /**
     * Credentials for the fill step only. Returns null unless the login belongs to this user
     * and was saved for exactly this origin (scheme, host and port).
     */
    credentialsFor(userId, id, pageOrigin) {
      const row = rows.find((r) => r.userId === userId && r.id === id);
      if (!row || row.site !== pageOrigin) return null;
      return {
        site: row.site,
        username: open(masterKey, userId, `${id}:username`, row.username),
        password: open(masterKey, userId, `${id}:password`, row.password),
      };
    },
  };
}
