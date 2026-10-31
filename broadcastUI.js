const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 2 });
const exactMoney = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });

function formatPrice(value) {
  if (!Number.isFinite(value) || value === null) return '—';
  if (value < 0.001) return `$${value.toExponential(3)}`;
  return `$${value.toFixed(value < 1 ? 6 : 2)}`;
}

const ADMIN_CSS = `
:root{color-scheme:dark;font-family:Inter,system-ui,sans-serif;background:#080d13;color:#e7edf3}*{box-sizing:border-box}body{margin:0;padding:26px}.admin-form{display:flex;flex-direction:column;gap:14px}.admin-heading{display:flex;justify-content:space-between;align-items:center}.admin-heading small{color:#35f2a0;font:700 10px ui-monospace,monospace;letter-spacing:2px}.admin-heading h1{margin:3px 0 0;font-size:26px}.admin-heading>span{padding:6px 9px;border:1px solid #31404f;color:#8f9aa6;font:12px ui-monospace,monospace}.admin-note{margin:0;color:#8c99a7;font-size:12px;line-height:1.5}.admin-form label{display:flex;flex-direction:column;gap:6px;color:#a9b5c0;font-size:12px}.admin-form input,.admin-form select{width:100%;padding:11px 12px;border:1px solid #2a3846;border-radius:5px;background:#101822;color:#edf4fa;outline:none}.admin-form input:focus,.admin-form select:focus{border-color:#35f2a0}.admin-form hr{width:100%;border:0;border-top:1px solid #24313e;margin:5px 0}.admin-actions{display:grid;grid-template-columns:1fr 1fr;gap:10px}.admin-actions.three{grid-template-columns:1fr 1fr 1fr}.admin-form button{padding:11px;border:0;border-radius:5px;background:#35f2a0;color:#06120d;font-weight:800;cursor:pointer}.admin-form button.secondary{background:#1b2936;color:#dbe5ed;border:1px solid #314252}.admin-form button.danger{background:#ffbd45;color:#201400}.admin-form button.wide{width:100%}.admin-heading-small{color:#e1e9f0;font-weight:750;font-size:13px}.admin-heading-small span{color:#718091;font-size:11px;font-weight:400}.offset-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.engine-status{padding:10px;background:#101822;border-left:2px solid #35f2a0;color:#9cadba;font-size:11px;line-height:1.45}.admin-output{min-height:18px;color:#35f2a0;font-size:12px}.admin-output.error{color:#ff7188}`;

export class BroadcastUI {
  constructor() {
    const id = (name) => document.getElementById(name);
    this.elements = {
      marketCap: id('market-cap'), price: id('market-price'), round: id('round-label'),
      buyPct: id('buy-pct'), sellPct: id('sell-pct'), buyPressure: id('buy-pressure'), sellPressure: id('sell-pressure'),
      buyUsd: id('buy-usd'), sellUsd: id('sell-usd'), feedStatus: id('feed-status'), phase: id('phase-label'),
      tradeList: id('trade-list'), ca: id('ca-ticker'), source: id('source-label'), hp1Bar: id('hp1-bar'), hp2Bar: id('hp2-bar'),
      hp1Value: id('hp1-value'), hp2Value: id('hp2-value'), ko: id('ko-banner'), fallback: id('admin-fallback'),
    };
    this.adminWindow = null;
    this.currentConfig = {};
  }

  updatePressure(snapshot) {
    const buy = Math.max(0, Math.min(100, snapshot.buyPct));
    this.elements.buyPct.textContent = `${buy.toFixed(1)}%`;
    this.elements.sellPct.textContent = `${(100 - buy).toFixed(1)}%`;
    this.elements.buyPressure.style.width = `${buy}%`;
    this.elements.sellPressure.style.width = `${100 - buy}%`;
    this.elements.buyUsd.textContent = `${money.format(snapshot.buyUsd)} VOL`;
    this.elements.sellUsd.textContent = `${money.format(snapshot.sellUsd)} VOL`;
    this.updateMarket(snapshot);
  }

  updateMarket({ marketCap, price }) {
    if (Number.isFinite(marketCap)) this.elements.marketCap.textContent = money.format(marketCap);
    if (Number.isFinite(price)) this.elements.price.textContent = formatPrice(price);
  }

  updateHealth(health) {
    const panel = document.querySelector('.fighters');
    if (panel) panel.hidden = false;
    health.forEach((value, index) => {
      const normalized = Math.max(0, Math.min(100, value));
      this.elements[`hp${index + 1}Bar`].style.width = `${normalized}%`;
      this.elements[`hp${index + 1}Value`].textContent = `${Math.ceil(normalized)}%`;
    });
  }

  setPhase(phase, round) {
    if (round) this.elements.round.textContent = `ROUND ${String(round).padStart(3, '0')}`;
    const mode = this.currentConfig.source ?? 'simulation';
    this.elements.phase.textContent = `${mode.toUpperCase()} // ${phase.toUpperCase()}`;
    this.elements.ko.hidden = phase !== 'ko';
  }

