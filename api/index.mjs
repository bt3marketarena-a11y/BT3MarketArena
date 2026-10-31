import { createArenaServer } from '../server.mjs';

// Vercel richiama questo http.Server per ogni richiesta. Il filesystem
// serverless è effimero: qui lo stato resta in memoria alla singola istanza.
const server = createArenaServer({ stateFile: null });

export default server;
