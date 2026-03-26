from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List
import yfinance as yf
import pandas as pd
import numpy as np
from datetime import datetime
import os, json, httpx
from dotenv import load_dotenv

load_dotenv()

# ── Env vars ──────────────────────────────────────────────────────────────────
GROQ_KEY           = os.getenv("GROQ_KEY", "")
ELEVENLABS_KEY     = os.getenv("ELEVENLABS_KEY", "")
NEWS_API_KEY       = os.getenv("NEWS_API_KEY", "")
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
BACKEND_URL        = os.getenv("BACKEND_URL", "https://investedge-api.onrender.com")
GROQ_MODEL         = "llama-3.3-70b-versatile"
TELEGRAM_API       = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}"

# ── Nifty 50 symbols ──────────────────────────────────────────────────────────
NIFTY50 = [
    "RELIANCE","TCS","HDFCBANK","INFY","ICICIBANK","HINDUNILVR","ITC",
    "SBIN","BAJFINANCE","BHARTIARTL","KOTAKBANK","LT","AXISBANK","ASIANPAINT",
    "MARUTI","HCLTECH","SUNPHARMA","TITAN","ULTRACEMCO","WIPRO","NESTLEIND",
    "ONGC","NTPC","POWERGRID","JSWSTEEL","TATAMOTORS","ADANIENT","ADANIPORTS",
    "COALINDIA","DIVISLAB","DRREDDY","EICHERMOT","GRASIM","HEROMOTOCO",
    "HINDALCO","INDUSINDBK","M&M","BAJAJFINSV","BAJAJ-AUTO","TECHM",
    "BRITANNIA","CIPLA","APOLLOHOSP","BPCL","TATACONSUM","LTIM","TATASTEEL"
]

# ── Technical indicators ──────────────────────────────────────────────────────
def _ema(series, length):
    return series.ewm(span=length, adjust=False).mean()

def _rsi(series, length=14):
    delta    = series.diff()
    gain     = delta.clip(lower=0)
    loss     = -delta.clip(upper=0)
    avg_gain = gain.ewm(com=length-1, adjust=False).mean()
    avg_loss = loss.ewm(com=length-1, adjust=False).mean()
    rs       = avg_gain / avg_loss.replace(0, np.nan)
    return 100 - (100 / (1 + rs))

def _macd(series, fast=12, slow=26, signal=9):
    ef  = _ema(series, fast)
    es  = _ema(series, slow)
    ml  = ef - es
    sl  = _ema(ml, signal)
    return ml, sl, ml - sl

def _bbands(series, length=20, std=2):
    mid   = series.rolling(length).mean()
    sigma = series.rolling(length).std()
    return mid + std*sigma, mid, mid - std*sigma

def _atr(high, low, close, length=14):
    pc = close.shift(1)
    tr = pd.concat([high-low, (high-pc).abs(), (low-pc).abs()], axis=1).max(axis=1)
    return tr.ewm(com=length-1, adjust=False).mean()

# ── Helpers ───────────────────────────────────────────────────────────────────
def nse(symbol):
    s = symbol.upper().strip()
    return s if s.endswith(".NS") or s.endswith(".BO") else s + ".NS"

def sf(val):
    if val is None: return None
    try:
        f = float(val)
        return None if (np.isnan(f) or np.isinf(f)) else round(f, 2)
    except: return None

def flatten_cols(df):
    df.columns = [c[0] if isinstance(c, tuple) else c for c in df.columns]
    return df.rename(columns={"Open":"open","High":"high","Low":"low",
                               "Close":"close","Volume":"volume"})

# ── FAISS RAG ─────────────────────────────────────────────────────────────────
_rag_index    = None
_rag_articles = []
_rag_model    = None
_rag_ready    = False

def _get_rag_model():
    global _rag_model
    if _rag_model is None:
        try:
            from sentence_transformers import SentenceTransformer
            _rag_model = SentenceTransformer("all-MiniLM-L6-v2")
        except: pass
    return _rag_model

def _build_rag_index(articles):
    global _rag_index, _rag_articles, _rag_ready
    try:
        import faiss
        model = _get_rag_model()
        if not model or not articles: return False
        texts      = [a.get("title","") + " " + a.get("description","") + " " + a.get("symbol","") for a in articles]
        embeddings = model.encode(texts, convert_to_numpy=True).astype("float32")
        faiss.normalize_L2(embeddings)
        idx = faiss.IndexFlatIP(embeddings.shape[1])
        idx.add(embeddings)
        _rag_index    = idx
        _rag_articles = articles
        _rag_ready    = True
        return True
    except Exception as e:
        print(f"[RAG build] {e}")
        return False

def _rag_search(query, k=15):
    try:
        import faiss
        model = _get_rag_model()
        if not model or _rag_index is None: return []
        q = model.encode([query], convert_to_numpy=True).astype("float32")
        faiss.normalize_L2(q)
        scores, indices = _rag_index.search(q, k)
        return [_rag_articles[i] for s, i in zip(scores[0], indices[0])
                if i < len(_rag_articles) and float(s) > 0.25]
    except Exception as e:
        print(f"[RAG search] {e}")
        return []

# ── NewsAPI ───────────────────────────────────────────────────────────────────
async def _fetch_newsapi(query: str, page_size: int = 30) -> list:
    if not NEWS_API_KEY:
        return []
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get("https://newsapi.org/v2/everything", params={
                "q":        query,
                "apiKey":   NEWS_API_KEY,
                "language": "en",
                "sortBy":   "publishedAt",
                "pageSize": page_size,
                "domains":  "economictimes.indiatimes.com,moneycontrol.com,business-standard.com,livemint.com"
            })
        if resp.status_code == 200:
            return [{
                "title":       a.get("title",""),
                "description": a.get("description","") or "",
                "publisher":   a.get("source",{}).get("name",""),
                "link":        a.get("url",""),
                "time":        (a.get("publishedAt") or "")[:10],
                "symbol":      ""
            } for a in resp.json().get("articles",[]) if a.get("title")]
    except Exception as e:
        print(f"[NewsAPI] {e}")
    return []

# ── Groq LLM call ─────────────────────────────────────────────────────────────
async def _groq(prompt: str, max_tokens: int = 150, temperature: float = 0.3) -> str:
    if not GROQ_KEY:
        return ""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={"Authorization": f"Bearer {GROQ_KEY}", "Content-Type": "application/json"},
                json={"model": GROQ_MODEL,
                      "messages": [{"role": "user", "content": prompt}],
                      "max_tokens": max_tokens, "temperature": temperature}
            )
        return resp.json()["choices"][0]["message"]["content"].strip()
    except Exception as e:
        print(f"[Groq] {e}")
        return ""

