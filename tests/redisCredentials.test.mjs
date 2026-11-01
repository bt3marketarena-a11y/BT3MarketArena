import test from 'node:test';
import assert from 'node:assert/strict';
import { findRedisCredentials } from '../redisCloudState.mjs';

test('le credenziali Redis accettano nomi standard e prefissi del Marketplace', () => {
  assert.deepEqual(findRedisCredentials({ KV_REST_API_URL: 'https://a', KV_REST_API_TOKEN: 't1' }), { url: 'https://a', token: 't1' });
  assert.deepEqual(findRedisCredentials({ UPSTASH_REDIS_REST_URL: 'https://b', UPSTASH_REDIS_REST_TOKEN: 't2' }), { url: 'https://b', token: 't2' });
  assert.deepEqual(
    findRedisCredentials({ STORAGE_KV_REST_API_URL: 'https://c', STORAGE_KV_REST_API_TOKEN: 't3', STORAGE_KV_REST_API_READ_ONLY_TOKEN: 'ro' }),
    { url: 'https://c', token: 't3' },
  );
});

test('senza coppia URL/token con lo stesso prefisso Redis non viene attivato', () => {
  assert.equal(findRedisCredentials({}), null);
  assert.equal(findRedisCredentials({ A_KV_REST_API_URL: 'https://a', B_KV_REST_API_TOKEN: 't' }), null);
  assert.equal(findRedisCredentials({ KV_REST_API_URL: 'https://a', KV_REST_API_READ_ONLY_TOKEN: 'ro' }), null);
});
