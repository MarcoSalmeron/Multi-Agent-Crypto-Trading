// ═══════════════════════════════════════════════════════════════════════
//  main.js  —  CryptolDEsk  (solo BTC/USDT)
//  • WebSocket /ws/volume (gráfico de velas): SIN CAMBIOS.
//  • Todo lo demás consume la API REST del backend FastAPI → Binance Testnet.
// ═══════════════════════════════════════════════════════════════════════

// ─── STATE ──────────────────────────────────────────────────────────────────
let state = {
  side:      'buy',
  orderType: 'limit',
  balance:   0,
  price:     0,
  change:    '0%',
  high:      0,
  low:       0,
  volume:    0,
};

// ─── API HELPER ─────────────────────────────────────────────────────────────
async function apiFetch(path) {
  try {
    const r = await fetch(path);
    if (!r.ok) throw new Error(r.status);
    return await r.json();
  } catch (e) {
    console.error(`[API] error en ${path}:`, e);
    return null;
  }
}

// ─── WEBSOCKET DE VELAS (SIN CAMBIOS) ───────────────────────────────────────
const socket = new WebSocket("ws://localhost:8000/ws/volume");
let initialized = false;

socket.onmessage = function (event) {
  const data = JSON.parse(event.data);

  const trace = {
    x:     data.timestamps,
    open:  data.opens,
    high:  data.highs,
    low:   data.lows,
    close: data.closes,
    type:  'candlestick',
    name:  `${data.symbol.toUpperCase()}`,
  };

  const layout = {
    title:         `Velas ${data.symbol.toUpperCase()} (${data.interval})`,
    paper_bgcolor: '#0d0f14',
    plot_bgcolor:  '#0d0f14',
    font:          { color: '#e0e0e0' },
    xaxis:         { type: 'date', title: 'Tiempo', rangeslider: { visible: false } },
    yaxis:         { title: 'Precio' },
  };

  if (!initialized) {
    Plotly.newPlot('chart-container', [trace], layout);
    initialized = true;
  } else {
    Plotly.react('chart-container', [trace], layout);
  }
};

// ─── CARGA INICIAL ──────────────────────────────────────────────────────────
async function loadDashboard() {
  const snap = await apiFetch('/api/dashboard');
  if (!snap) return;
  applyTicker(snap.ticker);
  applyBalance(snap.usdt_balance);
  applyOrders(snap.open_orders, snap.unrealized_pnl, snap.exposure);
  applyTrades(snap.recent_trades);
}

// ─── TICKER BTC ─────────────────────────────────────────────────────────────
function applyTicker(t) {
  if (!t || !t.price) return;

  const prevPrice = state.price;
  state.price  = t.price;
  state.change = (t.change_pct >= 0 ? '+' : '') + t.change_pct.toFixed(2) + '%';
  state.high   = t.high_24h;
  state.low    = t.low_24h;
  state.volume = t.quote_volume;

  // Header ticker
  const hdrEl = document.getElementById('hdr-btc');
  if (hdrEl) {
    const newTxt = '$' + t.price.toLocaleString('en', { minimumFractionDigits: 2 });
    if (hdrEl.textContent !== newTxt) {
      hdrEl.textContent = newTxt;
      hdrEl.classList.remove('price-flash-up', 'price-flash-dn');
      void hdrEl.offsetWidth;
      hdrEl.classList.add(t.price >= prevPrice ? 'price-flash-up' : 'price-flash-dn');
    }
    // Cambio % junto al header
    const pctEl = hdrEl.nextElementSibling;
    if (pctEl) {
      pctEl.textContent = state.change;
      pctEl.className   = t.change_pct < 0 ? 'text-terminal-red text-xs' : 'text-terminal-accent text-xs';
    }
  }

  // Asset bar
  document.getElementById('current-price').textContent =
    '$' + t.price.toLocaleString('en', { minimumFractionDigits: 2 });

  const pchEl = document.getElementById('price-change');
  pchEl.textContent = state.change;
  pchEl.className   = t.change_pct < 0 ? 'text-terminal-red text-xs' : 'text-terminal-accent text-xs';

  document.getElementById('high-24h').textContent =
    '$' + t.high_24h.toLocaleString('en', { minimumFractionDigits: 2 });
  document.getElementById('low-24h').textContent =
    '$' + t.low_24h.toLocaleString('en', { minimumFractionDigits: 2 });

  const volEl = document.getElementById('vol-24h');
  if (volEl) {
    volEl.textContent = t.quote_volume >= 1e9
      ? '$' + (t.quote_volume / 1e9).toFixed(1) + 'B'
      : '$' + (t.quote_volume / 1e6).toFixed(1) + 'M';
  }

  // Rellena el campo precio de la orden si está vacío
  const priceInput = document.getElementById('order-price');
  if (!priceInput.value) priceInput.value = t.price;
  calcTotal();
}

