/**
 * Live check of the SDK login vault methods against a running server.
 *
 * Usage (server running with CHUSKY_VAULT_KEY and CHUSKY_VAULT_FILE set;
 * CHUSKY_BASE_URL, CHUSKY_ACCESS_KEY and optionally CHUSKY_USER_ID in .env):
 *   node scripts/test-sdk-vault-live.mjs
 *
 * Saves a login, lists it, checks no password or username is returned, deletes it,
 * and checks that fill on a missing tab is refused. Needs no browser.
 * Removes what it saved.
 */
import { randomUUID } from 'node:crypto';
import { BASE, ACCESS_KEY } from './lib-env.mjs';
import { ChuskyClient, ChuskyError } from '../skills/chuskybrowser-setup/scripts/chusky-client.mjs';

const userId = process.env.CHUSKY_USER_ID || `sdk-live-${randomUUID()}`;
// apiKey: '' forces self-hosted mode, so a customer key in .env is not sent to this server.
const client = new ChuskyClient({ apiKey: '', baseUrl: BASE, accessKey: ACCESS_KEY, userId });
const SECRET = `pw-${randomUUID()}`;
const USERNAME = `user-${randomUUID().slice(0, 8)}`;
let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`);
};

let id = null;
try {
  const saved = await client.saveLogin({ site: 'https://the-internet.herokuapp.com', username: USERNAME, password: SECRET, label: 'sdk-live' });
  id = saved?.id ?? null;
  check('saveLogin returns an id', !!id);
  check('saveLogin response has no password or username', !JSON.stringify(saved).includes(SECRET) && !JSON.stringify(saved).includes(USERNAME));

  const list = await client.listLogins();
  const rows = list?.logins ?? [];
  check('listLogins includes the login', rows.some((r) => r.id === id));
  check('listLogins has no password or username', !JSON.stringify(list).includes(SECRET) && !JSON.stringify(list).includes(USERNAME));

  await client.deleteLogin(id);
  id = null;
  const after = (await client.listLogins())?.logins ?? [];
  check('deleteLogin removes the login', !after.some((r) => r.id === saved?.id));
} catch (err) {
  check('vault save, list and delete', false, err instanceof ChuskyError ? `${err.status} ${err.code}` : err.message);
} finally {
  if (id) await client.deleteLogin(id).catch(() => {});
}

try {
  await client.fillLogin('no-such-tab', { loginId: randomUUID() });
  check('fillLogin on a missing tab is refused', false, 'no error');
} catch (err) {
  check('fillLogin on a missing tab is refused', err instanceof ChuskyError && err.status === 404, `${err.status} ${err.code}`);
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exitCode = failures === 0 ? 0 : 1;
