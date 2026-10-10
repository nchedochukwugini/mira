import type { OrderBookSnapshot, OutcomeOrderBook, QuoteAmount } from "@/lib/panta/types";
import type { QuoteAsset } from "@/lib/panta/types";

export type MicrostructureHistoryPoint = {
  marketId: string;
  quoteAsset?: QuoteAsset | null;
  activeVolume?: QuoteAmount;
  totalVolume?: QuoteAmount;
  observedAt: number;
  slot: number | null;
  source: "panta-solana";
  provenance: "MIRA-observed" | "current-live";
  dataStatus: "complete" | "partial";
  yes: OutcomeObservation;
  no: OutcomeObservation;
  pantaReference: { yesPrice: number | null; noPrice: number | null; observedAt: string | null };
  activity: OrderBookSnapshot["activity"];
  activityStatus: OrderBookSnapshot["activityStatus"];
};

type OutcomeObservation = Pick<OutcomeOrderBook, "bestBid" | "bestAsk" | "bidDepth" | "askDepth"> & { bids: Array<{ price: number; size: number }>; asks: Array<{ price: number; size: number }> };

export type OutcomeMicrostructure = {
  bestBid: number | null;
  bestAsk: number | null;
  midpoint: number | null;
  spread: number | null;
  spreadBps: number | null;
  bidDepth: number;
  askDepth: number;
  totalDepth: number;
  depthImbalance: number | null;
  bidLevelCount: number;
  askLevelCount: number;
  bookState: "bid-only" | "ask-only" | "empty" | "two-sided";
  spreadRegime: "tight" | "normal" | "wide" | "unavailable";
};

export type DepthDelta = { change: number; percentChange: number | null; percentStatus: "comparable" | "not-comparable" };
export type LevelChange = { price: number; sizeChange: number };

export type MarketStructureSummary = {
  marketState: "balanced" | "bid-heavy" | "ask-heavy" | "thin" | "wide-spread" | "active" | "inactive" | "one-sided-book" | "insufficient-data";
  yesState: OutcomeMicrostructure["bookState"];
  noState: OutcomeMicrostructure["bookState"];
  yesImbalance: number | null;
  noImbalance: number | null;
  yesSpread: number | null;
  noSpread: number | null;
  yesDepth: number;
  noDepth: number;
  liquidityTrend: "increasing" | "decreasing" | "stable" | "changed" | "insufficient-history";
  activityStatus: "orders" | "cancellations" | "matched-trades" | "unknown" | "mixed" | "none" | "unavailable";
  historyStatus: "not-observed" | "single-observation" | "sparse" | "observed";
};

export type MicrostructureResult = {
  marketId: string;
  quoteAsset?: QuoteAsset | null;
  timestamp: number;
  source: "panta-solana";
  provenance: MicrostructureHistoryPoint["provenance"];
  historyObservationCount: number;
  dataStatus: "complete" | "partial";
  historyStatus: MarketStructureSummary["historyStatus"];
  yes: OutcomeMicrostructure;
  no: OutcomeMicrostructure;
  yesDepthChange: DepthDelta | null;
  noDepthChange: DepthDelta | null;
  totalDepthChange: DepthDelta | null;
  orderChanges: { bidAdditions: LevelChange[]; bidRemovals: LevelChange[]; askAdditions: LevelChange[]; askRemovals: LevelChange[] };
  liquidityTrend: MarketStructureSummary["liquidityTrend"];
  activity: { status: MarketStructureSummary["activityStatus"]; orderActivity: number; cancellationActivity: number; tradeCount: number; matchedVolume: number | null; events: OrderBookSnapshot["activity"]; evidenceStatus: OrderBookSnapshot["activityStatus"] };
  summary: MarketStructureSummary;
};

