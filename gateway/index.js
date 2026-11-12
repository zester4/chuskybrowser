// Picks the gateway's key store from configuration.
// memory: keys and tab records are lost on restart. Used by default and in tests.
// file: keys are saved to a local JSON file, so the CLI and the server share them.
// remote: keys are checked by the frontend, which holds them in Supabase. Production.
import { createMemoryStore } from './store.js';
import { createFileKeyStore } from './file-store.js';
import { createRemoteStore } from './remote-store.js';

export function createGatewayStore({ gatewayStore, gatewayKeyFile, frontendUrl, internalSecret }) {
  if (gatewayStore === 'remote') return createRemoteStore({ frontendUrl, secret: internalSecret });
  if (gatewayStore === 'file') return createFileKeyStore({ file: gatewayKeyFile });
  if (gatewayStore === 'memory') return createMemoryStore();
  throw new Error(`Unknown CHUSKY_GATEWAY_STORE "${gatewayStore}". Use "memory", "file" or "remote".`);
}
