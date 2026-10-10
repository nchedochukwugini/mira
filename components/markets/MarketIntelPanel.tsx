"use client";

import { Activity, Clock3, Database, ExternalLink, Info, MessageCircle, ShieldCheck, WalletCards } from "lucide-react";
import Image from "next/image";
import type { Market, RelatedMarket } from "@/lib/panta/types";
import { MiniChart } from "@/components/charts/MiniChart";
import { PantaOrderBookPanel } from "@/components/markets/PantaOrderBookPanel";
import { MarketReasoningPanel } from "@/components/markets/MarketReasoningPanel";
import { RelatedMarketGraph } from "@/components/markets/RelatedMarketGraph";
import { CrossMarketPanel } from "@/components/markets/CrossMarketPanel";
import { calculateMovement, dataStatusForMarket } from "@/lib/intelligence/core";

const money = (value: number | null) => value === null || !Number.isFinite(value) ? "Data unavailable" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: value >= 1_000 ? "compact" : "standard", maximumFractionDigits: value >= 1_000 ? 2 : 0 }).format(value);
const liquidityLabel = (market: Market) => market.liquidityUsd !== null ? money(market.liquidityUsd) : market.source === "panta" ? "Not provided by Panta" : "Data unavailable";
const pct = (value: number | null) => value === null ? "Data unavailable" : `${(value * 100).toFixed(1)}%`;

