import { useState, useRef, useEffect } from "react";

const BACKEND = import.meta.env.VITE_API_URL || "http://localhost:8000";

const SAMPLE = `RELIANCE 50 2800
HDFCBANK 30 1650
INFY 100 1420
TCS 20 3800`;

function parseHoldings(raw) {
  const lines = raw.trim().split("\n");
  const holdings = [];
  for (const line of lines) {
    const m1 = line.match(/([A-Z&-]+)\s+(\d+(?:\.\d+)?)\s+[\u20b9₹]?(\d+(?:\.\d+)?)/i);
    const m2 = line.match(/([A-Z&-]+)[^0-9]*(\d+(?:\.\d+)?)[^0-9]*[\u20b9₹]?(\d+(?:\.\d+)?)/i);
    const m = m1 || m2;
    if (m) holdings.push({ symbol: m[1].toUpperCase(), qty: parseFloat(m[2]), avg_cost: parseFloat(m[3]) });
  }
  return holdings;
}

// ── Donut Pie Chart ───────────────────────────────────────────────────────────
const COLORS = ["#00d4a0","#3b82f6","#f59e0b","#7c3aed","#ec4899","#06b6d4","#f97316","#10b981","#e11d48","#84cc16"];

function DonutChart({ holdings }) {
  const canvasRef = useRef(null);
  const valid = holdings.filter(h => h.current_value > 0);
  const total = valid.reduce((s, h) => s + h.current_value, 0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !valid.length) return;
    const ctx = canvas.getContext("2d");
    const W = canvas.width, H = canvas.height;
    const cx = W / 2, cy = H / 2;
    const R = Math.min(W, H) / 2 - 10;
    const r = R * 0.55;
    ctx.clearRect(0, 0, W, H);

    let angle = -Math.PI / 2;
    valid.forEach((h, i) => {
      const slice = (h.current_value / total) * 2 * Math.PI;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, R, angle, angle + slice);
      ctx.closePath();
      ctx.fillStyle = COLORS[i % COLORS.length];
      ctx.fill();
      ctx.strokeStyle = "#060b14";
      ctx.lineWidth = 2;
      ctx.stroke();
      angle += slice;
    });

    // Donut hole
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, 2 * Math.PI);
    ctx.fillStyle = "#060b14";
    ctx.fill();

    // Center text
    ctx.fillStyle = "#e2e8f0";
    ctx.font = "bold 11px JetBrains Mono, monospace";
    ctx.textAlign = "center";
    ctx.fillText("₹" + (total / 1000).toFixed(0) + "K", cx, cy - 4);
    ctx.fillStyle = "#475569";
    ctx.font = "9px JetBrains Mono, monospace";
    ctx.fillText("Portfolio", cx, cy + 10);
    ctx.textAlign = "left";
  }, [holdings]);

  return (
    <div style={{ display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap" }}>
      <canvas ref={canvasRef} width={160} height={160} style={{ flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 160 }}>
        {valid.map((h, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, flexShrink: 0, background: COLORS[i % COLORS.length] }} />
            <div style={{ flex: 1, fontSize: 11, color: "#94a3b8", fontFamily: "JetBrains Mono, monospace" }}>{h.symbol}</div>
            <div style={{ fontSize: 11, color: "#64748b", fontFamily: "JetBrains Mono, monospace" }}>{h.weight_pct?.toFixed(1)}%</div>
            <div style={{ fontSize: 11, color: h.pnl >= 0 ? "#00d4a0" : "#ff4466", fontFamily: "JetBrains Mono, monospace" }}>
              {h.pnl >= 0 ? "+" : ""}{h.pnl_pct?.toFixed(1)}%
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PnlBar({ pct }) {
  return (
    <div style={{ height: 6, background: "#0a1220", borderRadius: 3, overflow: "hidden", marginTop: 6 }}>
      <div style={{
        height: "100%", width: `${Math.min(Math.abs(pct) * 2, 100)}%`,
        background: pct >= 0 ? "linear-gradient(90deg,#059669,#00d4a0)" : "linear-gradient(90deg,#dc2626,#ff4466)",
        borderRadius: 3, transition: "width 0.6s ease",
      }} />
    </div>
  );
}

export default function Portfolio() {
  const [raw, setRaw]       = useState(SAMPLE);
  const [loading, setLoading] = useState(false);
  const [data, setData]     = useState(null);
  const [error, setError]   = useState(null);

  async function analyze() {
    const holdings = parseHoldings(raw);
    if (!holdings.length) { setError("Could not parse holdings. Format: SYMBOL QTY AVGPRICE"); return; }
    setLoading(true); setError(null); setData(null);
    try {
      const res = await fetch(`${BACKEND}/api/portfolio`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ holdings }),
      });
      if (!res.ok) throw new Error((await res.json()).detail || `HTTP ${res.status}`);
      setData(await res.json());
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  const summary = data?.summary;
  const inProfit = summary && summary.total_pnl >= 0;

  return (
    <div style={{ height: "100%", overflowY: "auto", padding: "28px 32px" }}>
      <div className="section-header">
        <div className="section-icon" style={{ background: "#0a0a1a", border: "1px solid #4f46e530" }}>💼</div>
        <div>
          <div className="section-title">Portfolio Analyzer</div>
          <div className="section-sub">P&L · Risk · Allocation · Per-Holding Signals</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 11, color: "#475569", fontFamily: "JetBrains Mono, monospace",
            marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Enter Holdings
          </div>
          <textarea
            value={raw}
            onChange={e => setRaw(e.target.value)}
            rows={6}
            placeholder={"RELIANCE 50 2800\nHDFCBANK 30 1650\nINFY 100 1420"}
            style={{
              width: "100%", background: "#080e1a", border: "1px solid #0f1e33",
              borderRadius: 10, padding: "12px 14px", color: "#cbd5e1",
              fontSize: 13, fontFamily: "JetBrains Mono, monospace",
              resize: "vertical", outline: "none", lineHeight: 1.7, boxSizing: "border-box",
            }}
          />
          <div style={{ fontSize: 10, color: "#334155", marginTop: 4, fontFamily: "JetBrains Mono, monospace" }}>
            Format: SYMBOL QUANTITY AVGPRICE — one per line
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "flex-end", gap: 10 }}>
          <button onClick={analyze} disabled={loading} style={{
            padding: "14px", borderRadius: 10, border: "none",
            background: loading ? "#0f1e33" : "linear-gradient(135deg,#1e1b4b,#4f46e5)",
            color: loading ? "#334155" : "#e9d5ff", fontSize: 14, fontWeight: 600,
            cursor: loading ? "not-allowed" : "pointer", fontFamily: "Outfit, sans-serif",
          }}>
            {loading ? "⏳ Analyzing…" : "📊 Analyze Portfolio"}
          </button>
          <button onClick={() => setRaw(SAMPLE)} style={{
            padding: "10px", borderRadius: 10, border: "1px solid #0f1e33",
            background: "#080e1a", color: "#475569", fontSize: 12, cursor: "pointer",
          }}>Load sample portfolio</button>
        </div>
      </div>

      {error && (
        <div style={{ padding: "12px 16px", background: "#1f0010", border: "1px solid #ff446640",
          borderRadius: 10, color: "#ff7a9a", fontSize: 12, fontFamily: "JetBrains Mono, monospace", marginBottom: 16 }}>
          ⚠️ {error}
        </div>
      )}

      {data && (
        <div style={{ animation: "fadeUp 0.4s ease" }}>
          {/* Summary cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(150px,1fr))", gap: 10, marginBottom: 20 }}>
            {[
              { label: "Invested", val: `₹${summary.total_invested.toLocaleString("en-IN")}`, color: "#94a3b8" },
              { label: "Current Value", val: `₹${summary.total_current.toLocaleString("en-IN")}`, color: "#e2e8f0" },
              { label: "Total P&L", val: `${inProfit ? "+" : ""}₹${summary.total_pnl.toLocaleString("en-IN")}`, color: inProfit ? "#00d4a0" : "#ff4466" },
              { label: "Return", val: `${inProfit ? "+" : ""}${summary.total_pnl_pct?.toFixed(2)}%`, color: inProfit ? "#00d4a0" : "#ff4466" },
              { label: "Holdings", val: summary.count, color: "#94a3b8" },
              { label: "Sharpe Ratio", val: summary.portfolio_sharpe ?? "N/A", color: "#a78bfa" },
            ].map(c => (
              <div key={c.label} style={{ padding: "12px 14px", background: "#080e1a",
                border: "1px solid #0f1e33", borderRadius: 10 }}>
                <div style={{ fontSize: 10, color: "#334155", fontFamily: "JetBrains Mono, monospace",
                  textTransform: "uppercase", marginBottom: 4 }}>{c.label}</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: c.color,
                  fontFamily: "JetBrains Mono, monospace" }}>{c.val}</div>
              </div>
            ))}
          </div>

          {/* Donut allocation chart */}
          <div style={{ padding: "16px 18px", background: "#080e1a", border: "1px solid #0f1e33",
            borderRadius: 12, marginBottom: 20 }}>
            <div style={{ fontSize: 11, color: "#475569", fontFamily: "JetBrains Mono, monospace",
              textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 12 }}>
              Portfolio Allocation
            </div>
            <DonutChart holdings={data.holdings} />
          </div>

          {/* Holdings table */}
          <div style={{ fontSize: 11, color: "#475569", fontFamily: "JetBrains Mono, monospace",
            textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>
            Holdings Detail
          </div>
          {data.holdings.map((h, i) => {
            if (h.error) return (
              <div key={i} style={{ padding: "12px 14px", background: "#1f0010",
                border: "1px solid #ff446630", borderRadius: 10, marginBottom: 8,
                fontSize: 12, color: "#ff7a9a", fontFamily: "JetBrains Mono, monospace" }}>
                ⚠️ {h.symbol}: {h.error}
              </div>
            );
            const pos = h.pnl >= 0;
            const sigColor = h.signal === "accumulate" ? "#00d4a0" : h.signal === "review" ? "#f97316" : "#94a3b8";
            return (
              <div key={i} style={{ padding: "14px 16px", background: "#080e1a",
                border: "1px solid #0f1e33", borderRadius: 12, marginBottom: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ width: 10, height: 10, borderRadius: 2, background: COLORS[i % COLORS.length] }} />
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 700, color: "#e2e8f0",
                        fontFamily: "JetBrains Mono, monospace" }}>{h.symbol}</div>
                      <div style={{ fontSize: 10, color: "#334155", fontFamily: "JetBrains Mono, monospace" }}>
                        {h.qty} shares @ ₹{h.avg_cost} avg
                      </div>
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: "#e2e8f0",
                      fontFamily: "JetBrains Mono, monospace" }}>
                      ₹{h.current_price?.toLocaleString("en-IN")}
                    </div>
                    <div style={{ fontSize: 12, color: pos ? "#00d4a0" : "#ff4466",
                      fontFamily: "JetBrains Mono, monospace" }}>
                      {pos ? "+" : ""}₹{h.pnl?.toLocaleString("en-IN")} ({pos ? "+" : ""}{h.pnl_pct?.toFixed(2)}%)
                    </div>
                  </div>
                </div>
                <PnlBar pct={h.pnl_pct || 0} />
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                  {[
                    { label: "Weight", val: `${h.weight_pct}%` },
                    { label: "RSI", val: h.rsi?.toFixed(1) },
                    { label: "Beta", val: h.beta },
                    { label: "Sharpe", val: h.sharpe },
                    { label: "Stop Loss", val: h.suggested_sl ? `₹${h.suggested_sl}` : null },
                  ].filter(x => x.val != null).map(x => (
                    <div key={x.label} style={{ padding: "4px 8px", background: "#0a1220",
                      border: "1px solid #0f1e33", borderRadius: 6 }}>
                      <span style={{ fontSize: 9, color: "#334155", fontFamily: "JetBrains Mono, monospace",
                        textTransform: "uppercase" }}>{x.label} </span>
                      <span style={{ fontSize: 11, color: "#94a3b8", fontFamily: "JetBrains Mono, monospace" }}>{x.val}</span>
                    </div>
                  ))}
                  <div style={{ padding: "4px 10px", background: sigColor + "15",
                    border: `1px solid ${sigColor}30`, borderRadius: 6 }}>
                    <span style={{ fontSize: 11, color: sigColor, fontFamily: "JetBrains Mono, monospace",
                      textTransform: "uppercase" }}>{h.signal}</span>
                  </div>
                </div>
                {h.signal_reason && (
                  <div style={{ marginTop: 6, fontSize: 11, color: "#475569",
                    fontFamily: "JetBrains Mono, monospace" }}>↳ {h.signal_reason}</div>
                )}
              </div>
            );
          })}
        </div>
      )}
      <style>{`
        @keyframes fadeUp { from { opacity:0;transform:translateY(12px); } to { opacity:1;transform:translateY(0); } }
      `}</style>
    </div>
  );
}
