"""
Binance_Price_Call.py
─────────────────────
Carga datos históricos de velas (klines) desde la API REST de Binance y los
inyecta directamente en un objeto CryptoChart antes de que arranque el
WebSocket en tiempo real.

Uso típico en app.py
────────────────────
    from Binance_Price_Extraction import CryptoChart
    from Binance_Price_Call import seed_chart_with_history

    chart = CryptoChart(symbol="btcusdt", interval="1m", max_candles=1000)
    seed_chart_with_history(chart, days=1)   # precarga 1 día de historia
    chart.start()                            # luego arranca el WebSocket
    chart.on_candle(broadcast)
"""

import threading
import time
from collections import deque
from datetime import datetime, timedelta, timezone
from typing import Optional

import requests

# ─────────────────────────── constantes ────────────────────────────────────

BINANCE_REST_BASE = "https://api.binance.com"
KLINES_ENDPOINT   = "/api/v3/klines"

# Límite oficial de la API por petición
_MAX_LIMIT_PER_REQUEST = 1000

# Mapeo intervalo → milisegundos (para calcular cuántas velas hay en N días)
_INTERVAL_MS: dict[str, int] = {
    "1s":  1_000,
    "1m":  60_000,
    "3m":  180_000,
    "5m":  300_000,
    "15m": 900_000,
    "30m": 1_800_000,
    "1h":  3_600_000,
    "2h":  7_200_000,
    "4h":  14_400_000,
    "6h":  21_600_000,
    "8h":  28_800_000,
    "12h": 43_200_000,
    "1d":  86_400_000,
    "3d":  259_200_000,
    "1w":  604_800_000,
    "1M":  2_592_000_000,  # ≈ 30 días
}


# ─────────────────────────── helpers internos ──────────────────────────────

def _now_ms() -> int:
    """Timestamp actual en milisegundos (UTC)."""
    return int(datetime.now(timezone.utc).timestamp() * 1000)


def _fetch_klines(
    symbol: str,
    interval: str,
    start_ms: int,
    end_ms: int,
) -> list[list]:
    """
    Descarga todas las velas entre start_ms y end_ms realizando
    paginación automática si el rango supera el límite de 1 000 velas
    por petición.

    Retorna lista de klines en formato Binance:
    [open_time, open, high, low, close, volume, close_time, ...]
    """
    all_klines: list[list] = []
    current_start = start_ms

    while current_start < end_ms:
        params = {
            "symbol":    symbol.upper(),
            "interval":  interval,
            "startTime": current_start,
            "endTime":   end_ms,
            "limit":     _MAX_LIMIT_PER_REQUEST,
        }

        try:
            response = requests.get(
                BINANCE_REST_BASE + KLINES_ENDPOINT,
                params=params,
                timeout=10,
            )
            response.raise_for_status()
        except requests.RequestException as exc:
            print(f"[Binance_Price_Call] ⚠️  Error en petición REST: {exc}")
            break

        batch: list[list] = response.json()

        if not batch:
            break

        all_klines.extend(batch)

        # La próxima página empieza después del close_time de la última vela
        last_close_time: int = batch[-1][6]
        current_start = last_close_time + 1

        # Si recibimos menos de limit, no hay más páginas
        if len(batch) < _MAX_LIMIT_PER_REQUEST:
            break

        # Pequeña pausa para no saturar la API
        time.sleep(0.1)

    return all_klines


def _klines_to_candles(klines: list[list]) -> dict:
    """
    Convierte la lista cruda de klines al mismo formato que usa
    CryptoChart.get_data():
        opens, highs, lows, closes, volumes, timestamps
    """
    opens      = [float(k[1]) for k in klines]
    highs      = [float(k[2]) for k in klines]
    lows       = [float(k[3]) for k in klines]
    closes     = [float(k[4]) for k in klines]
    volumes    = [float(k[5]) for k in klines]
    timestamps = [
        datetime.fromtimestamp(k[0] / 1000)   # open_time → datetime local
        for k in klines
    ]
    return {
        "opens":      opens,
        "highs":      highs,
        "lows":       lows,
        "closes":     closes,
        "volumes":    volumes,
        "timestamps": timestamps,
    }


# ─────────────────────────── función pública ───────────────────────────────

def fetch_historical(
    symbol: str,
    interval: str,
    days: float = 1.0,
    end_time: Optional[datetime] = None,
) -> dict:
    """
    Descarga velas históricas de Binance.

    Parámetros
    ──────────
    symbol    : par de trading, ej. "btcusdt"
    interval  : intervalo de velas, ej. "1m", "5m", "1h" …
    days      : cuántos días hacia atrás descargar (puede ser decimal, ej. 0.5)
    end_time  : momento de fin; si es None usa el instante actual

    Retorna
    ───────
    dict con claves: opens, highs, lows, closes, volumes, timestamps
    """
    end_ms   = int((end_time or datetime.now(timezone.utc)).timestamp() * 1000)
    start_ms = end_ms - int(days * 24 * 3600 * 1000)

    interval_ms = _INTERVAL_MS.get(interval)
    if interval_ms is None:
        raise ValueError(f"Intervalo '{interval}' no reconocido en Binance_Price_Call.")

    estimated_candles = (end_ms - start_ms) // interval_ms
    print(
        f"[Binance_Price_Call] 📥 Descargando ~{estimated_candles} velas "
        f"de {symbol.upper()} [{interval}] ({days} día(s))…"
    )

    klines = _fetch_klines(symbol, interval, start_ms, end_ms)

    if not klines:
        print("[Binance_Price_Call] ⚠️  No se recibieron datos históricos.")
        return {"opens": [], "highs": [], "lows": [], "closes": [], "volumes": [], "timestamps": []}

    candles = _klines_to_candles(klines)
    print(f"[Binance_Price_Call] ✅ {len(candles['closes'])} velas cargadas.")
    return candles


def seed_chart_with_history(
    chart,                  # instancia de CryptoChart
    days: float = 1.0,
    end_time: Optional[datetime] = None,
) -> None:
    """
    Descarga datos históricos e inyecta las velas directamente en las
    deques internas de un objeto CryptoChart, respetando su max_candles.

    Llamar ANTES de chart.start() para que el WebSocket continúe desde
    donde quedaron los datos históricos.

    Parámetros
    ──────────
    chart    : instancia de CryptoChart ya configurada (symbol + interval)
    days     : cuántos días hacia atrás cargar
    end_time : momento de corte; None → ahora
    """
    candles = fetch_historical(
        symbol   = chart.symbol,
        interval = chart.interval,
        days     = days,
        end_time = end_time,
    )

    if not candles["closes"]:
        return

    # Respeta el límite max_candles: toma las últimas N velas
    limit = chart.max_candles
    for key in ("opens", "highs", "lows", "closes", "volumes", "timestamps"):
        candles[key] = candles[key][-limit:]

    with chart._lock:
        chart.opens      = deque(candles["opens"],      maxlen=chart.max_candles)
        chart.highs      = deque(candles["highs"],      maxlen=chart.max_candles)
        chart.lows       = deque(candles["lows"],       maxlen=chart.max_candles)
        chart.closes     = deque(candles["closes"],     maxlen=chart.max_candles)
        chart.volumes    = deque(candles["volumes"],    maxlen=chart.max_candles)
        chart.timestamps = deque(candles["timestamps"], maxlen=chart.max_candles)

    print(
        f"[Binance_Price_Call] 🚀 CryptoChart pre-cargado con "
        f"{len(chart.closes)} velas históricas. El WebSocket continuará en tiempo real."
    )