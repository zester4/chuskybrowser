// Starts the Chusky Gateway.
//   CHUSKY_BASE_URL     the browser service, e.g. https://<your-railway-domain>
//   CHUSKY_ACCESS_KEY   the browser service's master key (never given to customers)
//   PORT                set by the host
//
// Storage: the memory store is for local runs only. Keys and tab records are lost
// on restart. Use the Supabase store (see schema.sql) in production.
import { createGatewayApp } from './http.js';
import { createMemoryStore } from './store.js';

const store = createMemoryStore();
if (process.env.NODE_ENV === 'production') {
  console.warn('WARNING: running with the memory store. Set up the Supabase store before going live.');
}
const app = createGatewayApp({
  store,
  chuskyUrl: process.env.CHUSKY_BASE_URL,
  masterKey: process.env.CHUSKY_ACCESS_KEY,
  cookieKey: process.env.CHUSKY_API_KEY || '',
});
const port = Number(process.env.PORT || 8080);
app.listen(port, () => console.log(`Chusky Gateway listening on ${port}`));
