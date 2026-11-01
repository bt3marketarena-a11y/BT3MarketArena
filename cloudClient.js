export class CloudConfigClient {
  constructor({
    baseUrl = '',
    fetchImpl = globalThis.fetch,
    EventSourceImpl = globalThis.EventSource,
    setIntervalImpl = globalThis.setInterval,
    clearIntervalImpl = globalThis.clearInterval,
  } = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.fetch = fetchImpl;
    this.EventSource = EventSourceImpl;
    this.setInterval = setIntervalImpl;
    this.clearInterval = clearIntervalImpl;
  }

  async request(url, options = {}) {
    const response = await this.fetch(`${this.baseUrl}${url}`, options);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error ?? `Cloud HTTP ${response.status}`);
    return payload;
  }

  load() {
    return this.request('/api/state', { headers: { Accept: 'application/json' }, cache: 'no-store' });
  }

  update(config, adminKey) {
    return this.request('/api/state', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminKey ?? ''}` },
      body: JSON.stringify(config),
    });
  }

  subscribe(onState, onError = () => {}, { pollMs = 2_000 } = {}) {
    let closed = false;
    let polling = false;
    let events = null;
    if (this.EventSource) {
      try {
        events = new this.EventSource(`${this.baseUrl}/api/events`);
        events.addEventListener('state', (event) => {
          try { onState(JSON.parse(event.data)); } catch (error) { onError(error); }
        });
        events.addEventListener('error', () => onError(new Error('SSE disconnesso: il polling mantiene lo stato sincronizzato.')));
      } catch (error) {
        onError(error);
      }
    }
    const poll = async () => {
      if (closed || polling) return;
      polling = true;
      try { onState(await this.load()); }
      catch (error) { if (!closed) onError(error); }
      finally { polling = false; }
    };
    const timer = this.setInterval(() => poll(), Math.max(500, pollMs));
    timer?.unref?.();
    return () => {
      closed = true;
      this.clearInterval(timer);
      events?.close();
    };
  }
}