// ─── SALDO ───────────────────────────────────────────────────────────────────
function applyBalance(usdtFree) {
  if (usdtFree == null) return;
  state.balance = usdtFree;
  document.getElementById('balance-display').textContent =
    '$' + usdtFree.toLocaleString('en', { minimumFractionDigits: 2 });
  document.getElementById('avail-balance').textContent =
    '$' + Math.floor(usdtFree).toLocaleString('en');
}

// ─── ÓRDENES ABIERTAS ────────────────────────────────────────────────────────
let openOrders = [];

function applyOrders(orders, pnl, exposure) {
  openOrders = orders || [];
  document.getElementById('open-count').textContent = openOrders.length;

  const pnlEl = document.getElementById('unrealized-pnl');
  if (pnlEl && pnl != null) {
    pnlEl.textContent = (pnl >= 0 ? '+$' : '-$') + Math.abs(pnl).toFixed(2);
    pnlEl.className   = pnl >= 0
      ? 'text-terminal-accent font-semibold'
      : 'text-terminal-red font-semibold';
  }

  const expEl = document.getElementById('exposure-value');
  if (expEl && exposure != null) {
    expEl.textContent = '$' + exposure.toLocaleString('en', { minimumFractionDigits: 2 });
  }

  renderOrders();
}

function filterOrders() { renderOrders(); }

function renderOrders() {
  const list = document.getElementById('orders-list');
  list.innerHTML = openOrders.length === 0
    ? `<div class="text-center py-8 text-terminal-dim text-xs">// sin órdenes activas</div>`
    : openOrders.map(o => `
      <div class="order-row panel border border-terminal-border rounded p-3 transition-colors">
        <div class="flex items-center justify-between mb-2">
          <div class="flex items-center gap-1.5">
            <span class="${o.side === 'buy' ? 'badge-buy' : 'badge-sell'} text-xs px-1.5 py-0.5 rounded font-medium">
              ${o.side.toUpperCase()}
            </span>
            <span class="text-terminal-text font-semibold text-xs">BTC/USDT</span>
          </div>
          <div class="flex items-center gap-1.5">
            <span class="badge-open text-xs px-1.5 py-0.5 rounded">${o.type}</span>
            <button onclick="cancelOrderApi('${o.id}')"
              class="text-terminal-dim hover:text-terminal-red text-xs transition-colors" title="Cancelar">✕</button>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-x-3 gap-y-1 text-xs mb-2">
          <div><span class="text-terminal-dim">Precio: </span>
               <span class="text-terminal-text">$${o.price.toLocaleString('en', { minimumFractionDigits: 2 })}</span></div>
          <div><span class="text-terminal-dim">Cant.: </span>
               <span class="text-terminal-text">${o.orig_qty} BTC</span></div>
          <div><span class="text-terminal-dim">ID: </span>
               <span class="text-terminal-dim">${o.id}</span></div>
          <div><span class="text-terminal-dim">${o.time}</span></div>
        </div>
        <div class="flex items-center gap-2">
          <div class="progress-bar flex-1">
            <div class="progress-fill" style="width:${o.filled_pct}%"></div>
          </div>
          <span class="text-terminal-dim text-xs w-8 text-right">${o.filled_pct}%</span>
        </div>
      </div>
    `).join('');
}

// ─── TRADES RECIENTES ────────────────────────────────────────────────────────
function applyTrades(trades) {
  const el = document.getElementById('recent-trades');
  if (!el) return;

  if (!trades || !trades.length) {
    el.innerHTML = `<div class="text-terminal-dim text-xs text-center py-4">// sin trades</div>`;
    return;
  }

  el.innerHTML = trades.slice(0, 12).map(t => `
    <div class="flex justify-between items-center py-1 border-b border-terminal-border/40">
      <span class="${t.side === 'buy' ? 'text-terminal-accent' : 'text-terminal-red'} text-xs font-medium w-8">
        ${t.side === 'buy' ? '▲' : '▼'}
      </span>
      <span class="text-terminal-text text-xs flex-1">
        $${t.price.toLocaleString('en', { minimumFractionDigits: 2 })}
      </span>
      <span class="text-terminal-dim text-xs w-20 text-right">${t.qty} BTC</span>
      <span class="text-terminal-dim text-xs w-14 text-right">${t.time}</span>
    </div>
  `).join('');
}