# ── Telegram helpers ──────────────────────────────────────────────────────────
SUBSCRIBERS_FILE = "subscribers.json"

def _load_subs():
    try:
        with open(SUBSCRIBERS_FILE) as f: return json.load(f)
    except: return []

def _save_subs(subs):
    with open(SUBSCRIBERS_FILE, "w") as f: json.dump(subs, f)

async def _tg_send(chat_id: int, text: str):
    if not TELEGRAM_BOT_TOKEN: return
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            await client.post(f"{TELEGRAM_API}/sendMessage",
                json={"chat_id": chat_id, "text": text, "parse_mode": "Markdown"})
    except Exception as e:
        print(f"[Telegram send] {e}")

async def _handle_telegram(update: dict):
    msg     = update.get("message", {})
    chat_id = msg.get("chat", {}).get("id")
    text    = (msg.get("text") or "").strip()
    if not chat_id or not text: return

    if text == "/start":
        await _tg_send(chat_id,
            "🧠 *Welcome to InvestEdge AI!*\n\n"
            "India's AI intelligence layer for 14 crore retail investors.\n\n"
            "Commands:\n"
            "/subscribe — Get daily NSE alerts every morning\n"
            "/alerts — See today's top opportunities\n"
            "/help — Show all commands\n\n"
            "Or just type any NSE stock symbol:\n`RELIANCE` `TCS` `HDFCBANK` `INFY`")
        return

    if text == "/subscribe":
        subs = _load_subs()
        if chat_id not in subs:
            subs.append(chat_id)
            _save_subs(subs)
            await _tg_send(chat_id,
                "✅ *Subscribed to InvestEdge Daily Alerts!*\n\n"
                "You'll receive top NSE opportunities every morning at 9 AM.\n\n"
                "Try typing a stock symbol like `RELIANCE` for instant AI analysis.\n\n"
                f"🔗 Full platform: {BACKEND_URL.replace('-api','')}")
        else:
            await _tg_send(chat_id, "You're already subscribed! ✅\nType any stock symbol for instant analysis.")
        return

    if text == "/unsubscribe":
        subs = _load_subs()
        if chat_id in subs:
            subs.remove(chat_id)
            _save_subs(subs)
        await _tg_send(chat_id, "Unsubscribed. You won't receive daily alerts anymore.")
        return

    if text == "/help":
        await _tg_send(chat_id,
            "📖 *InvestEdge Bot Commands*\n\n"
            "/subscribe — Daily NSE alerts at 9 AM\n"
            "/alerts — Today's top opportunities\n"
            "/unsubscribe — Stop alerts\n\n"
            "Type any NSE symbol for instant analysis:\n"
            "`RELIANCE` `TCS` `HDFCBANK` `INFY` `SBIN`")
        return

    if text == "/alerts":
        await _tg_send(chat_id, "📡 _Fetching today's top opportunities..._")
        try:
            async with httpx.AsyncClient(timeout=40.0) as client:
                resp = await client.get(f"{BACKEND_URL}/api/daily-alerts")
            if resp.status_code == 200:
                data  = resp.json()
                lines = [f"🚨 *InvestEdge Daily Alerts — {data['date']}*\n"]
                for a in data["alerts"][:5]:
                    lines.append(f"📈 *{a['symbol']}* — {a['headline']}")
                    if a.get("detail"):
                        lines.append(f"_{a['detail']}_\n")
                lines.append(f"\n🔗 Full analysis: {BACKEND_URL.replace('-api.onrender','').replace('https://','https://investedge.')}")
                await _tg_send(chat_id, "\n".join(lines))
        except Exception as e:
            await _tg_send(chat_id, f"⚠️ Could not fetch alerts: {e}")
        return

    # Stock symbol query
    symbol = text.upper().replace(".NS","").replace(".BO","")
    if symbol.replace("&","").replace("-","").isalpha() and len(symbol) <= 15:
        await _tg_send(chat_id, f"📡 _Fetching live AI analysis for *{symbol}*..._")
        try:
            async with httpx.AsyncClient(timeout=35.0) as client:
                resp = await client.post(f"{BACKEND_URL}/api/patterns",
                    json={"symbol": symbol, "period": "3mo"})
            if resp.status_code == 200:
                d      = resp.json()
                price  = d.get("price", {})
                sigs   = d.get("signals", [])
                bull   = sum(1 for s in sigs if s["direction"] == "bullish")
                bear   = sum(1 for s in sigs if s["direction"] == "bearish")
                emoji  = "🟢" if d["bias"]=="bullish" else "🔴" if d["bias"]=="bearish" else "⚪"
                chg    = price.get("change_pct") or 0
                top    = "\n".join([f"  • {s['type']}" for s in sigs[:4]])
                expl   = d.get("explanation", "")
                msg = (
                    f"{emoji} *{d['display']}* — {d['bias'].upper()}\n\n"
                    f"💰 ₹{price.get('current','N/A')} "
                    f"({'▲' if chg>=0 else '▼'}{abs(chg):.1f}%)\n"
                    f"📊 RSI: {price.get('rsi','N/A')} | "
                    f"Signals: 🟢{bull} 🔴{bear}\n\n"
                    f"*Top Signals:*\n{top}\n"
                )
                if expl:
                    msg += f"\n🧠 _{expl}_\n"
                msg += f"\n[Source: NSE · {datetime.now().strftime('%d %b %Y')}]"
                await _tg_send(chat_id, msg)
            else:
                await _tg_send(chat_id, f"⚠️ No data found for *{symbol}*. Check the symbol.")
        except Exception as e:
            await _tg_send(chat_id, f"⚠️ Error fetching {symbol}: {e}")
        return

    await _tg_send(chat_id, "Type a stock symbol like `RELIANCE` or use /help for commands.")

# ── FastAPI app ───────────────────────────────────────────────────────────────
app = FastAPI(title="InvestEdge AI", version="3.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"],
                   allow_methods=["*"], allow_headers=["*"])

# ── Cache ─────────────────────────────────────────────────────────────────────
_scan_cache        = None
_scan_cache_time   = None
_alerts_cache      = None
_alerts_cache_time = None

