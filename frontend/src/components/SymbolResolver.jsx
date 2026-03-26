import { useState } from "react";

const BACKEND = import.meta.env.VITE_API_URL || "http://localhost:8000";

// Common name → NSE symbol mapping
// User types anything close to these names and we match it
const NAME_MAP = {
  // Reliance
  "reliance": "RELIANCE", "reliance industries": "RELIANCE", "ril": "RELIANCE",
  // TCS
  "tcs": "TCS", "tata consultancy": "TCS", "tata consultancy services": "TCS",
  // HDFC
  "hdfc bank": "HDFCBANK", "hdfcbank": "HDFCBANK", "hdfc": "HDFCBANK",
  "hdfc life": "HDFCLIFE", "hdfc amc": "HDFC",
  // Infosys
  "infosys": "INFY", "infy": "INFY", "infosys limited": "INFY",
  // ICICI
  "icici bank": "ICICIBANK", "icici": "ICICIBANK",
  "icici prudential": "ICICIPRULI", "icici lombard": "ICICIGI",
  // SBI
  "sbi": "SBIN", "state bank": "SBIN", "state bank of india": "SBIN",
  // Bajaj
  "bajaj finance": "BAJFINANCE", "bajaj finserv": "BAJAJFINSV",
  "bajaj auto": "BAJAJ-AUTO",
  // Wipro
  "wipro": "WIPRO",
  // HCL
  "hcl": "HCLTECH", "hcl tech": "HCLTECH", "hcl technologies": "HCLTECH",
  // Axis
  "axis bank": "AXISBANK", "axis": "AXISBANK",
  // Kotak
  "kotak": "KOTAKBANK", "kotak mahindra": "KOTAKBANK", "kotak bank": "KOTAKBANK",
  // Tata
  "tata motors": "TATAMOTORS", "tatamotors": "TATAMOTORS",
  "tata steel": "TATASTEEL", "tata power": "TATAPOWER",
  "tata consumer": "TATACONSUM", "tata comm": "TATACOMM",
  // Adani
  "adani": "ADANIENT", "adani enterprises": "ADANIENT",
  "adani ports": "ADANIPORTS", "adani green": "ADANIGREEN",
  "adani total gas": "ATGL", "adani wilmar": "AWL",
  // Maruti
  "maruti": "MARUTI", "maruti suzuki": "MARUTI",
  // Asian Paints
  "asian paints": "ASIANPAINT", "asian paint": "ASIANPAINT",
  // ITC
  "itc": "ITC", "itc limited": "ITC",
  // Sun Pharma
  "sun pharma": "SUNPHARMA", "sunpharma": "SUNPHARMA",
  "sun pharmaceutical": "SUNPHARMA",
  // Dr Reddy
  "dr reddy": "DRREDDY", "drreddys": "DRREDDY",
  "dr reddy laboratories": "DRREDDY",
  // Cipla
  "cipla": "CIPLA",
  // Titan
  "titan": "TITAN", "titan company": "TITAN",
  // Nestle
  "nestle": "NESTLEIND", "nestle india": "NESTLEIND",
  // Hindustan Unilever
  "hul": "HINDUNILVR", "hindustan unilever": "HINDUNILVR",
  "unilever": "HINDUNILVR",
  // Larsen
  "larsen": "LT", "l&t": "LT", "larsen toubro": "LT",
  "larsen and toubro": "LT",
  // ONGC
  "ongc": "ONGC", "oil and natural gas": "ONGC",
  // NTPC
  "ntpc": "NTPC", "ntpc limited": "NTPC",
  // Power Grid
  "power grid": "POWERGRID", "powergrid": "POWERGRID",
  // Coal India
  "coal india": "COALINDIA",
  // JSW Steel
  "jsw steel": "JSWSTEEL", "jsw": "JSWSTEEL",
  // Hindalco
  "hindalco": "HINDALCO", "hindalco industries": "HINDALCO",
  // Tech Mahindra
  "tech mahindra": "TECHM", "techmahindra": "TECHM",
  // Ultratech
  "ultratech": "ULTRACEMCO", "ultratech cement": "ULTRACEMCO",
  // Grasim
  "grasim": "GRASIM", "grasim industries": "GRASIM",
  // M&M
  "mahindra": "M&M", "m&m": "M&M", "mahindra and mahindra": "M&M",
  // Hero
  "hero": "HEROMOTOCO", "hero motocorp": "HEROMOTOCO",
  "hero honda": "HEROMOTOCO",
  // Eicher
  "eicher": "EICHERMOT", "royal enfield": "EICHERMOT",
  "eicher motors": "EICHERMOT",
  // IndusInd
  "indusind": "INDUSINDBK", "indusind bank": "INDUSINDBK",
  // Britannia
  "britannia": "BRITANNIA",
  // Apollo Hospitals
  "apollo": "APOLLOHOSP", "apollo hospitals": "APOLLOHOSP",
  // BPCL
  "bpcl": "BPCL", "bharat petroleum": "BPCL",
  // Divis Lab
  "divis": "DIVISLAB", "divis lab": "DIVISLAB",
  // DLF
  "dlf": "DLF",
  // Zomato
  "zomato": "ZOMATO",
  // Nykaa
  "nykaa": "NYKAA", "fss": "NYKAA",
  // Paytm
  "paytm": "PAYTM", "one97": "PAYTM",
  // Wipro
  "wipro": "WIPRO",
  // LTIMindtree
  "ltimindtree": "LTIM", "lti": "LTIM",
  // Indices
  "nifty": "^NSEI", "nifty 50": "^NSEI", "nifty50": "^NSEI",
  "sensex": "^BSESN", "bse sensex": "^BSESN",
  "bank nifty": "^NSEBANK", "banknifty": "^NSEBANK",
};