// ─── COLOCAR ORDEN ───────────────────────────────────────────────────────────
async function submitOrder() {
  const price  = parseFloat(document.getElementById('order-price').value);
  const amount = parseFloat(document.getElementById('order-amount').value);

  if (!amount || amount <= 0) {
    showNotif('⚠ Ingresa una cantidad válida', false);
    return;
  }

  const body = {
    side:     state.side.toUpperCase(),
    type:     state.orderType.toUpperCase(),
    quantity: amount,
  };

  if (state.orderType !== 'market') {
    body.price = price;
  }
  if (state.orderType === 'stop') {
    const stopVal = document.getElementById('order-stop')?.value;
    body.stop_price = stopVal ? parseFloat(stopVal) : price;
  }

  try {
    const r = await fetch('/api/order', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });
    const result = await r.json();

    if (!r.ok || result.code) {
      showNotif(`⚠ ${result.msg || 'Orden rechazada'}`, false);
      return;
    }

    showNotif(`✓ Orden ${body.type} colocada → #${result.orderId}`, true);
    document.getElementById('order-amount').value = '';
    calcTotal();
    await refreshOrders();
    await refreshBalance();
  } catch (e) {
    showNotif('⚠ Error de red al colocar la orden', false);
  }
}

// ─── CANCELAR ORDEN ──────────────────────────────────────────────────────────
async function cancelOrderApi(orderId) {
  try {
    const r = await fetch(`/api/order/${orderId}`, { method: 'DELETE' });
    const result = await r.json();

    if (!r.ok || result.code) {
      showNotif(`⚠ No se pudo cancelar: ${result.msg || ''}`, false);
      return;
    }

    showNotif(`✗ Orden cancelada → #${orderId}`, false);
    await refreshOrders();
  } catch (e) {
    showNotif('⚠ Error de red al cancelar la orden', false);
  }
}

// ─── REFRESH PARCIALES ───────────────────────────────────────────────────────
async function refreshTicker() {
  const data = await apiFetch('/api/tickers');
  if (data) applyTicker(data);
}

async function refreshBalance() {
  const data = await apiFetch('/api/balance');
  if (data) applyBalance(data.usdt_free);
}

async function refreshOrders() {
  const data = await apiFetch('/api/orders');
  if (data) applyOrders(data.orders, data.unrealized_pnl, data.exposure);
}

async function refreshTrades() {
  const data = await apiFetch('/api/trades?limit=15');
  if (data) applyTrades(data.trades);
}

// ─── POLLING ─────────────────────────────────────────────────────────────────
function startPolling() {
  setInterval(refreshTicker,  5000);   // precio cada 5 s
  setInterval(async () => {            // órdenes + saldo cada 10 s
    await refreshOrders();
    await refreshBalance();
  }, 10000);
}

// ─── SIDE / TYPE (sin cambios de lógica) ─────────────────────────────────────
function setSide(s) {
  state.side = s;
  const btn = document.getElementById('submit-btn');
  if (s === 'buy') {
    document.getElementById('side-buy').className =
      'flex-1 py-3 text-xs font-semibold tracking-wider text-terminal-accent border-b-2 border-terminal-accent transition-all';
    document.getElementById('side-sell').className =
      'flex-1 py-3 text-xs font-semibold tracking-wider text-terminal-dim border-b-2 border-transparent transition-all hover:text-terminal-red';
    btn.className   = 'btn-buy w-full py-3 rounded text-sm font-semibold tracking-wider transition-all';
    btn.textContent = '▲ EJECUTAR COMPRA';
  } else {
    document.getElementById('side-buy').className =
      'flex-1 py-3 text-xs font-semibold tracking-wider text-terminal-dim border-b-2 border-transparent transition-all hover:text-terminal-accent';
    document.getElementById('side-sell').className =
      'flex-1 py-3 text-xs font-semibold tracking-wider text-terminal-red border-b-2 border-terminal-red transition-all';
    btn.className   = 'btn-sell w-full py-3 rounded text-sm font-semibold tracking-wider transition-all';
    btn.textContent = '▼ EJECUTAR VENTA';
  }
}

