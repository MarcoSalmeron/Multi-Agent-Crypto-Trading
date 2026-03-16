// ═══ STATE ════════════════════════════════════════════
let state = {
  asset: 'BTC',
  side: 'buy',
  orderType: 'limit',
  balance: 24850,
  prices: { BTC: 67842, ETH: 3521, SOL: 184.30 },
  changes: { BTC: '+2.41%', ETH: '+1.82%', SOL: '-0.61%' },
  highs: { BTC: 68120, ETH: 3588, SOL: 189.5 },
  lows: { BTC: 66890, ETH: 3470, SOL: 181.2 },
};

// Conexión al WebSocket del backend FastAPI
const socket = new WebSocket("ws://localhost:8000/ws/volume");
let initialized = false;

socket.onmessage = function (event) {
  const data = JSON.parse(event.data);
  console.log("Datos recibidos:", data);

  const trace = {
    x: data.timestamps,   // strings ISO
    open: data.opens,
    high: data.highs,
    low: data.lows,
    close: data.closes,
    type: 'candlestick',
    name: `${data.symbol.toUpperCase()}`
  };

  const layout = {
    title: `Velas ${data.symbol.toUpperCase()} (${data.interval})`,
    paper_bgcolor: '#0d0f14',
    plot_bgcolor: '#0d0f14',
    font: { color: '#e0e0e0' },
    xaxis: { type: 'date', title: 'Tiempo', rangeslider: { visible: false } },
    yaxis: { title: 'Precio' }
  };

  if (!initialized) {
    Plotly.newPlot('chart-container', [trace], layout);
    initialized = true;
  } else {
    Plotly.react('chart-container', [trace], layout);
  }

};


// ═══ INIT ═════════════════════════════════════════════
window.onload = () => {
  renderOrders();
  renderHistory('closed');
  renderRecentTrades();
  startPriceTick();
};

// ═══ ASSET / SIDE / TYPE ══════════════════════════════
function setAsset(a) {
  state.asset = a;
  ['BTC', 'ETH', 'SOL'].forEach(x => {
    document.getElementById('tab-' + x).className =
      'text-xs px-3 py-1.5 rounded font-medium transition-all ' +
      (x === a ? 'tab-active' : 'tab-inactive');
  });
  const p = state.prices[a];
  document.getElementById('current-price').textContent = '$' + p.toLocaleString('en', { minimumFractionDigits: 2 });
  document.getElementById('price-change').textContent = state.changes[a];
  document.getElementById('price-change').className = state.changes[a].startsWith('-') ? 'text-terminal-red text-xs' : 'text-terminal-accent text-xs';
  document.getElementById('high-24h').textContent = '$' + state.highs[a].toLocaleString('en');
  document.getElementById('low-24h').textContent = '$' + state.lows[a].toLocaleString('en');
  document.getElementById('amount-unit').textContent = a;
  document.getElementById('order-price').value = p;
  calcTotal();
  renderRecentTrades();
}

function setSide(s) {
  state.side = s;
  const btn = document.getElementById('submit-btn');
  if (s === 'buy') {
    document.getElementById('side-buy').className = 'flex-1 py-3 text-xs font-semibold tracking-wider text-terminal-accent border-b-2 border-terminal-accent transition-all';
    document.getElementById('side-sell').className = 'flex-1 py-3 text-xs font-semibold tracking-wider text-terminal-dim border-b-2 border-transparent transition-all hover:text-terminal-red';
    btn.className = 'btn-buy w-full py-3 rounded text-sm font-semibold tracking-wider transition-all';
    btn.textContent = '▲ EJECUTAR COMPRA';
  } else {
    document.getElementById('side-buy').className = 'flex-1 py-3 text-xs font-semibold tracking-wider text-terminal-dim border-b-2 border-transparent transition-all hover:text-terminal-accent';
    document.getElementById('side-sell').className = 'flex-1 py-3 text-xs font-semibold tracking-wider text-terminal-red border-b-2 border-terminal-red transition-all';
    btn.className = 'btn-sell w-full py-3 rounded text-sm font-semibold tracking-wider transition-all';
    btn.textContent = '▼ EJECUTAR VENTA';
  }
}

