// ── Estado ──────────────────────────────────────────────────────────
let chartData   = { opens:[], highs:[], lows:[], closes:[], volumes:[] };
let prevClose   = null;
let chartInited = false;
let volInited   = false;

// ── Plotly — Velas ───────────────────────────────────────────────────
function buildCandleTrace(d) {
  const idx = d.closes.map((_, i) => i);
  return {
    type: 'candlestick',
    x: idx,
    open:  d.opens,
    high:  d.highs,
    low:   d.lows,
    close: d.closes,
    name:  d.symbol,
    increasing: { line: { color: '#26a69a' }, fillcolor: '#26a69a' },
    decreasing: { line: { color: '#ef5350' }, fillcolor: '#ef5350' },
  };
}

const layout = {
  paper_bgcolor: '#131722',
  plot_bgcolor:  '#131722',
  font:  { color: '#d1d4dc', family: 'JetBrains Mono, monospace', size: 11 },
  margin: { t: 40, r: 14, b: 28, l: 60 },
  xaxis: {
    gridcolor: '#2a3045', linecolor: '#2a3045', tickcolor: '#2a3045',
    rangeslider: {
      visible: true,
      bgcolor: '#0b0e17',
      bordercolor: '#2a3045',
      thickness: 0.06,
    },
    rangeselector: {
      bgcolor: '#1e2332',
      activecolor: '#f0b429',
      bordercolor: '#2a3045',
      borderwidth: 1,
      font: { color: '#d1d4dc', size: 10 },
      buttons: [
        { count: 20,  label: '20',  step: 'all', stepmode: 'backward' },
        { count: 50,  label: '50',  step: 'all', stepmode: 'backward' },
        { count: 100, label: '100', step: 'all', stepmode: 'backward' },
        { step: 'all', label: 'Todo' },
      ],
    },
  },
  yaxis: {
    gridcolor: '#2a3045', linecolor: '#2a3045', tickcolor: '#2a3045',
    side: 'right',
    fixedrange: false,
  },
  dragmode: 'zoom',
  showlegend: false,
};

const volLayout = {
  paper_bgcolor: '#131722',
  plot_bgcolor:  '#131722',
  font:  { color: '#5d6378', family: 'JetBrains Mono, monospace', size: 10 },
  margin: { t: 6, r: 14, b: 28, l: 60 },
  xaxis: { gridcolor: '#2a3045', linecolor: '#2a3045' },
  yaxis: { gridcolor: '#2a3045', linecolor: '#2a3045', side: 'right' },
  showlegend: false,
};

function renderCharts(d) {
  const idx    = d.closes.map((_, i) => i);
  const colors = d.closes.map((c, i) => c >= d.opens[i] ? '#26a69a' : '#ef5350');

  if (!chartInited) {
    Plotly.newPlot('chart', [buildCandleTrace(d)], layout, {
      responsive: true,
      displayModeBar: true,
      displaylogo: false,
      modeBarButtonsToRemove: ['toImage', 'sendDataToCloud', 'editInChartStudio'],
      modeBarButtonsToAdd: [],
    });
    chartInited = true;
  } else {
    Plotly.react('chart', [buildCandleTrace(d)], layout);
  }

  const volTrace = {
    type: 'bar', x: idx, y: d.volumes,
    marker: { color: colors, opacity: 0.7 },
    name: 'Volumen',
  };

  if (!volInited) {
    Plotly.newPlot('volumeChart', [volTrace], volLayout, { responsive: true, displayModeBar: false });
    volInited = true;
  } else {
    Plotly.react('volumeChart', [volTrace], volLayout);
  }
}

// ── Sidebar metrics ──────────────────────────────────────────────────
function updateSidebar(d) {
  const n = d.closes.length - 1;
  if (n < 0) return;

  const fmt = v => Number(v).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 6 });

  document.getElementById('mOpen').textContent  = fmt(d.opens[n]);
  document.getElementById('mHigh').textContent  = fmt(d.highs[n]);
  document.getElementById('mLow').textContent   = fmt(d.lows[n]);
  document.getElementById('mClose').textContent = fmt(d.closes[n]);
  document.getElementById('mVol').textContent   = fmt(d.volumes[n]);

  // Status bar
  const close   = d.closes[n];
  const closeEl = document.getElementById('lastClose');
  closeEl.textContent = fmt(close);
  if (prevClose !== null) {
    closeEl.className = close >= prevClose ? 'up' : 'down';
  }
  prevClose = close;

  document.getElementById('statCount').textContent = d.closes.length;

  // Candle log
  const log     = document.getElementById('candleLog');
  const isBull  = d.closes[n] >= d.opens[n];
  const entry   = document.createElement('div');
  entry.className = `log-entry ${isBull ? 'bull' : 'bear'}`;
  entry.innerHTML = `
    <div class="badge"></div>
    <div>
      <div class="log-row">C: <span>${fmt(d.closes[n])}</span> &nbsp; O: <span>${fmt(d.opens[n])}</span></div>
      <div class="log-row">H: <span>${fmt(d.highs[n])}</span> &nbsp; L: <span>${fmt(d.lows[n])}</span></div>
    </div>`;
  log.prepend(entry);
  // Limitar log a 40 entradas
  while (log.children.length > 40) log.removeChild(log.lastChild);
}

// ── Carga inicial ────────────────────────────────────────────────────
async function loadInitial() {
  try {
    const res  = await fetch('/api/data');
    const data = await res.json();
    if (data.closes.length > 0) {
      chartData = data;
      renderCharts(data);
      updateSidebar(data);
    }
  } catch (e) {
    console.warn('Sin datos iniciales:', e);
  }
}

// ── SSE ──────────────────────────────────────────────────────────────
function connectSSE() {
  const es = new EventSource('/stream');

  es.onopen = () => {
    document.getElementById('statusDot').className  = 'live';
    document.getElementById('statusText').textContent = 'En vivo';
  };

  es.onmessage = e => {
    const data = JSON.parse(e.data);
    chartData  = data;
    document.getElementById('statSymbol').textContent   = data.symbol;
    document.getElementById('statInterval').textContent = data.interval;
    renderCharts(data);
    updateSidebar(data);
  };

  es.onerror = () => {
    document.getElementById('statusDot').className  = 'error';
    document.getElementById('statusText').textContent = 'Sin conexión — reintentando…';
    es.close();
    setTimeout(connectSSE, 3000);
  };
}

// ── Cambiar símbolo ───────────────────────────────────────────────────
async function applyChange() {
  const symbol   = document.getElementById('inputSymbol').value.trim();
  const interval = document.getElementById('inputInterval').value;
  const btn      = document.getElementById('btnApply');

  if (!symbol) return;
  btn.disabled    = true;
  btn.textContent = 'Aplicando…';

  // Reset visual
  chartInited = false;
  volInited   = false;
  prevClose   = null;
  document.getElementById('candleLog').innerHTML = '';
  Plotly.purge('chart');
  Plotly.purge('volumeChart');

  try {
    const res  = await fetch('/api/change', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ symbol, interval }),
    });
    const data = await res.json();
    if (!data.ok) alert('Error: ' + data.error);
  } catch (e) {
    alert('Error de red: ' + e.message);
  }

  btn.disabled    = false;
  btn.textContent = 'Aplicar';
}

// ── Cambio automático al seleccionar símbolo ─────────────────────────
document.getElementById('inputSymbol')
  .addEventListener('change', () => applyChange());

// ── Init ──────────────────────────────────────────────────────────────
loadInitial().then(connectSSE);