function setOrderType(t) {
  state.orderType = t;
  ['limit', 'market', 'stop'].forEach(x => {
    const el = document.getElementById('otype-' + x);
    el.className = x === t
      ? 'flex-1 text-xs py-1.5 rounded border border-terminal-accent text-terminal-accent bg-terminal-accentDim font-medium'
      : 'flex-1 text-xs py-1.5 rounded border border-terminal-border text-terminal-dim hover:border-terminal-accent transition-all';
  });
  document.getElementById('price-field').style.display = t === 'market' ? 'none' : '';
  document.getElementById('stop-field').style.display  = t === 'stop'   ? '' : 'none';
}

// ─── CÁLCULOS ────────────────────────────────────────────────────────────────
function calcTotal() {
  const price  = parseFloat(document.getElementById('order-price').value) || state.price;
  const amount = parseFloat(document.getElementById('order-amount').value) || 0;
  const total  = price * amount;
  const fee    = total * 0.001;
  const pct    = Math.min((total / (state.balance || 1)) * 100, 100);

  document.getElementById('order-total').textContent   = '$' + total.toFixed(2);
  document.getElementById('order-fee').textContent     = '$' + fee.toFixed(4);
  document.getElementById('balance-usage').style.width = pct + '%';
  document.getElementById('balance-pct').textContent   = pct.toFixed(1) + '%';
}

function setPct(p) {
  const price = parseFloat(document.getElementById('order-price').value) || state.price;
  document.getElementById('order-amount').value = ((state.balance * p / 100) / price).toFixed(6);
  calcTotal();
}

// ─── CHATBOX (sin cambios) ────────────────────────────────────────────────────
let chatOpen = false;

function toggleChat() {
  chatOpen = !chatOpen;
  document.getElementById('chatbox-aside').classList.toggle('open', chatOpen);
  const btn = document.getElementById('chat-toggle-btn');
  if (btn) {
    btn.style.borderColor = chatOpen ? '#00d4aa99' : '#00d4aa44';
    btn.style.background  = chatOpen ? '#00d4aa18' : '#12151c';
  }
}

let aiIdx = 0;
const aiReplies = [
  "Analizando el mercado en tiempo real…",
  "El BTC muestra soporte en el nivel actual.",
  "Recuerda gestionar el riesgo con stop-loss.",
  "Volumen alto = mayor liquidez en el par.",
  "¿Necesitas análisis técnico de algún activo?",
];

function sendChat() {
  const input = document.getElementById('chat-input');
  const msg   = input.value.trim();
  if (!msg) return;
  appendChat(msg, 'user');
  input.value = '';
  setTimeout(() => { appendChat(aiReplies[aiIdx++ % aiReplies.length], 'ai'); scrollChat(); },
    600 + Math.random() * 400);
  scrollChat();
}

function quickChat(msg) { document.getElementById('chat-input').value = msg; sendChat(); }

function appendChat(text, role) {
  const div  = document.getElementById('chat-messages');
  const wrap = document.createElement('div');
  wrap.className = role === 'user'
    ? 'chat-msg-user px-3 py-2 text-xs text-terminal-text'
    : 'chat-msg-ai px-3 py-2 text-xs text-terminal-text';
  wrap.innerHTML = role === 'ai'
    ? `<p class="text-terminal-accent text-xs mb-1">CRYPTO_AI</p>${text}`
    : `<p class="text-right text-terminal-dim text-xs mb-1">TÚ</p>${text}`;
  div.appendChild(wrap);
  scrollChat();
}

function scrollChat() {
  const c = document.getElementById('chat-messages');
  c.scrollTop = c.scrollHeight;
}

// ─── NOTIFICACIÓN (sin cambios) ───────────────────────────────────────────────
function showNotif(msg, success) {
  const toast = document.getElementById('notif-toast');
  document.getElementById('notif-msg').textContent = msg;
  toast.style.borderColor = success ? '#00d4aa44' : '#ff4d6a44';
  toast.style.color       = success ? '#00d4aa'   : '#ff4d6a';
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3200);
}

// ─── BOOT ────────────────────────────────────────────────────────────────────
window.onload = async () => {
  await loadDashboard();
  startPolling();
};
