# Backend: what is left before production

Status as of 2026-11-13. "Verified" means a test was run and passed. Nothing here is pushed to
production; the browser repo's `public` remote holds the last pushed backend commit, `5c00da3`.

## Verified

- Browser server health, key recognition through the frontend, 401 for a made-up key,
  open tab, read page text, close tab (test-bridge checks, through the built-in address).
- Usage events: the frontend's usage count goes up after tab calls (test-bridge check).
- AgentCard through the bridge: merchants, processors, card stored, presets set/read/delete,
  prepare, read back, cancel, purchase list. The vault mapping survived one Railway redeploy
  after the volume was added.
- Approve-first in AgentCard's test environment: a preparation reaches `ready` after the user
  approves on their device, and cancels cleanly (preparation-check.mjs).
- AgentCard webhook: registered with AgentCard for `https://chuskybrowser-production.up.railway.app/agentcard/webhooks`,
  with the signing secret set on Railway. A test event was delivered and accepted (HTTP 200), 2026-11-13.
- Payment on a checkout page in AgentCard's test environment, with the user's approval:
  8 of 8 (camoufox-pay-check.mjs). This ran directly, not through the bridge.

## Approve-first gap (found 2026-11-13)

- The bridge path (`service.js` `attachPayment` -> `attachInterception` in `agentcard/src/interception.js`)
  refuses every processor marked `preparationRequired` (Braintree, Square, Worldpay, Bambora, Mercado Pago):
  it aborts the card request with `preparation_required` and never pauses it. So the bridge cannot pay
  those merchants yet.
- The SDK already does the approve-first step: `checkout.prepare({ psp, environment })` on the
  `attachToPlaywright` controller, before the first Pay, with the approval URL delivered through
  `onApprovalUrl`. The later card request binds to that approval, with no second link.
- Fix: move the bridge's payment path onto the SDK's `attachToPlaywright` (it already handles prepare
  and bind), or call `prepare()` from our interception before the first card request. Then verify on a
  Braintree or Square test merchant through the bridge, with the approval on a device.
- Stripe (the demo store) does not need preparation, so the passing Firefox test does not cover this.

## Not yet verified (needed before production)

1. **Paying after approval** on a live checkout, for a processor that approves on its own page,
   through the bridge. The approve-first preparation has only been verified up to ready and cancel.
2. **Production environment.** Backend uses `AGENTCARD_ENVIRONMENT` (default `sandbox`).
   Needs production AgentCard credentials and the switch, tested once with a small real payment.
3. **Vault link for real customers.** The mapping from a user to their AgentCard user is saved only
   when the enrolment session is polled (`enrolStatus`). The test polls; a real customer's app
   does not yet. The AgentCard webhook is now live (see Verified), so handle `vault.session_linked`
   from it as the source of truth. Polling stays as a fallback. Still to confirm: a real
   `vault.session_linked` event links the user, and this is covered by the webhook tests only.
4. **Usage tracking is best-effort.** Each usage, tab-open and tab-close event is sent to the
   frontend once, with a 5-second timeout. A failed event is logged and never retried, so
   counts can be too low when the frontend is slow or down. Before billing on these counts:
   add a retry queue (or a durable local log that is sent later), and count events the frontend
   can reconcile. `browser_seconds` is always 0, so time is not tracked yet.
5. **Tab records live in memory** on the browser server (`createMemoryStore`), so a redeploy
   forgets which tabs are open. The frontend then keeps tabs marked open with no close event.
   Persist tab records to the volume, or close them on startup and send the close events.
6. **Routes not yet checked live:** `buy`, `reportOutcome`, `refreshPurchase`, and the purchase
   statuses `approved`, `submitted_on_device`, `settled`, `not_settled`. The docs describe these.
   Either test each one, or leave them out of the public docs.
7. **`createPurchase` in the SDK** is undocumented and fails against the live route (409 or 400).
   Remove it, or change it to the approve-first fields.
8. **Other AgentCard error paths** (timeouts, expired approvals, declines) are not tested.
9. **Rate limits and abuse limits** on customer keys are not set.

## Research: the two open failures (from AgentCard's docs)

**Approve-first cancels because nothing is waiting for the approval.** The preparation docs say the
approval is used by a live checkout: "Use controller.prepare() with the checkout SDK ... Call the API
directly only if your integration handles request interception." They also say "The user must keep the
same page open after approving" and that navigation, a changed checkout, or an early request stops the
approval from being used. Once `ready`, the window is at most 30 seconds. Our check creates the
preparation and never opens a checkout, so after approval there is nothing to continue, and AgentCard
cancels it (`payment_status: not_started`). This matches "Checkout stopped." The missing piece is our
bind step: while a preparation is `ready`, the page's card request must be intercepted and answered with
an authorization bound to the preparation (`binding_hash`, `checkout_key`). We have not built that. The
earlier pass was not reproducible and should not be trusted.

**`user_not_connected` (merchant list with a user).** No AgentCard page defines this error. The closest
documented error is for preparations: `not_found`, "The user is not connected to your app. Connect the
user first." The connections docs describe a separate platform connection (`/api/v2/connect/start`,
`verify`, `consent`) that gives each user an `access_token`. The card vault is not described there. Our
app links users through the vault only, so the merchant lookup, which asks for a user's `link_status`,
probably refuses them. This is an inference from the docs, not confirmed. The MCP tool documents
`link_status` as "this user's link status for each" merchant, and says a merchant should be linked before
shopping it. The catalog without a user works.

**To settle with AgentCard:** send founders@agentcard.com (named in their docs) the exact
`user_not_connected` response for `GET /buy/merchants?external_user_id=...`, and ask whether vault users
need the connections flow for `link_status`.

## Firefox results (2026-11-13)

- Firefox + AgentCard SDK (`attachToPlaywright`), Stripe test mode: the card request is paused, the approval
  link is issued, the user approves on device, and the page gets Stripe's `200` token. The SDK then holds the
  token as `awaiting_merchant` (`stripe_tokenization_unbound`): the token is not yet bound to a payment.
- Not yet shown: binding the token to a payment, a `completed` purchase on shop.agentcard.sh, the approve-first
  `prepare()` path on Firefox, Square (no sandbox application id), and production.
- Purchase on shop.agentcard.sh (Stripe test mode, Firefox): COMPLETED. The approval, the store's paid
  page, and `checkout.reconcile()` returning `completed` all passed (`firefox-store-purchase.mjs`).
- Still open for production: live payments, approve-first `prepare()`, Square, the REST calls through the bridge,
  usage retries, tab records after a redeploy.

## Security

- The internal secret was pasted in chat. Rotate `CHUSKY_INTERNAL_SECRET` on Railway and on the
  frontend, and set both to the same new value.
- A live customer key starting `cb_live_xwPj` was pasted in chat. Revoke it in the dashboard.

## Frontend work

See `updates.md` in the frontend repo. Its open items are the frontend's, not the backend's.
