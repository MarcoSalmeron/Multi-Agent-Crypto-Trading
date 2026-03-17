from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, WebSocket, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles
import uvicorn
from Binance_Price_Extraction import CryptoChart
from Binance_Price_Call import seed_chart_with_history
from Binance_Account_Connection import BinanceAccountConnection
import asyncio

app = FastAPI()
app.mount("/static", StaticFiles(directory="static"), name="static")

templates = Jinja2Templates(directory="templates")

chart   = CryptoChart(symbol="btcusdt", interval="1m", max_candles=1500)
account = BinanceAccountConnection()   # lee BINANCE_TESTNET_API_KEY / BINANCE_TESTNET_SECRET_KEY del entorno

clients = []
loop = None

# ── startup ───────────────────────────────────────────────────────────────────
@app.on_event("startup")
async def startup_event():
    global loop
    loop = asyncio.get_running_loop()
    seed_chart_with_history(chart, days=0.5)
    chart.start()
    chart.on_candle(broadcast)


# ── WebSocket de velas (sin cambios) ─────────────────────────────────────────
def broadcast(snapshot):
    asyncio.run_coroutine_threadsafe(_broadcast(snapshot), loop)

async def _broadcast(snapshot):
    data = {
        "symbol":       snapshot["symbol"],
        "interval":     snapshot["interval"],
        "opens":        snapshot["opens"],
        "highs":        snapshot["highs"],
        "lows":         snapshot["lows"],
        "closes":       snapshot["closes"],
        "volumes":      snapshot["volumes"],
        "timestamps":   snapshot["timestamps"],
        "candle_count": snapshot["candle_count"],
    }
    for ws in clients:
        try:
            await ws.send_json(data)
        except Exception:
            pass

@app.websocket("/ws/volume")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    clients.append(websocket)
    try:
        while True:
            await websocket.receive_text()
    except Exception:
        clients.remove(websocket)


# ── páginas (sin cambios) ─────────────────────────────────────────────────────
@app.get("/", response_class=HTMLResponse)
async def get_index(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})

@app.get("/dashboard", response_class=HTMLResponse)
async def get_main(request: Request):
    return templates.TemplateResponse("main.html", {"request": request})


# ── REST: snapshot completo del dashboard ────────────────────────────────────
@app.get("/api/dashboard")
async def get_dashboard():
    ticker   = account.get_ticker_24h("BTCUSDT")
    balance  = account.get_usdt_balance()
    orders   = account.get_open_orders("BTCUSDT")
    trades   = account.get_recent_trades("BTCUSDT", limit=15)
    pnl      = account.get_unrealized_pnl()
    exposure = account.get_exposure()
    return JSONResponse(content={
        "ticker":         ticker,
        "usdt_balance":   balance,
        "open_orders":    orders,
        "recent_trades":  trades,
        "unrealized_pnl": pnl,
        "exposure":       exposure,
    })


# ── REST: ticker BTC ──────────────────────────────────────────────────────────
@app.get("/api/tickers")
async def get_tickers():
    return JSONResponse(content=account.get_ticker_24h("BTCUSDT"))


# ── REST: saldo USDT ─────────────────────────────────────────────────────────
@app.get("/api/balance")
async def get_balance():
    return JSONResponse(content={"usdt_free": account.get_usdt_balance()})


# ── REST: órdenes abiertas BTC ───────────────────────────────────────────────
@app.get("/api/orders")
async def get_open_orders():
    orders   = account.get_open_orders("BTCUSDT")
    pnl      = account.get_unrealized_pnl()
    exposure = account.get_exposure()
    return JSONResponse(content={
        "orders":         orders,
        "unrealized_pnl": pnl,
        "exposure":       exposure,
    })


# ── REST: trades recientes BTC ────────────────────────────────────────────────
@app.get("/api/trades")
async def get_trades(limit: int = 15):
    return JSONResponse(content={"trades": account.get_recent_trades("BTCUSDT", limit)})


# ── REST: colocar orden BTC ───────────────────────────────────────────────────
@app.post("/api/order")
async def place_order(request: Request):
    body       = await request.json()
    order_type = body.get("type", "LIMIT").upper()
    if order_type == "STOP":
        order_type = "STOP_LOSS_LIMIT"

    result = account.place_order(
        symbol     = "BTCUSDT",
        side       = body.get("side", "BUY").upper(),
        order_type = order_type,
        quantity   = float(body.get("quantity", 0)),
        price      = float(body["price"])      if body.get("price")      else None,
        stop_price = float(body["stop_price"]) if body.get("stop_price") else None,
    )
    return JSONResponse(content=result, status_code=400 if "code" in result else 200)


# ── REST: cancelar orden BTC ──────────────────────────────────────────────────
@app.delete("/api/order/{order_id}")
async def cancel_order(order_id: str):
    result = account.cancel_order("BTCUSDT", order_id)
    return JSONResponse(content=result, status_code=400 if "code" in result else 200)


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000)