const outcomeMetrics = (book: MicrostructureHistoryPoint["yes"], spreadHistory: Array<number | null>): OutcomeMicrostructure => {
  const bestBid = book.bestBid;
  const bestAsk = book.bestAsk;
  const twoSided = bestBid !== null && bestAsk !== null;
  const midpoint = twoSided ? (bestBid + bestAsk) / 2 : null;
  const spread = twoSided ? bestAsk - bestBid : null;
  const historical = spreadHistory.filter((value): value is number => value !== null && value >= 0).sort((a, b) => a - b);
  let spreadRegime: OutcomeMicrostructure["spreadRegime"] = "unavailable";
  if (spread !== null && historical.length >= 3) {
    const middle = Math.floor(historical.length / 2);
    const median = historical.length % 2 ? historical[middle]! : (historical[middle - 1]! + historical[middle]!) / 2;
    spreadRegime = spread < median ? "tight" : spread > median ? "wide" : "normal";
  }
  const bid = book.bids.length > 0;
  const ask = book.asks.length > 0;
  const totalDepth = book.bidDepth + book.askDepth;
  return {
    bestBid, bestAsk, midpoint, spread,
    spreadBps: midpoint !== null && midpoint !== 0 && spread !== null ? spread / midpoint * 10_000 : null,
    bidDepth: book.bidDepth, askDepth: book.askDepth, totalDepth,
    depthImbalance: totalDepth === 0 ? null : (book.bidDepth - book.askDepth) / totalDepth,
    bidLevelCount: book.bids.length, askLevelCount: book.asks.length,
    bookState: bid && ask ? "two-sided" : bid ? "bid-only" : ask ? "ask-only" : "empty",
    spreadRegime,
  };
};

export function calculateMidpoint(bestBid: number | null, bestAsk: number | null): number | null {
  return bestBid !== null && bestAsk !== null ? (bestBid + bestAsk) / 2 : null;
}

export function calculateSpread(bestBid: number | null, bestAsk: number | null): number | null {
  return bestBid !== null && bestAsk !== null ? bestAsk - bestBid : null;
}

export function calculateDepthImbalance(bidDepth: number, askDepth: number): number | null {
  const total = bidDepth + askDepth;
  return total === 0 ? null : (bidDepth - askDepth) / total;
}

export function calculateDepthDelta(previous: number, current: number): DepthDelta {
  return { change: current - previous, percentChange: previous === 0 ? null : ((current - previous) / previous) * 100, percentStatus: previous === 0 ? "not-comparable" : "comparable" };
}

function changes(previous: Array<{ price: number; size: number }>, current: Array<{ price: number; size: number }>): { additions: LevelChange[]; removals: LevelChange[] } {
  const before = new Map(previous.map((level) => [level.price, level.size]));
  const after = new Map(current.map((level) => [level.price, level.size]));
  const additions: LevelChange[] = [];
  const removals: LevelChange[] = [];
  for (const [price, size] of after) {
    const delta = size - (before.get(price) ?? 0);
    if (delta > 0) additions.push({ price, sizeChange: delta });
    else if (delta < 0) removals.push({ price, sizeChange: -delta });
  }
  for (const [price, size] of before) if (!after.has(price) && size > 0) removals.push({ price, sizeChange: size });
  return { additions, removals };
}

function trend(history: MicrostructureHistoryPoint[]): MarketStructureSummary["liquidityTrend"] {
  if (history.length < 2) return "insufficient-history";
  if (history.length === 2) {
    const a = history[0]!.yes.bidDepth + history[0]!.yes.askDepth + history[0]!.no.bidDepth + history[0]!.no.askDepth;
    const b = history[1]!.yes.bidDepth + history[1]!.yes.askDepth + history[1]!.no.bidDepth + history[1]!.no.askDepth;
    return a === b ? "stable" : "changed";
  }
  const values = history.map((point) => point.yes.bidDepth + point.yes.askDepth + point.no.bidDepth + point.no.askDepth);
  const rising = values.every((value, index) => index === 0 || value >= values[index - 1]!);
  const falling = values.every((value, index) => index === 0 || value <= values[index - 1]!);
  if (rising && values.at(-1) !== values[0]) return "increasing";
  if (falling && values.at(-1) !== values[0]) return "decreasing";
  return values.every((value) => value === values[0]) ? "stable" : "changed";
}

