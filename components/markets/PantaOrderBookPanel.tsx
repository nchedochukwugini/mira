"use client";

import { useEffect, useState } from "react";
import type { Market, OrderBookLevel, OrderBookSnapshot, OutcomeOrderBook, QuoteAmount } from "@/lib/panta/types";
import type { MicrostructureHistoryPoint, MicrostructureResult } from "@/lib/panta/microstructure";
import { explainOneSidedBook } from "@/lib/panta/microstructure";
import { formatQuoteAmount } from "@/lib/panta/market-display";

type DiscreteChartPoint = Pick<MicrostructureHistoryPoint, "observedAt" | "slot" | "quoteAsset"> & { yesBestBid: number | null; yesBestAsk: number | null; noBestBid: number | null; noBestAsk: number | null; yesRef: number | null; noRef: number | null; yesMidpoint: number | null; noMidpoint: number | null };

const money = (value: number, asset: string | null | undefined) => `${value.toFixed(4)} ${asset ?? "quote asset unavailable"}`;
const formatQuote = (value?: QuoteAmount) => formatQuoteAmount(value?.amount, value?.asset);
const size = (value: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 }).format(value);
function price(value: number | null, asset: string | null | undefined) {
  return value === null ? "Unavailable" : `${value.toFixed(4)} ${asset ?? "quote"}/share`;
}
function ageLabel(timestamp: number) {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  return seconds < 2 ? "just now" : `${seconds}s ago`;
}

function BookSide({ label, rows, side, asset }: { label: string; rows: OrderBookLevel[]; side: "bid" | "ask"; asset: string | null | undefined }) {
  return <div className={`clob-side clob-side--${side}`}>
    <div className="clob-side__heading"><span>{label}</span><span>{asset ?? "Quote"} / share</span><span>Shares</span></div>
    {rows.length ? rows.slice(0, 8).map((level) => <div className="clob-level" key={`${level.price}:${level.size}`} title={`Quote notional: ${level.quoteNotional === undefined ? "unavailable" : `${level.quoteNotional.toFixed(4)} ${asset ?? "quote"}`}`}><b>{price(level.price, asset)}</b><span>{size(level.size)}</span></div>) : <p className="clob-empty-side">No {side === "bid" ? "bids" : "asks"} {asset ? "in this decoded snapshot" : "could be verified"}</p>}
  </div>;
}

function OutcomeBook({ book, asset, dataStatus }: { book: OutcomeOrderBook; asset: string | null | undefined; dataStatus: OrderBookSnapshot["dataStatus"] }) {
  return <section className="clob-outcome">
    <div className="clob-outcome__header"><h4>{book.outcome}</h4><span>Best bid {price(book.bestBid, asset)} <i /> Best ask {price(book.bestAsk, asset)}</span></div>
    <div className="clob-book-columns">
      <BookSide label="BIDS" side="bid" rows={book.bids} asset={asset} />
      <BookSide label="ASKS" side="ask" rows={book.asks} asset={asset} />
    </div>
    <div className="clob-book-metrics">
      <span>Decoded open orders <b>{book.openOrderCount === undefined ? "Unavailable" : dataStatus === "complete" ? `${book.openOrderCount} verified` : `${book.openOrderCount} decoded · partial`}</b></span>
      <span>Spread <b>{book.spread === null ? "Unavailable" : `${book.spread.toFixed(4)} ${asset ?? "quote"} / share`}</b></span>
      <span>Visible bid depth <b>{book.bids.length ? money(book.bidDepth, asset) : "No bids in decoded snapshot"}</b></span>
      <span>Visible ask depth <b>{book.asks.length ? money(book.askDepth, asset) : "No asks in decoded snapshot"}</b></span>
      {book.midpoint !== null && <span>Midpoint, not traded <b>{price(book.midpoint, asset)}</b></span>}
    </div>
  </section>;
}

