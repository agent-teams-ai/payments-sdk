import assert from 'node:assert/strict';
import test from 'node:test';
import { MockAgent, getGlobalDispatcher, setGlobalDispatcher, install } from 'undici';
import { createPaddleProvider } from '../../../src/index.ts';
import { paddleIds } from '../../../src/testing.ts';
import type { OfferSnapshot, PaymentScope } from '@agent-teams/payments-core';

const scope: PaymentScope = { applicationId: 'rate-fixture', provider: 'paddle', paymentAccountId: 'merchant-fixture', environment: 'sandbox' };
const offer: OfferSnapshot = { applicationId: scope.applicationId, offerId: 'credits', version: '1', policyVersion: '1', profile: 'one_time', currency: 'USD', allowZeroTotal: false, lines: [{ providerPriceRef: paddleIds.price, benefitSlotId: 'credits', quantity: 1 }] };
const error = (code: string) => ({ error: { type: 'api_error', code, detail: 'Synthetic rate contract', documentation_url: 'https://developer.paddle.com/errors/too_many_requests', errors: null } });

void test('official SDK rate hints are absolute and never turn unknown mutations into safe retries', async t => {
  const names = ['fetch', 'Headers', 'Response', 'Request', 'FormData', 'WebSocket', 'CloseEvent', 'ErrorEvent', 'MessageEvent', 'EventSource'] as const;
  const saved = names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const), dispatcher = getGlobalDispatcher();
  install(); const agent = new MockAgent(); agent.disableNetConnect(); setGlobalDispatcher(agent);
  const api = agent.get('https://sandbox-api.paddle.com');
  const provider = createPaddleProvider({ scope, apiKey: 'synthetic-never-valid-key', apiVersion: 1, webhook: { endpointId: 'fixture', secret: 'synthetic-secret', apiVersion: 1 } });
  const create = () => provider.createCheckout({ intentId: 'intent', attemptId: 'attempt', buyerId: 'buyer', offer });
  try {
    await t.test('documented 429 retains a bounded absolute hint for the host', async () => {
      api.intercept({ path: /^\/transactions\??$/u, method: 'POST' }).reply(429, error('too_many_requests'), { headers: { 'retry-after': '60' } });
      const before = Date.now(), result = await create(), after = Date.now();
      assert.equal(result.kind, 'rejected'); assert.equal(result.code, 'rate_limited'); assert.ok(typeof result.retryAt === 'string' && result.retryAt.length > 0);
      const retry = Date.parse(result.retryAt);
      assert.ok(retry >= before + 60_000 && retry <= after + 60_000);
    });
    await t.test('unrecognized mutation error remains unknown even with Retry-After', async () => {
      api.intercept({ path: /^\/transactions\??$/u, method: 'POST' }).reply(503, error('future_error_after_possible_effect'), { headers: { 'retry-after': '60' } });
      const result = await create();
      assert.equal(result.kind, 'outcome_unknown'); assert.equal('retryAt' in result, false);
    });
    await t.test('invalid retry timings are omitted rather than propagated or throwing', async () => {
      for (const value of ['-1', 'not-a-number', '999999999999999999']) {
        api.intercept({ path: /^\/transactions\??$/u, method: 'POST' }).reply(429, error('too_many_requests'), { headers: { 'retry-after': value } });
        const result = await create();
        assert.equal(result.kind, 'rejected'); assert.equal(result.code, 'rate_limited'); assert.equal(result.retryAt, undefined);
      }
    });
    agent.assertNoPendingInterceptors();
  } finally {
    await agent.close(); setGlobalDispatcher(dispatcher);
    for (const [name, descriptor] of saved) {
      if (descriptor === undefined) {Reflect.deleteProperty(globalThis, name);} else {Object.defineProperty(globalThis, name, descriptor);}
    }
  }
});
