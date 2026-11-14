/**
 * Live test for the login vault, against a running Chusky server.
 *
 * Needs CHUSKY_BASE_URL and CHUSKY_ACCESS_KEY in .env, and CHUSKY_VAULT_KEY and CHUSKY_VAULT_FILE set on the server.
 * Optional: VAULT_TEST_LOGIN_URL, a login page you control (default: a public test login page).
 *
 *   node scripts/test-vault-live.mjs
 *
 * Checks that a saved login is never returned, that it fills only on its own host, and that the
 * password reaches the page without being printed. Nothing is submitted.
 */
import { randomUUID } from 'node:crypto';
import { call, makeReporter } from './lib-env.mjs';

const LOGIN_URL = process.env.VAULT_TEST_LOGIN_URL || 'https://the-internet.herokuapp.com/login';
const TEST_USER = process.env.VAULT_TEST_USERNAME || 'tomsmith';
const TEST_PASS = process.env.VAULT_TEST_PASSWORD || 'SuperSecretPassword!';

const TWO_STEP_JS = `(() => {
  document.body.innerHTML = '<form id="e"><label>Email <input type="text" name="user"></label><button type="submit">Next</button></form>';
  document.getElementById('e').addEventListener('submit', (ev) => {
    ev.preventDefault();
    document.body.innerHTML = '<form id="p"><label>Password <input type="password" name="pw"></label></form>';
  });
  return 'ok';
})()`;
const CODE_ONLY_JS = `(() => {
  document.body.innerHTML = '<form><label>Code <input type="text" name="code" autocomplete="one-time-code"></label></form>';
  return 'ok';
})()`;

const report = makeReporter();
const userId = `vault-test-${randomUUID()}`;
const sessionKey = `s-${randomUUID()}`;
const cleanup = [];