function HistoryChart({ history, status, asset }: { history: DiscreteChartPoint[]; status: string; asset: string | null | undefined }) {
  const orderedHistory = [...history].sort((left, right) => left.observedAt - right.observedAt);
  const series = [
    { label: "YES bid", key: "yesBestBid" as const, color: "#547b55" },
    { label: "YES ask", key: "yesBestAsk" as const, color: "#b86d54" },
    { label: "NO bid", key: "noBestBid" as const, color: "#557f8b" },
    { label: "NO ask", key: "noBestAsk" as const, color: "#a17e42" },
    { label: "Panta YES reference", key: "yesRef" as const, color: "#9476ad" },
    { label: "CLOB YES midpoint", key: "yesMidpoint" as const, color: "#324f39" },
    { label: "Panta NO reference", key: "noRef" as const, color: "#8c789d" },
    { label: "CLOB NO midpoint", key: "noMidpoint" as const, color: "#46657b" },
  ].map((item) => ({ ...item, values: orderedHistory.map((point) => point[item.key]) }));
  const available = series.filter((item) => item.values.filter((value) => value !== null).length >= 2);
  if (status === "unavailable") return <div className="clob-history-empty">Snapshot history could not be read from Neon.</div>;
  if (orderedHistory.length < 2 || available.length === 0) return <div className="clob-history-empty">{orderedHistory.length === 0 ? status === "not-observed" ? "MIRA has no observations in this selected range." : "MIRA hasn't observed this market yet." : "MIRA has one observation. Historical movement will appear as more snapshots are collected."}</div>;
  const numbers = available.flatMap((item) => item.values.filter((value): value is number => value !== null));
  const low = Math.min(...numbers); const high = Math.max(...numbers); const range = Math.max(high - low, 0.01);
  return <div className="clob-history-wrap">
    <svg className="clob-history-chart" viewBox="0 0 100 32" preserveAspectRatio="none" role="img" aria-label="Discrete MIRA observed best bid and ask snapshots">
      <line x1="0" y1="29" x2="100" y2="29" stroke="#dce4d2" strokeWidth=".6" />
      {available.flatMap((item) => item.values.flatMap((value, index) => value === null ? [] : [<circle key={`${item.key}-${orderedHistory[index]?.slot ?? index}`} cx={((orderedHistory[index]!.observedAt - orderedHistory[0]!.observedAt) / Math.max(1, orderedHistory.at(-1)!.observedAt - orderedHistory[0]!.observedAt)) * 100} cy={28 - ((value - low) / range) * 24} r="1.15" fill={item.color}><title>{`${item.label}: ${price(value, asset)} at ${new Date(orderedHistory[index]!.observedAt).toLocaleString()}`}</title></circle>]))}
    </svg>
    <div className="clob-history-legend">{available.map((item) => <span key={item.key}><i style={{ background: item.color }} />{item.label}</span>)}</div>
    <small>Discrete MIRA-observed points · {asset ?? "unresolved quote asset"} per share · not trade prices</small>
  </div>;
}

function MicrostructureMetrics({ metrics, asset }: { metrics: MicrostructureResult | null; asset: string | null | undefined }) {
  if (!metrics) return <p className="clob-history-empty">Microstructure metrics will appear after MIRA has persisted an observation.</p>;
  const row = (label: string, value: number | null) => <span>{label}<b>{value === null ? "Unavailable" : `${value.toFixed(4)} ${asset ?? "quote"}`}</b></span>;
  return <div className="clob-microstructure">
    <div><b>YES</b>{row("Midpoint", metrics.yes.midpoint)}{row("Spread", metrics.yes.spread)}<span>Spread bps<b>{metrics.yes.spreadBps === null ? "Unavailable" : `${metrics.yes.spreadBps.toFixed(2)} bps`}</b></span>{row("Visible depth", metrics.yes.totalDepth)}<span>Depth imbalance<b>{metrics.yes.depthImbalance === null ? "Unavailable" : metrics.yes.depthImbalance.toFixed(3)}</b></span></div>
    <div><b>NO</b>{row("Midpoint", metrics.no.midpoint)}{row("Spread", metrics.no.spread)}<span>Spread bps<b>{metrics.no.spreadBps === null ? "Unavailable" : `${metrics.no.spreadBps.toFixed(2)} bps`}</b></span>{row("Visible depth", metrics.no.totalDepth)}<span>Depth imbalance<b>{metrics.no.depthImbalance === null ? "Unavailable" : metrics.no.depthImbalance.toFixed(3)}</b></span></div>
    <p>Imbalance is a visible depth ratio from −1 to +1, not a probability. One-sided books are identified separately. Market state: <b>{metrics.summary.marketState}</b> · Liquidity: <b>{metrics.liquidityTrend}</b> · Current: <b>{metrics.provenance === "current-live" ? "live snapshot" : "MIRA observation"}</b> · Saved history: <b>{metrics.historyObservationCount} observations ({metrics.historyStatus})</b></p>
  </div>;
}

