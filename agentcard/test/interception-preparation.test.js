import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { makeService } from './helpers.js';
import { attachInterception, toRegistry } from '../src/index.js';

const SHOP = 'https://shop.example.com';
const CARD_URL = 'https://payments.braintree-api.com/graphql';

/** One Braintree-style recognizer that needs an approved preparation before it pauses. */
const REGISTRY = toRegistry([{
  psp: 'braintree', match: 'payments\\.braintree-api\\.com/graphql', hosts: ['^payments\\.braintree-api\\.com$'],
  request: { method: 'POST' }, preparationRequired: true, passthroughHeaders: [],
}]);

/** Store a card for one of our users, as the vault flow does. */
async function enrol(s, userId, agentcardUserId = `usr_${userId}`) {
  const { sessionId } = await s.service.vault.start(userId);
  s.fake.linkSession(sessionId, agentcardUserId);
  s.advance(3000);
  await s.service.vault.poll(userId, sessionId);
  s.fake.addCard(agentcardUserId, { last4: '4242' });
}

/** A page that keeps its route handler, so the test can send it a card request. */
function fakePage() {
  const page = { handler: null };
  page.route = async (_pattern, h) => { page.handler = h; };
  page.unroute = async () => {};
  return page;
}

/** One card request as a Playwright route sees it, and what happened to it. */
function cardRoute() {
  const outcome = { aborted: false, fulfilled: null };
  const route = {
    request: () => ({ url: () => CARD_URL, method: () => 'POST', headers: () => ({ origin: SHOP }), postData: () => '{}' }),
    abort: async () => { outcome.aborted = true; },
    fulfill: async (r) => { outcome.fulfilled = r; },
    continue: async () => { outcome.continued = true; },
  };
  return { route, outcome };
}

/** Attach to a page. The authorization poll answers "approved" at once, so a paused request can finish. */
async function attach(s, { preparation, preparationStatus, approvalLinks }) {
  const api = {
    getPreparation: async () => ({ status: preparationStatus }),
    getAuthorization: async () => ({ status: 'approved', response: { status: 200, headers: {}, body: 'ok' } }),
    cancelAuthorization: async () => ({}),
  };
  const page = fakePage();
  await attachInterception(page, {
    checkout: s.service.checkout, api, registry: REGISTRY, userId: 'prep-int',
    merchant: 'Shop', amount: 2306, currency: 'usd', checkoutOrigin: SHOP,
    onApprovalUrl: (url) => approvalLinks.push(url), preparation,
    sleep: async () => {}, now: () => Date.now(), timeoutMs: 60_000,
  });
  return page;
}

describe('interception: a preparation-required card request', () => {
  test('is aborted and never paused while the approval is still waiting for the user', async () => {
    const s = makeService();
    await enrol(s, 'prep-int');
    const approvalLinks = [];
    const preparation = { id: 'cprep_none', checkoutKey: 'key-int-0000000001', merchantOrigin: SHOP, psp: 'braintree' };
    const page = await attach(s, { preparation, preparationStatus: 'awaiting_approval', approvalLinks });
    const { route, outcome } = cardRoute();
    await page.handler(route);
    assert.equal(outcome.aborted, true);
    assert.equal(outcome.fulfilled, null);
    assert.deepEqual(approvalLinks, []);
  });

  test('without any preparation, a preparation-required card request is refused as before', async () => {
    const s = makeService();
    await enrol(s, 'prep-int');
    const approvalLinks = [];
    const page = await attach(s, { preparation: null, preparationStatus: 'ready', approvalLinks });
    const { route, outcome } = cardRoute();
    await page.handler(route);
    assert.equal(outcome.aborted, true);
    assert.deepEqual(approvalLinks, []);
  });

  test('when the approval is ready, the card request is bound, answered, and gets no second approval link', async () => {
    const s = makeService();
    await enrol(s, 'prep-int');
    const checkoutKey = 'key-int-0000000002';
    const prep = await s.service.checkout.prepare('prep-int', { merchant: 'Shop', amount: 2306, currency: 'usd', psp: 'braintree', merchantOrigin: SHOP, checkoutKey });
    s.fake.setPreparation(prep.purchaseId, { status: 'ready' });
    const approvalLinks = [];
    const preparation = { id: prep.purchaseId, checkoutKey, merchantOrigin: SHOP, psp: 'braintree' };
    const page = await attach(s, { preparation, preparationStatus: 'ready', approvalLinks });
    const { route, outcome } = cardRoute();
    await page.handler(route);
    assert.equal(outcome.aborted, false);
    assert.equal(outcome.fulfilled?.status, 200);
    assert.deepEqual(approvalLinks, []);
  });
});
