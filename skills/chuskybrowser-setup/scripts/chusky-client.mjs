// chuskybrowser SDK. One instance per end user.
//
//   import { forUser } from 'chuskybrowser-sdk';
//   const browser = forUser(userIdFromYourSession);     // NEVER from user-typed text
//   const { tabId } = await browser.openTab({ url, sessionKey: taskId });
//
// Customers set one variable:  CHUSKYBROWSER_API_KEY=cb_live_...
//
// Errors carry .status and .code (for example 'human_in_control').
import { loadDotEnv } from './lib-env.mjs';

const ENV = { ...loadDotEnv(), ...process.env };

// Built-in customer address. Customers never set or see it.
export const DEFAULT_GATEWAY_URL = 'https://chuskybrowser-production.up.railway.app/v1';

export class ChuskyError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'ChuskyError';
    this.status = status;
    this.code = body?.code || body?.error || null;
    this.body = body;
  }
}

const enc = (v) => encodeURIComponent(String(v));

export class ChuskyClient {
  constructor({ apiKey, baseUrl, accessKey, userId } = {}) {
    // Customer mode: one key, gateway address built in.
    // Self-hosted mode: the server's access key plus its base URL.
    const customerKey = apiKey ?? ENV.CHUSKYBROWSER_API_KEY;
    const key = customerKey || accessKey || ENV.CHUSKY_ACCESS_KEY;
    const url = customerKey
      ? (baseUrl || ENV.CHUSKYBROWSER_BASE_URL || DEFAULT_GATEWAY_URL)
      : (baseUrl || ENV.CHUSKY_BASE_URL);
    if (!key) throw new Error('CHUSKYBROWSER_API_KEY is not set.');
    if (!url) throw new Error('CHUSKY_BASE_URL is not set.');
    if (typeof userId !== 'string' || !userId.trim()) {
      throw new Error('userId is required. Pass the end user\'s ID from your authenticated session.');
    }
    this.baseUrl = url.replace(/\/+$/, '');
    this.#key = key;
    this.userId = userId.trim();
  }

  #key;

