import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFileKeyStore } from '../../gateway/file-store.js';
import { createApiKey, verifyApiKey, revokeApiKey, listApiKeys } from '../../gateway/keys.js';

const ACCOUNT = '00000000-0000-0000-0000-000000000001';

describe('file key store', () => {
  let dir;
  let file;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chusky-keys-'));
    file = path.join(dir, 'keys.json');
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('a key created by one process is accepted by another, and survives a restart', async () => {
    const cli = createFileKeyStore({ file });
    const { key } = await createApiKey(cli, ACCOUNT, 'dev');
    const server = createFileKeyStore({ file }); // a fresh store, as after a restart
    expect(await verifyApiKey(server, key)).toEqual({ accountId: ACCOUNT, keyId: expect.any(String) });
  });

  it('stores only the hash, never the raw key', async () => {
    const store = createFileKeyStore({ file });
    const { key } = await createApiKey(store, ACCOUNT, 'dev');
    expect(fs.readFileSync(file, 'utf8')).not.toContain(key);
  });

  it('a revoked key is refused by every store instance', async () => {
    const cli = createFileKeyStore({ file });
    const server = createFileKeyStore({ file });
    const { key, id } = await createApiKey(cli, ACCOUNT, 'dev');
    expect(await verifyApiKey(server, key)).not.toBeNull();
    expect(await revokeApiKey(cli, ACCOUNT, id)).toBe(true);
    expect(await verifyApiKey(server, key)).toBeNull();
  });

  it('lists only the keys of the account asked for', async () => {
    const store = createFileKeyStore({ file });
    await createApiKey(store, ACCOUNT, 'mine');
    await createApiKey(store, '00000000-0000-0000-0000-000000000002', 'theirs');
    const mine = await listApiKeys(store, ACCOUNT);
    expect(mine.map((k) => k.name)).toEqual(['mine']);
    expect(mine[0]).not.toHaveProperty('keyHash');
  });
});
