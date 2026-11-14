import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { ChuskyClient, ChuskyError } from '../../skills/chuskybrowser-setup/scripts/chusky-client.mjs';

const realFetch = globalThis.fetch;
let calls;
let reply;

beforeEach(() => {
  calls = [];
  reply = { status: 200, body: {} };
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), method: init.method, body: init.body ? JSON.parse(init.body) : null });
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'content-type': 'application/json' } });
  };
});
afterEach(() => { globalThis.fetch = realFetch; });

const client = () => new ChuskyClient({ apiKey: 'cb_test_key', baseUrl: 'https://gw.test/v1', userId: 'customer-42' });

describe('SDK login vault methods', () => {
  test('saveLogin sends the user id and the login, and returns metadata', async () => {
    reply = { status: 201, body: { id: 'L1', site: 'https://shop.test', hosts: ['shop.test'] } };
    const out = await client().saveLogin({ site: 'https://shop.test/login', username: 'a@b.test', password: 'pw', label: 'Shop' });
    expect(calls[0]).toMatchObject({ method: 'POST', url: 'https://gw.test/v1/vault/logins' });
    expect(calls[0].body).toMatchObject({ userId: 'customer-42', site: 'https://shop.test/login', username: 'a@b.test', password: 'pw' });
    expect(out.id).toBe('L1');
  });

  test('saveLogin refuses a call without a password', () => {
    expect(() => client().saveLogin({ site: 'https://shop.test' })).toThrow(/needs site and password/);
  });

  test('listLogins and deleteLogin scope the call to the user', async () => {
    await client().listLogins();
    expect(calls[0].url).toBe('https://gw.test/v1/vault/logins?userId=customer-42');
    await client().deleteLogin('L1');
    expect(calls[1]).toMatchObject({ method: 'DELETE', url: 'https://gw.test/v1/vault/logins/L1?userId=customer-42' });
  });

  test('fillLogin resolves when the password is filled', async () => {
    reply = { status: 200, body: { ok: true, status: 'password_filled', filled: ['username', 'password'], submitted: false } };
    const out = await client().fillLogin('t1', { loginId: 'L1' });
    expect(out.status).toBe('password_filled');
    expect(calls[0].body).toMatchObject({ userId: 'customer-42', loginId: 'L1' });
  });

  test('fillLogin throws verification_code_needed, with the handoff, when a code is asked for', async () => {
    reply = { status: 200, body: { ok: false, status: 'needs_code', filled: ['username', 'password'], handoff: { mode: 'human', reason: 'enter the code' } } };
    const err = await client().fillLogin('t1', { loginId: 'L1' }).catch((e) => e);
    expect(err).toBeInstanceOf(ChuskyError);
    expect(err.code).toBe('verification_code_needed');
    expect(err.body.handoff.mode).toBe('human');
  });

  test('fillLogin throws a named error for any other outcome', async () => {
    reply = { status: 422, body: { error: 'no_login_fields', status: 'no_fields' } };
    const err = await client().fillLogin('t1', { loginId: 'L1' }).catch((e) => e);
    expect(err.code).toBe('no_login_fields');
  });
});
