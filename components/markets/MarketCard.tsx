"use client";

import { Bookmark, ExternalLink } from "lucide-react";
import { motion } from "motion/react";
import Image from "next/image";
import type { Market } from "@/lib/panta/types";
import { MiniChart } from "@/components/charts/MiniChart";
import { MarketIdControl } from "@/components/markets/MarketIdControl";
import { isSecondaryMarketCandidate, isSecondaryTradeEligibleMarket, isTradeEligibleMarket } from "@/lib/panta/trade-safety";

function currency(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "Unavailable";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: value >= 1_000 ? "compact" : "standard", maximumFractionDigits: value >= 1_000 ? 2 : 0 }).format(value);
}

function liquidityLabel(value: number | null, source: Market["source"]): string {
  if (value !== null && Number.isFinite(value)) return currency(value);
  return source === "panta" ? "Not provided" : "Unavailable";
}

function probability(value: number | null): string {
  return value === null ? "Unavailable" : `${(value * 100).toFixed(0)}%`;
}

function closeLabel(value: string | null): string {
  if (!value || Number.isNaN(Date.parse(value))) return "Unavailable";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

export function MarketCard({ market, onSelect, onTrade, isWatched, onWatch, index = 0, pantaEnvironment = "unknown" }: {
  market: Market;
  onSelect: (market: Market) => void;
  onTrade: (market: Market, outcome: "YES" | "NO") => void;
  isWatched: boolean;
  onWatch: (market: Market) => void;
  index?: number;
  pantaEnvironment?: "test" | "live" | "unknown";
}) {
  const titleUnavailable = !market.question.trim() || market.question === "Market title unavailable";
  const tradeAllowed = isTradeEligibleMarket(market) || isSecondaryTradeEligibleMarket(market) || isSecondaryMarketCandidate(market);
  const phaseLabel = market.phase?.trim() ? market.phase.replace(/[_-]+/g, " ").toUpperCase() : "PHASE UNAVAILABLE";
  const completeness = market.yesProbability !== null && market.noProbability !== null && market.volumeUsd !== null && market.closeAt !== null && market.status !== "unknown";
  const pantaLabel = pantaEnvironment === "test" ? "PANTA TEST" : "PANTA · UNKNOWN";
  return (
    <motion.article className={`market-card${titleUnavailable ? " market-card--incomplete" : ""}`} data-market-complete={!titleUnavailable} initial={{ opacity: 0, y: 9 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .28, delay: Math.min(index * .045, .24) }}>
      <div className="market-card__eyebrow"><span className="market-category"><span className={`market-category__dot category-${(market.category ?? "other").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`} />{market.category ?? "Market"}</span><span className="market-phase-badge">{phaseLabel}</span>{market.source === "demo" ? <span className="market-source market-source--demo">DEMO</span> : pantaEnvironment === "live" ? null : <span className="market-source market-source--panta">{pantaLabel} · {completeness ? "COMPLETE" : "PARTIAL"}</span>}<span className={`market-status market-status--${market.status}`}>{market.status === "unknown" ? "STATUS N/A" : market.status.toUpperCase()}</span></div>
      <button className="market-card__image" onClick={() => onSelect(market)} aria-label={titleUnavailable ? "Open incomplete Panta listing" : `Open ${market.question}`}>
        {market.imageUrl ? <><Image src={market.imageUrl} alt="" fill sizes="(max-width: 700px) 100vw, 360px" unoptimized onError={(event) => { event.currentTarget.hidden = true; const fallback = event.currentTarget.nextElementSibling; if (fallback instanceof HTMLElement) fallback.hidden = false; }} /><span className="market-card__image-empty" hidden>{market.category ?? "Market"}<small>Image unavailable from Panta</small></span></> : <span className="market-card__image-empty">{market.category ?? "Market"}<small>Image unavailable from Panta</small></span>}
      </button>
      {titleUnavailable ? <div className="market-card__title market-card__title--unavailable"><span>Market title unavailable</span><small>Panta returned no title</small><MarketIdControl marketId={market.id} /></div> : <button className="market-card__title" onClick={() => onSelect(market)}>{market.question}<ExternalLink size={13} aria-hidden="true" /></button>}
      <div className="market-card__pricing">
        <div className="market-card__outcomes">
          <div className="market-card__outcome-buttons">
            <button type="button" className="price-pill price-pill--yes" onClick={() => onTrade(market, "YES")} disabled={!tradeAllowed} aria-label={`Continue with YES on ${market.question}, ${probability(market.yesProbability)}`}><span>YES</span><b>{probability(market.yesProbability)}</b></button>
            <button type="button" className="price-pill price-pill--no" onClick={() => onTrade(market, "NO")} disabled={!tradeAllowed} aria-label={`Continue with NO on ${market.question}, ${probability(market.noProbability)}`}><span>NO</span><b>{probability(market.noProbability)}</b></button>
          </div>
          <div className="outcome-split" role="img" aria-label={`YES ${probability(market.yesProbability)}, NO ${probability(market.noProbability)}`}>
            <i className="outcome-split__yes" style={{ width: `${(market.yesProbability ?? 0) * 100}%` }} />
            <i className="outcome-split__no" style={{ width: `${(market.noProbability ?? 0) * 100}%` }} />
          </div>
        </div>
        <button className={`watch-button ${isWatched ? "watch-button--active" : ""}`} onClick={() => onWatch(market)} aria-label={isWatched ? "Remove from watchlist" : "Add to watchlist"}><Bookmark size={15} fill={isWatched ? "currentColor" : "none"} /></button>
      </div>
      <MiniChart points={market.history} label={market.question} className="market-card__chart" />
      <div className="market-card__metrics">
        <div><span>VOLUME</span><b>{currency(market.volumeUsd)}</b></div>
        <div><span>LIQUIDITY</span><b title={market.liquidityUsd === null && market.source === "panta" ? "Panta does not include liquidity in its market catalog or market detail response." : undefined}>{liquidityLabel(market.liquidityUsd, market.source)}</b></div>
        <div><span>HISTORY</span><b>{market.history.length ? `${market.history.length} provider points` : market.source === "panta" ? "Provider history unavailable" : "Unavailable"}</b></div>
        <div><span>CLOSES</span><b className="metric-close">{closeLabel(market.closeAt)}</b></div>
      </div>
      <div className="market-card__footer"><span>{market.source === "panta" ? "Panta market data" : "Demo fixture"} · Updated {market.updatedAt ? new Date(market.updatedAt).toLocaleString() : "time unavailable"}</span><MarketIdControl marketId={market.id} /><button onClick={() => onSelect(market)}>Details <span>→</span></button></div>
    </motion.article>
  );
}
