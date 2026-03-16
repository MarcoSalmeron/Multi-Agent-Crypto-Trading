from fastapi import FastAPI, WebSocket, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles
import uvicorn
from Binance_Price_Extraction import CryptoChart
import asyncio

app = FastAPI()
app.mount("/static", StaticFiles(directory="static"), name="static")

templates = Jinja2Templates(directory="templates")

chart = CryptoChart(symbol="btcusdt", interval="1m")

clients = []
loop = None

@app.on_event("startup")
async def startup_event():
    global loop
    loop = asyncio.get_running_loop()
    chart.start()
    chart.on_candle(broadcast)


def broadcast(snapshot):
    asyncio.run_coroutine_threadsafe(_broadcast(snapshot), loop)

async def _broadcast(snapshot):
    print(snapshot)
    data = {
        "symbol": snapshot["symbol"],
        "interval": snapshot["interval"],
        "opens": snapshot["opens"],
        "highs": snapshot["highs"],
        "lows": snapshot["lows"],
        "closes": snapshot["closes"],
        "volumes": snapshot["volumes"],
        "timestamps": snapshot["timestamps"],
        "candle_count": snapshot["candle_count"],
    }
    for ws in clients:
        try:
            await ws.send_json(data)
        except Exception:
            pass

@app.get("/", response_class=HTMLResponse)
async def get_main(request: Request):
    return templates.TemplateResponse("main.html", {"request": request})

@app.websocket("/ws/volume")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    clients.append(websocket)
    try:
        while True:
            await websocket.receive_text()
    except Exception:
        clients.remove(websocket)

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000)