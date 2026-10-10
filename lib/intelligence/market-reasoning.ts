import type { Market, OrderBookSnapshot } from "@/lib/panta/types";
import { toMicrostructureHistory, type MicrostructureHistoryPoint, type MicrostructureResult } from "@/lib/panta/microstructure";
import type { ResearchEvidence } from "@/lib/research/types";

export type MarketSignalKind = "PRICE_MOVEMENT" | "BID_LIQUIDITY_INCREASE" | "BID_LIQUIDITY_DECREASE" | "ASK_LIQUIDITY_INCREASE" | "ASK_LIQUIDITY_DECREASE" | "DEPTH_IMBALANCE" | "SPREAD_NARROWING" | "SPREAD_WIDENING" | "BOOK_STATE" | "ORDER_PLACEMENT" | "ORDER_CANCELLATION" | "VERIFIED_MATCHED_TRADE" | "RESEARCH_EVIDENCE";
export type MarketSignal = {
  id: string;
  kind: MarketSignalKind;
  outcome: "YES" | "NO" | "MARKET";
  direction: "YES_UP" | "YES_DOWN" | "BID_MORE" | "ASK_MORE" | "BID_LESS" | "ASK_LESS" | "NARROWER" | "WIDER" | "ONE_SIDED" | "EMPTY" | "TWO_SIDED" | "PLACEMENT" | "CANCELLATION" | "MATCHED" | "SUPPORTS_YES" | "SUPPORTS_NO" | "NEUTRAL";
  observed: string;
  interpretation: string;
  classification: "supports-yes" | "opposes-yes" | "supports-no" | "opposes-no" | "neutral";
  provenance: "panta-market-history" | "mira-observed-order-book" | "solana-activity" | "retrieved-research";
  sourceUrl?: string;
};
export type MarketChange = {
  type: "price" | "bid-depth" | "ask-depth" | "spread";
  outcome: "YES" | "NO";
  previousValue: number;
  currentValue: number;
  delta: number;
  observedAt: string;
  previousObservedAt: string;
  confidence: "moderate" | "high";
};
export type MarketReasoningSummary = {
  marketId: string;
  quoteAsset: Market["quoteAsset"];
  marketState: Market["status"];
  marketPriceContext: { yesPrice: number | null; noPrice: number | null; source: "panta"; observedAt: string | null };
  structure: { yes: MicrostructureResult["yes"] | null; no: MicrostructureResult["no"] | null };
  signals: MarketSignal[];
  supportingSignals: MarketSignal[];
  opposingSignals: MarketSignal[];
  changes: MarketChange[];
  evidenceQuality: "strong" | "moderate" | "limited" | "insufficient";
  uncertainty: string[];
  dataStatus: "complete" | "partial" | "insufficient";
  observationCount: number;
  comparisonObservationCount: number;
  historyStatus: "available" | "unavailable" | "not-observed";
  researchStatus: "available" | "unavailable" | "not-run";
  explanation: string;
};

type ReasoningInput = {
  market: Market;
  snapshot: OrderBookSnapshot | null;
  microstructure: MicrostructureResult | null;
  history: MicrostructureHistoryPoint[];
  research: ResearchEvidence[];
  researchStatus: "available" | "unavailable" | "not-run";
  historyStatus?: "available" | "unavailable" | "not-observed";
};

const iso = (value: number | string | null | undefined) => {
  if (value === null || value === undefined) return null;
  const time = typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
};
const round = (value: number) => Math.round(value * 1e8) / 1e8;

function addChange(changes: MarketChange[], type: MarketChange["type"], outcome: "YES" | "NO", previousValue: number | null, currentValue: number | null, previousAt: number | string | null, currentAt: number | string | null, confidence: MarketChange["confidence"]) {
  const previousObservedAt = iso(previousAt); const observedAt = iso(currentAt);
  if (previousValue === null || currentValue === null || !previousObservedAt || !observedAt || previousValue === currentValue) return;
  changes.push({ type, outcome, previousValue: round(previousValue), currentValue: round(currentValue), delta: round(currentValue - previousValue), previousObservedAt, observedAt, confidence });
}