try {
  const siteOrigin = new URL(LOGIN_URL).origin;

  // 1. Save a login.
  const saved = await call('/vault/logins', { method: 'POST', body: { userId, site: LOGIN_URL, username: TEST_USER, password: TEST_PASS, label: 'vault live test' } });
  report.check('save a login (201)', saved.status === 201 && typeof saved.data?.id === 'string', `HTTP ${saved.status}`);
  const loginId = saved.data?.id;
  if (!loginId) throw new Error('no login id, stopping');
  cleanup.push(() => call(`/vault/logins/${loginId}?userId=${encodeURIComponent(userId)}`, { method: 'DELETE' }));

  // 2. List never returns the secret.
  const listed = await call(`/vault/logins?userId=${encodeURIComponent(userId)}`);
  const listText = JSON.stringify(listed.data ?? {});
  report.check('list returns the login', listed.status === 200 && listed.data?.logins?.some((l) => l.id === loginId));
  report.check('list does not contain the password or username', !listText.includes(TEST_PASS) && !listText.includes(TEST_USER));

  // 3. Open the login page and fill it.
  const opened = await call('/tabs', { method: 'POST', body: { userId, sessionKey, url: LOGIN_URL }, timeoutMs: 90_000 });
  const tabId = opened.data?.tabId;
  report.check('open the login page', !!tabId, `HTTP ${opened.status}`);
  if (tabId) {
    cleanup.push(() => call(`/tabs/${tabId}?userId=${encodeURIComponent(userId)}`, { method: 'DELETE' }));
    await new Promise((r) => setTimeout(r, 4000));

    const filled = await call(`/tabs/${tabId}/vault/fill`, { method: 'POST', body: { userId, loginId } });
    report.check('fill reports password_filled', filled.status === 200 && filled.data?.status === 'password_filled', `HTTP ${filled.status}, status ${filled.data?.status ?? filled.data?.error}`);
    report.check('fill response does not contain the password', !JSON.stringify(filled.data ?? {}).includes(TEST_PASS));

    // Read the length of the password field only, never its value.
    const probe = await call(`/tabs/${tabId}/evaluate`, { method: 'POST', body: { userId, expression: "(() => { const p = document.querySelector('input[type=password]'); return String(p ? p.value.length : -1); })()" } });
    const len = Number(probe.data?.result);
    report.check('password field now holds the saved password', len === TEST_PASS.length, `length ${len}`);

    // 3b. Two-step sign-in: the email is on one page, the password on the next. The page is built in place
    // on the same host, so the login stays allowed.
    const prepared = await call(`/tabs/${tabId}/evaluate`, { method: 'POST', body: { userId, expression: TWO_STEP_JS } });
    report.check('two-step page prepared on the test host', prepared.data?.result === 'ok', `result ${JSON.stringify(prepared.data?.result ?? prepared.data?.error ?? null)}`);
    const two = await call(`/tabs/${tabId}/vault/fill`, { method: 'POST', body: { userId, loginId, submit: false } });
    report.check('two-step: email then password filled', two.status === 200 && two.data?.status === 'password_filled' && two.data?.filled?.includes('username') && two.data?.filled?.includes('password') && two.data?.submitted === true, `HTTP ${two.status}, status ${two.data?.status ?? two.data?.error}, filled ${JSON.stringify(two.data?.filled ?? [])}`);
    const len2 = Number((await call(`/tabs/${tabId}/evaluate`, { method: 'POST', body: { userId, expression: "(() => { const p = document.querySelector('input[type=password]'); return String(p ? p.value.length : -1); })()" } })).data?.result);
    report.check('two-step: password field holds the saved password', len2 === TEST_PASS.length, `length ${len2}`);

    // 3c. A page that asks only for a code: the fill hands the tab to a person.
    const codePrepared = await call(`/tabs/${tabId}/evaluate`, { method: 'POST', body: { userId, expression: CODE_ONLY_JS } });
    report.check('code page prepared on the test host', codePrepared.data?.result === 'ok', `result ${JSON.stringify(codePrepared.data?.result ?? codePrepared.data?.error ?? null)}`);
    const code = await call(`/tabs/${tabId}/vault/fill`, { method: 'POST', body: { userId, loginId } });
    report.check('code page: status needs_code', code.status === 200 && code.data?.status === 'needs_code', `HTTP ${code.status}, ${code.data?.status ?? code.data?.error}`);
    report.check('code page: handed to a person in the live view', code.data?.handoff?.mode === 'human', JSON.stringify(code.data?.handoff ?? null));
    const blockedAfter = await call(`/tabs/${tabId}/vault/fill`, { method: 'POST', body: { userId, loginId, handoff: false } });
    report.check('while a person holds the tab, the agent is refused (409)', blockedAfter.status === 409, `HTTP ${blockedAfter.status}`);
  }

  // 4. A login saved for another site must not fill on this page.
  // First hand the tab back, as the person would after entering the code. The fill is refused while a person holds it.
  if (tabId) await call(`/tabs/${tabId}/handoff/release`, { method: 'POST', body: { userId } });
  const other = await call('/vault/logins', { method: 'POST', body: { userId, site: 'https://example.org', username: 'x', password: 'y', label: 'wrong site' } });
  const otherId = other.data?.id;
  if (otherId && tabId) {
    cleanup.push(() => call(`/vault/logins/${otherId}?userId=${encodeURIComponent(userId)}`, { method: 'DELETE' }));
    const refused = await call(`/tabs/${tabId}/vault/fill`, { method: 'POST', body: { userId, loginId: otherId } });
    report.check('login for another site is refused (404)', refused.status === 404 && refused.data?.error === 'login_not_for_this_site', `HTTP ${refused.status}`);
  }
  report.check('site origin used by test', siteOrigin.startsWith('https://') || siteOrigin.startsWith('http://'));
} catch (err) {
  report.check('vault live test ran to the end', false, err.message);
} finally {
  for (const fn of cleanup.reverse()) await fn().catch(() => {});
  await call(`/sessions/${encodeURIComponent(userId)}`, { method: 'DELETE' }).catch(() => {});
  report.finish();
}