# ── Core pattern engine ───────────────────────────────────────────────────────
def _run_patterns(ticker_sym: str, period: str) -> dict:
    raw = yf.download(ticker_sym, period=period, interval="1d",
                      progress=False, auto_adjust=True)
    if raw.empty or len(raw) < 30:
        raise HTTPException(404, f"No data for {ticker_sym}")

    df    = flatten_cols(raw)
    close = df["close"]; high = df["high"]; low = df["low"]; vol = df["volume"]

    df["rsi"]    = _rsi(close)
    df["ema20"]  = _ema(close, 20)
    df["ema50"]  = _ema(close, 50)
    df["ema200"] = _ema(close, 200)
    df["atr"]    = _atr(high, low, close)
    ml, sl, mh   = _macd(close)
    df["macd"] = ml; df["macd_signal"] = sl; df["macd_hist"] = mh
    bu, bm, bl   = _bbands(close)
    df["bb_upper"] = bu; df["bb_mid"] = bm; df["bb_lower"] = bl

    cur = df.iloc[-1]; prev = df.iloc[-2]
    signals = []

    # RSI signals
    rsi = sf(cur.get("rsi"))
    if rsi:
        if rsi < 28:   signals.append({"type":"RSI Oversold","direction":"bullish","strength":"strong","detail":f"RSI {rsi:.1f} — deeply oversold"})
        elif rsi < 35: signals.append({"type":"RSI Approaching Oversold","direction":"bullish","strength":"moderate","detail":f"RSI {rsi:.1f} — entering oversold"})
        elif rsi > 72: signals.append({"type":"RSI Overbought","direction":"bearish","strength":"strong","detail":f"RSI {rsi:.1f} — overbought"})
        elif rsi > 65: signals.append({"type":"RSI Approaching Overbought","direction":"bearish","strength":"moderate","detail":f"RSI {rsi:.1f} — nearing overbought"})

    # EMA crossover
    e20,e50,pe20,pe50 = sf(cur.get("ema20")),sf(cur.get("ema50")),sf(prev.get("ema20")),sf(prev.get("ema50"))
    if all(v for v in [e20,e50,pe20,pe50]):
        if pe20<pe50 and e20>e50:   signals.append({"type":"Golden Cross","direction":"bullish","strength":"strong","detail":"EMA20 crossed above EMA50"})
        elif pe20>pe50 and e20<e50: signals.append({"type":"Death Cross","direction":"bearish","strength":"strong","detail":"EMA20 crossed below EMA50"})
        elif e20>e50:               signals.append({"type":"EMA Bullish Alignment","direction":"bullish","strength":"moderate","detail":f"EMA20 {((e20-e50)/e50*100):.1f}% above EMA50"})
        else:                       signals.append({"type":"EMA Bearish Alignment","direction":"bearish","strength":"moderate","detail":f"EMA20 {((e50-e20)/e50*100):.1f}% below EMA50"})

    # 200 EMA
    price_now = sf(cur["close"]); e200 = sf(cur.get("ema200"))
    if price_now and e200:
        pct = (price_now-e200)/e200*100
        if pct>2:   signals.append({"type":"Above 200 EMA","direction":"bullish","strength":"moderate","detail":f"Price {pct:.1f}% above 200 EMA"})
        elif pct<-2:signals.append({"type":"Below 200 EMA","direction":"bearish","strength":"moderate","detail":f"Price {abs(pct):.1f}% below 200 EMA"})

    # MACD
    mv,ms,pmv,pms = sf(cur.get("macd")),sf(cur.get("macd_signal")),sf(prev.get("macd")),sf(prev.get("macd_signal"))
    if all(v is not None for v in [mv,ms,pmv,pms]):
        if pmv<pms and mv>ms: signals.append({"type":"MACD Bullish Cross","direction":"bullish","strength":"moderate","detail":"MACD crossed above signal"})
        elif pmv>pms and mv<ms: signals.append({"type":"MACD Bearish Cross","direction":"bearish","strength":"moderate","detail":"MACD crossed below signal"})

    # Bollinger Bands
    bbu,bbl,bbm = sf(cur.get("bb_upper")),sf(cur.get("bb_lower")),sf(cur.get("bb_mid"))
    if price_now and bbu and bbl and bbm:
        bw = (bbu-bbl)/bbm*100
        if price_now>bbu:  signals.append({"type":"BB Upper Breakout","direction":"bullish","strength":"moderate","detail":"Price above upper Bollinger Band"})
        elif price_now<bbl:signals.append({"type":"BB Lower Breakdown","direction":"bearish","strength":"moderate","detail":"Price below lower Bollinger Band"})
        if bw<3.5:         signals.append({"type":"Bollinger Squeeze","direction":"neutral","strength":"strong","detail":f"BB width {bw:.1f}% — explosive move expected"})

    # Volume
    avg_vol = sf(vol.tail(20).mean()); lat_vol = sf(vol.iloc[-1])
    if avg_vol and lat_vol and avg_vol>0:
        vr = lat_vol/avg_vol
        if vr>2.0: signals.append({"type":"High Volume Surge","direction":"bullish" if price_now and sf(prev["close"]) and price_now>sf(prev["close"]) else "bearish","strength":"strong","detail":f"Volume {vr:.1f}x above avg"})

    # 52W levels
    yh = sf(high.tail(252).max()); yl = sf(low.tail(252).min())
    if price_now and yh and yl:
        pfh = (yh-price_now)/yh*100
        if pfh<2:   signals.append({"type":"Near 52W High","direction":"bullish","strength":"strong","detail":f"{pfh:.1f}% below 52W high ₹{yh:.0f}"})
        elif pfh>30:signals.append({"type":"Far from 52W High","direction":"bearish","strength":"moderate","detail":f"Down {pfh:.0f}% from 52W high"})

    bull_n = sum(1 for s in signals if s["direction"]=="bullish")
    bear_n = sum(1 for s in signals if s["direction"]=="bearish")
    bias   = "bullish" if bull_n>bear_n else ("bearish" if bear_n>bull_n else "neutral")

    # Chart data
    chart = []
    for _, row in df.tail(90).reset_index().iterrows():
        try:
            dt = row["Date"]
            chart.append({"time": dt.strftime("%Y-%m-%d") if hasattr(dt,"strftime") else str(dt)[:10],
                          "open":sf(row["open"]),"high":sf(row["high"]),"low":sf(row["low"]),
                          "close":sf(row["close"]),"volume":sf(row["volume"]),
                          "ema20":sf(row.get("ema20")),"ema50":sf(row.get("ema50")),"rsi":sf(row.get("rsi"))})
        except: pass

    # Backtest
    backtest = None
    od = df[df["rsi"]<32].index
    if len(od)>2:
        gains = []
        for dt in od[:-1]:
            try:
                pos = df.index.get_loc(dt)
                ep  = sf(df["close"].iloc[pos])
                fp  = sf(df["close"].iloc[min(pos+15, len(df)-1)])
                if ep and fp: gains.append((fp-ep)/ep*100)
            except: pass
        if gains:
            wr = sum(1 for g in gains if g>0)/len(gains)*100
            ag = sum(gains)/len(gains)
            backtest = f"RSI<32 appeared {len(gains)} times. Win rate +15 days: {wr:.0f}%, avg move: {ag:+.1f}%"

    display = ticker_sym.replace(".NS","").replace(".BO","")
    return {
        "symbol": ticker_sym, "display": display,
        "price":  {"current":price_now,"open":sf(cur["open"]),"high":sf(cur["high"]),
                   "low":sf(cur["low"]),"prev_close":sf(prev["close"]),
                   "change_pct":sf((price_now-sf(prev["close"]))/sf(prev["close"])*100) if price_now and sf(prev["close"]) else None,
                   "rsi":rsi,"ema20":e20,"ema50":e50,"ema200":e200,
                   "52w_high":yh,"52w_low":yl,"volume":lat_vol,"avg_volume":avg_vol,"atr":sf(cur.get("atr"))},
        "signals":signals,"bias":bias,"bias_counts":{"bullish":bull_n,"bearish":bear_n},
        "backtest":backtest,"chart_data":chart,"generated_at":datetime.now().isoformat(),
        "explanation": None
    }

