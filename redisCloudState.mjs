import { Redis } from '@upstash/redis';
import { DEFAULT_PUBLIC_STATE, normalizePublicStatePatch } from './cloudState.mjs';

const REDIS_KEY = 'bt3:market-arena:state:v1';

class RedisCloudStateStore {
  constructor(client, now) {
    this.client = client;
    this.now = now;
    this.mode = 'redis';
    this.queue = Promise.resolve();
  }

  async get() {
    const saved = await this.client.get(REDIS_KEY);
    if (!saved) return { ...DEFAULT_PUBLIC_STATE, revision: 0, updatedAt: null };
    const value = typeof saved === 'string' ? JSON.parse(saved) : saved;
    const { revision = 0, updatedAt = null, ...config } = value;
    return {
      ...normalizePublicStatePatch(DEFAULT_PUBLIC_STATE, config),
      revision: Number(revision) || 0,
      updatedAt,
    };
  }

  update(patch) {
    this.queue = this.queue.catch(() => {}).then(async () => {
      const current = await this.get();
      const publicConfig = normalizePublicStatePatch(current, patch);
      const next = {
        ...publicConfig,
        revision: current.revision + 1,
        updatedAt: this.now(),
      };
      await this.client.set(REDIS_KEY, next);
      return { ...next };
    });
    return this.queue;
  }
}

// Il Marketplace Vercel può aggiungere un prefisso scelto all'installazione
// (es. STORAGE_KV_REST_API_URL): URL e token devono condividere lo stesso prefisso.
export function findRedisCredentials(env = process.env) {
  for (const [urlSuffix, tokenSuffix] of [['KV_REST_API_URL', 'KV_REST_API_TOKEN'], ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']]) {
    const prefixes = Object.keys(env)
      .filter((key) => key.endsWith(urlSuffix) && env[key])
      .map((key) => key.slice(0, -urlSuffix.length))
      .sort((a, b) => a.length - b.length);
    for (const prefix of prefixes) {
      const token = env[`${prefix}${tokenSuffix}`];
      if (token) return { url: env[`${prefix}${urlSuffix}`], token };
    }
  }
  return null;
}

export function createRedisStateStore({
  url = findRedisCredentials()?.url,
  token = findRedisCredentials()?.token,
  fetchImpl = globalThis.fetch,
  client = null,
  now = () => new Date().toISOString(),
} = {}) {
  if (!client && (!url || !token)) throw new Error('Credenziali Redis REST non configurate.');
  return new RedisCloudStateStore(client ?? new Redis({ url, token, fetch: fetchImpl }), now);
}