function MiraBookAnalysis({ snapshot, metrics }: { snapshot: OrderBookSnapshot; metrics: MicrostructureResult | null }) {
  const oneSided = explainOneSidedBook(snapshot.yes, snapshot.pantaReference.yesPrice) ?? explainOneSidedBook(snapshot.no, snapshot.pantaReference.noPrice);
  const statement = oneSided ?? (metrics ? `The visible market structure is ${metrics.summary.marketState}. YES visible depth is ${metrics.yes.totalDepth.toFixed(4)} ${snapshot.quoteAsset ?? "quote"} and NO visible depth is ${metrics.no.totalDepth.toFixed(4)} ${snapshot.quoteAsset ?? "quote"}; these are bid/ask book notionals, not the primary-pool snapshot. The current activity classification is ${metrics.activity.status}, with ${metrics.activity.tradeCount} verified matched trades in the observed activity set.` : "MIRA has a current book snapshot but insufficient persisted history to describe changes over time.");
  return <section className="clob-history"><div className="clob-subheading"><span className="panel-kicker">MIRA ANALYSIS</span><h4>What the visible book supports</h4></div><p className="clob-analysis-copy">{statement}</p></section>;
}

function RecentActivity({ snapshot }: { snapshot: OrderBookSnapshot }) {
  if (!snapshot.activity.length) return <p className="clob-history-empty">{snapshot.activityStatus === "unavailable" ? "Recent on-chain activity could not be read." : "No verified recent order activity was returned."}</p>;
  return <>{snapshot.activityStatus === "partial" && <p className="clob-history-empty">Some transaction details could not be read; this activity list may be incomplete.</p>}<ul className="clob-activity-list">{snapshot.activity.map((item, index) => <li key={`${item.signature}-${index}`}>
    <span>{item.kind === "order_matched" ? "Matched trade evidence" : item.kind === "order_cancelled" ? "Cancellation instruction" : item.kind === "unknown" ? "Unclassified activity" : "Order placement instruction"}</span>
    <b>{item.outcome ? `${item.outcome} ${price(item.price ?? null, snapshot.quoteAsset)} · ${size(item.size ?? 0)} shares` : item.instruction}</b>
    <time>{item.observedAt ? new Date(item.observedAt).toLocaleString() : "Time unavailable"}</time>
    <small>Slot {item.slot ?? "unavailable"} · Program {item.programId ?? "unavailable"} · {item.verificationStatus ?? "historical classification unavailable"}</small>
    <small>{item.classificationReason ?? "This historical record predates the current activity decoder metadata."}</small>
    <a href={`https://solscan.io/tx/${encodeURIComponent(item.signature)}`} target="_blank" rel="noreferrer">View on-chain transaction</a>
  </li>)}</ul></>;
}