# ── API 1: Chart Patterns ─────────────────────────────────────────────────────
class PatternReq(BaseModel):
    symbol: str
    period: str = "6mo"

@app.post("/api/patterns")
async def detect_patterns(req: PatternReq):
    ticker = nse(req.symbol)
    try:
        data = _run_patterns(ticker, req.period)
        # LLM plain-English explanation
        if GROQ_KEY and data["signals"]:
            sig_names = ", ".join([s["type"] for s in data["signals"][:4]])
            rsi_val   = data["price"]["rsi"] or "N/A"
            expl = await _groq(
                f"You are a sharp Indian stock analyst. {data['display']} shows these signals: {sig_names}. "
                f"RSI: {rsi_val}. Bias: {data['bias']}. "
                f"Write exactly 2 sentences in plain English for a retail investor. "
                f"Be specific, mention the stock name. End with one word: BUY / HOLD / AVOID. "
                f"No jargon. No markdown.",
                max_tokens=100
            )
            data["explanation"] = expl
        return data
    except HTTPException: raise
    except Exception as e: raise HTTPException(500, str(e))

# ── API 2: Opportunity Radar ──────────────────────────────────────────────────
class OppReq(BaseModel):
    symbol: str

@app.post("/api/opportunity")
async def fundamental_analysis(req: OppReq):
    ticker = nse(req.symbol)
    try:
        t    = yf.Ticker(ticker)
        info = t.info or {}

        pe=sf(info.get("trailingPE")); fwd_pe=sf(info.get("forwardPE"))
        pb=sf(info.get("priceToBook")); roe=sf(info.get("returnOnEquity"))
        debt_eq=sf(info.get("debtToEquity")); profit_mg=sf(info.get("profitMargins"))
        rev_growth=sf(info.get("revenueGrowth")); earn_growth=sf(info.get("earningsGrowth"))
        div_yield=sf(info.get("dividendYield")); beta=sf(info.get("beta"))
        current_p=sf(info.get("currentPrice") or info.get("regularMarketPrice"))
        target_p=sf(info.get("targetMeanPrice")); target_hi=sf(info.get("targetHighPrice"))
        target_lo=sf(info.get("targetLowPrice")); rec_key=info.get("recommendationKey","")
        num_analyst=info.get("numberOfAnalystOpinions",0)
        short_name=info.get("shortName",ticker); sector=info.get("sector","")
        market_cap=info.get("marketCap")

        mc_str=""
        if market_cap:
            mc_cr=market_cap/1e7
            mc_str=f"₹{mc_cr/1e5:.2f}L Cr (Large Cap)" if mc_cr>=1e5 else f"₹{mc_cr/1e4:.2f}L Cr (Mid Cap)" if mc_cr>=2e4 else f"₹{mc_cr:.0f} Cr (Small Cap)"

        upside=sf(((target_p-current_p)/current_p)*100) if target_p and current_p and current_p>0 else None

        signals=[]
        if pe:
            if pe<12:   signals.append({"type":"Very Low P/E","cat":"valuation","sentiment":"positive","detail":f"P/E {pe:.1f}x — deep value"})
            elif pe<20: signals.append({"type":"Reasonable P/E","cat":"valuation","sentiment":"positive","detail":f"P/E {pe:.1f}x — fairly valued"})
            elif pe>60: signals.append({"type":"Very High P/E","cat":"valuation","sentiment":"caution","detail":f"P/E {pe:.1f}x — growth priced in"})
        if pb and pb<1.2: signals.append({"type":"Trading Near Book","cat":"valuation","sentiment":"positive","detail":f"P/B {pb:.2f}x"})
        if rev_growth:
            if rev_growth>0.20:  signals.append({"type":"Strong Revenue Growth","cat":"growth","sentiment":"positive","detail":f"Revenue +{rev_growth*100:.1f}% YoY"})
            elif rev_growth<-0.05: signals.append({"type":"Revenue Declining","cat":"growth","sentiment":"caution","detail":f"Revenue {rev_growth*100:.1f}% YoY"})
        if earn_growth and earn_growth>0.20: signals.append({"type":"Strong EPS Growth","cat":"growth","sentiment":"positive","detail":f"Earnings +{earn_growth*100:.1f}% YoY"})
        if roe:
            if roe>0.25:   signals.append({"type":"Excellent ROE","cat":"quality","sentiment":"positive","detail":f"ROE {roe*100:.1f}%"})
            elif roe>0.15: signals.append({"type":"Good ROE","cat":"quality","sentiment":"positive","detail":f"ROE {roe*100:.1f}%"})
        if debt_eq:
            if debt_eq<20:   signals.append({"type":"Low Debt","cat":"quality","sentiment":"positive","detail":f"D/E {debt_eq:.1f}%"})
            elif debt_eq>200:signals.append({"type":"High Leverage","cat":"quality","sentiment":"caution","detail":f"D/E {debt_eq:.1f}%"})
        if upside:
            if upside>15:   signals.append({"type":"Analyst Upside","cat":"analyst","sentiment":"positive","detail":f"Target ₹{target_p:.0f} — {upside:.1f}% upside ({num_analyst} analysts)"})
            elif upside<-10:signals.append({"type":"Analyst Downside","cat":"analyst","sentiment":"caution","detail":f"Target ₹{target_p:.0f} — {abs(upside):.1f}% below current"})
        if div_yield and div_yield>0.03: signals.append({"type":"Good Dividend Yield","cat":"income","sentiment":"positive","detail":f"Yield {div_yield*100:.2f}%"})
        if beta:
            if beta>1.5:   signals.append({"type":"High Beta","cat":"risk","sentiment":"caution","detail":f"Beta {beta:.2f}"})
            elif beta<0.7: signals.append({"type":"Low Beta","cat":"risk","sentiment":"positive","detail":f"Beta {beta:.2f}"})

        # NewsAPI articles for this stock
        news = []
        if NEWS_API_KEY:
            display = ticker.replace(".NS","").replace(".BO","")
            news = await _fetch_newsapi(f"{display} stock India", page_size=5)
        if not news:
            try:
                for n in (t.news or [])[:5]:
                    content=n.get("content") or {}
                    title=content.get("title","") if content else n.get("title","")
                    publisher=(content.get("provider") or {}).get("displayName","") if content else n.get("publisher","")
                    link=(content.get("canonicalUrl") or {}).get("url","") if content else n.get("link","")
                    t_str=(content.get("pubDate","") or "")[:10] if content else ""
                    if title: news.append({"title":title,"publisher":publisher,"link":link,"time":t_str,"description":""})
            except: pass

        return {
            "symbol":ticker,"display":ticker.replace(".NS","").replace(".BO",""),
            "name":short_name,"sector":sector,"market_cap":mc_str,"current_price":current_p,
            "fundamentals":{"pe":pe,"fwd_pe":fwd_pe,"pb":pb,
                "roe":f"{roe*100:.1f}%" if roe else None,
                "debt_equity":f"{debt_eq:.1f}%" if debt_eq else None,
                "profit_margin":f"{profit_mg*100:.1f}%" if profit_mg else None,
                "revenue_growth":f"{rev_growth*100:.1f}%" if rev_growth else None,
                "earnings_growth":f"{earn_growth*100:.1f}%" if earn_growth else None,
                "dividend_yield":f"{div_yield*100:.2f}%" if div_yield else None,
                "beta":beta},
            "analyst":{"target_mean":target_p,"target_high":target_hi,"target_low":target_lo,
                "upside_pct":upside,"recommendation":rec_key,"num_analysts":num_analyst},
            "signals":signals,"news":news,"generated_at":datetime.now().isoformat()
        }
    except HTTPException: raise
    except Exception as e: raise HTTPException(500, str(e))

