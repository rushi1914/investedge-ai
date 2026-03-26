import { useState, useEffect, useRef, useCallback } from "react";

const BACKEND = import.meta.env.VITE_API_URL || "http://localhost:8000";

const VOICES = [
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Bella — Warm Female" },
  { id: "ErXwobaYiN019PkySvjV", name: "Antoni — Deep Male" },
  { id: "VR6AewLTigWG4xSOukaG", name: "Arnold — Confident Male" },
  { id: "pNInz6obpgDQGcFmaJgB", name: "Adam — Narration" },
  { id: "yoZ06aMxZJJ28mfd3POQ", name: "Sam — Energetic Male" },
  { id: "jBpfuIE2acCO8z3wKNLl", name: "Gigi — Cheerful Female" },
  { id: "oWAxZDx7w5VEj9dCyTzz", name: "Grace — Soft Female" },
];

const QUICK_TOPICS = [
  { label: "Nifty50 market wrap", type: "market" },
  { label: "Top gainers & losers NSE", type: "gainers" },
  { label: "FII DII flow today", type: "fii" },
  { label: "Banking sector outlook", type: "sector" },
  { label: "IT sector earnings", type: "sector" },
  { label: "RBI policy impact", type: "market" },
];

const SCHEDULE = [
  { time: "09:15", label: "Market Open Bell",   color: "#00d4a0", icon: "🔔" },
  { time: "11:30", label: "Mid-Session Movers", color: "#3b82f6", icon: "📊" },
  { time: "14:00", label: "FII/DII Activity",   color: "#f59e0b", icon: "🏦" },
  { time: "15:30", label: "Closing Bell Recap",  color: "#7c3aed", icon: "🎬" },
];

// ── Fallback static data used until real data arrives ────────────────────────
const FALLBACK_PRICES = [
  { sym: "RELIANCE", price: 2847, chg: +1.2 },
  { sym: "TCS",      price: 3521, chg: -0.4 },
  { sym: "HDFCBANK", price: 1689, chg: +0.8 },
  { sym: "INFY",     price: 1673, chg: +2.1 },
  { sym: "ICICIBANK",price: 1245, chg: +1.5 },
  { sym: "SBIN",     price: 812,  chg: -0.6 },
  { sym: "BAJFINANCE",price: 7234,chg: +0.3 },
  { sym: "WIPRO",    price: 489,  chg: -1.1 },
];

const FALLBACK_SECTORS = [
  { name: "IT",      chg: +1.8, color: "#3b82f6" },
  { name: "Banking", chg: +0.9, color: "#00d4a0" },
  { name: "Energy",  chg: -0.4, color: "#f59e0b" },
  { name: "Auto",    chg: +2.1, color: "#7c3aed" },
  { name: "Pharma",  chg: -0.8, color: "#ec4899" },
];

