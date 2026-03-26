import { useState, useEffect } from "react";

const BACKEND = import.meta.env.VITE_API_URL || "http://localhost:8000";

const POPULAR = [
  "Nifty50 outlook", "HDFC earnings", "Reliance AGM",
  "IT sector results", "RBI rate decision", "FII inflows",
  "bulk deal today", "Bajaj Finance NPA",
];

function NewsCard({ article, idx }) {
  return (
    <a href={article.link || "#"} target="_blank" rel="noreferrer" style={{
      display: "block", padding: "14px 16px", background: "#080e1a",
      border: "1px solid #0f1e33", borderRadius: 12, marginBottom: 8,
      textDecoration: "none", transition: "all 0.15s",
      animation: `fadeUp 0.3s ${idx * 0.04}s both`,
    }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = "#1e3a66"; e.currentTarget.style.background = "#0a1220"; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = "#0f1e33"; e.currentTarget.style.background = "#080e1a"; }}
    >
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
        <div style={{ width: 32, height: 32, borderRadius: 8, flexShrink: 0,
          background: "linear-gradient(135deg,#071830,#0ea5e920)",
          border: "1px solid #0ea5e930",
          display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>🗞️</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, color: "#cbd5e1", lineHeight: 1.5, marginBottom: 4,
            fontFamily: "Inter, sans-serif", fontWeight: 500 }}>{article.title}</div>
          {article.description && (
            <div style={{ fontSize: 12, color: "#475569", lineHeight: 1.5, marginBottom: 6,
              fontFamily: "Inter, sans-serif",
              overflow: "hidden", display: "-webkit-box",
              WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
              {article.description}
            </div>
          )}
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {article.symbol && article.symbol !== "NEWS" && (
              <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 4,
                background: "#071830", border: "1px solid #0ea5e930",
                color: "#0ea5e9", fontFamily: "JetBrains Mono, monospace" }}>{article.symbol}</span>
            )}
            {article.publisher && (
              <span style={{ fontSize: 10.5, color: "#334155", fontFamily: "JetBrains Mono, monospace" }}>
                {article.publisher}
              </span>
            )}
            {article.time && (
              <span style={{ fontSize: 10.5, color: "#1e3a5f", fontFamily: "JetBrains Mono, monospace" }}>
                {article.time}
              </span>
            )}
          </div>
        </div>
        <div style={{ color: "#1e3a5f", fontSize: 12, flexShrink: 0 }}>→</div>
      </div>
    </a>
  );
}

