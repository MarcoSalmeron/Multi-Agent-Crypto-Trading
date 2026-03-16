import json
import threading
import time
from collections import deque
from datetime import datetime

import websocket

VALID_INTERVALS = [
    "1s", "1m", "3m", "5m", "15m", "30m",
    "1h", "2h", "4h", "6h", "8h", "12h",
    "1d", "3d", "1w", "1M",
]


class CryptoChart:
    BINANCE_WS_BASE = "wss://stream.binance.com:9443/ws"

    def __init__(
        self,
        symbol: str = "btcusdt",
        interval: str = "1m",
        max_candles: int = 100,
    ):
        self.max_candles = max_candles
        self._ws: websocket.WebSocketApp | None = None
        self._thread: threading.Thread | None = None
        self._lock = threading.Lock()

        self._on_candle_callbacks: list = []

        self._symbol = ""
        self._interval = ""
        self._set_params(symbol, interval)
        self._reset_data()

    @property
    def symbol(self) -> str:
        return self._symbol

    @property
    def interval(self) -> str:
        return self._interval

    @property
    def socket_url(self) -> str:
        return f"{self.BINANCE_WS_BASE}/{self._symbol}@kline_{self._interval}"

    def start(self, block: bool = False) -> None:
        self._ws = websocket.WebSocketApp(
            self.socket_url,
            on_message=self._on_message,
            on_open=self._on_open,
            on_close=self._on_close,
            on_error=self._on_error,
        )

        if block:
            self._ws.run_forever()
        else:
            self._thread = threading.Thread(
                target=self._ws.run_forever,
                kwargs={"ping_interval": 30, "ping_timeout": 10},
                daemon=True,
            )
            self._thread.start()

    def stop(self) -> None:
        if self._ws:
            self._ws.close()
            self._ws = None

    def change_symbol(self, symbol: str, interval: str | None = None) -> None:
        self.stop()
        time.sleep(0.5)
        self._set_params(symbol, interval or self._interval)
        self._reset_data()
        self.start()

    def get_data(self) -> dict:
        with self._lock:
            return {
                "symbol": self._symbol.upper(),
                "interval": self._interval,
                "opens": list(self.opens),
                "highs": list(self.highs),
                "lows": list(self.lows),
                "closes": list(self.closes),
                "volumes": list(self.volumes),
                "timestamps": [ts.isoformat() for ts in self.timestamps],  # ✅ ISO strings
                "candle_count": len(self.closes),
            }

    def on_candle(self, callback) -> None:
        self._on_candle_callbacks.append(callback)

    def _set_params(self, symbol: str, interval: str) -> None:
        symbol = symbol.lower().strip()
        interval = interval.strip()
        if interval not in VALID_INTERVALS:
            raise ValueError(
                f"Intervalo '{interval}' no válido. Opciones: {', '.join(VALID_INTERVALS)}"
            )
        self._symbol = symbol
        self._interval = interval

    def _reset_data(self) -> None:
        with self._lock if hasattr(self, "_lock") else threading.Lock():
            self.opens: deque[float] = deque(maxlen=self.max_candles)
            self.closes: deque[float] = deque(maxlen=self.max_candles)
            self.highs: deque[float] = deque(maxlen=self.max_candles)
            self.lows: deque[float] = deque(maxlen=self.max_candles)
            self.volumes: deque[float] = deque(maxlen=self.max_candles)
            self.timestamps: deque[datetime] = deque(maxlen=self.max_candles)  # ✅ nuevo

    def _on_message(self, ws, message: str) -> None:
        json_message = json.loads(message)
        candle = json_message.get("k")
        if not candle:
            return

        if candle["x"]:  # Vela cerrada
            with self._lock:
                self.opens.append(float(candle["o"]))
                self.closes.append(float(candle["c"]))
                self.highs.append(float(candle["h"]))
                self.lows.append(float(candle["l"]))
                self.volumes.append(float(candle["v"]))
                self.timestamps.append(datetime.fromtimestamp(candle["t"] / 1000))  # ✅ guardar datetime

            snapshot = self.get_data()

            for cb in self._on_candle_callbacks:
                try:
                    cb(snapshot)
                except Exception as e:
                    print(f"[CryptoChart] Error en callback: {e}")

    def _on_open(self, ws) -> None:
        print(f"[CryptoChart] 🟢 Conectado → {self._symbol.upper()} [{self._interval}]")

    def _on_close(self, ws, status_code, msg) -> None:
        print(f"[CryptoChart] 🔴 Conexión cerrada [{status_code}]")

    def _on_error(self, ws, error) -> None:
        print(f"[CryptoChart] ⚠️  Error: {error}")