export function resolveSymbol(input) {
  if (!input) return null;
  const clean = input.trim().toLowerCase();
  // Direct map check
  if (NAME_MAP[clean]) return NAME_MAP[clean];
  // Partial match — find best match
  const keys = Object.keys(NAME_MAP);
  const partial = keys.find(k => clean.includes(k) || k.includes(clean));
  if (partial) return NAME_MAP[partial];
  // Return uppercased input as fallback (assume it's already a symbol)
  return input.trim().toUpperCase();
}

// Smart search input component — reusable across all pages
export function SmartSymbolInput({ value, onChange, onSearch, placeholder, accentColor = "#7c3aed", loading = false }) {
  const [suggestions, setSuggestions] = useState([]);
  const [showSug, setShowSug] = useState(false);

  function handleChange(e) {
    const v = e.target.value;
    onChange(v);
    if (v.length >= 2) {
      const q = v.toLowerCase();
      const matches = Object.entries(NAME_MAP)
        .filter(([name]) => name.includes(q))
        .slice(0, 6)
        .map(([name, sym]) => ({ name, sym }));
      setSuggestions(matches);
      setShowSug(matches.length > 0);
    } else {
      setShowSug(false);
    }
  }

  function select(sym, name) {
    onChange(sym);
    setShowSug(false);
    onSearch && onSearch(sym);
  }

  function handleKey(e) {
    if (e.key === "Enter") {
      setShowSug(false);
      const resolved = resolveSymbol(value);
      onSearch && onSearch(resolved);
    }
    if (e.key === "Escape") setShowSug(false);
  }

  return (
    <div style={{ position: "relative", flex: 1 }}>
      <input
        className="input"
        value={value}
        onChange={handleChange}
        onKeyDown={handleKey}
        onBlur={() => setTimeout(() => setShowSug(false), 150)}
        placeholder={placeholder || "Stock name or symbol… 'Reliance', 'INFY', 'Tata Motors'"}
        style={{ width: "100%", fontFamily: "JetBrains Mono, monospace" }}
      />
      {showSug && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0,
          background: "#0a1220", border: `1px solid ${accentColor}40`,
          borderRadius: 10, zIndex: 100, overflow: "hidden",
          boxShadow: `0 8px 32px ${accentColor}20`,
        }}>
          {suggestions.map((s, i) => (
            <div key={i} onMouseDown={() => select(s.sym, s.name)} style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "10px 14px", cursor: "pointer",
              borderBottom: i < suggestions.length - 1 ? "1px solid #0f1e33" : "none",
              transition: "background 0.1s",
            }}
              onMouseEnter={e => e.currentTarget.style.background = "#111c2e"}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}
            >
              <div>
                <div style={{ fontSize: 13, color: "#e2e8f0", fontFamily: "Inter, sans-serif",
                  textTransform: "capitalize" }}>{s.name}</div>
              </div>
              <div style={{ fontSize: 12, color: accentColor, fontFamily: "JetBrains Mono, monospace",
                fontWeight: 600, background: accentColor + "15",
                padding: "2px 8px", borderRadius: 4 }}>{s.sym}</div>
            </div>
          ))}
          <div style={{ padding: "8px 14px", fontSize: 10, color: "#334155",
            fontFamily: "JetBrains Mono, monospace", borderTop: "1px solid #0f1e33" }}>
            Press Enter to search · NSE symbols
          </div>
        </div>
      )}
    </div>
  );
}

export default SmartSymbolInput;