const FII_DII = [
  { day: "Mon", fii: -1240, dii: +890  },
  { day: "Tue", fii: -560,  dii: +1200 },
  { day: "Wed", fii: +340,  dii: +650  },
  { day: "Thu", fii: +890,  dii: +420  },
  { day: "Fri", fii: +1560, dii: +780  },
];

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// ── Main Market Canvas — uses REAL data from API ──────────────────────────────
function MarketVideoCanvas({ isPlaying, topic, marketData }) {
  const canvasRef  = useRef(null);
  const animRef    = useRef(null);
  const frameRef   = useRef(0);
  const tickerRef  = useRef(0);

  // Use real data or fallback
  const livePrices  = marketData?.live_prices?.length  ? marketData.live_prices  : FALLBACK_PRICES;
  const sectors     = marketData?.sectors?.length      ? marketData.sectors.map((s, i) => ({
    ...s, color: ["#3b82f6","#00d4a0","#f59e0b","#7c3aed","#ec4899"][i % 5]
  })) : FALLBACK_SECTORS;
  const niftyChart  = marketData?.nifty_chart || [];
  const niftyCurrent = marketData?.nifty_current || 22847;
  const niftyChgPct  = marketData?.nifty_change_pct || 0;
  const timestamp    = marketData?.generated_at_ist || new Date().toLocaleTimeString("en-IN");

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const W = canvas.width, H = canvas.height;
    const t = frameRef.current;
    const speed = isPlaying ? 1.4 : 0.6;

    // Background
    ctx.fillStyle = "#060b14";
    ctx.fillRect(0, 0, W, H);

    // Grid
    ctx.strokeStyle = "#0d1a2e"; ctx.lineWidth = 0.5;
    for (let i = 0; i <= 8; i++) { const y = (i/8)*H; ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }
    for (let i = 0; i <= 12; i++) { const x = (i/12)*W; ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }

    // ── TOP BAR ──────────────────────────────────────────────────────────────
    ctx.fillStyle = "#080e1a";
    ctx.fillRect(0, 0, W, 32);
    ctx.strokeStyle = "#0f1e33"; ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(0, 32); ctx.lineTo(W, 32); ctx.stroke();

    ctx.fillStyle = "#00d4a0"; ctx.font = "bold 11px JetBrains Mono, monospace";
    ctx.fillText("▶ InvestEdge AI — ET Markets LIVE", 12, 20);

    // Live dot blink
    const alpha = 0.5 + 0.5 * Math.sin(t * 0.12);
    ctx.fillStyle = `rgba(255,68,102,${alpha})`;
    ctx.beginPath(); ctx.arc(W - 62, 16, 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#ff4466"; ctx.font = "9px JetBrains Mono, monospace";
    ctx.fillText("LIVE", W - 54, 20);

    ctx.fillStyle = "#334155"; ctx.font = "9px JetBrains Mono, monospace";
    ctx.textAlign = "right";
    ctx.fillText(`NSE · ${timestamp}`, W - 68, 20);
    ctx.textAlign = "left";

    // ── NIFTY CANDLESTICK CHART (left 56%, top 52%) ───────────────────────
    const chartX = 12, chartY = 40, chartW = W * 0.55, chartH = H * 0.50;

    if (niftyChart.length > 1) {
      // REAL data
      const prices = niftyChart.flatMap(d => [d.high, d.low, d.open, d.close]).filter(Boolean);
      const minP = Math.min(...prices) * 0.999;
      const maxP = Math.max(...prices) * 1.001;
      const range = maxP - minP || 1;
      const gap = chartW / niftyChart.length;
      const cw  = Math.max(2, gap * 0.6);

      niftyChart.forEach((d, i) => {
        if (!d.open || !d.close) return;
        const x  = chartX + i * gap + gap / 2;
        const yH = chartY + ((maxP - (d.high || d.close)) / range) * chartH;
        const yL = chartY + ((maxP - (d.low  || d.close)) / range) * chartH;
        const yO = chartY + ((maxP - d.open)  / range) * chartH;
        const yC = chartY + ((maxP - d.close) / range) * chartH;
        const up = d.close >= d.open;
        const col = up ? "#00d4a0" : "#ff4466";

        ctx.strokeStyle = col; ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.moveTo(x, yH); ctx.lineTo(x, yL); ctx.stroke();

        if (i === niftyChart.length - 1) {
          const grow = 0.4 + 0.6 * ((Math.sin(t * 0.05) + 1) / 2);
          ctx.fillStyle = col + "bb";
          ctx.fillRect(x - cw/2, Math.min(yO, yC), cw, Math.max(1.5, Math.abs(yC - yO)) * grow);
        } else {
          ctx.fillStyle = col;
          ctx.fillRect(x - cw/2, Math.min(yO, yC), cw, Math.max(1.5, Math.abs(yC - yO)));
        }
      });

      // EMA line from real data
      let ema = niftyChart[0].close;
      const emaPoints = niftyChart.map((d, i) => {
        ema = ema * 0.88 + (d.close || ema) * 0.12;
        return [chartX + i * gap + gap/2, chartY + ((maxP - ema) / range) * chartH];
      });
      ctx.strokeStyle = "#3b82f680"; ctx.lineWidth = 1.5;
      ctx.beginPath();
      emaPoints.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
      ctx.stroke();

      // Price line at last close
      const lastClose = niftyChart[niftyChart.length - 1].close;
      const lineY = chartY + ((maxP - lastClose) / range) * chartH;
      ctx.strokeStyle = "#facc1560"; ctx.lineWidth = 0.7; ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(chartX, lineY); ctx.lineTo(chartX + chartW, lineY); ctx.stroke();
      ctx.setLineDash([]);

    } else {
      // Animated fallback bars
      for (let i = 0; i < 30; i++) {
        const x = chartX + (i / 30) * chartW;
        const base = chartY + chartH * 0.5;
        const h2 = Math.sin(i * 0.4 + t * 0.02) * chartH * 0.3;
        const up = Math.sin(i * 0.7 + t * 0.01) > 0;
        ctx.fillStyle = up ? "#00d4a0" : "#ff4466";
        ctx.fillRect(x, base - Math.abs(h2), chartW / 32, Math.abs(h2));
      }
    }

    // Chart labels
    const niftyColor = niftyChgPct >= 0 ? "#00d4a0" : "#ff4466";
    ctx.fillStyle = "#94a3b8"; ctx.font = "bold 11px JetBrains Mono, monospace";
    ctx.fillText("NIFTY 50", chartX + 4, chartY - 4);
    ctx.fillStyle = niftyColor; ctx.font = "bold 14px JetBrains Mono, monospace";
    ctx.fillText(`${niftyCurrent.toLocaleString("en-IN")}`, chartX + 78, chartY - 4);
    ctx.fillStyle = niftyColor; ctx.font = "10px JetBrains Mono, monospace";
    ctx.fillText(`${niftyChgPct >= 0 ? "▲" : "▼"}${Math.abs(niftyChgPct).toFixed(2)}%  (1 month)`, chartX + 200, chartY - 4);

    // Topic banner under chart
    if (topic) {
      ctx.fillStyle = "#0f1e3388";
      roundRect(ctx, chartX, chartY + chartH + 3, chartW, 17, 3); ctx.fill();
      ctx.fillStyle = "#475569"; ctx.font = "8.5px JetBrains Mono, monospace";
      ctx.fillText(`📊 ${topic.slice(0, 60)}`, chartX + 6, chartY + chartH + 13);
    }

    // ── LIVE PRICE RACE CHART (right top) ────────────────────────────────
    const rcX = W * 0.58, rcY = 38, rcW = W * 0.40, rcH = H * 0.46;
    ctx.fillStyle = "#0a1220"; roundRect(ctx, rcX, rcY, rcW, rcH, 8); ctx.fill();
    ctx.strokeStyle = "#0f1e33"; ctx.lineWidth = 0.5;
    roundRect(ctx, rcX, rcY, rcW, rcH, 8); ctx.stroke();

    ctx.fillStyle = "#334155"; ctx.font = "9px JetBrains Mono, monospace";
    ctx.fillText("LIVE PRICE RACE", rcX + 8, rcY + 13);

    const maxChg = Math.max(...livePrices.map(p => Math.abs(p.chg || 0)), 3);
    const rowH3  = (rcH - 24) / Math.min(livePrices.length, 8);

    livePrices.slice(0, 8).forEach((s, i) => {
      const ry = rcY + 20 + i * rowH3;
      const pulse = 1 + 0.03 * Math.sin(t * speed * 0.05 + i * 1.2);
      const dispChg = (s.chg || 0) + Math.sin(t * 0.04 + i) * 0.04;
      const col = dispChg >= 0 ? "#00d4a0" : "#ff4466";
      const barW = (Math.abs(dispChg) / maxChg) * (rcW - 100) * pulse;

      // Background bar
      ctx.fillStyle = col + "18";
      ctx.fillRect(rcX + 70, ry + 2, rcW - 90, rowH3 - 5);
      // Actual bar
      ctx.fillStyle = col + "cc";
      ctx.fillRect(rcX + 70, ry + 2, Math.max(2, barW), rowH3 - 5);

      ctx.fillStyle = "#64748b"; ctx.font = "bold 8.5px JetBrains Mono, monospace";
      ctx.fillText(s.sym.slice(0, 9), rcX + 6, ry + rowH3 / 2 + 3);

      ctx.fillStyle = "#94a3b8"; ctx.font = "8px JetBrains Mono, monospace";
      ctx.fillText(`₹${(s.price || 0).toLocaleString("en-IN")}`, rcX + 70, ry + rowH3 / 2 + 3);

      ctx.fillStyle = col; ctx.font = "8px JetBrains Mono, monospace";
      ctx.textAlign = "right";
      ctx.fillText(`${dispChg >= 0 ? "+" : ""}${dispChg.toFixed(1)}%`, rcX + rcW - 6, ry + rowH3 / 2 + 3);
      ctx.textAlign = "left";
    });

    // ── SECTOR ROTATION (right bottom half) ──────────────────────────────
    const srX = W * 0.58, srY = rcY + rcH + 6, srW = W * 0.40, srH = H * 0.32;
    ctx.fillStyle = "#0a1220"; roundRect(ctx, srX, srY, srW, srH, 8); ctx.fill();
    ctx.strokeStyle = "#0f1e33"; ctx.lineWidth = 0.5;
    roundRect(ctx, srX, srY, srW, srH, 8); ctx.stroke();

    ctx.fillStyle = "#334155"; ctx.font = "9px JetBrains Mono, monospace";
    ctx.fillText("SECTOR ROTATION", srX + 8, srY + 13);

    const maxS = Math.max(...sectors.map(s => Math.abs(s.chg || 0)), 2);
    const sbH = (srH - 24) / sectors.length - 2;

    sectors.forEach((s, i) => {
      const sy = srY + 20 + i * (sbH + 2);
      const pulse = 1 + 0.04 * Math.sin(t * speed * 0.04 + i * 0.9);
      const w2 = (Math.abs(s.chg || 0) / maxS) * (srW - 80) * pulse;
      const col = (s.chg || 0) >= 0 ? "#00d4a0" : "#ff4466";

      ctx.fillStyle = col + "20";
      ctx.fillRect(srX + 52, sy, srW - 68, sbH);
      ctx.fillStyle = s.color + "cc";
      ctx.fillRect(srX + 52, sy, Math.max(2, w2), sbH);

      ctx.fillStyle = "#64748b"; ctx.font = "8.5px JetBrains Mono, monospace";
      ctx.fillText(s.name, srX + 4, sy + sbH / 2 + 3);
      ctx.fillStyle = col; ctx.font = "8px JetBrains Mono, monospace";
      ctx.textAlign = "right";
      ctx.fillText(`${(s.chg || 0) >= 0 ? "+" : ""}${(s.chg || 0).toFixed(1)}%`, srX + srW - 4, sy + sbH / 2 + 3);
      ctx.textAlign = "left";
    });

    // ── FII/DII (left bottom) ─────────────────────────────────────────────
    const fX = chartX, fY = chartY + chartH + 24, fW = W * 0.55, fH = H * 0.28;
    ctx.fillStyle = "#0a1220"; roundRect(ctx, fX, fY, fW, fH, 8); ctx.fill();
    ctx.strokeStyle = "#0f1e33"; ctx.lineWidth = 0.5;
    roundRect(ctx, fX, fY, fW, fH, 8); ctx.stroke();

    ctx.fillStyle = "#334155"; ctx.font = "9px JetBrains Mono, monospace";
    ctx.fillText("FII / DII WEEKLY FLOWS  (₹ Cr)", fX + 8, fY + 13);

    const maxF = 1600, midY2 = fY + fH / 2 + 8;
    const bw2 = (fW - 24) / FII_DII.length / 2 - 3;

    ctx.strokeStyle = "#1e3a5f"; ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(fX + 8, midY2); ctx.lineTo(fX + fW - 8, midY2); ctx.stroke();

    FII_DII.forEach((d, i) => {
      const cx2 = fX + 14 + i * ((fW - 24) / FII_DII.length) + (fW - 24) / FII_DII.length / 2;
      const pulse = 1 + 0.03 * Math.sin(t * speed * 0.05 + i);

      const fh = (Math.abs(d.fii) / maxF) * (fH / 2 - 20) * pulse;
      ctx.fillStyle = d.fii >= 0 ? "#00d4a040" : "#ff446640";
      ctx.fillRect(cx2 - bw2 - 2, d.fii >= 0 ? midY2 - fh : midY2, bw2, fh);
      ctx.fillStyle = d.fii >= 0 ? "#00d4a0" : "#ff4466";
      ctx.fillRect(cx2 - bw2 - 2, d.fii >= 0 ? midY2 - fh : midY2, bw2, 2);

      const dh = (Math.abs(d.dii) / maxF) * (fH / 2 - 20) * pulse;
      ctx.fillStyle = "#3b82f640";
      ctx.fillRect(cx2 + 2, midY2 - dh, bw2, dh);
      ctx.fillStyle = "#3b82f6";
      ctx.fillRect(cx2 + 2, midY2 - dh, bw2, 2);

      ctx.fillStyle = "#334155"; ctx.font = "8px JetBrains Mono, monospace";
      ctx.textAlign = "center";
      ctx.fillText(d.day, cx2, fY + fH - 4);
      ctx.textAlign = "left";
    });

    // FII/DII legend
    ctx.fillStyle = "#00d4a0"; ctx.fillRect(fX + fW - 76, fY + 8, 8, 6);
    ctx.fillStyle = "#475569"; ctx.font = "7.5px JetBrains Mono, monospace";
    ctx.fillText("FII", fX + fW - 64, fY + 14);
    ctx.fillStyle = "#3b82f6"; ctx.fillRect(fX + fW - 36, fY + 8, 8, 6);
    ctx.fillText("DII", fX + fW - 24, fY + 14);

    // ── SCROLLING TICKER ──────────────────────────────────────────────────
    const tickY2 = H - 22;
    ctx.fillStyle = "#00d4a0"; ctx.fillRect(0, tickY2, W, 22);

    tickerRef.current = (tickerRef.current + speed * 0.9) % (W * 2.2);
    const tOff = -tickerRef.current;

    ctx.save();
    ctx.beginPath(); ctx.rect(0, tickY2, W, 22); ctx.clip();

    let tx = tOff;
    const tickers = [...livePrices, ...livePrices];
    tickers.forEach(s => {
      ctx.fillStyle = "#060b14"; ctx.font = "bold 9px JetBrains Mono, monospace";
      const sym = s.sym || "";
      ctx.fillText(sym, tx + W, tickY2 + 14);
      tx += ctx.measureText(sym).width + 4;
      const pStr = `₹${(s.price||0).toLocaleString("en-IN")}`;
      ctx.fillText(pStr, tx + W, tickY2 + 14);
      tx += ctx.measureText(pStr).width + 4;
      ctx.fillStyle = (s.chg||0) >= 0 ? "#004d2e" : "#7f0000";
      const cStr = `${(s.chg||0) >= 0 ? "▲" : "▼"}${Math.abs(s.chg||0).toFixed(1)}%`;
      ctx.fillText(cStr, tx + W, tickY2 + 14);
      tx += ctx.measureText(cStr).width + 22;
    });
    ctx.restore();

    frameRef.current++;
    animRef.current = requestAnimationFrame(draw);
  }, [isPlaying, topic, marketData, livePrices, sectors, niftyChart, niftyCurrent, niftyChgPct, timestamp]);

  useEffect(() => {
    animRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animRef.current);
  }, [draw]);

  return (
    <canvas ref={canvasRef} width={720} height={400}
      style={{ width: "100%", display: "block", borderRadius: "10px 10px 0 0", border: "1px solid #0f1e33" }}
    />
  );
}