function activityStatus(activity: OrderBookSnapshot["activity"], status: OrderBookSnapshot["activityStatus"]): MarketStructureSummary["activityStatus"] {
  if (status === "unavailable") return "unavailable";
  const kinds = new Set(activity.map((item) => item.kind));
  if (!kinds.size) return "none";
  if (kinds.size > 1) return "mixed";
  return kinds.has("order_matched") ? "matched-trades" : kinds.has("order_cancelled") ? "cancellations" : kinds.has("unknown") ? "unknown" : "orders";
}

export function calculateMicrostructure(historyInput: MicrostructureHistoryPoint[]): MicrostructureResult | null {
  const latestAsset = historyInput.at(-1)?.quoteAsset ?? null;
  const history = [...historyInput].filter((point) => (point.quoteAsset ?? null) === latestAsset).sort((a, b) => a.observedAt - b.observedAt);
  const current = history.at(-1);
  if (!current) return null;
  const yesSpreads = history.map((point) => calculateSpread(point.yes.bestBid, point.yes.bestAsk));
  const noSpreads = history.map((point) => calculateSpread(point.no.bestBid, point.no.bestAsk));
  const yes = outcomeMetrics(current.yes, yesSpreads);
  const no = outcomeMetrics(current.no, noSpreads);
  const previous = history.at(-2);
  const yesDepthChange = previous ? calculateDepthDelta(previous.yes.bidDepth + previous.yes.askDepth, current.yes.bidDepth + current.yes.askDepth) : null;
  const noDepthChange = previous ? calculateDepthDelta(previous.no.bidDepth + previous.no.askDepth, current.no.bidDepth + current.no.askDepth) : null;
  const prevTotal = previous ? previous.yes.bidDepth + previous.yes.askDepth + previous.no.bidDepth + previous.no.askDepth : null;
  const totalDepth = current.yes.bidDepth + current.yes.askDepth + current.no.bidDepth + current.no.askDepth;
  const totalDepthChange = prevTotal === null ? null : calculateDepthDelta(prevTotal, totalDepth);
  const prior = previous;
  const yesBid = prior ? changes(prior.yes.bids, current.yes.bids) : { additions: [], removals: [] };
  const yesAsk = prior ? changes(prior.yes.asks, current.yes.asks) : { additions: [], removals: [] };
  const noBid = prior ? changes(prior.no.bids, current.no.bids) : { additions: [], removals: [] };
  const noAsk = prior ? changes(prior.no.asks, current.no.asks) : { additions: [], removals: [] };
  const bidAdditions = [...yesBid.additions, ...noBid.additions];
  const bidRemovals = [...yesBid.removals, ...noBid.removals];
  const askAdditions = [...yesAsk.additions, ...noAsk.additions];
  const askRemovals = [...yesAsk.removals, ...noAsk.removals];
  const liquidityTrend = trend(history);
  const status = activityStatus(current.activity, current.activityStatus);
  const persistedCount = history.filter((point) => point.provenance === "MIRA-observed").length;
  const historyStatus: MarketStructureSummary["historyStatus"] = persistedCount === 0 ? "not-observed" : persistedCount === 1 ? "single-observation" : persistedCount < 5 ? "sparse" : "observed";
  const oneSided = yes.bookState === "bid-only" || yes.bookState === "ask-only" || no.bookState === "bid-only" || no.bookState === "ask-only";
  const totalVisibleDepth = yes.totalDepth + no.totalDepth;
  const comparableImbalances = [yes, no].filter((item) => item.bookState === "two-sided" && item.depthImbalance !== null);
  const meanImbalance = comparableImbalances.length ? comparableImbalances.reduce((sum, item) => sum + item.depthImbalance!, 0) / comparableImbalances.length : null;
  const marketState: MarketStructureSummary["marketState"] = history.length < 1 ? "insufficient-data" : oneSided ? "one-sided-book" : totalVisibleDepth === 0 ? "thin" : [yes, no].some((item) => item.spreadRegime === "wide") ? "wide-spread" : status === "matched-trades" ? "active" : meanImbalance !== null && Math.abs(meanImbalance) <= 0.1 ? "balanced" : meanImbalance !== null && meanImbalance > 0.1 ? "bid-heavy" : meanImbalance !== null && meanImbalance < -0.1 ? "ask-heavy" : "insufficient-data";
  const summary: MarketStructureSummary = { marketState, yesState: yes.bookState, noState: no.bookState, yesImbalance: yes.depthImbalance, noImbalance: no.depthImbalance, yesSpread: yes.spread, noSpread: no.spread, yesDepth: yes.totalDepth, noDepth: no.totalDepth, liquidityTrend, activityStatus: status, historyStatus };
  const events = current.activity;
  const fills = events.filter((item) => item.kind === "order_matched" && typeof item.size === "number" && typeof item.price === "number");
  return {
    marketId: current.marketId, quoteAsset: current.quoteAsset ?? null,
    timestamp: current.observedAt, source: current.source, provenance: current.provenance, historyObservationCount: persistedCount, dataStatus: current.dataStatus, historyStatus, yes, no,
    yesDepthChange, noDepthChange, totalDepthChange,
    orderChanges: { bidAdditions, bidRemovals, askAdditions, askRemovals }, liquidityTrend,
    activity: { status, orderActivity: events.filter((item) => item.kind === "order_placed").length, cancellationActivity: events.filter((item) => item.kind === "order_cancelled").length, tradeCount: fills.length, matchedVolume: fills.length ? fills.reduce((sum, item) => sum + item.price! * item.size!, 0) : null, events, evidenceStatus: current.activityStatus }, summary,
  };
}