export function MarketIntelPanel({ market, markets, onSelect, onTrade, onAskMira, isDemo, pantaEnvironment = "unknown", relationships = [], allowTrading = true, detailLoading = false, detailWarning = "" }: {
  market: Market | null;
  markets: Market[];
  onSelect: (market: Market) => void;
  onTrade: (market: Market, side: "YES" | "NO") => void;
  onAskMira?: (market: Market) => void;
  isDemo: boolean;
  pantaEnvironment?: "test" | "live" | "unknown";
  relationships?: RelatedMarket[];
  allowTrading?: boolean;
  detailLoading?: boolean;
  detailWarning?: string;
}) {
  if (!market) return <aside className="intel-panel intel-panel--empty"><div className="intel-empty-art"><div className="intel-sun" /><div className="intel-hill intel-hill--one" /><div className="intel-hill intel-hill--two" /><span>⌁</span></div><div className="intel-empty-copy"><span className="panel-kicker">MARKET INTELLIGENCE</span><h2>Your market lens</h2><p>Run an analysis or select a market to inspect current prices, activity and provider-linked context.</p></div><div className="intel-empty-foot"><ShieldCheck size={15} /> Market data stays source-labelled</div></aside>;
  const complete = market.yesProbability !== null && market.noProbability !== null && market.volumeUsd !== null && market.closeAt !== null && market.status !== "unknown";
  const dataStatus = dataStatusForMarket(market);
  const sourceLabel = isDemo ? "DEMO DATA" : pantaEnvironment === "test" ? "PANTA TEST" : pantaEnvironment === "live" ? null : "PANTA · ENVIRONMENT UNKNOWN";
  const dailyMovement = calculateMovement(market, "24h");
  const historyTimestamps = market.history.map((point) => Date.parse(point.timestamp)).filter(Number.isFinite).sort((left, right) => left - right);
  const latestHistoryLabel = historyTimestamps.length ? new Date(historyTimestamps.at(-1)!).toLocaleString() : "Timestamp unavailable";
  const validHistoryCount = market.history.filter((point) => point.yesProbability !== null && Number.isFinite(point.yesProbability) && Number.isFinite(Date.parse(point.timestamp))).length;
  const phaseLabel = market.phase?.trim() ? market.phase.replace(/[_-]+/g, " ").toUpperCase() : "PHASE UNAVAILABLE";
  return (
    <aside className="intel-panel">
      <div className="intel-panel__header"><span className="panel-kicker">MARKET INTELLIGENCE</span>{sourceLabel && <span className={`source-stamp ${isDemo ? "source-stamp--demo" : "source-stamp--live"}`}>{sourceLabel}</span>}</div>
      <div className="intel-market-title"><span>{market.category ?? "Market"} · {phaseLabel}</span><h2>{market.question}</h2></div>
      <div className="intel-market-image">{market.imageUrl ? <Image src={market.imageUrl} alt={`Image for ${market.question}`} fill sizes="(max-width: 700px) 100vw, 420px" unoptimized onError={(event) => { event.currentTarget.hidden = true; const fallback = event.currentTarget.nextElementSibling; if (fallback instanceof HTMLElement) fallback.hidden = false; }} /> : null}<span hidden={Boolean(market.imageUrl)}>Image unavailable from Panta</span></div>
      {detailLoading && <div className="intel-detail-note" role="status">MIRA is gathering this market’s detail fields…</div>}
      {detailWarning && <div className="intel-detail-note intel-detail-note--warning" role="status">{detailWarning} Catalog values remain shown where available.</div>}
      <div className="probability-card">
        <div className="probability-card__top"><span>IMPLIED PROBABILITY</span><span><Activity size={13} /> {market.status.toUpperCase()}</span></div>
        <div className="probability-main"><strong className={market.yesProbability === null ? "probability-main__unavailable" : undefined}>{pct(market.yesProbability)}</strong><span>YES</span></div>
        <div className="probability-track" role="img" aria-label={`YES ${pct(market.yesProbability)}, NO ${pct(market.noProbability)}`}>
          <i className="probability-track__yes" style={{ width: market.yesProbability === null ? "0%" : `${market.yesProbability * 100}%` }} />
          <i className="probability-track__no" style={{ width: market.noProbability === null ? "0%" : `${market.noProbability * 100}%` }} />
        </div>
        <div className="probability-foot"><span>YES</span><b>{pct(market.yesProbability)}</b><span>NO</span><b>{pct(market.noProbability)}</b></div>
      </div>
      <div className="intel-metrics">
        <div><span>VOLUME</span><b>{money(market.volumeUsd)}</b></div>
        <div><span>LIQUIDITY</span><b title={market.source === "panta" && market.liquidityUsd === null ? "Panta does not include liquidity in its market catalog or market detail response." : undefined}>{liquidityLabel(market)}</b></div>
        <div><span>HISTORY</span><b>{market.history.length ? `${market.history.length} Panta observations` : "Not enough data to measure movement"}</b></div>
        <div><span>RESOLUTION</span><b>{market.closeAt && !Number.isNaN(Date.parse(market.closeAt)) ? new Date(market.closeAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : market.closeAt ?? "Not provided"}</b></div>
      </div>
      <PantaOrderBookPanel market={market} />
      <MarketReasoningPanel market={market} />
      <section className="intelligence-section intel-chart-section"><div className="panel-heading"><div><span className="panel-kicker">PRICE HISTORY</span><h3>YES price</h3></div><span className="chart-period">PROVIDER SERIES</span></div><MiniChart points={market.history} label={market.question} className="intel-chart" /><div className="chart-boundaries"><span>{validHistoryCount ? `${validHistoryCount} provider observations` : "History unavailable"}</span><span>Latest · {latestHistoryLabel}</span></div></section>
      <section className="intel-evidence-status"><span>DATA / SOURCE</span><b>{isDemo ? "Demo fixture" : sourceLabel}</b><span>Data completeness: {isDemo ? "Demo" : complete && dataStatus === "live" ? "Complete" : "Partial"}</span><span>Provider update: {market.updatedAt ? new Date(market.updatedAt).toLocaleString() : "Unavailable"}</span><span>Resolution: {market.closeAt ? new Date(market.closeAt).toLocaleString() : "Unavailable"}</span></section>
      <section className="intel-evidence-status"><span>MIRA’S ANALYSIS</span><b>{dailyMovement ? `YES moved ${(dailyMovement.absoluteChange * 100).toFixed(2)} percentage points in the last 24 hours of available history.` : "There isn’t enough timestamped Panta price history to measure short-term movement."}</b><span>Market prices are provider observations and do not establish the outcome.</span></section>
      <RelatedMarketGraph focus={market} markets={markets} onSelect={onSelect} isDemo={isDemo} relationships={relationships} />
      {!isDemo && <CrossMarketPanel focus={market} markets={markets} relationships={relationships} />}
      <div className="intel-disclaimer"><Info size={14} /><span>Probabilities reflect market prices, not MIRA forecasts. Data may lag the venue.</span></div>
      <div className="intel-panel__actions">{onAskMira && <button className="intel-ask-button" onClick={() => onAskMira(market)}><MessageCircle size={15} /> Ask MIRA about this market</button>}{allowTrading && <button className="intel-trade-button" onClick={() => onTrade(market, "YES")} disabled={market.yesProbability === null}><WalletCards size={15} /> Prepare a trade</button>}<a href={`https://docs.panta.market/`} target="_blank" rel="noreferrer">Source details <ExternalLink size={12} /></a></div>
      <div className="intel-updated"><Database size={12} /> Data completeness: {isDemo ? "Demo" : complete && dataStatus === "live" ? "Complete" : "Partial"}<span><Clock3 size={12} /> {market.source === "demo" ? "Demo fixture" : "Panta API"}</span></div>
    </aside>
  );
}
