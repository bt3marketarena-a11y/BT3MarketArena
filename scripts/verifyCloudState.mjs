// Verifica reale di scrittura e persistenza dello stato CA su un deploy pubblico.
// ADMIN_KEY si legge solo dall'ambiente e non viene mai stampata.
// Uso: ADMIN_KEY=... node scripts/verifyCloudState.mjs [baseUrl] [mint] [--keep]
const args = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
const keep = process.argv.includes('--keep');
const base = (args[0] ?? 'https://bt-3-market-arena.vercel.app').replace(/\/$/, '');
const mint = args[1] ?? 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
const adminKey = process.env.ADMIN_KEY ?? '';
if (!adminKey) throw new Error('Imposta ADMIN_KEY nell\'ambiente del terminale.');

const summary = (state) => ({ revision: state.revision, source: state.source, ca: state.ca, storage: state.storage, updatedAt: state.updatedAt });
const read = async () => {
  const response = await fetch(`${base}/api/state?t=${Date.now()}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`GET /api/state HTTP ${response.status}`);
  return response.json();
};
const write = async (patch) => {
  const response = await fetch(`${base}/api/state`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminKey}` },
    body: JSON.stringify(patch),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`PATCH /api/state HTTP ${response.status}: ${payload.error ?? ''}`);
  return payload;
};

const before = await read();
console.log('prima      ', summary(before));
const written = await write({ source: 'dexscreener', ca: mint });
console.log('scritto    ', summary(written));
let persisted = true;
for (let check = 1; check <= 3; check += 1) {
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  const state = await read();
  console.log(`rilettura ${check}`, summary(state));
  persisted &&= state.revision === written.revision && state.ca === mint && state.storage === 'redis';
}
if (!keep) {
  const restored = await write({ source: 'simulation', ca: '' });
  console.log('ripristino ', summary(restored));
}
console.log(JSON.stringify({
  revisionIncremented: written.revision === before.revision + 1,
  persistedOnRedis: persisted,
  restoredToSimulation: !keep,
}));
if (written.revision !== before.revision + 1 || !persisted) process.exitCode = 1;
