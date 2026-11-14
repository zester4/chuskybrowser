import { jest } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createVault, parseMasterKey, siteOrigin, allowedHostsFor, pageAllowed } from '../../lib/vault.js';

const KEY = Buffer.alloc(32, 7);
const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vault-')), 'vault.json');

describe('login vault', () => {
  test('a saved login is encrypted on disk and comes back only for its own site and owner', () => {
    const file = tmpFile();
    const v = createVault({ masterKey: KEY, filePath: file });
    const meta = v.save('alice', { site: 'https://shop.example.com/login', username: 'alice@mail.test', password: 'hunter2-PLAIN' });
    expect(meta.site).toBe('https://shop.example.com');

    const onDisk = fs.readFileSync(file, 'utf8');
    expect(onDisk).not.toContain('hunter2-PLAIN');
    expect(onDisk).not.toContain('alice@mail.test');

    expect(v.credentialsFor('alice', meta.id, 'https://shop.example.com')).toEqual({
      site: 'https://shop.example.com', username: 'alice@mail.test', password: 'hunter2-PLAIN',
    });
    expect(v.credentialsFor('alice', meta.id, 'https://shop.example.com.evil.test')).toBeNull();
    expect(v.credentialsFor('alice', meta.id, 'http://shop.example.com')).toBeNull();
    expect(v.credentialsFor('bob', meta.id, 'https://shop.example.com')).toBeNull();
  });

  test('list returns metadata only, and remove deletes the login', () => {
    const v = createVault({ masterKey: KEY, filePath: tmpFile() });
    const meta = v.save('alice', { site: 'https://a.test', username: 'u', password: 'p' });
    const listed = v.list('alice');
    expect(listed).toHaveLength(1);
    expect(JSON.stringify(listed)).not.toMatch(/"password"|"username"|"data"/);
    expect(v.list('bob')).toHaveLength(0);
    expect(v.remove('bob', meta.id)).toBe(false);
    expect(v.remove('alice', meta.id)).toBe(true);
    expect(v.credentialsFor('alice', meta.id, 'https://a.test')).toBeNull();
  });

  test('a tampered ciphertext is refused, not decrypted', () => {
    const file = tmpFile();
    const v = createVault({ masterKey: KEY, filePath: file });
    const meta = v.save('alice', { site: 'https://a.test', username: 'u', password: 'secret' });
    const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
    rows[0].password.data = Buffer.from('forged!!').toString('base64');
    fs.writeFileSync(file, JSON.stringify(rows));
    const reopened = createVault({ masterKey: KEY, filePath: file });
    expect(() => reopened.credentialsFor('alice', meta.id, 'https://a.test')).toThrow();
  });

  test('a row copied under another id fails, because the id is bound into the ciphertext', () => {
    const file = tmpFile();
    const v = createVault({ masterKey: KEY, filePath: file });
    const a = v.save('alice', { site: 'https://a.test', username: 'u', password: 'secret' });
    const b = v.save('alice', { site: 'https://a.test', username: 'u2', password: 'other' });
    const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
    rows[1].password = rows[0].password;
    fs.writeFileSync(file, JSON.stringify(rows));
    const reopened = createVault({ masterKey: KEY, filePath: file });
    expect(() => reopened.credentialsFor('alice', b.id, 'https://a.test')).toThrow();
    expect(reopened.credentialsFor('alice', a.id, 'https://a.test').password).toBe('secret');
  });

  test('a wrong master key cannot read saved logins', () => {
    const file = tmpFile();
    const meta = createVault({ masterKey: KEY, filePath: file }).save('alice', { site: 'https://a.test', username: 'u', password: 'secret' });
    const other = createVault({ masterKey: Buffer.alloc(32, 9), filePath: file });
    expect(() => other.credentialsFor('alice', meta.id, 'https://a.test')).toThrow();
  });

  test('a login covers its listed hosts and their subdomains, and nothing else', () => {
    const v = createVault({ masterKey: KEY, filePath: tmpFile() });
    const m = v.save('alice', { site: 'https://accounts.google.com', allowedHosts: ['google.com'], username: 'u', password: 'p' });
    expect(m.hosts).toEqual(['accounts.google.com', 'google.com']);
    expect(v.credentialsFor('alice', m.id, 'https://myaccount.google.com/security')).not.toBeNull();
    expect(v.credentialsFor('alice', m.id, 'https://google.com/signin')).not.toBeNull();
    expect(v.credentialsFor('alice', m.id, 'https://evil-google.com/signin')).toBeNull();
    expect(v.credentialsFor('alice', m.id, 'https://google.com.evil.test/signin')).toBeNull();
    expect(v.credentialsFor('alice', m.id, 'http://google.com/signin')).toBeNull();
    expect(v.credentialsFor('alice', m.id, 'https://google.com:8443/signin')).toBeNull();
  });

  test('pageAllowed and allowedHostsFor refuse bad host lists', () => {
    expect(() => allowedHostsFor('https://a.test', ['not a host'])).toThrow(/not a hostname/);
    expect(() => allowedHostsFor('https://a.test', Array(11).fill('x.test'))).toThrow(/at most 10/);
    expect(allowedHostsFor('https://a.test', ['.B.test', 'a.test'])).toEqual(['a.test', 'b.test']);
    expect(pageAllowed({ site: 'https://a.test', hosts: ['a.test'] }, 'https://a.test/x')).toBe(true);
    expect(pageAllowed({ site: 'https://a.test', hosts: ['a.test'] }, 'not a url')).toBe(false);
  });

  test('bad input is refused with a clear error', () => {
    const v = createVault({ masterKey: KEY, filePath: tmpFile() });
    expect(() => v.save('alice', { site: 'ftp://x.test', username: 'u', password: 'p' })).toThrow(/http or https/);
    expect(() => v.save('alice', { site: 'not a url', username: 'u', password: 'p' })).toThrow(/full URL/);
    expect(() => v.save('alice', { site: 'https://a.test', username: 'u', password: '' })).toThrow(/password/);
    expect(() => parseMasterKey('c2hvcnQ=')).toThrow(/32 random bytes/);
    expect(parseMasterKey(Buffer.alloc(32, 1).toString('base64'))).toHaveLength(32);
    expect(siteOrigin('https://A.test:8443/path?q=1')).toBe('https://a.test:8443');
  });
});
