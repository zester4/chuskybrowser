# Railway: variables to set for chuskybrowser

Service: `chuskybrowser` in the `nurturing-miracle` project, production environment.

Never paste a secret value into chat or into this file. Set secrets in Railway's Variables tab only.

## Set these next (proxy, Decodo)

These turn on the proxy. They are not set yet.

| Variable | Value |
|---|---|
| `PROXY_STRATEGY` | `backconnect` |
| `PROXY_PROVIDER` | `decodo` |
| `PROXY_USERNAME` | Your Decodo username (secret) |
| `PROXY_PASSWORD` | Your Decodo password (secret) |
| `PROXY_BACKCONNECT_HOST` | Your Decodo gateway host, from the Decodo dashboard |
| `PROXY_BACKCONNECT_PORT` | `7000` |

Optional:

| Variable | Value | Default |
|---|---|---|
| `PROXY_COUNTRY` | Two-letter country code, for example `us` | none |
| `PROXY_SESSION_DURATION_MINUTES` | 1 to 1440 | `10` |

A user can override country, state, city, zip and session length per session through the API (`POST /sessions/{userId}/proxy`). These variables set the default.

## Already set, nothing to add

- `CHUSKY_STORAGE_KEY`: encrypts saved logins and sessions.
- `CHUSKY_PROFILE_DIR`: profiles folder, on the volume.
- `CHUSKY_INTERNAL_SECRET`: for the billing service's plan route.
- `CHUSKY_ACCESS_KEY`: the key clients use. Replay links are signed with it, so rotating it breaks existing links.

## Optional: capacity plans

| Variable | Value | Default |
|---|---|---|
| `CHUSKY_DEFAULT_PLAN` | `standard`, `pro` or `scale` | `standard` |
| `CHUSKY_PLAN_LIMITS` | JSON, for example `{"pro":{"maxConcurrentPerUser":12}}` | built-in limits |

Plan limits: standard 3 concurrent operations and 10 tabs per session; pro 10 and 25; scale 25 and 50. The standard plan follows `MAX_CONCURRENT_PER_USER` and `MAX_TABS_PER_SESSION` if those are set.

## No variable needed: traces

Session traces (for replay) are saved to a `traces` folder beside the profiles folder, so they land on the same volume. The default is used unless `CHUSKY_TRACES_DIR` is set.

## After setting variables

1. Redeploy, then check `GET /health` returns 200.
2. Check a session status: `GET /sessions/{userId}/status` with the access key.
3. With the proxy set, check usage after one request: `GET /sessions/{userId}/proxy-usage` should show bytes above 0.