# ── API 3: Portfolio ──────────────────────────────────────────────────────────
class Holding(BaseModel):
    symbol: str; qty: float; avg_cost: float

class PortfolioReq(BaseModel):
    holdings: List[Holding]

@app.post("/api/portfolio")
async def analyze_portfolio(req: PortfolioReq):
    results=[]; t_inv=0.0; t_cur=0.0
    nifty_close=None
    try:
        nr=yf.download("^NSEI",period="3mo",interval="1d",progress=False,auto_adjust=True)
        if not nr.empty: nifty_close=flatten_cols(nr)["close"]
    except: pass

    for h in req.holdings:
        ticker=nse(h.symbol)
        try:
            raw=yf.download(ticker,period="3mo",interval="1d",progress=False,auto_adjust=True)
            if raw.empty: results.append({"symbol":h.symbol,"error":"No data"}); continue
            df=flatten_cols(raw); close=df["close"]; high=df["high"]; low=df["low"]
            cur_p=sf(close.iloc[-1]); rsi_v=sf(_rsi(close).iloc[-1])
            e20=sf(_ema(close,20).iloc[-1]); e50=sf(_ema(close,50).iloc[-1])
            atr_v=sf(_atr(high,low,close).iloc[-1])
            # Sharpe
            dr=close.pct_change().dropna()
            sharpe=round(float(dr.mean()/dr.std()*(252**0.5)),2) if len(dr)>5 and dr.std()>0 else None
            # Beta
            beta_val=None
            if nifty_close is not None:
                try:
                    s,n=close.pct_change().dropna().align(nifty_close.pct_change().dropna(),join="inner")
                    if len(s)>10: beta_val=round(float(np.cov(s,n)[0][1]/np.var(n)),2)
                except: pass
            invested=round(h.qty*h.avg_cost,2); current=round(h.qty*(cur_p or 0),2)
            pnl=round(current-invested,2); pnl_pct=round(pnl/invested*100 if invested else 0,2)
            t_inv+=invested; t_cur+=current
            signal,reason="hold","No strong signal"
            if rsi_v:
                if rsi_v>72:   signal,reason="review",f"RSI overbought {rsi_v:.0f}"
                elif rsi_v<30: signal,reason="accumulate",f"RSI oversold {rsi_v:.0f}"
            if signal=="hold" and cur_p and e50 and cur_p<e50*0.93:
                signal,reason="review",f"Price {((e50-cur_p)/e50*100):.1f}% below EMA50"
            results.append({
                "symbol":ticker.replace(".NS","").replace(".BO",""),
                "qty":h.qty,"avg_cost":h.avg_cost,"current_price":cur_p,
                "invested":invested,"current_value":current,"pnl":pnl,"pnl_pct":pnl_pct,
                "rsi":rsi_v,"ema20":e20,"ema50":e50,"atr":atr_v,
                "sharpe":sharpe,"beta":beta_val,
                "suggested_sl":round(cur_p-2*atr_v,2) if cur_p and atr_v else None,
                "signal":signal,"signal_reason":reason,"weight_pct":None
            })
        except Exception as e: results.append({"symbol":h.symbol,"error":str(e)})

    for r in results:
        if "current_value" in r and t_cur>0:
            r["weight_pct"]=round(r["current_value"]/t_cur*100,1)
    t_pnl=round(t_cur-t_inv,2)
    valid_sharpes=[r["sharpe"] for r in results if r.get("sharpe")]
    return {
        "holdings":results,
        "summary":{"total_invested":round(t_inv,2),"total_current":round(t_cur,2),
                   "total_pnl":t_pnl,"total_pnl_pct":round(t_pnl/t_inv*100 if t_inv else 0,2),
                   "count":len(results),
                   "portfolio_sharpe":round(sum(valid_sharpes)/len(valid_sharpes),2) if valid_sharpes else None},
        "generated_at":datetime.now().isoformat()
    }

