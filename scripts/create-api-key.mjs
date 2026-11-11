#!/usr/bin/env node
// Creates, lists and revokes customer API keys (cb_live_...) in the local key file.
//
//   node scripts/create-api-key.mjs create [--name "label"] [--account <uuid>]
//   node scripts/create-api-key.mjs list   [--account <uuid>]
//   node scripts/create-api-key.mjs revoke --id <key-id> [--account <uuid>]
//
// The server reads the same file when it runs with CHUSKY_GATEWAY_STORE=file.
// The raw key is printed once. Only its hash is saved.

import { loadConfig } from '../lib/config.js';
import { createApiKey, listApiKeys, revokeApiKey } from '../gateway/keys.js';
import { createFileKeyStore } from '../gateway/file-store.js';

const DEFAULT_ACCOUNT = '00000000-0000-0000-0000-000000000001';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const [command, ...rest] = process.argv.slice(2);
const args = {};
for (let i = 0; i < rest.length; i += 2) args[rest[i].replace(/^--/, '')] = rest[i + 1];

const accountId = args.account || DEFAULT_ACCOUNT;
if (!UUID.test(accountId)) {
  console.error('--account must be a UUID.');
  process.exit(1);
}

const config = loadConfig();
const store = createFileKeyStore({ file: config.gatewayKeyFile });

if (command === 'create') {
  const key = await createApiKey(store, accountId, args.name || 'dev key');
  console.log(`Created key ${key.id} (${key.name}).`);
  console.log(`Key: ${key.key}`);
  console.log(`Saved to ${config.gatewayKeyFile}. Shown once. Keep it safe.`);
} else if (command === 'list') {
  const keys = await listApiKeys(store, accountId);
  if (!keys.length) console.log('No keys for this account.');
  for (const k of keys) {
    const state = k.revokedAt ? 'revoked' : 'active';
    console.log(`${k.id}  ${state.padEnd(8)} ${k.prefix}...  ${k.name}`);
  }
} else if (command === 'revoke') {
  if (!args.id) {
    console.error('revoke needs --id <key-id>.');
    process.exit(1);
  }
  const ok = await revokeApiKey(store, accountId, args.id);
  console.log(ok ? 'Key revoked.' : 'No active key with that id for this account.');
  process.exit(ok ? 0 : 1);
} else {
  console.log('Usage: create | list | revoke. See the header of scripts/create-api-key.mjs.');
  process.exit(1);
}