function setOrderType(t) {
  state.orderType = t;
  ['limit', 'market', 'stop'].forEach(x => {
    const el = document.getElementById('otype-' + x);
    if (x === t) {
      el.className = 'flex-1 text-xs py-1.5 rounded border border-terminal-accent text-terminal-accent bg-terminal-accentDim font-medium';
    } else {
      el.className = 'flex-1 text-xs py-1.5 rounded border border-terminal-border text-terminal-dim hover:border-terminal-accent transition-all';
    }
  });
  document.getElementById('price-field').style.display = t === 'market' ? 'none' : '';
  document.getElementById('stop-field').style.display = t === 'stop' ? '' : 'none';
}

// ═══ CALCULATIONS ═════════════════════════════════════
function calcTotal() {
  const price = parseFloat(document.getElementById('order-price').value) || state.prices[state.asset];
  const amount = parseFloat(document.getElementById('order-amount').value) || 0;
  const total = price * amount;
  const fee = total * 0.001;
  const pct = Math.min((total / state.balance) * 100, 100);

  document.getElementById('order-total').textContent = '$' + total.toFixed(2);
  document.getElementById('order-fee').textContent = '$' + fee.toFixed(4);
  document.getElementById('balance-usage').style.width = pct + '%';
  document.getElementById('balance-pct').textContent = pct.toFixed(1) + '%';
}

function setPct(p) {
  const price = parseFloat(document.getElementById('order-price').value) || state.prices[state.asset];
  const maxUsdt = state.balance * (p / 100);
  const amount = maxUsdt / price;
  document.getElementById('order-amount').value = amount.toFixed(6);
  calcTotal();
}

// ═══ SUBMIT ORDER ════════════════════════════════════
function submitOrder() {
  const price = parseFloat(document.getElementById('order-price').value);
  const amount = parseFloat(document.getElementById('order-amount').value);
  if (!amount || amount <= 0) { showNotif('⚠ Ingresa una cantidad válida', false); return; }

  const total = price * amount;
  const newOrder = {
    id: 'ORD-0' + Math.floor(Math.random() * 900 + 100),
    asset: state.asset,
    side: state.side,
    type: state.orderType,
    price: price || state.prices[state.asset],
    amount,
    filled: state.orderType === 'market' ? 100 : 0,
    time: new Date().toTimeString().slice(0, 5),
    status: 'open'
  };

  if (state.side === 'buy') {
    state.balance -= total;
    document.getElementById('balance-display').textContent = '$' + state.balance.toFixed(2);
    document.getElementById('avail-balance').textContent = '$' + state.balance.toFixed(0);
  }

  if (state.orderType === 'market') {
    closedOrders.unshift({ ...newOrder, pnl: 0, status: 'closed' });
    showNotif('✓ Orden MARKET ejecutada → ' + newOrder.id, true);
  } else {
    openOrders.unshift(newOrder);
    document.getElementById('open-count').textContent = openOrders.length;
    showNotif('✓ Orden ' + state.orderType.toUpperCase() + ' colocada → ' + newOrder.id, true);
  }

  renderOrders();
  renderHistory('closed');
  document.getElementById('order-amount').value = '';
  calcTotal();
}

// ═══ CANCEL ORDER ════════════════════════════════════
function cancelOrder(id) {
  const i = openOrders.findIndex(o => o.id === id);
  if (i > -1) {
    openOrders.splice(i, 1);
    document.getElementById('open-count').textContent = openOrders.length;
    renderOrders();
    showNotif('✗ Orden cancelada → ' + id, false);
  }
}

// ═══ RENDER OPEN ORDERS ══════════════════════════════
function filterOrders() {
  renderOrders();
}

function renderOrders() {
  const filter = document.getElementById('order-filter').value;
  const list = document.getElementById('orders-list');
  const orders = filter === 'ALL' ? openOrders : openOrders.filter(o => o.asset === filter);

  list.innerHTML = orders.length === 0
    ? `<div class="text-center py-8 text-terminal-dim text-xs">// sin órdenes activas</div>`
    : orders.map(o => `
      <div class="order-row panel border border-terminal-border rounded p-3 transition-colors">
        <div class="flex items-center justify-between mb-2">
          <div class="flex items-center gap-1.5">
            <span class="${o.side === 'buy' ? 'badge-buy' : 'badge-sell'} text-xs px-1.5 py-0.5 rounded font-medium">${o.side.toUpperCase()}</span>
            <span class="text-terminal-text font-semibold text-xs">${o.asset}/USDT</span>
          </div>
          <div class="flex items-center gap-1.5">
            <span class="badge-open text-xs px-1.5 py-0.5 rounded">${o.type}</span>
            <button onclick="cancelOrder('${o.id}')" class="text-terminal-dim hover:text-terminal-red text-xs transition-colors" title="Cancelar">✕</button>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-x-3 gap-y-1 text-xs mb-2">
          <div><span class="text-terminal-dim">Precio: </span><span class="text-terminal-text">$${o.price.toLocaleString('en')}</span></div>
          <div><span class="text-terminal-dim">Cant.: </span><span class="text-terminal-text">${o.amount} ${o.asset}</span></div>
          <div><span class="text-terminal-dim">ID: </span><span class="text-terminal-dim">${o.id}</span></div>
          <div><span class="text-terminal-dim">${o.time}</span></div>
        </div>
        <div class="flex items-center gap-2">
          <div class="progress-bar flex-1"><div class="progress-fill" style="width:${o.filled}%"></div></div>
          <span class="text-terminal-dim text-xs w-8 text-right">${o.filled}%</span>
        </div>
      </div>
    `).join('');
}




