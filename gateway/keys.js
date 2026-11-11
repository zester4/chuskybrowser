// API keys for customers of the Chusky gateway.
//
// Customers send their key as `Authorization: Bearer cb_live_...` to the gateway.
// The raw key is shown once when created. Only its SHA-256 hash is stored.

import crypto from 'node:crypto';

export const KEY_PREFIX = 'cb_live_';

export function generateKey() {
  return KEY_PREFIX + crypto.randomBytes(32).toString('base64url');
}

export function hashKey(rawKey) {
  return crypto.createHash('sha256').update(rawKey).digest('hex');
}

// store must provide: insertKey(row), findKeyByHash(hash), touchKey(id), listKeys(accountId), revokeKey(accountId, id)
export async function createApiKey(store, accountId, name) {
  const raw = generateKey();
  const row = {
    id: crypto.randomUUID(),
    accountId,
    name: String(name || 'Untitled key').slice(0, 80),
    prefix: raw.slice(0, 16),
    keyHash: hashKey(raw),
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
    revokedAt: null,
  };
  await store.insertKey(row);
  // `key` is returned only here. Show it to the customer once.
  return { id: row.id, name: row.name, prefix: row.prefix, createdAt: row.createdAt, key: raw };
}

export async function verifyApiKey(store, rawKey) {
  if (typeof rawKey !== 'string' || !rawKey.startsWith(KEY_PREFIX)) return null;
  const row = await store.findKeyByHash(hashKey(rawKey));
  if (!row || row.revokedAt) return null;
  await store.touchKey(row.id);
  return { accountId: row.accountId, keyId: row.id };
}

export async function listApiKeys(store, accountId) {
  const rows = await store.listKeys(accountId);
  return rows.map(({ id, name, prefix, createdAt, lastUsedAt, revokedAt }) => ({ id, name, prefix, createdAt, lastUsedAt, revokedAt }));
}

export async function revokeApiKey(store, accountId, keyId) {
  return store.revokeKey(accountId, keyId);
}