export function buildMarketReasoning(input: ReasoningInput): MarketReasoningSummary {
  const { market, snapshot, microstructure, research } = input;
  const allObservations = [...input.history];
  if (snapshot && snapshot.dataStatus !== "unavailable" && !allObservations.some((point) => (point.slot !== null && point.slot === snapshot.slot) || point.observedAt === snapshot.observedAt)) allObservations.push(toMicrostructureHistory(snapshot));
  const usableHistory = allObservations.filter((point) => point.dataStatus !== "partial" && (point.quoteAsset ?? null) === (snapshot?.quoteAsset ?? market.quoteAsset ?? null)).sort((a, b) => a.observedAt - b.observedAt);
  const savedObservationCount = usableHistory.filter((point) => point.provenance === "MIRA-observed").length;
  const historyStatus = input.historyStatus ?? (input.history.length ? "available" : "not-observed");
  const changes: MarketChange[] = [];
  const previous = usableHistory.at(-2); const current = usableHistory.at(-1);
  if (previous && current) {
    for (const outcome of ["yes", "no"] as const) {
      const label = outcome.toUpperCase() as "YES" | "NO";
      addChange(changes, "bid-depth", label, previous[outcome].bidDepth, current[outcome].bidDepth, previous.observedAt, current.observedAt, usableHistory.length >= 3 ? "high" : "moderate");
      addChange(changes, "ask-depth", label, previous[outcome].askDepth, current[outcome].askDepth, previous.observedAt, current.observedAt, usableHistory.length >= 3 ? "high" : "moderate");
      const oldSpread = previous[outcome].bestBid !== null && previous[outcome].bestAsk !== null ? previous[outcome].bestAsk - previous[outcome].bestBid : null;
      const newSpread = current[outcome].bestBid !== null && current[outcome].bestAsk !== null ? current[outcome].bestAsk - current[outcome].bestBid : null;
      addChange(changes, "spread", label, oldSpread, newSpread, previous.observedAt, current.observedAt, usableHistory.length >= 3 ? "high" : "moderate");
    }
  }
  const priceHistory = market.history.map((point) => ({ value: point.yesProbability, at: point.timestamp })).filter((point) => Number.isFinite(Date.parse(point.at)) && Number.isFinite(point.value));
  if (market.yesProbability !== null && market.updatedAt) {
    const providerTime = Date.parse(market.updatedAt);
    if (Number.isFinite(providerTime) && !priceHistory.some((point) => Date.parse(point.at) === providerTime)) priceHistory.push({ value: market.yesProbability, at: market.updatedAt });
  }
  priceHistory.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const oldPrice = priceHistory.at(-2); const newPrice = priceHistory.at(-1);
  if (oldPrice && newPrice && oldPrice.value !== null && newPrice.value !== null) {
    addChange(changes, "price", "YES", oldPrice.value, newPrice.value, oldPrice.at, newPrice.at, "moderate");
  }

  const signals: MarketSignal[] = [];
  const signal = (s: Omit<MarketSignal, "id">) => signals.push({ ...s, id: `${s.kind.toLowerCase()}-${signals.length + 1}` });
  for (const change of changes) {
    if (change.type === "price") {
      const up = change.delta > 0;
      signal({ kind: "PRICE_MOVEMENT", outcome: "YES", direction: up ? "YES_UP" : "YES_DOWN", observed: `Panta YES price changed ${(change.previousValue * 100).toFixed(1)}¢ → ${(change.currentValue * 100).toFixed(1)}¢ (${change.delta > 0 ? "+" : ""}${(change.delta * 100).toFixed(1)}¢).`, interpretation: "Provider-reported price movement; this describes market direction and does not establish a forecast.", classification: up ? "supports-yes" : "opposes-yes", provenance: "panta-market-history" });
    } else if (change.type === "spread") {
      const narrower = change.delta < 0;
      signal({ kind: narrower ? "SPREAD_NARROWING" : "SPREAD_WIDENING", outcome: change.outcome, direction: narrower ? "NARROWER" : "WIDER", observed: `${change.outcome} spread changed ${change.previousValue.toFixed(4)} → ${change.currentValue.toFixed(4)} ${snapshot?.quoteAsset ?? market.quoteAsset ?? "quote"}/share.`, interpretation: `The displayed ${change.outcome} spread ${narrower ? "narrowed" : "widened"} across MIRA observations; this describes displayed liquidity only.`, classification: "neutral", provenance: "mira-observed-order-book" });
    } else if (change.type === "bid-depth" || change.type === "ask-depth") {
      const bid = change.type === "bid-depth"; const increase = change.delta > 0;
      const kind: MarketSignalKind = bid ? increase ? "BID_LIQUIDITY_INCREASE" : "BID_LIQUIDITY_DECREASE" : increase ? "ASK_LIQUIDITY_INCREASE" : "ASK_LIQUIDITY_DECREASE";
      const direction = bid ? increase ? "BID_MORE" : "BID_LESS" : increase ? "ASK_MORE" : "ASK_LESS";
      const classification: MarketSignal["classification"] = bid ? (increase ? change.outcome === "YES" ? "supports-yes" : "supports-no" : change.outcome === "YES" ? "opposes-yes" : "opposes-no") : (increase ? change.outcome === "YES" ? "opposes-yes" : "opposes-no" : change.outcome === "YES" ? "supports-yes" : "supports-no");
      signal({ kind, outcome: change.outcome, direction, observed: `${change.outcome} visible ${bid ? "bid" : "ask"} depth changed ${change.previousValue.toFixed(4)} → ${change.currentValue.toFixed(4)} ${snapshot?.quoteAsset ?? market.quoteAsset ?? "quote"}.`, interpretation: `${increase ? "More" : "Less"} visible ${bid ? "buy-side" : "sell-side"} quote notional was observed; it is not primary-pool liquidity and its change alone does not prove an order event.`, classification, provenance: "mira-observed-order-book" });
    }
  }
  for (const outcome of ["YES", "NO"] as const) {
    const book = outcome === "YES" ? snapshot?.yes : snapshot?.no;
    if (book && snapshot?.dataStatus !== "unavailable") {
      const state = book.bids.length && book.asks.length ? "two-sided" : book.bids.length || book.asks.length ? "one-sided" : "empty";
      const direction = state === "two-sided" ? "TWO_SIDED" : state === "one-sided" ? "ONE_SIDED" : "EMPTY";
      const interpretation = state === "two-sided"
        ? `The ${outcome} book has visible bids and asks. A midpoint may be calculated from those quotes, but it is not a traded price.`
        : state === "one-sided"
          ? book.bids.length ? `The ${outcome} book is one-sided, with visible bids but no asks. This shows available buy-side liquidity but does not establish a reliable market price or probability.` : `The ${outcome} book is one-sided, with visible asks but no bids. Only visible sell-side liquidity exists; this does not establish a reliable market price or probability.`
          : `The ${outcome} book is empty; there is no visible liquidity and no price or midpoint can be inferred.`;
      signal({ kind: "BOOK_STATE", outcome, direction, observed: `${outcome} book state: ${state}; visible bid ${book.bestBid ?? "unavailable"}, visible ask ${book.bestAsk ?? "unavailable"}.`, interpretation, classification: "neutral", provenance: "mira-observed-order-book" });
    }
    const side = outcome === "YES" ? microstructure?.yes : microstructure?.no;
    if (side?.depthImbalance !== null && side?.depthImbalance !== undefined) {
      const classification = side.depthImbalance > 0 ? outcome === "YES" ? "supports-yes" : "supports-no" : side.depthImbalance < 0 ? outcome === "YES" ? "opposes-yes" : "opposes-no" : "neutral";
      signal({ kind: "DEPTH_IMBALANCE", outcome, direction: side.depthImbalance > 0 ? "BID_MORE" : side.depthImbalance < 0 ? "ASK_MORE" : "NEUTRAL", observed: `${outcome} visible depth imbalance is ${side.depthImbalance.toFixed(3)} on a −1 to +1 ratio.`, interpretation: side.depthImbalance > 0 ? `More visible ${outcome} bid-side than ask-side liquidity. This is a liquidity ratio, not a probability.` : side.depthImbalance < 0 ? `More visible ${outcome} ask-side than bid-side liquidity. This is a liquidity ratio, not a probability.` : `Visible ${outcome} bid and ask depth is balanced. This is a liquidity ratio, not a probability.`, classification, provenance: "mira-observed-order-book" });
    }
  }
  for (const item of snapshot?.activity ?? []) {
    if (item.kind === "order_placed") signal({ kind: "ORDER_PLACEMENT", outcome: item.outcome ?? "MARKET", direction: "PLACEMENT", observed: `Verified placement instruction ${item.instruction} was observed${item.observedAt ? ` at ${new Date(item.observedAt).toISOString()}` : ""}.`, interpretation: "An order placement instruction does not prove the order remains open or was filled.", classification: "neutral", provenance: "solana-activity" });
    else if (item.kind === "order_cancelled") signal({ kind: "ORDER_CANCELLATION", outcome: item.outcome ?? "MARKET", direction: "CANCELLATION", observed: `Verified cancellation instruction ${item.instruction} was observed${item.observedAt ? ` at ${new Date(item.observedAt).toISOString()}` : ""}.`, interpretation: "A cancellation instruction is not a matched trade.", classification: "neutral", provenance: "solana-activity" });
    else if (item.kind === "order_matched") signal({ kind: "VERIFIED_MATCHED_TRADE", outcome: item.outcome ?? "MARKET", direction: "MATCHED", observed: `A verified OrderMatched event was observed${item.size !== undefined && item.price !== undefined ? ` for ${item.size} shares at ${item.price} ${snapshot?.quoteAsset ?? market.quoteAsset ?? "quote"}/share` : ""}.`, interpretation: "Only the decoded matched event is counted as trade evidence.", classification: "neutral", provenance: "solana-activity" });
  }
  for (const item of research) {
    const classification: MarketSignal["classification"] = item.direction === "supports-yes" ? "supports-yes" : item.direction === "supports-no" ? "supports-no" : "neutral";
    signal({ kind: "RESEARCH_EVIDENCE", outcome: classification === "supports-yes" ? "YES" : classification === "supports-no" ? "NO" : "MARKET", direction: classification === "supports-yes" ? "SUPPORTS_YES" : classification === "supports-no" ? "SUPPORTS_NO" : "NEUTRAL", observed: `${item.title}: ${item.claim}`, interpretation: `${item.evidenceType} from ${item.source}; reliability ${item.reliability}, relevance ${item.relevance}${item.publishedAt ? `, published ${item.publishedAt}` : ", publication date unavailable"}.`, classification, provenance: "retrieved-research", sourceUrl: item.url });
  }
  const supportingSignals = signals.filter((item) => item.classification === "supports-yes" || item.classification === "supports-no");
  const opposingSignals = signals.filter((item) => item.classification === "opposes-yes" || item.classification === "opposes-no");
  const uncertainty: string[] = [];
  if (market.status === "resolved") uncertainty.push("This market is resolved; prices and book observations are historical context, not current trading conditions.");
  if (market.yesProbability === null || market.noProbability === null) uncertainty.push("One or both Panta reference prices are unavailable; price context is incomplete.");
  if (!snapshot || snapshot.dataStatus === "unavailable") uncertainty.push("A current verified on-chain order-book snapshot is unavailable.");
  else if (snapshot.dataStatus === "partial") uncertainty.push("The latest on-chain order-book snapshot is partial.");
  if (snapshot && (snapshot.yes.bids.length === 0 || snapshot.yes.asks.length === 0 || snapshot.no.bids.length === 0 || snapshot.no.asks.length === 0)) uncertainty.push("At least one outcome book is one-sided or empty; missing quotes do not imply zero price or a reliable midpoint.");
  if (usableHistory.length === 0) uncertainty.push("MIRA has no complete saved order-book observations for a historical comparison.");
  else if (usableHistory.length === 1) uncertainty.push("MIRA has only one complete order-book observation, so a trend cannot be established.");
  else if (savedObservationCount < 5) uncertainty.push(`MIRA has limited historical observations (${savedObservationCount} saved observations plus the latest snapshot); this is not a continuous market-history feed.`);
  if (!snapshot?.activity.length || snapshot.activity.every((item) => item.kind !== "order_matched")) uncertainty.push("No verified matched trade is present in the latest bounded activity observation.");
  if (input.researchStatus === "unavailable") uncertainty.push("Persisted research evidence could not be loaded.");
  else if (input.researchStatus === "not-run") uncertainty.push("No persisted research run is available for this market.");
  else if (research.length === 0) uncertainty.push("A prior research run exists, but it contains no retained evidence items.");
  else if (research.length && !research.some((item) => item.direction === "supports-yes" || item.direction === "supports-no")) uncertainty.push("Retrieved research evidence is neutral or mixed on outcome direction.");
  if (supportingSignals.some((item) => item.classification === "supports-yes") && supportingSignals.some((item) => item.classification === "supports-no")) uncertainty.push("Signals are mixed across YES and NO; they do not establish a clear direction.");
  if (historyStatus === "unavailable") uncertainty.push("MIRA could not read saved order-book history, so historical changes may be unavailable.");
  const hasMarketPrice = market.yesProbability !== null || market.noProbability !== null;
  const hasUsableBook = snapshot !== null && snapshot.dataStatus !== "unavailable";
  const dataStatus: MarketReasoningSummary["dataStatus"] = !hasMarketPrice && !hasUsableBook ? "insufficient" : snapshot?.dataStatus === "unavailable" || snapshot?.dataStatus === "partial" || !microstructure || historyStatus === "unavailable" ? "partial" : "complete";
  const evidenceQuality: MarketReasoningSummary["evidenceQuality"] = dataStatus === "insufficient" ? "insufficient" : supportingSignals.length + opposingSignals.length >= 5 && usableHistory.length >= 3 ? "strong" : supportingSignals.length + opposingSignals.length >= 2 ? "moderate" : usableHistory.length || signals.length ? "limited" : "insufficient";
  const yesPrice = market.yesProbability; const noPrice = market.noProbability;
  const explanation = market.status === "resolved"
    ? "This market is resolved. The available price, order-book, and research records provide historical context only."
    : dataStatus === "insufficient"
      ? "There is not enough verified market data to describe current structure or establish a direction."
      : `Panta currently reports YES at ${yesPrice === null ? "unavailable" : `${(yesPrice * 100).toFixed(1)}¢`} and NO at ${noPrice === null ? "unavailable" : `${(noPrice * 100).toFixed(1)}¢`}. ${usableHistory.length < 2 ? "MIRA does not have enough complete order-book observations to establish a structural trend." : `MIRA compares ${savedObservationCount} saved observations with the latest snapshot; changes reflect these actual observations only.`}${uncertainty.length ? ` Uncertainty: ${uncertainty.join(" ")}` : ""}`;
  return { marketId: market.id, quoteAsset: market.quoteAsset ?? null, marketState: market.status, marketPriceContext: { yesPrice, noPrice, source: "panta", observedAt: iso(market.updatedAt) }, structure: { yes: microstructure?.yes ?? null, no: microstructure?.no ?? null }, signals, supportingSignals, opposingSignals, changes, evidenceQuality, uncertainty, dataStatus, observationCount: savedObservationCount, comparisonObservationCount: usableHistory.length, historyStatus, researchStatus: input.researchStatus, explanation };
}
