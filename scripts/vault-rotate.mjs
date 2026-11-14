#!/usr/bin/env node
// Re-encrypts every saved login under a new key. Run on the machine with the vault file.
//
//   VAULT_OLD_KEY=<current key> VAULT_NEW_KEY=<new key> node scripts/vault-rotate.mjs /data/vault.json
//
// Makes a backup copy of the vault file (vault.json.bak-<time>) before it writes anything.
// After it succeeds, set CHUSKY_VAULT_KEY to the new key on the server and redeploy.
import { rotateVaultKey, parseMasterKey } from '../lib/vault.js';

const file = process.argv[2];
if (!file) {
  console.error('Usage: VAULT_OLD_KEY=... VAULT_NEW_KEY=... node scripts/vault-rotate.mjs <vault file>');
  process.exit(2);
}
try {
  const moved = rotateVaultKey({
    filePath: file,
    oldKey: parseMasterKey(process.env.VAULT_OLD_KEY),
    newKey: parseMasterKey(process.env.VAULT_NEW_KEY),
  });
  console.log(`Re-encrypted ${moved} login(s). Backup kept next to the vault file. Now set CHUSKY_VAULT_KEY to the new key.`);
} catch (err) {
  console.error(`Rotation failed, nothing was changed: ${err.message}`);
  process.exit(1);
}
