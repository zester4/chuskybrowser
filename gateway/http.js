// Chusky Gateway HTTP layer. The public entry point for customers.
//
// Customers send  Authorization: Bearer cb_live_...  to  <gateway>/v1/<route>.
// The gateway checks the key, then forwards the call to the browser server with the
// server's master key. Customers never see the master key or the browser server address.
//
// Isolation rules:
//   - Only the routes in routes.js are forwarded.
//   - Every call's userId is replaced with "<accountId>:<endUserId>", in the query,
//     the body and the path, so one customer can't reach another's sessions.
//   - Tab and AgentCard-tab calls are refused unless the account opened that tab.
//   - Live-view links are issued for the customer's own tabs and point at this gateway.

import express from 'express';
import { verifyApiKey } from './keys.js';
import { matchRoute } from './routes.js';

const UPSTREAM_TIMEOUT_MS = 120000;

function bearer(req) {
  return String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
}

function sendUpstream(res, upstream, buffer) {
  const type = upstream.headers.get('content-type');
  if (type) res.type(type);
  res.status(upstream.status).send(buffer);
}

export function createGatewayApp({ store, chuskyUrl, masterKey, cookieKey = '', fetchImpl = globalThis.fetch }) {
  // masterKey may be empty when the browser server runs without CHUSKY_ACCESS_KEY.
  if (!store || !chuskyUrl) throw new Error('createGatewayApp needs store and chuskyUrl');
  const upstreamBase = chuskyUrl.replace(/\/+$/, '');
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '5mb' }));

  // Forward one request to the browser server.
  async function forward(method, path, { query, body, headers = {} }) {
    const target = new URL(`${upstreamBase}${path}`);
    for (const [k, v] of Object.entries(query || {})) target.searchParams.set(k, String(v));
    const init = {
      method,
      headers: { ...headers },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
      init.headers['Content-Type'] = 'application/json';
    }
    const upstream = await fetchImpl(target, init);
    const buffer = Buffer.from(await upstream.arrayBuffer());
    return { upstream, buffer };
  }

  // Public live-view pages and their calls. The token in ?t= is the access check.
  app.use('/live-viewer', async (req, res) => {
    if (!(req.method === 'GET' && /^\/(view|frame|control)$/.test(req.path)) &&
        !(req.method === 'POST' && /^\/(input|done)$/.test(req.path))) {
      return res.status(404).json({ error: 'not_found' });
    }
    try {
      const { upstream, buffer } = await forward(req.method, `/live-viewer${req.path}`, {
        query: req.query,
        body: req.method === 'POST' ? req.body : undefined,
      });
      sendUpstream(res, upstream, buffer);
    } catch {
      res.status(502).json({ error: 'gateway_error', detail: 'Could not reach the browser service.' });
    }
  });

  app.get('/v1/health', (_req, res) => res.json({ ok: true }));

  app.use('/v1', async (req, res) => {
    try {
      const account = await verifyApiKey(store, bearer(req));
      if (!account) return res.status(401).json({ error: 'invalid_api_key' });

      const route = matchRoute(req.method, req.path);
      if (!route) return res.status(404).json({ error: 'not_found' });

      // The end user is a name the customer chooses for their own user, e.g. "alice".
      const endUser = route.pathUser ?? String(req.body?.userId ?? req.query?.userId ?? '').trim();
      if (!endUser) return res.status(400).json({ error: 'userId_required' });
      const userId = `${account.accountId}:${endUser}`;

      // Tab calls: the account must have opened this tab.
      if (route.kind === 'tab' || route.kind === 'viewer-link') {
        const tabId = route.kind === 'tab' ? route.tabId : String(req.body?.tabId ?? '');
        if (!tabId || (await store.tabOwner(tabId)) !== account.accountId) {
          return res.status(404).json({ error: 'tab_not_found' });
        }
      }

      // Cookie import needs the server's own cookie key, which customers never see.
      if (route.kind === 'cookies' && !cookieKey) {
        return res.status(403).json({ error: 'cookie_import_disabled' });
      }

      // Build the upstream path. The userId goes in the path, the query and the body.
      const path = route.pathUser !== null
        ? req.path.replace(/^\/sessions\/[^/]+/, `/sessions/${encodeURIComponent(userId)}`)
        : req.path;
      const query = { ...req.query, userId };
      const body = req.body && typeof req.body === 'object' && Object.keys(req.body).length
        ? { ...req.body, userId }
        : (req.method === 'GET' || req.method === 'DELETE' ? undefined : { userId });
      const headers = {
        Authorization: `Bearer ${route.kind === 'cookies' ? cookieKey : masterKey}`,
      };

      const { upstream, buffer } = await forward(req.method, path, { query, body, headers });

      // Bookkeeping, only on success.
      if (upstream.ok) {
        const at = new Date().toISOString();
        const isJson = (upstream.headers.get('content-type') || '').includes('application/json');
        const data = isJson ? JSON.parse(buffer.toString('utf8') || 'null') : null;
        if (route.kind === 'open' && data?.tabId) {
          await store.recordTab({ accountId: account.accountId, endUserId: endUser, tabId: data.tabId, sessionKey: req.body?.sessionKey || 'default', url: req.body?.url || null, openedAt: at });
        }
        if (route.closes) await store.markTabClosed(account.accountId, route.tabId, at);
        if (route.kind === 'viewer-link' && data?.url) {
          // The browser server builds the link from its own host. Point it at this gateway.
          const issued = new URL(data.url);
          const publicBase = `${req.get('x-forwarded-proto') || req.protocol}://${req.get('host')}`;
          data.url = `${publicBase}${issued.pathname}${issued.search}`;
          return res.status(upstream.status).json(data);
        }
        await store.recordUsage(account.accountId, `${req.method} ${route.kind}`);
      }

      sendUpstream(res, upstream, buffer);
    } catch {
      res.status(502).json({ error: 'gateway_error', detail: 'Could not reach the browser service.' });
    }
  });

  app.use((_req, res) => res.status(404).json({ error: 'not_found' }));
  return app;
}
