// Intermediario locale per la segnalazione WHIP. Il muxer WHIP di FFmpeg prova soltanto il
// primo candidato ICE della risposta SDP: se è IPv6 e la rete non ha IPv6, la connessione
// fallisce. Qui passano solo offerta e risposta SDP (testo): i candidati IPv6 vengono tolti
// e il video viaggia poi direttamente verso il server WHIP. Ascolta solo su 127.0.0.1.
import http from 'node:http';

const IPV6_CANDIDATE = /^a=candidate:\S+ \d+ \S+ \d+ [0-9a-f]*:[0-9a-f:]+ /i;

/** Toglie i candidati ICE IPv6 da una risposta SDP. */
export function stripIpv6Candidates(sdp) {
  return String(sdp).split(/\r?\n/).filter((line) => !IPV6_CANDIDATE.test(line)).join('\r\n');
}

export function startWhipProxy({ target, fetchImpl = fetch, host = '127.0.0.1' } = {}) {
  const upstream = new URL(target);
  let resource = null;
  const server = http.createServer(async (request, response) => {
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      // POST crea la sessione sull'URL WHIP; DELETE/PATCH agiscono sulla risorsa restituita.
      const url = request.method === 'POST' || !resource ? upstream : resource;
      const headers = {};
      for (const name of ['authorization', 'content-type', 'if-match']) if (request.headers[name]) headers[name] = request.headers[name];
      const reply = await fetchImpl(url, { method: request.method, headers, body: body.length ? body : undefined });
      let text = await reply.text();
      const replyHeaders = { 'content-type': reply.headers.get('content-type') ?? 'application/sdp' };
      const location = reply.headers.get('location');
      if (location) {
        resource = new URL(location, upstream);
        replyHeaders.location = `http://${host}:${server.address().port}/resource`;
      }
      if (/application\/sdp/i.test(replyHeaders['content-type'])) text = stripIpv6Candidates(text);
      // Il client HTTP di FFmpeg legge la risposta per lunghezza: niente chunked encoding.
      const payload = Buffer.from(text);
      response.writeHead(reply.status, { ...replyHeaders, 'content-length': payload.length, connection: 'close' });
      response.end(payload);
    } catch {
      response.writeHead(502);
      response.end();
    }
  });
  return new Promise((resolve) => server.listen(0, host, () => resolve({
    url: `http://${host}:${server.address().port}/whip`,
    close: () => new Promise((done) => server.close(() => done())),
  })));
}