# ── API 4: News RAG ───────────────────────────────────────────────────────────
@app.get("/api/news")
async def news_rag(q: Optional[str]=Query(None), symbol: Optional[str]=Query(None)):
    fresh = []
    # Try NewsAPI first
    if NEWS_API_KEY:
        search_q = q or (f"{symbol} stock India" if symbol else "NSE BSE India stock market today")
        fresh    = await _fetch_newsapi(search_q, page_size=40)
    # Fallback: yfinance
    if not fresh:
        syms = [nse(symbol)] if symbol else ["RELIANCE.NS","HDFCBANK.NS","INFY.NS","TCS.NS","BAJFINANCE.NS","SBIN.NS","ICICIBANK.NS","WIPRO.NS"]
        seen = set()
        for sym in syms[:6]:
            try:
                for n in (yf.Ticker(sym).news or [])[:8]:
                    content=n.get("content") or {}
                    title=content.get("title","") if content else n.get("title","")
                    if title and title not in seen:
                        seen.add(title)
                        fresh.append({"title":title,"description":"",
                            "publisher":(content.get("provider") or {}).get("displayName","") if content else n.get("publisher",""),
                            "link":(content.get("canonicalUrl") or {}).get("url","") if content else n.get("link",""),
                            "time":(content.get("pubDate","") or "")[:10] if content else "",
                            "symbol":sym.replace(".NS","")})
            except: continue

    rag_ok = _build_rag_index(fresh) if fresh else False
    if q and rag_ok:
        results = _rag_search(q, k=20)
        method  = "newsapi-vector-rag" if NEWS_API_KEY else "yfinance-vector-rag"
    elif q:
        kw      = q.lower().split()
        results = [a for a in fresh if any(k in (a["title"]+" "+a.get("symbol","")).lower() for k in kw)]
        method  = "keyword-fallback"
    else:
        results = fresh[:30]
        method  = "latest"

    return {"query":q or "","symbol":symbol or "","total":len(results),
            "articles":results[:30],"search_method":method,
            "rag_active":rag_ok,"source":"NewsAPI + FAISS" if NEWS_API_KEY else "yfinance + FAISS"}

# ── API 5: Nifty50 Universe Scanner ──────────────────────────────────────────
@app.get("/api/scan")
async def universe_scan(bias: Optional[str]=Query(None), min_signals: int=Query(2)):
    global _scan_cache, _scan_cache_time
    now = datetime.now()
    if _scan_cache and _scan_cache_time and (now-_scan_cache_time).seconds < 3600:
        results = _scan_cache
    else:
        results = []
        for sym in NIFTY50:
            try:
                d      = _run_patterns(sym+".NS","3mo")
                strong = [s for s in d["signals"] if s["strength"] in ("strong","moderate")]
                if len(strong)>=min_signals:
                    results.append({"symbol":d["display"],"bias":d["bias"],
                        "price":d["price"]["current"],"change_pct":d["price"]["change_pct"],
                        "rsi":d["price"]["rsi"],"signal_count":len(strong),
                        "top_signal":strong[0]["type"] if strong else "",
                        "explanation":d.get("explanation")})
            except: continue
        results.sort(key=lambda x: x["signal_count"], reverse=True)
        _scan_cache=results; _scan_cache_time=now

    if bias:
        results=[r for r in results if r["bias"]==bias.lower()]

    # Add LLM explanations for top 5 if missing
    if GROQ_KEY:
        for r in results[:5]:
            if not r.get("explanation"):
                r["explanation"] = await _groq(
                    f"{r['symbol']} has {r['signal_count']} technical signals including {r['top_signal']}. "
                    f"RSI {r['rsi']}. Write 1 sentence for a retail investor. End with BUY/HOLD/AVOID.",
                    max_tokens=60)

    return {"total":len(results),"results":results,"generated_at":now.isoformat()}

# ── API 6: Daily Alerts ───────────────────────────────────────────────────────
@app.get("/api/daily-alerts")
async def daily_alerts():
    global _alerts_cache, _alerts_cache_time
    now = datetime.now()
    if _alerts_cache and _alerts_cache_time and (now-_alerts_cache_time).seconds<3600:
        return _alerts_cache

    alerts = []
    # Technical alerts from scanner
    try:
        scan = await universe_scan(bias="bullish", min_signals=2)
        for s in scan["results"][:4]:
            alerts.append({"symbol":s["symbol"],"type":"Technical Opportunity",
                "headline":f"{s['symbol']} shows {s['top_signal']} — {s['signal_count']} signals",
                "detail":s.get("explanation") or f"RSI: {s['rsi']}, Bias: {s['bias']}",
                "price":s["price"],"change_pct":s["change_pct"],
                "time":now.strftime("%d %b %Y %H:%M"),"source":"NSE · InvestEdge Scanner"})
    except: pass

    # News-based alerts from NewsAPI
    if NEWS_API_KEY:
        try:
            news = await _fetch_newsapi("NSE bulk deal insider trade India stock today", page_size=3)
            for a in news[:2]:
                alerts.append({"symbol":"NEWS","type":"Market News",
                    "headline":a["title"][:80],
                    "detail":a.get("description","")[:100],
                    "price":None,"change_pct":None,
                    "time":a.get("time",""),"source":a.get("publisher","NewsAPI")})
        except: pass

    # NSE bulk deals
    try:
        from nsetools import Nse as NseTools
        for deal in (NseTools().get_bulk_deals() or [])[:2]:
            alerts.append({"symbol":deal.get("symbol",""),"type":"Bulk Deal",
                "headline":f"Bulk deal: {deal.get('clientName','')} {deal.get('buySell','')} {deal.get('symbol','')}",
                "detail":f"Qty: {deal.get('quantity','')} @ ₹{deal.get('tradePrice','')}",
                "price":None,"change_pct":None,
                "time":now.strftime("%d %b %Y %H:%M"),"source":"NSE Bulk Deals"})
    except: pass

    result = {"date":now.strftime("%d %b %Y"),"total":len(alerts),
              "alerts":alerts,"generated_at":now.isoformat()}
    _alerts_cache=result; _alerts_cache_time=now
    return result

# ── API 7: Video Engine (Groq script + ElevenLabs TTS) ───────────────────────
class VideoReq(BaseModel):
    topic: str
    voice_id: str = "EXAVITQu4vr4xnSDxMaL"  # Bella — valid as of 2025

