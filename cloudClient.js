export class CloudConfigClient {
  constructor({
    baseUrl = '',
    fetchImpl = globalThis.fetch,
    EventSourceImpl = globalThis.EventSource,
  } = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.fetch = fetchImpl;
    this.EventSource = EventSourceImpl;
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

  subscribe(onState, onError = () => {}) {
    if (!this.EventSource) throw new Error('EventSource non disponibile nel browser.');
    const events = new this.EventSource(`${this.baseUrl}/api/events`);
    events.addEventListener('state', (event) => {
      try { onState(JSON.parse(event.data)); } catch (error) { onError(error); }
    });
    events.addEventListener('error', () => onError(new Error('SSE disconnesso: riconnessione automatica.')));
    return () => events.close();
  }
}
