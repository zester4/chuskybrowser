// Every browser-server route a customer may call through the gateway.
//
// Routes NOT listed here are never forwarded. That includes the AgentCard webhook,
// /metrics, /pressure/cleanup, the legacy /start /stop /navigate /snapshot /act
// routes, and /tabs/open.
//
// Access kinds:
//   user    customer key + a userId. The userId is namespaced to the customer's account.
//   tab     like user, plus the account must own the tab in the path (:tabId).
//   public  no customer key. The live-viewer token in the query string is the access check.
//   cookies customer key + userId, and the server's cookie-import key is attached.

const T = '([^/]+)'; // one path segment

export const ROUTES = [
  // Tabs
  { m: 'GET', re: /^\/tabs$/, kind: 'user' },
  { m: 'POST', re: /^\/tabs$/, kind: 'open' },
  { m: 'DELETE', re: /^\/tabs\/group\/([^/]+)$/, kind: 'user' },
  { m: 'GET', re: new RegExp(`^/tabs/${T}/(snapshot|state|links|screenshot|downloads|images|stats|control)$`), kind: 'tab', tabAt: 1 },
  { m: 'POST', re: new RegExp(`^/tabs/${T}/(navigate|wait|overlays/dismiss|click|upload|type|select|press|scroll|viewport|back|forward|refresh|fetch-current-resource|evaluate|extract|handoff|handoff/release|checkpoint)$`), kind: 'tab', tabAt: 1 },
  { m: 'DELETE', re: new RegExp(`^/tabs/${T}$`), kind: 'tab', tabAt: 1, closes: true },

  // Sessions, traces, cookies
  { m: 'GET', re: /^\/sessions\/([^/]+)\/traces$/, kind: 'session', userAt: 1 },
  { m: 'GET', re: /^\/sessions\/([^/]+)\/traces\/([^/]+)$/, kind: 'session', userAt: 1 },
  { m: 'DELETE', re: /^\/sessions\/([^/]+)\/traces\/([^/]+)$/, kind: 'session', userAt: 1 },
  { m: 'POST', re: /^\/sessions\/([^/]+)\/cookies$/, kind: 'cookies', userAt: 1 },
  { m: 'DELETE', re: /^\/sessions\/([^/]+)$/, kind: 'session', userAt: 1 },

  // Live view. Links are issued for the customer's tab. The viewer pages are token-gated.
  { m: 'POST', re: /^\/live-viewer\/links$/, kind: 'viewer-link' },
  { m: 'GET', re: /^\/live-viewer\/(view|frame|control)$/, kind: 'public', publicPath: true },
  { m: 'POST', re: /^\/live-viewer\/(input|done)$/, kind: 'public', publicPath: true },

  // AgentCard (purchases, vault, presets, commerce)
  { m: 'POST', re: /^\/agentcard\/vault\/enrol$/, kind: 'user' },
  { m: 'GET', re: /^\/agentcard\/vault\/sessions\/([^/]+)$/, kind: 'user' },
  { m: 'GET', re: /^\/agentcard\/vault\/cards$/, kind: 'user' },
  { m: 'POST', re: /^\/agentcard\/vault\/send-link$/, kind: 'user' },
  { m: 'DELETE', re: /^\/agentcard\/vault\/connection$/, kind: 'user' },
  { m: 'DELETE', re: /^\/agentcard\/users$/, kind: 'user' },
  { m: 'GET', re: /^\/agentcard\/cards\/placeholder$/, kind: 'user' },
  { m: 'POST', re: /^\/agentcard\/purchases$/, kind: 'user' },
  { m: 'GET', re: /^\/agentcard\/purchases$/, kind: 'user' },
  { m: 'POST', re: /^\/agentcard\/purchases\/prepare$/, kind: 'user' },
  { m: 'GET', re: /^\/agentcard\/purchases\/([^/]+)$/, kind: 'user' },
  { m: 'POST', re: /^\/agentcard\/purchases\/([^/]+)\/(cancel|refresh|outcome)$/, kind: 'user' },
  { m: 'GET', re: /^\/agentcard\/processors$/, kind: 'user' },
  { m: 'GET', re: /^\/agentcard\/presets$/, kind: 'user' },
  { m: 'GET', re: /^\/agentcard\/presets\/([^/]+)$/, kind: 'user' },
  { m: 'PUT', re: /^\/agentcard\/presets\/([^/]+)$/, kind: 'user' },
  { m: 'DELETE', re: /^\/agentcard\/presets\/([^/]+)$/, kind: 'user' },
  { m: 'POST', re: /^\/agentcard\/presets\/([^/]+)\/attach$/, kind: 'user' },
  { m: 'POST', re: /^\/agentcard\/commerce\/buy$/, kind: 'user' },
  { m: 'GET', re: /^\/agentcard\/commerce\/tool$/, kind: 'user' },
  { m: 'GET', re: /^\/agentcard\/merchants$/, kind: 'user' },
  { m: 'POST', re: /^\/agentcard\/tabs\/([^/]+)\/payment$/, kind: 'tab', tabAt: 1 },
  { m: 'GET', re: /^\/agentcard\/tabs\/([^/]+)\/payment\/([^/]+)$/, kind: 'tab', tabAt: 1 },
  { m: 'DELETE', re: /^\/agentcard\/tabs\/([^/]+)\/payment\/([^/]+)$/, kind: 'tab', tabAt: 1 },
];

export function matchRoute(method, path) {
  for (const route of ROUTES) {
    if (route.m !== method) continue;
    const hit = path.match(route.re);
    if (!hit) continue;
    return {
      ...route,
      tabId: route.tabAt ? decodeURIComponent(hit[route.tabAt]) : null,
      pathUser: route.userAt ? decodeURIComponent(hit[route.userAt]) : null,
    };
  }
  return null;
}