export function PantaOrderBookPanel({ market }: { market: Market }) {
  const [result, setResult] = useState<{ marketId: string; snapshot?: OrderBookSnapshot & { microstructure?: MicrostructureResult | null }; error?: string } | null>(null);
  const [chartRange, setChartRange] = useState<"1h" | "6h" | "1d" | "1w" | "all">("all");
  const [chart, setChart] = useState<{ marketId: string; range: string; points: DiscreteChartPoint[]; status: string } | null>(null);
  const snapshot = result?.marketId === market.id ? result.snapshot ?? null : null;
  const hasSnapshot = snapshot !== null;
  const error = result?.marketId === market.id ? result.error ?? "" : "";

  useEffect(() => {
    let current = true;
    let timer: ReturnType<typeof setInterval> | undefined;
    if (market.source !== "panta") return () => { current = false; };
    const refresh = async () => {
      try {
        const response = await fetch(`/api/markets/${encodeURIComponent(market.id)}/orderbook`, { cache: "no-store" });
        const payload = await response.json() as { data?: OrderBookSnapshot & { microstructure?: MicrostructureResult | null }; error?: string };
        if (!response.ok || !payload.data) throw new Error(payload.error ?? "MIRA could not load this order book.");
        if (current) setResult({ marketId: market.id, snapshot: payload.data });
      } catch (caught) {
        if (current) setResult({ marketId: market.id, error: caught instanceof Error ? caught.message : "MIRA could not load this order book." });
      }
    };
    void refresh();
    if (market.status === "active" && market.phase === "secondary") timer = setInterval(() => { void refresh(); }, 15_000);
    return () => { current = false; if (timer) clearInterval(timer); };
  }, [market.id, market.phase, market.source, market.status]);

  useEffect(() => {
    if (market.source !== "panta" || !hasSnapshot) return;
    let current = true;
    const load = async () => {
      try {
        const response = await fetch(`/api/markets/${encodeURIComponent(market.id)}/snapshots?range=${chartRange}&maxPoints=500`, { cache: "no-store" });
        const payload = await response.json() as { observations?: MicrostructureHistoryPoint[]; historyStatus?: string };
        const points = (payload.observations ?? []).filter((point) => point.quoteAsset === market.quoteAsset).map((point) => ({ observedAt: point.observedAt, slot: point.slot, quoteAsset: point.quoteAsset, yesBestBid: point.yes.bestBid, yesBestAsk: point.yes.bestAsk, noBestBid: point.no.bestBid, noBestAsk: point.no.bestAsk, yesRef: point.pantaReference.yesPrice, noRef: point.pantaReference.noPrice, yesMidpoint: point.yes.bestBid !== null && point.yes.bestAsk !== null ? (point.yes.bestBid + point.yes.bestAsk) / 2 : null, noMidpoint: point.no.bestBid !== null && point.no.bestAsk !== null ? (point.no.bestBid + point.no.bestAsk) / 2 : null }));
        if (current) setChart({ marketId: market.id, range: chartRange, points, status: payload.historyStatus ?? "unavailable" });
      } catch { if (current) setChart({ marketId: market.id, range: chartRange, points: [], status: "unavailable" }); }
    };
    void load();
    const timer = setInterval(() => { void load(); }, 60_000);
    return () => { current = false; clearInterval(timer); };
  }, [market.id, market.quoteAsset, market.source, chartRange, hasSnapshot]);

  return <section className="clob-panel" aria-live="polite">
    <div className="clob-panel__header"><div><span className="panel-kicker">ON-CHAIN MARKET DATA</span><h3>Order book</h3></div>
      {snapshot && <span className={`clob-status clob-status--${snapshot.dataStatus}`}>{snapshot.dataStatus === "complete" ? snapshot.freshness.toUpperCase() : snapshot.dataStatus.toUpperCase()}</span>}
    </div>
    {market.source === "demo" ? <div className="clob-unavailable"><b>DEMO DATA</b><p>Solana CLOB data is unavailable for demo markets.</p></div>
      : !result || result.marketId !== market.id ? <div className="clob-unavailable" role="status">MIRA is reading the Panta on-chain book…</div>
      : error ? <div className="clob-unavailable"><b>Unavailable</b><p>{error}</p></div>
      : snapshot?.dataStatus === "unavailable" ? <div className="clob-unavailable"><b>Unavailable</b><p>{snapshot.message ?? "MIRA couldn't reach the Solana market-data source."}</p></div>
      : snapshot ? <>
        <div className="clob-provenance"><span>SOURCE <b>{snapshot.sourceLabel}</b></span><span>QUOTE ASSET <b title={snapshot.quoteAssetResolution?.message ?? `Resolved from ${snapshot.quoteAssetResolution?.source ?? "unknown source"}`}>{snapshot.quoteAsset ?? "Unavailable"}{snapshot.quoteAssetResolution?.status === "conflict" ? " · metadata conflict" : ""}</b></span><span>OBSERVED <b>{ageLabel(snapshot.observedAt)}</b></span><span>DATA <b>{snapshot.dataStatus === "partial" ? "Partial on-chain snapshot" : snapshot.freshness === "stale" ? "Stale on-chain snapshot" : snapshot.freshness === "recent" ? "Recent on-chain snapshot" : "Live on-chain snapshot"}</b></span>{snapshot.slot !== null && <span>SLOT <b>{snapshot.slot.toLocaleString()}</b></span>}{snapshot.accountReadSlots && <span>RPC READ SLOTS <b>{snapshot.accountReadSlots.priceLevels} / {snapshot.accountReadSlots.orderNodes} / {snapshot.accountReadSlots.event}</b></span>}</div>
        {snapshot.primaryPoolLiquidity && <div className="clob-reference"><span>Finalized primary-pool snapshot</span><b>{formatQuote(snapshot.primaryPoolLiquidity)}{snapshot.primaryPoolLiquidityUsd !== null && snapshot.primaryPoolLiquidityUsd !== undefined ? ` (${snapshot.primaryPoolLiquidityUsd.toFixed(2)} USD)` : ""}</b><small>Raw {snapshot.primaryPoolLiquidity.rawBaseUnits ?? "unavailable"} base units · {snapshot.primaryPoolLiquidity.baseUnitsPerUnit ?? "unavailable"} base units per {snapshot.quoteAsset ?? "quote"} · on-chain Event account · {snapshot.primaryPoolLiquidityStatus === "conflict" ? "detail value conflicts with chain" : "not current executable order-book depth"}</small></div>}
        <div className="clob-reference"><span>Volume from on-chain Event</span><b>Active {formatQuote(snapshot.activeVolume)} · Total {formatQuote(snapshot.totalVolume)}</b><small>Active and total volume are separate from primary-pool liquidity and open orders.</small></div>
        {snapshot.dataStatus === "partial" && <div className="clob-partial-note">{snapshot.message ?? "This snapshot contains only part of the observable book."}</div>}
        {[snapshot.yes, snapshot.no].every((book) => book.bids.length === 0 && book.asks.length === 0) && <div className="clob-partial-note" role="note">{snapshot.dataStatus === "complete" ? "Both decoded books are empty at this snapshot." : "No levels were decoded; partial data does not establish that the books are empty."} This describes secondary order-book state, not primary-pool liquidity.</div>}
        {snapshot.pantaReference.yesPrice !== null || snapshot.pantaReference.noPrice !== null ? <div className="clob-reference"><span>Panta API {snapshot.pantaReference.kind === "last_trade" ? "last matched trade" : "reference"}</span><b>YES {price(snapshot.pantaReference.yesPrice, snapshot.quoteAsset)} · NO {price(snapshot.pantaReference.noPrice, snapshot.quoteAsset)}</b><small>Provider reference, not an executable quote from this on-chain order book · source {snapshot.pantaReference.source ?? "unavailable"} · timestamp {snapshot.pantaReference.observedAt ? new Date(snapshot.pantaReference.observedAt).toLocaleString() : "unavailable"}</small></div> : null}
        <OutcomeBook book={snapshot.yes} asset={snapshot.quoteAsset} dataStatus={snapshot.dataStatus} />
        <OutcomeBook book={snapshot.no} asset={snapshot.quoteAsset} dataStatus={snapshot.dataStatus} />
        <section className="clob-history"><div className="clob-subheading"><span className="panel-kicker">PRICE / MARKET STRUCTURE</span><h4>MIRA microstructure</h4></div><MicrostructureMetrics metrics={snapshot.microstructure ?? null} asset={snapshot.quoteAsset} /></section>
        <section className="clob-history"><div className="clob-subheading"><span className="panel-kicker">PRICE HISTORY</span><h4>MIRA-observed book snapshots</h4></div><div className="clob-range-selector">{(["1h", "6h", "1d", "1w", "all"] as const).map((range) => <button type="button" key={range} aria-pressed={chartRange === range} onClick={() => setChartRange(range)}>{range.toUpperCase()}</button>)}</div><HistoryChart history={chart?.marketId === market.id && chart.range === chartRange ? chart.points : []} status={chart?.marketId === market.id && chart.range === chartRange ? chart.status : "loading"} asset={snapshot.quoteAsset} /></section>
        <section className="clob-history"><div className="clob-subheading"><span className="panel-kicker">RECENT ACTIVITY</span><h4>Orders, cancellations and matched trades</h4></div><RecentActivity snapshot={snapshot} /></section>
        <MiraBookAnalysis snapshot={snapshot} metrics={snapshot.microstructure ?? null} />
        <p className="clob-disclaimer">Visible depth is only the decoded on-chain snapshot; it is not total market liquidity. A placed order is not necessarily a fill.</p>
      </>
      : <div className="clob-unavailable"><b>Unavailable</b><p>MIRA has not received a market-data snapshot.</p></div>}
  </section>;
}
