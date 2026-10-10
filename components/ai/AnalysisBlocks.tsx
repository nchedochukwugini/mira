"use client";

import { AlertCircle, ArrowRight, BarChart3, Check, Compass, Sparkles } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import type { AnalysisResult, Insight } from "@/lib/panta/types";
import { MarketCard } from "@/components/markets/MarketCard";
import { MiraCharacter } from "@/components/mira/MiraCharacter";
import type { MiraState } from "@/components/mira/miraStates";
import type { Market } from "@/lib/panta/types";
import { formatProviderPrice, formatQuoteAmount } from "@/lib/panta/market-display";

export function ThinkingIndicator({ step }: { step: string }) {
  return <motion.div className="thinking-card" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}><span className="thinking-orbit"><i /><i /><i /></span><div><b>{step}</b><p>Reading provider data. No action is taken on your wallet.</p></div><span className="thinking-live"><i /> WORKING</span></motion.div>;
}

export function AnalysisMessage({ result, state, watched, onSelect, onTrade, onWatch }: {
  result: AnalysisResult;
  state: MiraState;
  watched: Set<string>;
  onSelect: (market: Market) => void;
  onTrade: (market: Market, side: "YES" | "NO") => void;
  onWatch: (market: Market) => void;
}) {
  const insufficient = result.confidence === "insufficient";
  const [streamedAnswer, setStreamedAnswer] = useState({ id: result.id, text: "" });
  useEffect(() => {
    let offset = 0;
    const timer = setInterval(() => {
      offset = Math.min(result.answer.length, offset + 3);
      setStreamedAnswer({ id: result.id, text: result.answer.slice(0, offset) });
      if (offset >= result.answer.length) clearInterval(timer);
    }, 13);
    return () => clearInterval(timer);
  }, [result.id, result.answer]);
  const visibleAnswer = streamedAnswer.id === result.id ? streamedAnswer.text : "";
  return <motion.div className="analysis-message" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: .4 }}>
    <div className="assistant-message"><span className="assistant-character"><MiraCharacter state={state} compact /></span><div className="assistant-message__body"><div className="assistant-label">MIRA <span>{result.source === "demo" ? "DEMO DATA · " : result.providerEnvironment === "test" ? "PANTA TEST · " : result.providerEnvironment === "live" ? "" : "PANTA · ENVIRONMENT UNKNOWN · "}DATA COMPLETENESS: {result.dataStatus === "live" ? "COMPLETE" : result.dataStatus === "partial" ? "PARTIAL" : result.dataStatus.toUpperCase()}</span></div><p>{visibleAnswer}</p></div></div>
    {insufficient && <InsufficientData />}
    {result.intent.intent === "probability_comparison" && result.markets.length > 1 && <ComparisonTable markets={result.markets} />}
    {result.insights.length > 0 && <div className="insight-list">{result.insights.map((insight, index) => <InsightCard key={`${insight.title}-${index}`} insight={insight} />)}</div>}
    {result.markets.length > 0 && <section className="analysis-results"><div className="results-heading"><div><span className="panel-kicker">MARKET DISCOVERY</span><h2>Markets in this question <span>{result.markets.length}</span></h2></div><div className="confidence-label"><Check size={13} /> {result.markets.length} provider {result.markets.length === 1 ? "match" : "matches"}</div></div><div className="results-market-list">{result.markets.map((market, index) => <MarketCard key={market.id} market={market} index={index} pantaEnvironment={result.providerEnvironment} onSelect={onSelect} onTrade={onTrade} isWatched={watched.has(market.id)} onWatch={onWatch} />)}</div></section>}
    <div className="synthesis-note"><Compass size={13} /> Deterministic data synthesis · No predictive model or financial recommendation</div>
  </motion.div>;
}

function ComparisonTable({ markets }: { markets: Market[] }) {
  const time = (value: string | null) => value ? new Date(value).toLocaleString() : "Unavailable";
  return <section className="analysis-results"><div className="results-heading"><div><span className="panel-kicker">PANTA MARKET DATA</span><h2>Market comparison</h2></div></div><div style={{ overflowX: "auto" }}><table><thead><tr>{["Market", "YES price", "NO price", "Active volume", "Quote asset", "Close time", "Status", "Available evidence"].map((label) => <th key={label}>{label}</th>)}</tr></thead><tbody>{markets.slice(0, 2).map((market) => <tr key={market.id}><th scope="row">{market.question}</th><td>{formatProviderPrice(market, "YES")}</td><td>{formatProviderPrice(market, "NO")}</td><td>{formatQuoteAmount(market.activeVolume?.amount, market.activeVolume?.asset)}</td><td>{market.quoteAsset ?? "Unavailable"}</td><td>{time(market.closeAt)}</td><td>{market.status === "unknown" ? "Unavailable" : market.status}</td><td>{[market.pantaPrices?.yes !== null && market.pantaPrices?.yes !== undefined || market.yesProbability !== null ? "provider prices" : null, market.activeVolume?.amount !== null && market.activeVolume?.amount !== undefined ? "active volume" : null, market.history.length ? "price history" : null].filter(Boolean).join(", ") || "No supporting fields returned"}</td></tr>)}</tbody></table></div><p className="panel-source-note">Provider prices include source units and may be last trades; they are not current order-book quotes. Missing fields remain unavailable.</p></section>;
}

function InsightCard({ insight }: { insight: Insight }) {
  const Icon = insight.kind === "evidence" ? BarChart3 : insight.kind === "insufficient" ? AlertCircle : insight.kind === "context" ? ArrowRight : Sparkles;
  return <article className={`insight-card insight-card--${insight.kind}`}><span><Icon size={14} /></span><div><h3>{insight.title}</h3><p>{insight.body}</p></div></article>;
}

export function InsufficientData({ message }: { message?: string }) {
  return <div className="insufficient-state"><span><AlertCircle size={18} /></span><div><b>Insufficient market data</b><p>{message ?? "Try another name, ticker or event. MIRA will not fill in missing prices, probabilities or evidence."}</p></div></div>;
}