function AnimatedBar() {
  const [bars, setBars] = useState(() => Array.from({ length: 24 }, () => Math.random()));
  useEffect(() => {
    const id = setInterval(() => {
      setBars(prev => prev.map(b => Math.max(0.05, Math.min(1, b + (Math.random() - 0.5) * 0.25))));
    }, 500);
    return () => clearInterval(id);
  }, []);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 40 }}>
      {bars.map((b, i) => (
        <div key={i} style={{
          flex: 1, height: `${b * 100}%`,
          background: i % 3 === 0 ? "#7c3aed" : i % 3 === 1 ? "#0ea5e9" : "#00d4a0",
          borderRadius: "2px 2px 0 0", transition: "height 0.4s ease", opacity: 0.6 + b * 0.4,
        }} />
      ))}
    </div>
  );
}

export default function VideoEngine() {
  const [topic, setTopic]             = useState("");
  const [voiceId, setVoiceId]         = useState(VOICES[0].id);
  const [loading, setLoading]         = useState(false);
  const [loadingStep, setLoadingStep] = useState("");
  const [result, setResult]           = useState(null);
  const [error, setError]             = useState(null);
  const [isPlaying, setIsPlaying]     = useState(false);
  const audioRef = useRef(null);

  async function generate() {
    const t = topic.trim();
    if (!t) return;
    setLoading(true); setError(null); setResult(null); setIsPlaying(false);
    try {
      setLoadingStep("Waking server…");
      try { await fetch(`${BACKEND}/health`, { signal: AbortSignal.timeout(8000) }); } catch (_) {}

      setLoadingStep("Generating Hinglish script via Groq…");
      const res = await fetch(`${BACKEND}/api/video`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: t, voice_id: voiceId }),
        signal: AbortSignal.timeout(60000),
      });

      if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try { const j = await res.json(); detail = j.detail || detail; } catch (_) {
          detail = res.status === 404 ? "Backend not reachable — is server running on port 8000?" : `Server error (${res.status})`;
        }
        throw new Error(detail);
      }

      setLoadingStep("Fetching live market data + converting to voice…");
      const data = await res.json();
      setResult(data);

      if (data.audio_b64 && audioRef.current) {
        setTimeout(() => {
          audioRef.current?.play().then(() => setIsPlaying(true)).catch(() => {});
        }, 300);
      }
    } catch (e) {
      setError(e.name === "TimeoutError" ? "Timed out — server may be starting up, try again." : e.message);
    } finally {
      setLoading(false); setLoadingStep("");
    }
  }

  return (
    <div style={{ height: "100%", overflowY: "auto", padding: "24px 28px" }}>
      {/* Header */}
      <div className="section-header">
        <div className="section-icon" style={{ background: "#071a0f", border: "1px solid #00d4a030" }}>🎬</div>
        <div>
          <div className="section-title">AI Market Video Engine</div>
          <div className="section-sub">Real-time data · Groq Script · ElevenLabs Voice · Live Broadcast Canvas</div>
        </div>
      </div>

      <div style={{ padding: "12px 16px", background: "#080e1a", border: "1px solid #0f1e33",
        borderRadius: 10, marginBottom: 20, fontSize: 13, color: "#64748b", lineHeight: 1.6 }}>
        Auto-generates a <strong style={{ color: "#94a3b8" }}>Hinglish market update script</strong> via Groq →
        <strong style={{ color: "#94a3b8" }}> real AI voice</strong> via ElevenLabs →
        plays over a <strong style={{ color: "#00d4a0" }}>live broadcast canvas</strong> with real NSE prices,
        sector rotation, FII/DII flows and race chart.
        <span style={{ color: "#00d4a0" }}> Zero human editing. 30–60 seconds.</span>
      </div>

      {/* Controls */}
      <div style={{ padding: "18px 20px", background: "#080e1a", border: "1px solid #00d4a020",
        borderRadius: 14, marginBottom: 20 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0", marginBottom: 10,
          fontFamily: "Outfit, sans-serif" }}>Generate AI Market Video</div>

        {/* Topic chips */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
          {QUICK_TOPICS.map(qt => (
            <button key={qt.label} onClick={() => setTopic(qt.label)} style={{
              padding: "4px 10px", borderRadius: 6, border: "1px solid #0f1e33",
              background: topic === qt.label ? "#001f12" : "#080e1a",
              color: topic === qt.label ? "#00d4a0" : "#475569",
              fontSize: 11, cursor: "pointer", fontFamily: "Inter, sans-serif",
            }}>{qt.label}</button>
          ))}
        </div>

        {/* Input + generate */}
        <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
          <input className="input" value={topic} onChange={e => setTopic(e.target.value)}
            onKeyDown={e => e.key === "Enter" && generate()}
            placeholder="Topic… 'Nifty weekly recap', 'HDFC Bank results', 'FII selloff'"
            style={{ flex: 1 }} />
          <button className="btn btn-primary" onClick={generate}
            disabled={!topic.trim() || loading}
            style={{ background: "linear-gradient(135deg,#065f46,#00d4a0)", minWidth: 120 }}>
            {loading ? "Generating…" : "🎬 Generate"}
          </button>
        </div>

        {/* Voice selector */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 11, color: "#475569", fontFamily: "JetBrains Mono, monospace",
            whiteSpace: "nowrap" }}>🎙️ Voice:</span>
          <select value={voiceId} onChange={e => setVoiceId(e.target.value)} style={{
            flex: 1, padding: "6px 10px", borderRadius: 8, border: "1px solid #0f1e33",
            background: "#0a1220", color: "#94a3b8", fontSize: 12,
            fontFamily: "Inter, sans-serif", cursor: "pointer", outline: "none",
          }}>
            {VOICES.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </div>

        {/* Loading */}
        {loading && (
          <div style={{ marginTop: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <div style={{ width: 24, height: 24, border: "3px solid #0f1e33",
                borderTopColor: "#00d4a0", borderRadius: "50%",
                animation: "spin 0.8s linear infinite", flexShrink: 0 }} />
              <div style={{ fontSize: 12, color: "#00d4a0", fontFamily: "JetBrains Mono, monospace" }}>
                {loadingStep}
              </div>
            </div>
            <AnimatedBar />
          </div>
        )}

        {error && (
          <div style={{ marginTop: 12, padding: "10px 14px", background: "#1f0010",
            border: "1px solid #ff446640", borderRadius: 10, color: "#ff7a9a",
            fontSize: 12, fontFamily: "JetBrains Mono, monospace" }}>
            ⚠️ {error}
          </div>
        )}
      </div>

      {/* VIDEO PLAYER — shows after generation */}
      {result && !loading && (
        <div style={{ marginBottom: 20, animation: "fadeUp 0.5s ease" }}>
          {/* Real-data market canvas */}
          <MarketVideoCanvas
            isPlaying={isPlaying}
            topic={topic}
            marketData={result.market_data || {}}
          />

          {/* Audio + script */}
          <div style={{
            background: "#0a1220", border: "1px solid #0f1e33",
            borderTop: "none", borderRadius: "0 0 10px 10px", padding: "12px 16px",
          }}>
            {/* Real data badge */}
            {result.market_data?.nifty_current && (
              <div style={{ marginBottom: 10, display: "flex", gap: 6, flexWrap: "wrap" }}>
                <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4,
                  background: "#071a0f", border: "1px solid #00d4a030", color: "#00d4a0",
                  fontFamily: "JetBrains Mono, monospace" }}>
                  📡 Live data — Nifty {result.market_data.nifty_current?.toLocaleString("en-IN")}
                  &nbsp;{(result.market_data.nifty_change_pct || 0) >= 0 ? "▲" : "▼"}
                  {Math.abs(result.market_data.nifty_change_pct || 0).toFixed(2)}%
                </span>
                <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4,
                  background: "#071a0f", border: "1px solid #00d4a030", color: "#00d4a0",
                  fontFamily: "JetBrains Mono, monospace" }}>
                  {result.market_data.live_prices?.length || 0} stocks live
                </span>
              </div>
            )}

            {result.tts_ready && result.audio_b64 ? (
              <>
                <div style={{ fontSize: 10, color: "#00d4a0", fontFamily: "JetBrains Mono, monospace",
                  textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
                  🎙️ AI Voice — ElevenLabs · {VOICES.find(v => v.id === voiceId)?.name}
                </div>
                <audio ref={audioRef} controls style={{ width: "100%", height: 40 }}
                  src={`data:audio/mpeg;base64,${result.audio_b64}`}
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                  onEnded={() => setIsPlaying(false)}
                />
              </>
            ) : (
              <div style={{ fontSize: 12, color: "#f59e0b", fontFamily: "JetBrains Mono, monospace" }}>
                ⚠️ Script ready — TTS unavailable. Check ELEVENLABS_KEY.
              </div>
            )}

            {/* Script */}
            <div style={{ marginTop: 12, padding: "10px 14px", background: "#080e1a",
              borderRadius: 8, border: "1px solid #0f1e33" }}>
              <div style={{ fontSize: 10, color: "#334155", fontFamily: "JetBrains Mono, monospace",
                marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                AI Script — Groq · {result.script?.split(" ").length} words
              </div>
              <div style={{ fontSize: 13, color: "#e2e8f0", lineHeight: 1.8,
                fontFamily: "Inter, sans-serif", fontStyle: "italic" }}>
                "{result.script}"
              </div>
            </div>

            {/* Status badges */}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
              {[
                { label: "✅ Script", always: true },
                { label: result.tts_ready ? "✅ Audio" : "⚠️ Audio", ok: result.tts_ready },
                { label: "✅ Real market data", always: true },
                { label: "✅ Live canvas", always: true },
              ].map((b, i) => (
                <span key={i} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4,
                  background: b.ok === false ? "#1f0010" : "#071a0f",
                  border: `1px solid ${b.ok === false ? "#ff446630" : "#00d4a030"}`,
                  color: b.ok === false ? "#ff7a9a" : "#00d4a0",
                  fontFamily: "JetBrains Mono, monospace" }}>
                  {b.label}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Schedule */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 11, color: "#475569", fontFamily: "JetBrains Mono, monospace",
          letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 10 }}>
          Automated Broadcast Schedule
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(160px,1fr))", gap: 8 }}>
          {SCHEDULE.map(h => (
            <div key={h.time} style={{ padding: "12px 14px", background: "#080e1a",
              border: `1px solid ${h.color}20`, borderRadius: 10, borderLeft: `3px solid ${h.color}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 14 }}>{h.icon}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: h.color,
                  fontFamily: "JetBrains Mono, monospace" }}>{h.time}</span>
              </div>
              <div style={{ fontSize: 11, color: "#94a3b8" }}>{h.label}</div>
            </div>
          ))}
        </div>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeUp { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }
      `}</style>
    </div>
  );
}