export default function NewsRAG() {
  const [query, setQuery]     = useState("");
  const [symbol, setSymbol]   = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError]     = useState(null);
  const [autoLoaded, setAutoLoaded] = useState(false);

  // Auto-load trending news when page opens
  useEffect(() => {
    if (!autoLoaded) {
      setAutoLoaded(true);
      loadTrending();
    }
  }, []);

  async function loadTrending() {
    setLoading(true); setError(null);
    try {
      // Fetch latest market news automatically
      const res = await fetch(`${BACKEND}/api/news?q=NSE+BSE+India+stock+market+today`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setResults({ ...data, isTrending: true });
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function search() {
    if (!query.trim() && !symbol.trim()) {
      loadTrending();
      return;
    }
    setLoading(true); setError(null); setResults(null);
    try {
      const params = new URLSearchParams();
      if (query.trim())  params.append("q", query.trim());
      if (symbol.trim()) params.append("symbol", symbol.trim().toUpperCase());
      const res = await fetch(`${BACKEND}/api/news?${params}`);
      if (!res.ok) throw new Error((await res.json()).detail || `HTTP ${res.status}`);
      setResults({ ...(await res.json()), isTrending: false });
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ height: "100%", overflowY: "auto", padding: "28px 32px" }}>
      {/* Header */}
      <div className="section-header">
        <div className="section-icon" style={{ background: "#071830", border: "1px solid #0ea5e930" }}>🗞️</div>
        <div>
          <div className="section-title">News RAG</div>
          <div className="section-sub">Vector Search — NewsAPI + FAISS Embeddings</div>
        </div>
      </div>

      {/* Description */}
      <div style={{ padding: "14px 16px", background: "#080e1a", border: "1px solid #0f1e33",
        borderRadius: 10, marginBottom: 20, fontSize: 13, color: "#64748b", lineHeight: 1.6 }}>
        Real-time news from <strong style={{ color: "#94a3b8" }}>ET Markets, Reuters, Moneycontrol, Business Standard</strong> via
        NewsAPI. Semantic search powered by <strong style={{ color: "#94a3b8" }}>FAISS vector embeddings</strong>.
        <span style={{ color: "#0ea5e9" }}> Auto-refreshes every page load.</span>
      </div>

      {/* Search inputs */}
      <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
        <input className="input" value={query} onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === "Enter" && search()}
          placeholder="Search news… 'Reliance earnings', 'RBI rate cut', 'bulk deal'"
          style={{ flex: 2 }} />
        <input className="input" value={symbol} onChange={e => setSymbol(e.target.value.toUpperCase())}
          onKeyDown={e => e.key === "Enter" && search()}
          placeholder="Symbol filter" style={{ flex: 0.7, fontFamily: "JetBrains Mono, monospace" }} />
        <button className="btn btn-primary" onClick={search}
          disabled={loading}
          style={{ background: "linear-gradient(135deg,#075985,#0ea5e9)", minWidth: 100 }}>
          {loading ? "…" : "🔍 Search"}
        </button>
        <button onClick={loadTrending} disabled={loading} style={{
          padding: "10px 14px", borderRadius: 10, border: "1px solid #0f1e33",
          background: "#080e1a", color: "#475569", fontSize: 12, cursor: "pointer",
          fontFamily: "Inter, sans-serif", whiteSpace: "nowrap",
        }}>↻ Refresh</button>
      </div>

      {/* Popular chips */}
      <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 20 }}>
        <span style={{ fontSize: 10.5, color: "#1e3a5f", fontFamily: "JetBrains Mono, monospace",
          alignSelf: "center" }}>Trending:</span>
        {POPULAR.map(p => (
          <button key={p} onClick={() => { setQuery(p); setTimeout(search, 50); }} style={{
            padding: "4px 10px", borderRadius: 6, border: "1px solid #0f1e33",
            background: "#080e1a", color: "#334155", fontSize: 11, cursor: "pointer",
            fontFamily: "Inter, sans-serif", transition: "all 0.15s",
          }}
            onMouseEnter={e => { e.target.style.borderColor="#0ea5e9"; e.target.style.color="#0ea5e9"; }}
            onMouseLeave={e => { e.target.style.borderColor="#0f1e33"; e.target.style.color="#334155"; }}
          >{p}</button>
        ))}
      </div>

      {/* Loading */}
      {loading && (
        <div style={{ textAlign: "center", padding: 40 }}>
          <div style={{ width: 36, height: 36, border: "3px solid #0f1e33",
            borderTopColor: "#0ea5e9", borderRadius: "50%",
            animation: "spin 0.8s linear infinite", margin: "0 auto 16px" }} />
          <div style={{ color: "#475569", fontFamily: "JetBrains Mono, monospace", fontSize: 13 }}>
            {autoLoaded && !results ? "Loading trending market news…" : "Searching news index…"}
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{ padding: "14px 18px", background: "#1f0010", border: "1px solid #ff446640",
          borderRadius: 10, color: "#ff7a9a", fontSize: 13, fontFamily: "JetBrains Mono, monospace" }}>
          ⚠️ {error} — Backend must be running
        </div>
      )}

      {/* Results */}
      {results && !loading && (
        <div style={{ animation: "fadeUp 0.4s ease" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
            <div style={{ fontSize: 11, color: "#334155", fontFamily: "JetBrains Mono, monospace",
              letterSpacing: "0.08em", textTransform: "uppercase" }}>
              {results.isTrending
                ? `📡 ${results.total} trending articles — auto-loaded`
                : `${results.total} results${results.query ? ` for "${results.query}"` : ""}`}
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {results.rag_active && (
                <span style={{ fontSize: 9.5, padding: "3px 9px", borderRadius: 4,
                  background: "#001f12", border: "1px solid #00d4a030",
                  color: "#00d4a0", fontFamily: "JetBrains Mono, monospace" }}>
                  ✅ Vector RAG Active
                </span>
              )}
              <span style={{ fontSize: 9.5, padding: "3px 9px", borderRadius: 4,
                background: "#071830", border: "1px solid #0ea5e920",
                color: "#0ea5e9", fontFamily: "JetBrains Mono, monospace" }}>
                {results.source || "NewsAPI + FAISS"}
              </span>
            </div>
          </div>

          {results.articles?.length === 0 ? (
            <div style={{ textAlign: "center", padding: "40px 20px" }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>📭</div>
              <div style={{ color: "#334155", fontFamily: "JetBrains Mono, monospace", fontSize: 13 }}>
                No articles found. Try a different keyword.
              </div>
            </div>
          ) : (
            results.articles.map((a, i) => <NewsCard key={i} article={a} idx={i} />)
          )}
        </div>
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeUp { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }
      `}</style>
    </div>
  );
}