// ═══ LIVE PRICE TICK ═════════════════════════════════
function startPriceTick() {
  setInterval(() => {
    ['BTC', 'ETH', 'SOL'].forEach(a => {
      const prev = state.prices[a];
      const delta = prev * (Math.random() - 0.499) * 0.0008;
      state.prices[a] = +(prev + delta).toFixed(a === 'SOL' ? 2 : 2);

      const hdrs = { BTC: 'hdr-btc', ETH: 'hdr-eth', SOL: 'hdr-sol' };
      const el = document.getElementById(hdrs[a]);
      const newTxt = '$' + state.prices[a].toLocaleString('en', { minimumFractionDigits: 2 });
      if (el.textContent !== newTxt) {
        el.textContent = newTxt;
        el.classList.remove('price-flash-up', 'price-flash-dn');
        void el.offsetWidth;
        el.classList.add(delta > 0 ? 'price-flash-up' : 'price-flash-dn');
      }
    });

    // Update active asset
    const p = state.prices[state.asset];
    document.getElementById('current-price').textContent = '$' + p.toLocaleString('en', { minimumFractionDigits: 2 });

    // Refresh market data every 3s
    if (Math.random() > 0.7) {
      renderOrderBook();
      renderRecentTrades();
    }
  }, 1200);
}

// ═══ CHATBOX ═════════════════════════════════════════
let chatOpen = false;

function toggleChat() {
  chatOpen = !chatOpen;
  const aside = document.getElementById('chatbox-aside');
  aside.classList.toggle('open', chatOpen);
  const btn = document.getElementById('chat-toggle-btn');
  btn.style.borderColor = chatOpen ? '#00d4aa99' : '#00d4aa44';
  btn.style.background = chatOpen ? '#00d4aa18' : '#12151c';
}


let aiIdx = 0;

function sendChat() {
  const input = document.getElementById('chat-input');
  const msg = input.value.trim();
  if (!msg) return;

  appendChat(msg, 'user');
  input.value = '';

  setTimeout(() => {
    appendChat(aiReplies[aiIdx % aiReplies.length], 'ai');
    aiIdx++;
    scrollChat();
  }, 600 + Math.random() * 400);
  scrollChat();
}

function quickChat(msg) {
  document.getElementById('chat-input').value = msg;
  sendChat();
}

function appendChat(text, role) {
  const div = document.getElementById('chat-messages');
  const wrap = document.createElement('div');
  wrap.className = role === 'user' ? 'chat-msg-user px-3 py-2 text-xs text-terminal-text' : 'chat-msg-ai px-3 py-2 text-xs text-terminal-text';
  if (role === 'ai') wrap.innerHTML = `<p class="text-terminal-accent text-xs mb-1">CRYPTO_AI</p>${text}`;
  else wrap.innerHTML = `<p class="text-right text-terminal-dim text-xs mb-1">TÚ</p>${text}`;
  div.appendChild(wrap);
  scrollChat();
}

function scrollChat() {
  const c = document.getElementById('chat-messages');
  c.scrollTop = c.scrollHeight;
}

// ═══ NOTIFICATION ════════════════════════════════════
function showNotif(msg, success) {
  const toast = document.getElementById('notif-toast');
  document.getElementById('notif-msg').textContent = msg;
  toast.style.borderColor = success ? '#00d4aa44' : '#ff4d6a44';
  toast.style.color = success ? '#00d4aa' : '#ff4d6a';
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3200);
}

// ═══ BOOT ════════════════════════════════════════════
document.getElementById('order-price').value = state.prices['BTC'];
document.getElementById('avail-balance').textContent = '$' + state.balance.toFixed(0);