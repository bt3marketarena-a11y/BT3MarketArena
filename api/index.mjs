import { createArenaServer } from '../server.mjs';

// Il filesystem serverless è effimero: niente stato su disco e niente listen().
const arena = createArenaServer({ stateFile: null });
const requestHandler = arena.listeners('request')[0];

export default async function handler(request, response) {
  try {
    await requestHandler(request, response);
  } catch (error) {
    if (response.headersSent) {
      response.destroy(error);
      return;
    }
    const body = JSON.stringify({
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : null,
    });
    response.writeHead(500, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
      'Cache-Control': 'no-store',
    });
    response.end(body);
  }
}
