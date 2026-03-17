"""
Binance_Account_Connection.py
──────────────────────────────
Conecta con la cuenta demo (Testnet) de Binance Spot y expone métodos
para obtener:
  - Saldo USDT disponible
  - Precio actual + stats 24h de cualquier par
  - Órdenes abiertas
  - Trades recientes (fills)
  - Colocación y cancelación de órdenes

Testnet Spot:  https://testnet.binance.vision
Genera tus API keys en: https://testnet.binance.vision  (requiere login con GitHub)

Variables de entorno necesarias (o pásalas al constructor):
    BINANCE_TESTNET_API_KEY
    BINANCE_TESTNET_SECRET_KEY
"""

import hashlib
import hmac
import os
import time
from datetime import datetime
from typing import Optional
from urllib.parse import urlencode

import requests

# ────────────────────────── constantes ──────────────────────────────────────

TESTNET_BASE = "https://testnet.binance.vision"

ENDPOINTS = {
    "ping":         "/api/v3/ping",
    "ticker_24h":   "/api/v3/ticker/24hr",
    "ticker_price": "/api/v3/ticker/price",
    "account":      "/api/v3/account",
    "open_orders":  "/api/v3/openOrders",
    "my_trades":    "/api/v3/myTrades",
    "order":        "/api/v3/order",
    "depth":        "/api/v3/depth",
}

TRACKED_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT"]


# ────────────────────────── clase principal ──────────────────────────────────