@app.post("/api/video")
async def generate_video(req: VideoReq):
    if not GROQ_KEY:
        raise HTTPException(400, "GROQ_KEY not configured")

    # ── Step 1: Gather REAL market intelligence before writing script ─────────
    intel = []

    # 1a. Detect topic type and fetch relevant stock data
    topic_lower = req.topic.lower()

    # Pick stocks to analyze based on topic
    if any(w in topic_lower for w in ["banking", "bank", "hdfc", "sbi", "icici", "axis"]):
        analysis_syms = ["HDFCBANK", "ICICIBANK", "SBIN", "AXISBANK"]
    elif any(w in topic_lower for w in ["it", "tech", "infy", "infosys", "tcs", "wipro"]):
        analysis_syms = ["INFY", "TCS", "WIPRO", "HCLTECH"]
    elif any(w in topic_lower for w in ["pharma", "health", "sun", "cipla"]):
        analysis_syms = ["SUNPHARMA", "DRREDDY", "CIPLA"]
    elif any(w in topic_lower for w in ["auto", "maruti", "tata motor"]):
        analysis_syms = ["MARUTI", "TATAMOTORS", "BAJAJ-AUTO"]
    elif any(w in topic_lower for w in ["fii", "dii", "foreign", "institutional"]):
        analysis_syms = ["RELIANCE", "HDFCBANK", "INFY", "TCS"]
    elif any(w in topic_lower for w in ["nifty", "sensex", "market", "broad"]):
        analysis_syms = ["RELIANCE", "HDFCBANK", "INFY", "TCS", "ICICIBANK"]
    else:
        analysis_syms = ["RELIANCE", "HDFCBANK", "INFY"]

    # 1b. Run real technical analysis on each stock
    stock_briefs = []
    for sym in analysis_syms[:4]:
        try:
            data = _run_patterns(sym + ".NS", "3mo")
            price  = data["price"]["current"]
            rsi    = data["price"]["rsi"]
            chg    = data["price"]["change_pct"]
            bias   = data["bias"]
            sigs   = [s["type"] for s in data["signals"][:3]]
            hi52   = data["price"]["52w_high"]
            lo52   = data["price"]["52w_low"]
            brief = (
                f"{sym}: ₹{price} ({'+' if chg and chg>=0 else ''}{chg:.1f}%), "
                f"RSI={rsi:.1f}, bias={bias.upper()}, "
                f"signals=[{', '.join(sigs)}], "
                f"52W range=₹{lo52}-₹{hi52}"
            )
            if data.get("backtest"):
                brief += f", backtest={data['backtest']}"
            stock_briefs.append(brief)
            intel.append(brief)
        except Exception as e:
            print(f"[Video intel] {sym}: {e}")

    # 1c. Fetch latest news headlines
    news_headlines = []
    if NEWS_API_KEY:
        try:
            news_query = "NSE BSE India stock market " + req.topic
            news = await _fetch_newsapi(news_query, page_size=5)
            for n in news[:4]:
                news_headlines.append(n["title"])
                intel.append(f"NEWS: {n['title']}")
        except: pass

    # 1d. Nifty50 overall market mood
    try:
        nifty_data = _run_patterns("^NSEI", "1mo")
        nifty_price = nifty_data["price"]["current"]
        nifty_chg   = nifty_data["price"]["change_pct"]
        nifty_rsi   = nifty_data["price"]["rsi"]
        nifty_bias  = nifty_data["bias"]
        intel.insert(0,
            f"NIFTY50: {nifty_price} ({'+' if nifty_chg and nifty_chg>=0 else ''}{nifty_chg:.1f}%), "
            f"RSI={nifty_rsi:.1f}, overall market={nifty_bias.upper()}"
        )
    except: pass

    # ── Step 2: Build data-grounded prompt ────────────────────────────────────
    intel_text = "\n".join(intel) if intel else "No live data available."

    prompt = f"""You are a sharp Indian financial news anchor on ET Markets with REAL market data.

LIVE MARKET DATA (use ONLY these real numbers — do NOT invent any):
{intel_text}

TOPIC: {req.topic}

Write a 75-word market update script for retail investors.
Rules:
- Use ONLY the real numbers above (RSI, price, % change, signal names)
- Start with "Namaskar investors!"
- Mix 2-3 Hindi finance words: bazaar, nivesh, munafa, girawat, tezi
- If a stock shows bullish signals → suggest accumulate. If bearish → suggest wait/avoid.
- State the actual RSI and what it means for that stock
- End with ONE specific data-backed action (e.g. "TCS RSI at 28 is oversold — consider SIP entry")
- NEVER say "5% return in 1 month" or any made-up returns
- 75 words exactly. No markdown. Broadcast-ready."""

    script = await _groq(prompt, max_tokens=200, temperature=0.4)
    if not script:
        raise HTTPException(500, "Script generation failed")

    # TTS via ElevenLabs
    audio_b64 = None
    tts_error  = None
    if ELEVENLABS_KEY:
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                tts = await client.post(
                    f"https://api.elevenlabs.io/v1/text-to-speech/{req.voice_id}",
                    headers={"xi-api-key": ELEVENLABS_KEY, "Content-Type": "application/json"},
                    json={"text": script,
                          "model_id": "eleven_multilingual_v2",
                          "voice_settings": {"stability": 0.5, "similarity_boost": 0.75}}
                )
            if tts.status_code == 200:
                import base64
                audio_b64 = base64.b64encode(tts.content).decode()
            else:
                tts_error = f"ElevenLabs {tts.status_code}: {tts.text[:200]}"
                print(f"[ElevenLabs] {tts_error}")
                # Fallback: try with monolingual model
                async with httpx.AsyncClient(timeout=30.0) as client:
                    tts2 = await client.post(
                        f"https://api.elevenlabs.io/v1/text-to-speech/{req.voice_id}",
                        headers={"xi-api-key": ELEVENLABS_KEY, "Content-Type": "application/json"},
                        json={"text": script,
                              "model_id": "eleven_monolingual_v1",
                              "voice_settings": {"stability": 0.5, "similarity_boost": 0.75}}
                    )
                if tts2.status_code == 200:
                    import base64
                    audio_b64 = base64.b64encode(tts2.content).decode()
                    tts_error  = None
                else:
                    print(f"[ElevenLabs fallback] {tts2.status_code}: {tts2.text[:200]}")
        except Exception as e:
            tts_error = str(e)
            print(f"[ElevenLabs] {e}")

    # Fetch real market data for canvas visualization
    market_data = {}
    try:
        # Top 5 Nifty stocks live prices
        top_syms = ["RELIANCE.NS","TCS.NS","HDFCBANK.NS","INFY.NS","ICICIBANK.NS",
                    "SBIN.NS","BAJFINANCE.NS","WIPRO.NS","LT.NS","AXISBANK.NS"]
        live = []
        for sym in top_syms[:8]:
            try:
                t2 = yf.Ticker(sym)
                info2 = t2.fast_info
                price = sf(getattr(info2, "last_price", None))
                prev  = sf(getattr(info2, "previous_close", None))
                chg   = sf(((price - prev) / prev * 100)) if price and prev else 0.0
                live.append({"sym": sym.replace(".NS",""), "price": price or 0, "chg": chg or 0.0})
            except: pass
        market_data["live_prices"] = live

        # Nifty50 chart data (last 30 days)
        nifty = yf.download("^NSEI", period="1mo", interval="1d", progress=False, auto_adjust=True)
        if not nifty.empty:
            nifty = flatten_cols(nifty)
            chart_pts = []
            for _, row in nifty.tail(30).reset_index().iterrows():
                try:
                    dt = row["Date"]
                    chart_pts.append({
                        "time": dt.strftime("%Y-%m-%d") if hasattr(dt,"strftime") else str(dt)[:10],
                        "open": sf(row["open"]), "high": sf(row["high"]),
                        "low": sf(row["low"]), "close": sf(row["close"])
                    })
                except: pass
            market_data["nifty_chart"] = chart_pts
            if chart_pts:
                first = chart_pts[0]["close"] or 1
                last2 = chart_pts[-1]["close"] or 0
                market_data["nifty_change_pct"] = sf((last2 - first) / first * 100)
                market_data["nifty_current"] = last2

        # Sector performance (proxy ETFs / key stocks)
        sector_map = [
            ("IT",      ["TCS.NS","INFY.NS","WIPRO.NS"]),
            ("Banking", ["HDFCBANK.NS","ICICIBANK.NS","SBIN.NS"]),
            ("Energy",  ["RELIANCE.NS","ONGC.NS"]),
            ("Auto",    ["MARUTI.NS","TATAMOTORS.NS"]),
            ("Pharma",  ["SUNPHARMA.NS","DRREDDY.NS"]),
        ]
        sector_data = []
        for name, syms2 in sector_map:
            chgs = []
            for s2 in syms2:
                try:
                    t3 = yf.Ticker(s2)
                    fi = t3.fast_info
                    p2 = sf(getattr(fi, "last_price", None))
                    pc = sf(getattr(fi, "previous_close", None))
                    if p2 and pc and pc > 0:
                        chgs.append((p2 - pc) / pc * 100)
                except: pass
            avg_chg = sf(sum(chgs)/len(chgs)) if chgs else 0.0
            sector_data.append({"name": name, "chg": avg_chg or 0.0})
        market_data["sectors"] = sector_data

        # FII/DII — use scan results as proxy if available
        market_data["generated_at_ist"] = datetime.now().strftime("%d %b %Y %H:%M IST")

    except Exception as e:
        print(f"[Video market_data] {e}")

    return {"topic":req.topic,"script":script,"audio_b64":audio_b64,
            "tts_ready":audio_b64 is not None,
            "tts_error":tts_error,
            "market_data": market_data,
            "model":"Groq Llama-3.3-70b + ElevenLabs TTS",
            "generated_at":datetime.now().isoformat()}


