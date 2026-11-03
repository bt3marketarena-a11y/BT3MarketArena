// Limita i tentativi di ADMIN_KEY sbagliati per IP. Con Redis il conteggio è condiviso
// fra tutte le istanze Vercel; senza resta in memoria (solo sviluppo e test).
export function createFailureLimiter({ client = null, max = 10, windowSec = 900, now = () => Date.now() } = {}) {
  const memory = new Map();
  const key = (ip) => `bt3:admin-fail:${ip}`;
  return {
    async blocked(ip) {
      if (client) return Number(await client.get(key(ip))) >= max;
      const entry = memory.get(ip);
      if (!entry || entry.until <= now()) { memory.delete(ip); return false; }
      return entry.count >= max;
    },
    async fail(ip) {
      if (client) {
        const count = await client.incr(key(ip));
        if (count === 1) await client.expire(key(ip), windowSec);
        return count;
      }
      const entry = memory.get(ip);
      const fresh = !entry || entry.until <= now();
      const next = fresh ? { count: 1, until: now() + windowSec * 1000 } : { ...entry, count: entry.count + 1 };
      memory.set(ip, next);
      return next.count;
    },
  };
}

// x-vercel-forwarded-for è scritto dalla piattaforma e non si può falsificare dal client;
// gli altri restano come ripiego fuori da Vercel (sviluppo e test).
export function clientIp(request) {
  const first = (name) => String(request.headers[name] ?? '').split(',')[0].trim().slice(0, 64);
  return first('x-vercel-forwarded-for') || first('x-real-ip') || first('x-forwarded-for')
    || String(request.socket?.remoteAddress ?? 'unknown');
}