class BinanceAccountConnection:

    def __init__(
        self,
        api_key:    Optional[str] = None,
        secret_key: Optional[str] = None,
    ):
        self.api_key    = api_key    or os.getenv("BINANCE_TESTNET_API_KEY")
        self.secret_key = secret_key or os.getenv("BINANCE_TESTNET_SECRET_KEY")
        self.session    = requests.Session()
        self.session.headers.update({"X-MBX-APIKEY": self.api_key})

        if not self.api_key or not self.secret_key:
            print(
                "[BinanceAccount] ⚠️  Sin credenciales. "
                "Define BINANCE_TESTNET_API_KEY y BINANCE_TESTNET_SECRET_KEY."
            )

    # ── helpers de firma ─────────────────────────────────────────────────────

    def _sign(self, params: dict) -> dict:
        params["timestamp"] = int(time.time() * 1000)
        query = urlencode(params)
        sig   = hmac.new(
            self.secret_key.encode(),
            query.encode(),
            hashlib.sha256,
        ).hexdigest()
        params["signature"] = sig
        return params

    def _get(self, endpoint: str, params: dict | None = None, signed: bool = False) -> dict | list:
        params = params or {}
        if signed:
            params = self._sign(params)
        try:
            r = self.session.get(TESTNET_BASE + endpoint, params=params, timeout=8)
            r.raise_for_status()
            return r.json()
        except requests.RequestException as exc:
            print(f"[BinanceAccount] GET error {endpoint}: {exc}")
            return {}

    def _post(self, endpoint: str, params: dict) -> dict:
        params = self._sign(params)
        try:
            r = self.session.post(TESTNET_BASE + endpoint, params=params, timeout=8)
            r.raise_for_status()
            return r.json()
        except requests.RequestException as exc:
            print(f"[BinanceAccount] POST error {endpoint}: {exc}")
            return {}

    def _delete(self, endpoint: str, params: dict) -> dict:
        params = self._sign(params)
        try:
            r = self.session.delete(TESTNET_BASE + endpoint, params=params, timeout=8)
            r.raise_for_status()
            return r.json()
        except requests.RequestException as exc:
            print(f"[BinanceAccount] DELETE error {endpoint}: {exc}")
            return {}

    # ── conectividad ──────────────────────────────────────────────────────────

    def ping(self) -> bool:
        result = self._get(ENDPOINTS["ping"])
        ok = result == {}
        print("[BinanceAccount]", "🟢 Testnet OK" if ok else "🔴 Sin respuesta")
        return ok

    # ── mercado (público, sin firma) ─────────────────────────────────────────

    def get_ticker_24h(self, symbol: str) -> dict:
        """
        Retorna estadísticas 24h para el par solicitado:
        lastPrice, priceChangePercent, highPrice, lowPrice, volume, quoteVolume
        """
        raw = self._get(ENDPOINTS["ticker_24h"], {"symbol": symbol.upper()})
        if not raw or "lastPrice" not in raw:
            return {}
        return {
            "symbol":           raw["symbol"],
            "price":            float(raw["lastPrice"]),
            "change_pct":       float(raw["priceChangePercent"]),
            "high_24h":         float(raw["highPrice"]),
            "low_24h":          float(raw["lowPrice"]),
            "volume":           float(raw["volume"]),          # en base asset
            "quote_volume":     float(raw["quoteVolume"]),     # en USDT
        }

    def get_all_tickers(self) -> dict:
        """
        Retorna un dict { "BTCUSDT": {...}, "ETHUSDT": {...}, "SOLUSDT": {...} }
        con las estadísticas 24h de los pares rastreados.
        """
        result = {}
        for sym in TRACKED_SYMBOLS:
            data = self.get_ticker_24h(sym)
            if data:
                result[sym] = data
        return result

    def get_order_book(self, symbol: str, limit: int = 10) -> dict:
        """Retorna bids y asks del order book."""
        raw = self._get(ENDPOINTS["depth"], {"symbol": symbol.upper(), "limit": limit})
        if not raw:
            return {"bids": [], "asks": []}
        return {
            "bids": [[float(p), float(q)] for p, q in raw.get("bids", [])],
            "asks": [[float(p), float(q)] for p, q in raw.get("asks", [])],
        }

    # ── cuenta (requiere firma) ───────────────────────────────────────────────

    def get_balances(self) -> dict:
        """
        Retorna los saldos relevantes de la cuenta Testnet.
        { "USDT": {"free": 24850.0, "locked": 0.0}, "BTC": {...}, ... }
        """
        raw = self._get(ENDPOINTS["account"], signed=True)
        if not raw or "balances" not in raw:
            return {}

        coins_of_interest = {"USDT", "BTC", "ETH", "SOL", "BNB"}
        balances = {}
        for b in raw["balances"]:
            asset = b["asset"]
            if asset in coins_of_interest:
                free   = float(b["free"])
                locked = float(b["locked"])
                if free > 0 or locked > 0:
                    balances[asset] = {"free": free, "locked": locked}
        return balances

    def get_usdt_balance(self) -> float:
        """Atajo: devuelve solo el saldo libre en USDT."""
        bals = self.get_balances()
        return bals.get("USDT", {}).get("free", 0.0)

    def get_open_orders(self, symbol: Optional[str] = None) -> list[dict]:
        """
        Devuelve las órdenes abiertas.  Si se proporciona symbol se filtra.
        Cada elemento del resultado:
        {
          id, symbol, side, type, price, orig_qty, executed_qty,
          filled_pct, status, time, client_order_id
        }
        """
        params = {}
        if symbol:
            params["symbol"] = symbol.upper()

        raw = self._get(ENDPOINTS["open_orders"], params, signed=True)
        if not isinstance(raw, list):
            return []

        orders = []
        for o in raw:
            orig   = float(o.get("origQty", 0))
            filled = float(o.get("executedQty", 0))
            pct    = round((filled / orig * 100) if orig else 0, 1)
            sym    = o.get("symbol", "")
            # Extrae el asset base (BTC, ETH, SOL) quitando USDT
            base_asset = sym.replace("USDT", "")
            orders.append({
                "id":              str(o.get("orderId", "")),
                "client_order_id": o.get("clientOrderId", ""),
                "symbol":          sym,
                "asset":           base_asset,
                "side":            o.get("side", "").lower(),
                "type":            o.get("type", "").lower(),
                "price":           float(o.get("price", 0)),
                "orig_qty":        orig,
                "executed_qty":    filled,
                "filled_pct":      pct,
                "status":          o.get("status", ""),
                "time":            datetime.fromtimestamp(
                                       o["time"] / 1000
                                   ).strftime("%H:%M") if "time" in o else "--",
            })
        return orders

    def get_recent_trades(self, symbol: str, limit: int = 20) -> list[dict]:
        """
        Devuelve los últimos trades ejecutados del usuario en el par indicado.
        """
        raw = self._get(
            ENDPOINTS["my_trades"],
            {"symbol": symbol.upper(), "limit": limit},
            signed=True,
        )
        if not isinstance(raw, list):
            return []

        trades = []
        for t in raw:
            qty   = float(t.get("qty", 0))
            price = float(t.get("price", 0))
            side  = "buy" if t.get("isBuyer") else "sell"
            trades.append({
                "id":     str(t.get("id", "")),
                "symbol": t.get("symbol", ""),
                "side":   side,
                "price":  price,
                "qty":    qty,
                "total":  round(price * qty, 4),
                "time":   datetime.fromtimestamp(
                              t["time"] / 1000
                          ).strftime("%H:%M:%S") if "time" in t else "--",
            })
        return list(reversed(trades))  # más reciente primero

    def get_unrealized_pnl(self) -> float:
        """
        Calcula un P&L no realizado aproximado comparando el precio medio de
        las órdenes abiertas vs el precio actual del mercado.
        (Estimación simplificada para la demo Testnet)
        """
        orders = self.get_open_orders()
        if not orders:
            return 0.0

        total_pnl = 0.0
        tickers   = self.get_all_tickers()

        for o in orders:
            sym          = o["symbol"]
            market_price = tickers.get(sym, {}).get("price", 0)
            order_price  = o["price"]
            qty          = o["orig_qty"]

            if market_price and order_price and qty:
                if o["side"] == "buy":
                    total_pnl += (market_price - order_price) * qty
                else:
                    total_pnl += (order_price - market_price) * qty

        return round(total_pnl, 2)

    def get_exposure(self) -> float:
        """
        Calcula la exposición total (valor nocional) de todas las órdenes
        abiertas usando el precio actual del mercado.
        """
        orders  = self.get_open_orders()
        tickers = self.get_all_tickers()
        total   = 0.0
        for o in orders:
            price = tickers.get(o["symbol"], {}).get("price", o["price"])
            total += price * o["orig_qty"]
        return round(total, 2)

    # ── colocación / cancelación de órdenes ──────────────────────────────────

    def place_order(
        self,
        symbol:    str,
        side:      str,          # "BUY" | "SELL"
        order_type: str,         # "LIMIT" | "MARKET" | "STOP_LOSS_LIMIT"
        quantity:  float,
        price:     Optional[float] = None,
        stop_price: Optional[float] = None,
    ) -> dict:
        """
        Coloca una orden en la cuenta Testnet.
        Retorna la respuesta de Binance o {} en caso de error.
        """
        params: dict = {
            "symbol":   symbol.upper(),
            "side":     side.upper(),
            "type":     order_type.upper(),
            "quantity": f"{quantity:.8f}",
        }

        if order_type.upper() in ("LIMIT", "STOP_LOSS_LIMIT"):
            if price is None:
                raise ValueError("price es requerido para órdenes LIMIT y STOP_LOSS_LIMIT")
            params["price"]       = f"{price:.8f}"
            params["timeInForce"] = "GTC"

        if order_type.upper() == "STOP_LOSS_LIMIT":
            if stop_price is None:
                raise ValueError("stop_price es requerido para STOP_LOSS_LIMIT")
            params["stopPrice"] = f"{stop_price:.8f}"

        result = self._post(ENDPOINTS["order"], params)
        return result

    def cancel_order(self, symbol: str, order_id: str) -> dict:
        """Cancela una orden abierta por su orderId."""
        return self._delete(
            ENDPOINTS["order"],
            {"symbol": symbol.upper(), "orderId": int(order_id)},
        )

    # ── snapshot completo para el frontend ───────────────────────────────────

    def get_dashboard_snapshot(self) -> dict:
        """
        Devuelve en una sola llamada todo lo que necesita el frontend:
          - tickers (BTC, ETH, SOL)
          - usdt_balance
          - open_orders
          - recent_trades (BTC por defecto)
          - unrealized_pnl
          - exposure
        """
        tickers       = self.get_all_tickers()
        usdt_balance  = self.get_usdt_balance()
        open_orders   = self.get_open_orders()
        recent_trades = self.get_recent_trades("BTCUSDT", limit=15)
        pnl           = self.get_unrealized_pnl()
        exposure      = self.get_exposure()

        return {
            "tickers":       tickers,
            "usdt_balance":  usdt_balance,
            "open_orders":   open_orders,
            "recent_trades": recent_trades,
            "unrealized_pnl": pnl,
            "exposure":       exposure,
        }