# ── API 7b: List available ElevenLabs voices ──────────────────────────────────
@app.get("/api/voices")
async def list_voices():
    """Returns curated list of valid ElevenLabs voices"""
    voices = [
        {"id": "EXAVITQu4vr4xnSDxMaL", "name": "Bella",   "gender": "female", "style": "warm"},
        {"id": "ErXwobaYiN019PkySvjV", "name": "Antoni",  "gender": "male",   "style": "deep"},
        {"id": "VR6AewLTigWG4xSOukaG", "name": "Arnold",  "gender": "male",   "style": "confident"},
        {"id": "pNInz6obpgDQGcFmaJgB", "name": "Adam",    "gender": "male",   "style": "narration"},
        {"id": "yoZ06aMxZJJ28mfd3POQ", "name": "Sam",     "gender": "male",   "style": "energetic"},
        {"id": "jBpfuIE2acCO8z3wKNLl", "name": "Gigi",    "gender": "female", "style": "cheerful"},
        {"id": "oWAxZDx7w5VEj9dCyTzz", "name": "Grace",   "gender": "female", "style": "soft"},
    ]
    return {"voices": voices, "elevenlabs_configured": bool(ELEVENLABS_KEY)}

# ── API 8: Telegram Webhook ───────────────────────────────────────────────────
@app.post("/webhook/telegram")
async def telegram_webhook(request: Request):
    try:
        update = await request.json()
        await _handle_telegram(update)
    except Exception as e:
        print(f"[Telegram webhook] {e}")
    return {"ok": True}

# ── API 9: Send Daily Alerts to all Telegram subscribers ─────────────────────
@app.post("/api/send-alerts")
async def send_telegram_alerts():
    """Call this endpoint every morning at 9 AM via cron-job.org"""
    subs = _load_subs()
    if not subs:
        return {"sent": 0, "message": "No subscribers yet"}
    data  = await daily_alerts()
    lines = [f"🚨 *InvestEdge Morning Brief — {data['date']}*\n",
             "_Top NSE opportunities detected by AI:_\n"]
    for a in data["alerts"][:5]:
        lines.append(f"📈 *{a['symbol']}* — {a['headline']}")
        if a.get("detail"): lines.append(f"_{a['detail']}_\n")
    lines.append(f"\n🔗 {BACKEND_URL.replace('-api','')}")
    msg = "\n".join(lines)
    for chat_id in subs:
        await _tg_send(chat_id, msg)
    return {"sent": len(subs), "alerts": len(data["alerts"])}

# ── Health ────────────────────────────────────────────────────────────────────
@app.get("/health")
async def health():
    return {
        "status":   "ok",
        "service":  "InvestEdge AI v3.0 — ET AI Hackathon PS6",
        "agents":   ["patterns","opportunity","portfolio","news-rag","scanner","alerts","video","telegram"],
        "integrations": {
            "groq":       bool(GROQ_KEY),
            "elevenlabs": bool(ELEVENLABS_KEY),
            "newsapi":    bool(NEWS_API_KEY),
            "telegram":   bool(TELEGRAM_BOT_TOKEN),
            "rag_ready":  _rag_ready
        },
        "time": datetime.now().isoformat()
    }

@app.get("/")
async def root():
    return {"message": "InvestEdge AI v3.0 — visit /docs for full API reference"}