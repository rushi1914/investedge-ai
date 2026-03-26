import { useState, Component } from "react";
import Sidebar from "./components/Sidebar.jsx";
import LandingPage from "./components/LandingPage.jsx";
import ChatUI from "./components/ChatUI.jsx";
import OpportunityRadar from "./components/OpportunityRadar.jsx";
import ChartIntelligence from "./components/ChartIntelligence.jsx";
import Portfolio from "./components/Portfolio.jsx";
import NewsRAG from "./components/NewsRAG.jsx";
import VideoEngine from "./components/VideoEngine.jsx";

class ErrorBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error("[ErrorBoundary]", error, info); }
  render() {
    if (this.state.error) {
      return (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          height: "100%", flexDirection: "column", gap: 12,
          background: "#060b14", color: "#ff4466",
          fontFamily: "JetBrains Mono, monospace", padding: 32,
        }}>
          <div style={{ fontSize: 32 }}>⚠️</div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Something went wrong</div>
          <div style={{ fontSize: 11, color: "#475569", maxWidth: 480, textAlign: "center", lineHeight: 1.6 }}>
            {this.state.error.message}
          </div>
          <button
            onClick={() => this.setState({ error: null })}
            style={{
              marginTop: 8, padding: "8px 20px", borderRadius: 8, border: "1px solid #ff446640",
              background: "#1f0010", color: "#ff7a9a", cursor: "pointer", fontSize: 12,
              fontFamily: "JetBrains Mono, monospace",
            }}
          >Try again</button>
        </div>
      );
    }
    return this.props.children;
  }
}

const VIEWS = {
  home:      LandingPage,
  chat:      ChatUI,
  radar:     OpportunityRadar,
  chart:     ChartIntelligence,
  portfolio: Portfolio,
  news:      NewsRAG,
  video:     VideoEngine,
};

export default function App() {
  const [view, setView] = useState("home");
  const View = VIEWS[view] || LandingPage;

  return (
    <div className="app-shell">
      <Sidebar active={view} onNav={setView} />
      <main className="main-content">
        <ErrorBoundary key={view}>
          <View onNav={setView} />
        </ErrorBoundary>
      </main>
    </div>
  );
}