  setStatus({ state, detail, mode, contractAddress }) {
    this.elements.feedStatus.innerHTML = `<i></i> ${state.toUpperCase()}`;
    this.elements.feedStatus.title = detail;
    if (contractAddress) this.setContract(contractAddress, mode);
  }

  setContract(ca, source) {
    this.elements.ca.textContent = ca || 'SIMULATION_MODE';
    this.elements.ca.title = ca;
    this.elements.source.textContent = source === 'simulation' ? 'PRE-LAUNCH SIMULATOR' : `${source.toUpperCase()} // LIVE MARKET`;
    this.currentConfig.source = source;
  }

  addTrade(trade) {
    const item = document.createElement('li');
    item.className = `${trade.side.toLowerCase()} ${trade.kind === 'whale' ? 'whale' : ''}`;
    const attacker = trade.side === 'BUY' ? 'P1' : 'P2';
    const defender = trade.side === 'BUY' ? 'P2' : 'P1';
    const action = trade.kind === 'whale' ? `${attacker} → ULTIMATE FINAL su ${defender}!` : `${attacker} rompe il counter di ${defender}!`;
    const amount = document.createElement('span');
    amount.className = 'trade-amount';
    amount.textContent = `${trade.side} ${exactMoney.format(trade.amountUsd)}`;
    const detail = document.createElement('span');
    detail.className = 'trade-action';
    detail.textContent = action;
    const time = document.createElement('span');
    time.className = 'trade-time';
    time.textContent = `${trade.aggregate ? `AGGREGATO ×${trade.count ?? 1}` : trade.source.toUpperCase()} // ${new Date(trade.timestamp).toLocaleTimeString('it-IT')}`;
    detail.appendChild(time);
    item.append(amount, detail);
    this.elements.tradeList.prepend(item);
    while (this.elements.tradeList.children.length > 5) this.elements.tradeList.lastElementChild.remove();
  }

  bindAdmin(callbacks, config) {
    this.currentConfig = { ...this.currentConfig, ...config };
    if (!this.adminBound) {
      window.addEventListener('keydown', (event) => {
        if (event.key === 'F2') {
          event.preventDefault();
          this.openAdmin(callbacks);
        }
      });
      this.adminBound = true;
    }
    this.adminCallbacks = callbacks;
  }

  openAdmin(callbacks = this.adminCallbacks) {
    if (this.adminWindow && !this.adminWindow.closed) {
      this.adminWindow.focus();
      return;
    }
    const popup = window.open('', 'BT3MarketArenaAdmin', 'width=560,height=900,resizable=yes,scrollbars=yes');
    if (!popup) {
      const container = document.getElementById('admin-fallback-content');
      container.replaceChildren(document.getElementById('admin-template').content.cloneNode(true));
      this.wireAdminForm(container.querySelector('form'), callbacks);
      this.elements.fallback.showModal();
      return;
    }
    popup.document.open();
    popup.document.write(`<!doctype html><html lang="it"><head><meta charset="utf-8"><title>Market Arena Admin</title><style>${ADMIN_CSS}</style></head><body></body></html>`);
    popup.document.close();
    popup.document.body.appendChild(document.getElementById('admin-template').content.cloneNode(true));
    this.wireAdminForm(popup.document.querySelector('form'), callbacks, popup);
    this.adminWindow = popup;
  }

  wireAdminForm(form, callbacks, popup = null) {
    for (const [key, value] of Object.entries(this.currentConfig)) {
      if (form.elements[key] && value !== undefined && value !== null) form.elements[key].value = value;
    }
    const output = form.querySelector('.admin-output');
    const engineStatus = form.querySelector('#engine-status');
    if (callbacks.getEngineStatus) engineStatus.textContent = callbacks.getEngineStatus();
    const readConfig = () => {
      const values = Object.fromEntries(new FormData(form).entries());
      const adminKey = String(values.adminKey ?? '');
      delete values.adminKey;
      return { values, adminKey };
    };
    const run = async (action) => {
      output.classList.remove('error');
      output.textContent = 'Applicazione…';
      try {
        const { values, adminKey } = readConfig();
        await callbacks.onApply(values, action, adminKey);
        output.textContent = `Completato: ${action}`;
        if (action === 'engine' && callbacks.getEngineStatus) engineStatus.textContent = callbacks.getEngineStatus();
      } catch (error) {
        output.classList.add('error');
        output.textContent = error.message;
      }
    };
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      run(event.submitter?.dataset.action ?? 'feed');
    });
    form.querySelectorAll('button[data-action="simulation"],button[data-action^="test-"]').forEach((button) => {
      button.addEventListener('click', () => run(button.dataset.action));
    });
    if (popup) popup.addEventListener('beforeunload', () => { if (this.adminWindow === popup) this.adminWindow = null; });
  }
}