  async #call(method, path, { query, body, raw = false, timeoutMs = 120000 } = {}) {
    const url = new URL(this.baseUrl + path);
    if (query) for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    const headers = { Authorization: `Bearer ${this.#key}` };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (raw) {
      if (!res.ok) throw new ChuskyError(`Chusky ${method} ${path} failed (HTTP ${res.status})`, res.status, null);
      return Buffer.from(await res.arrayBuffer());
    }
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text.slice(0, 200) }; }
    if (!res.ok) {
      throw new ChuskyError(`Chusky ${method} ${path} failed (HTTP ${res.status}): ${data?.error || data?.code || 'no detail'}`, res.status, data);
    }
    return data;
  }

  get #user() { return this.userId; }

  // ----- Health and tabs -----
  health() { return this.#call('GET', '/health'); }

  openTab({ url, sessionKey, trace } = {}) {
    if (!sessionKey) throw new Error('sessionKey is required (groups the tabs of one task).');
    return this.#call('POST', '/tabs', { body: { userId: this.#user, sessionKey, url, trace } });
  }

  listTabs() { return this.#call('GET', '/tabs', { query: { userId: this.#user } }); }

  closeTab(tabId) { return this.#call('DELETE', `/tabs/${enc(tabId)}`, { query: { userId: this.#user } }); }

  deleteGroup(sessionKey) { return this.#call('DELETE', `/tabs/group/${enc(sessionKey)}`, { query: { userId: this.#user } }); }

  // ----- Navigation and reading -----
  navigate(tabId, { url, macro, query, sessionKey } = {}) {
    return this.#call('POST', `/tabs/${enc(tabId)}/navigate`, { body: { userId: this.#user, url, macro, query, sessionKey } });
  }

  back(tabId) { return this.#call('POST', `/tabs/${enc(tabId)}/back`, { body: { userId: this.#user } }); }
  forward(tabId) { return this.#call('POST', `/tabs/${enc(tabId)}/forward`, { body: { userId: this.#user } }); }
  refresh(tabId) { return this.#call('POST', `/tabs/${enc(tabId)}/refresh`, { body: { userId: this.#user } }); }

  state(tabId) { return this.#call('GET', `/tabs/${enc(tabId)}/state`, { query: { userId: this.#user } }); }

  snapshot(tabId, { offset } = {}) {
    return this.#call('GET', `/tabs/${enc(tabId)}/snapshot`, { query: { userId: this.#user, offset } });
  }

  // Returns a PNG as a Buffer.
  screenshot(tabId) {
    return this.#call('GET', `/tabs/${enc(tabId)}/screenshot`, { query: { userId: this.#user }, raw: true });
  }

  links(tabId, { offset, limit } = {}) {
    return this.#call('GET', `/tabs/${enc(tabId)}/links`, { query: { userId: this.#user, offset, limit } });
  }

  images(tabId) { return this.#call('GET', `/tabs/${enc(tabId)}/images`, { query: { userId: this.#user } }); }
  downloads(tabId) { return this.#call('GET', `/tabs/${enc(tabId)}/downloads`, { query: { userId: this.#user } }); }
  stats(tabId) { return this.#call('GET', `/tabs/${enc(tabId)}/stats`, { query: { userId: this.#user } }); }

  // kinds: ['tables','prices','json_ld','listings'] (default: all). Or pass schema (needs a snapshot first).
  extract(tabId, { kinds, schema } = {}) {
    if (kinds && schema) throw new Error('Pass kinds or schema, not both.');
    return this.#call('POST', `/tabs/${enc(tabId)}/extract`, { body: { userId: this.#user, kinds, schema } });
  }

  evaluate(tabId, expression) {
    return this.#call('POST', `/tabs/${enc(tabId)}/evaluate`, { body: { userId: this.#user, expression } });
  }

  // ----- Acting on the page -----
  click(tabId, { ref, selector }) {
    return this.#call('POST', `/tabs/${enc(tabId)}/click`, { body: { userId: this.#user, ref, selector } });
  }

  type(tabId, { ref, selector, text, pressEnter = false }) {
    return this.#call('POST', `/tabs/${enc(tabId)}/type`, { body: { userId: this.#user, ref, selector, text, pressEnter } });
  }

  select(tabId, { ref, selector, option }) {
    return this.#call('POST', `/tabs/${enc(tabId)}/select`, { body: { userId: this.#user, ref, selector, option } });
  }

  press(tabId, { key }) {
    return this.#call('POST', `/tabs/${enc(tabId)}/press`, { body: { userId: this.#user, key } });
  }

  scroll(tabId, { direction, amount } = {}) {
    return this.#call('POST', `/tabs/${enc(tabId)}/scroll`, { body: { userId: this.#user, direction, amount } });
  }

  viewport(tabId, { width, height }) {
    return this.#call('POST', `/tabs/${enc(tabId)}/viewport`, { body: { userId: this.#user, width, height } });
  }

  wait(tabId, { selector, timeout } = {}) {
    return this.#call('POST', `/tabs/${enc(tabId)}/wait`, { body: { userId: this.#user, selector, timeout } });
  }

  upload(tabId, { path, ref, selector, timeout } = {}) {
    return this.#call('POST', `/tabs/${enc(tabId)}/upload`, { body: { userId: this.#user, path, ref, selector, timeout } });
  }

  dismissOverlays(tabId, { maxClicks } = {}) {
    return this.#call('POST', `/tabs/${enc(tabId)}/overlays/dismiss`, { body: { userId: this.#user, maxClicks } });
  }

  // ----- Human handoff and live view -----
  checkpoint(tabId) {
    return this.#call('POST', `/tabs/${enc(tabId)}/checkpoint`, { body: { userId: this.#user } });
  }

  startHandoff(tabId, { reason, idleMs } = {}) {
    if (!reason) throw new Error('reason is required so the user knows what to do.');
    return this.#call('POST', `/tabs/${enc(tabId)}/handoff`, { body: { userId: this.#user, reason, idleMs } });
  }

  release(tabId) {
    return this.#call('POST', `/tabs/${enc(tabId)}/handoff/release`, { body: { userId: this.#user } });
  }

  control(tabId) { return this.#call('GET', `/tabs/${enc(tabId)}/control`, { query: { userId: this.#user } }); }

  // Link for this user only. Send it to them in chat. Read-only unless control is true,
  // and control needs an active handoff.
  async viewerLink(tabId, { control = false, ttlSeconds = 3600 } = {}) {
    const out = await this.#call('POST', '/live-viewer/links', { body: { userId: this.#user, tabId, control, ttlSeconds } });
    return out.url;
  }

  // Control link. Needs an active handoff on the tab. Kept for existing callers.
  controlLink(tabId, { ttlSeconds = 3600 } = {}) {
    return this.viewerLink(tabId, { control: true, ttlSeconds });
  }

  // ----- Sessions, traces and cookies -----
  endSession() { return this.#call('DELETE', `/sessions/${enc(this.#user)}`); }
  listTraces() { return this.#call('GET', `/sessions/${enc(this.#user)}/traces`); }
  getTrace(filename) { return this.#call('GET', `/sessions/${enc(this.#user)}/traces/${enc(filename)}`); }
  deleteTrace(filename) { return this.#call('DELETE', `/sessions/${enc(this.#user)}/traces/${enc(filename)}`); }

  // cookies: [{ name, value, domain, path, expires, httpOnly, secure, sameSite }]
  importCookies(cookies) {
    return this.#call('POST', `/sessions/${enc(this.#user)}/cookies`, { body: { cookies } });
  }

  // ----- Cards, purchases, presets, merchants -----
  enrolCard({ addAnother = false } = {}) {
    return this.#call('POST', '/agentcard/vault/enrol', { body: { userId: this.#user, addAnother } });
  }

  enrolStatus(sessionId) {
    return this.#call('GET', `/agentcard/vault/sessions/${enc(sessionId)}`, { query: { userId: this.#user } });
  }

  listCards() { return this.#call('GET', '/agentcard/vault/cards', { query: { userId: this.#user } }); }

  placeholder(cardId) {
    return this.#call('GET', '/agentcard/cards/placeholder', { query: { userId: this.#user, cardId } });
  }

  sendEnrolLink() { return this.#call('POST', '/agentcard/vault/send-link', { body: { userId: this.#user } }); }
  disconnectVault() { return this.#call('DELETE', '/agentcard/vault/connection', { query: { userId: this.#user } }); }
  eraseCardData() { return this.#call('DELETE', '/agentcard/users', { query: { userId: this.#user } }); }

  merchants({ kind, q, limit, cursor } = {}) {
    return this.#call('GET', '/agentcard/merchants', { query: { userId: this.#user, kind, q, limit, cursor } });
  }

  processors() { return this.#call('GET', '/agentcard/processors', { query: { userId: this.#user } }); }
  commerceTool() { return this.#call('GET', '/agentcard/commerce/tool', { query: { userId: this.#user } }); }

  buy(fields = {}) {
    return this.#call('POST', '/agentcard/commerce/buy', { body: { ...fields, userId: this.#user } });
  }

  createPurchase({ merchant, amount, currency, checkoutOrigin, cardId }) {
    return this.#call('POST', '/agentcard/purchases', { body: { userId: this.#user, merchant, amount, currency, checkoutOrigin, cardId } });
  }

  preparePurchase(fields = {}) {
    return this.#call('POST', '/agentcard/purchases/prepare', { body: { ...fields, userId: this.#user } });
  }

  listPurchases() { return this.#call('GET', '/agentcard/purchases', { query: { userId: this.#user } }); }
  getPurchase(purchaseId) { return this.#call('GET', `/agentcard/purchases/${enc(purchaseId)}`, { query: { userId: this.#user } }); }
  cancelPurchase(purchaseId) { return this.#call('POST', `/agentcard/purchases/${enc(purchaseId)}/cancel`, { body: { userId: this.#user } }); }
  refreshPurchase(purchaseId) { return this.#call('POST', `/agentcard/purchases/${enc(purchaseId)}/refresh`, { body: { userId: this.#user } }); }
  reportOutcome(purchaseId, outcome = {}) {
    return this.#call('POST', `/agentcard/purchases/${enc(purchaseId)}/outcome`, { body: { ...outcome, userId: this.#user } });
  }

  listPresets() { return this.#call('GET', '/agentcard/presets', { query: { userId: this.#user } }); }
  getPreset(label) { return this.#call('GET', `/agentcard/presets/${enc(label)}`, { query: { userId: this.#user } }); }
  setPreset(label, rules) { return this.#call('PUT', `/agentcard/presets/${enc(label)}`, { body: { userId: this.#user, rules } }); }
  deletePreset(label) { return this.#call('DELETE', `/agentcard/presets/${enc(label)}`, { query: { userId: this.#user } }); }
  attachPreset(label, cardId) {
    return this.#call('POST', `/agentcard/presets/${enc(label)}/attach`, { body: { userId: this.#user, cardId } });
  }

  // Arms a card for the checkout on this tab. Returns an attachmentId.
  armPayment(tabId, { merchant, amount, currency, checkoutOrigin, cardId }) {
    return this.#call('POST', `/agentcard/tabs/${enc(tabId)}/payment`, { body: { userId: this.#user, merchant, amount, currency, checkoutOrigin, cardId } });
  }

  paymentStatus(tabId, attachmentId) {
    return this.#call('GET', `/agentcard/tabs/${enc(tabId)}/payment/${enc(attachmentId)}`, { query: { userId: this.#user } });
  }

  disarmPayment(tabId, attachmentId) {
    return this.#call('DELETE', `/agentcard/tabs/${enc(tabId)}/payment/${enc(attachmentId)}`, { query: { userId: this.#user } });
  }
  // ----- Login vault -----
  // Your server saves logins (saveLogin). The agent only lists, fills and deletes them.
  // Never pass a password through an agent or a prompt: call saveLogin from your own server code.

  /**
   * Save a site login for this user. Call from your server, not from an agent.
   * @param {{site: string, username: string, password: string, label?: string, allowedHosts?: string[]}} login
   *   site: the sign-in page, for example https://shop.example.com/login
   *   allowedHosts: other hosts the login may be filled on, for example ['example.com'] covers its subdomains
   */
  saveLogin({ site, username, password, label, allowedHosts } = {}) {
    if (!site || typeof password !== 'string') throw new Error('saveLogin needs site and password.');
    return this.#call('POST', '/vault/logins', { body: { userId: this.#user, site, username: username ?? '', password, label, allowedHosts } });
  }

  /** The user's saved logins: id, site, hosts and label. No usernames or passwords. */
  listLogins() {
    return this.#call('GET', '/vault/logins', { query: { userId: this.#user } });
  }

  deleteLogin(loginId) {
    if (!loginId) throw new Error('deleteLogin needs a loginId.');
    return this.#call('DELETE', `/vault/logins/${enc(loginId)}`, { query: { userId: this.#user } });
  }

  /**
   * Fill a saved login into the sign-in form on a tab. Resolves with { status: 'password_filled' } when done.
   * Throws a ChuskyError with code 'verification_code_needed' when the site asks for a code. In that case
   * the tab is already handed to the person (see err.body.handoff); ask them for the code and do not retry.
   */
  async fillLogin(tabId, { loginId, submit = false, handoff = true } = {}) {
    if (!loginId) throw new Error('fillLogin needs a loginId.');
    const data = await this.#call('POST', `/tabs/${enc(tabId)}/vault/fill`, { body: { userId: this.#user, loginId, submit, handoff } });
    if (data?.ok === true && data.status === 'password_filled') return data;
    if (data?.status === 'needs_code') {
      throw new ChuskyError('This site asks for a verification code. The person must enter it in the live view.', 409, {
        error: 'verification_code_needed', code: 'verification_code_needed', handoff: data.handoff, filled: data.filled,
      });
    }
    throw new ChuskyError(`The login was not filled (status: ${data?.status || 'unknown'}).`, 422, {
      error: data?.status || 'login_not_filled', code: data?.status || 'login_not_filled', filled: data?.filled,
    });
  }
}

export function forUser(userId, options = {}) {
  return new ChuskyClient({ ...options, userId });
}
