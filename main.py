"""
main.py — Servidor Flask para el dashboard de velas japonesas.

Endpoints
---------
GET  /                          → Renderiza dashboard.html
GET  /api/data                  → Snapshot JSON de velas actuales
POST /api/change                → Cambia símbolo/intervalo { symbol, interval }
GET  /stream                    → SSE: empuja datos en tiempo real al browser
"""
import json
import queue

from flask import Flask, Response, jsonify, render_template, request

from Binance_Price_Extraction import CryptoChart

# ---------------------------------------------------------------------------
# App & estado global
# ---------------------------------------------------------------------------

app = Flask(__name__)

# Cola compartida para SSE: cada ítem es un string JSON listo para enviar
_sse_queue: queue.Queue = queue.Queue(maxsize=50)

chart = CryptoChart(symbol="btcusdt", interval="1m", max_candles=200)


def _broadcast(data: dict) -> None:
    """Callback que recibe cada vela cerrada y la mete en la cola SSE."""
    payload = json.dumps(data)
    try:
        _sse_queue.put_nowait(payload)
    except queue.Full:
        # Si la cola está llena descartamos el ítem más viejo
        try:
            _sse_queue.get_nowait()
        except queue.Empty:
            pass
        _sse_queue.put_nowait(payload)


chart.on_candle(_broadcast)
chart.start()          # Arranca el WebSocket en un hilo daemon

# ---------------------------------------------------------------------------
# Rutas
# ---------------------------------------------------------------------------
@app.route("/")
def index_page():
    return render_template("index.html")

@app.route("/login")
def login_page():
    return render_template("login.html")

@app.route("/dashboard")
def dashboard_page():
    """Página principal — renderiza el dashboard."""
    return render_template(
        "dashboard.html",
        symbol=chart.symbol.upper(),
        interval=chart.interval,
    )


@app.route("/api/data")
def api_data():
    """Devuelve el snapshot JSON actual (útil para carga inicial)."""
    return jsonify(chart.get_data())


@app.route("/api/change", methods=["POST"])
def api_change():
    """
    Cambia símbolo e intervalo en caliente.

    Body JSON esperado:
        { "symbol": "ethusdt", "interval": "5m" }
    """
    body = request.get_json(silent=True) or {}
    symbol = body.get("symbol", chart.symbol).strip().lower()
    interval = body.get("interval", chart.interval).strip()

    try:
        chart.change_symbol(symbol, interval)
        return jsonify({"ok": True, "symbol": symbol.upper(), "interval": interval})
    except ValueError as e:
        return jsonify({"ok": False, "error": str(e)}), 400


@app.route("/stream")
def stream():
    """
    Server-Sent Events: el browser se suscribe aquí y recibe
    cada vela cerrada como evento JSON.
    """

    def event_generator():
        # Mandamos un comentario de keep-alive cada ~15s si no hay datos
        local_q: queue.Queue = queue.Queue()

        # Cada cliente tiene su propio listener para no competir por la cola
        def listener(data: dict):
            local_q.put_nowait(json.dumps(data))

        chart.on_candle(listener)

        try:
            while True:
                try:
                    payload = local_q.get(timeout=15)
                    yield f"data: {payload}\n\n"
                except queue.Empty:
                    yield ": keep-alive\n\n"  # Evita que el browser cierre la conexión
        except GeneratorExit:
            # El cliente desconectó — limpiamos el listener
            if listener in chart._on_candle_callbacks:
                chart._on_candle_callbacks.remove(listener)

    return Response(
        event_generator(),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",   # Necesario si usas Nginx
        },
    )


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    # use_reloader=False es CRÍTICO: evita que Flask arranque dos procesos
    # (y por tanto dos conexiones WebSocket a Binance)
    app.run(host="0.0.0.0", port=5000, debug=True, use_reloader=False)