export function toMicrostructureHistory(snapshot: OrderBookSnapshot): MicrostructureHistoryPoint {
  const pick = (book: OutcomeOrderBook) => ({ bids: book.bids.map(({ price, size }) => ({ price, size })), asks: book.asks.map(({ price, size }) => ({ price, size })), bestBid: book.bestBid, bestAsk: book.bestAsk, bidDepth: book.bidDepth, askDepth: book.askDepth });
  return { marketId: snapshot.marketId, quoteAsset: snapshot.quoteAsset ?? null, activeVolume: snapshot.activeVolume, totalVolume: snapshot.totalVolume, observedAt: snapshot.observedAt, slot: snapshot.slot, source: snapshot.source, provenance: "current-live", dataStatus: snapshot.dataStatus === "partial" ? "partial" : "complete", yes: pick(snapshot.yes), no: pick(snapshot.no), pantaReference: snapshot.pantaReference, activity: snapshot.activity, activityStatus: snapshot.activityStatus };
}

export function explainOneSidedBook(book: OutcomeOrderBook, referencePrice: number | null): string | null {
  const asset = book.quoteAsset ?? "unresolved quote asset";
  const reference = referencePrice === null ? "unavailable" : `${referencePrice.toFixed(4)} ${asset}/share`;
  if (book.bestBid !== null && book.bestAsk === null) return `The current decoder returned a one-sided ${book.outcome} book: a ${book.bestBid.toFixed(4)} ${asset}/share bid is present, but it returned no ask level. Panta's separate reference price is ${reference}. Because there is no two-sided quote in the decoded snapshot, the bid should not be treated as a reliable market probability.`;
  if (book.bestAsk !== null && book.bestBid === null) return `The current decoder returned a one-sided ${book.outcome} book: an ask at ${book.bestAsk.toFixed(4)} ${asset}/share is present, but it returned no bid level. Panta's separate reference price is ${reference}. Because there is no two-sided quote in the decoded snapshot, the ask should not be treated as a reliable market probability.`;
  return null;
}
