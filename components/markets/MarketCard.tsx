"use client";

import { Bookmark, ExternalLink } from "lucide-react";
import { motion } from "motion/react";
import Image from "next/image";
import type { Market } from "@/lib/panta/types";
import { formatProviderPrice, formatQuoteAmount, marketPoolLiquidityDisplay, marketStatusLabel } from "@/lib/panta/market-display";
import { MarketIdControl } from "@/components/markets/MarketIdControl";
import { isSecondaryMarketCandidate, isSecondaryTradeEligibleMarket, isTradeEligibleMarket } from "@/lib/panta/trade-safety";

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
  const hasVerifiedPrices = market.quoteAsset === "USDC"
    ? market.yesProbability !== null && market.noProbability !== null
    : market.pantaPrices?.quoteAsset !== null && market.pantaPrices?.quoteAsset !== undefined && market.pantaPrices.yes !== null && market.pantaPrices.no !== null;
  const completeness = hasVerifiedPrices && (market.activeVolume?.amount !== null && market.activeVolume?.amount !== undefined || market.volumeUsd !== null) && market.closeAt !== null && market.status !== "unknown";
  const pantaLabel = pantaEnvironment === "test" ? "PANTA TEST" : "PANTA · UNKNOWN";
  const activeVolume = market.activeVolume;
  const poolDisplay = marketPoolLiquidityDisplay(market);
  return (
    <motion.article className={`market-card${titleUnavailable ? " market-card--incomplete" : ""}`} data-market-complete={!titleUnavailable} initial={{ opacity: 0, y: 9 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .28, delay: Math.min(index * .045, .24) }}>
      <div className="market-card__eyebrow"><span className="market-category"><span className={`market-category__dot category-${(market.category ?? "other").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`} />{market.category ?? "Market"}</span><span className="market-phase-badge">{phaseLabel}</span>{market.source === "demo" ? <span className="market-source market-source--demo">DEMO</span> : pantaEnvironment === "live" ? null : <span className="market-source market-source--panta">{pantaLabel} · {completeness ? "COMPLETE" : "PARTIAL"}</span>}<span className={`market-status market-status--${market.status}`} title={market.status === "unknown" ? "Panta has not provided enough verified status fields to confirm whether this market is open or closed." : undefined}>{marketStatusLabel(market.status)}</span></div>
      <button className="market-card__image" onClick={() => onSelect(market)} aria-label={titleUnavailable ? "Open incomplete Panta listing" : `Open ${market.question}`}>
        {market.imageUrl ? <><Image src={market.imageUrl} alt="" fill sizes="(max-width: 700px) 100vw, 360px" unoptimized onError={(event) => { event.currentTarget.hidden = true; const fallback = event.currentTarget.nextElementSibling; if (fallback instanceof HTMLElement) fallback.hidden = false; }} /><span className="market-card__image-empty" hidden>{market.category ?? "Market"}<small>Image unavailable from Panta</small></span></> : <span className="market-card__image-empty">{market.category ?? "Market"}<small>Image unavailable from Panta</small></span>}
      </button>
      {titleUnavailable ? <div className="market-card__title market-card__title--unavailable"><span>Market title unavailable</span><small>Panta returned no title</small><MarketIdControl marketId={market.id} /></div> : <button className="market-card__title" onClick={() => onSelect(market)}>{market.question}<ExternalLink size={13} aria-hidden="true" /></button>}
      <div className="market-card__pricing">
        <div className="market-card__outcomes">
          <div className="market-card__outcome-buttons">
            <button type="button" className="price-pill price-pill--yes" onClick={() => onTrade(market, "YES")} disabled={!tradeAllowed} title={formatProviderPrice(market, "YES") === "No quote" ? "Panta did not return a verified YES reference price. MIRA does not derive one from a one-sided order book." : market.priceProvenance?.kind === "last_trade" ? "Last matched trade reported by Panta; not a current bid or ask." : "Panta-reported reference price; not a verified current bid or ask."} aria-label={`Continue with YES on ${market.question}, ${formatProviderPrice(market, "YES")}`}><span>YES</span><b>{formatProviderPrice(market, "YES")}</b></button>
            <button type="button" className="price-pill price-pill--no" onClick={() => onTrade(market, "NO")} disabled={!tradeAllowed} title={formatProviderPrice(market, "NO") === "No quote" ? "Panta did not return a verified NO reference price. MIRA does not derive one from a one-sided order book." : market.priceProvenance?.kind === "last_trade" ? "Last matched trade reported by Panta; not a current bid or ask." : "Panta-reported reference price; not a verified current bid or ask."} aria-label={`Continue with NO on ${market.question}, ${formatProviderPrice(market, "NO")}`}><span>NO</span><b>{formatProviderPrice(market, "NO")}</b></button>
          </div>
          {market.quoteAsset === "USDC" && market.yesProbability !== null && market.noProbability !== null
            ? <div className="outcome-split" role="img" aria-label={`YES ${probability(market.yesProbability)}, NO ${probability(market.noProbability)}`}><i className="outcome-split__yes" style={{ width: `${market.yesProbability * 100}%` }} /><i className="outcome-split__no" style={{ width: `${market.noProbability * 100}%` }} /></div>
            : <p className="outcome-split__unavailable">Probability view unavailable for this quote asset</p>}
        </div>
        <button className={`watch-button ${isWatched ? "watch-button--active" : ""}`} onClick={() => onWatch(market)} aria-label={isWatched ? "Remove from watchlist" : "Add to watchlist"}><Bookmark size={15} fill={isWatched ? "currentColor" : "none"} /></button>
      </div>
      <div className="market-card__metrics">
        <div><span>ACTIVE VOLUME</span><b title="Active trade volume in the verified quote asset; it is not liquidity.">{formatQuoteAmount(activeVolume?.amount, activeVolume?.asset)}</b></div>
        <div><span>TOTAL VOLUME</span><b title="Total trade volume in the verified quote asset; it is not liquidity.">{formatQuoteAmount(market.totalVolume?.amount, market.totalVolume?.asset)}</b></div>
        <div><span>{poolDisplay.label}</span><b title={poolDisplay.title}>{poolDisplay.value}</b></div>
        <div><span>Quote asset</span><b title={market.quoteAssetResolution?.message ?? `Source: ${market.quoteAssetResolution?.source ?? "unavailable"}`}>{market.quoteAsset ?? (market.quoteAssetResolution?.status === "conflict" ? "Conflict" : "Unavailable")}</b></div>
        <div><span>CLOSES</span><b className="metric-close">{closeLabel(market.closeAt)}</b></div>
      </div>
      <div className="market-card__footer"><span>{market.source === "panta" ? "Panta market data" : "Demo fixture"} · Updated {market.updatedAt ? new Date(market.updatedAt).toLocaleString() : "time unavailable"}</span><MarketIdControl marketId={market.id} /><button onClick={() => onSelect(market)}>Details <span>→</span></button></div>
    </motion.article>
  );
}
