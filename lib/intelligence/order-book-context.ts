import type { OrderBookSnapshot, OutcomeOrderBook } from "@/lib/panta/types";
import type { MicrostructureResult } from "@/lib/panta/microstructure";
import { explainOneSidedBook } from "@/lib/panta/microstructure";

const cents = (price: number) => `${(price * 100).toFixed(Number.isInteger(price * 100) ? 0 : 2)}¢`;

export function buildOrderBookFacts(snapshot: OrderBookSnapshot, microstructure?: MicrostructureResult | null) {
  const formatOutcome = (book: OutcomeOrderBook) => ({
    outcome: book.outcome,
    bids: book.bids.map(({ price, size }) => ({ priceUsdcPerShare: price, sizeShares: size })),
    asks: book.asks.map(({ price, size }) => ({ priceUsdcPerShare: price, sizeShares: size })),
    bestBidUsdcPerShare: book.bestBid,
    bestAskUsdcPerShare: book.bestAsk,
    midpointUsdcPerShare: book.midpoint,
    midpointIsTradedPrice: false,
    spreadUsdcPerShare: book.spread,
    visibleBidDepthUsdc: book.bidDepth,
    visibleAskDepthUsdc: book.askDepth,
  });
  return { marketId: snapshot.marketId, source: snapshot.source, observedAt: snapshot.observedAt, slot: snapshot.slot, dataStatus: snapshot.dataStatus, freshness: snapshot.freshness, pantaReference: snapshot.pantaReference, yes: formatOutcome(snapshot.yes), no: formatOutcome(snapshot.no), microstructure: microstructure ? { timestamp: microstructure.timestamp, provenance: microstructure.provenance, historyObservationCount: microstructure.historyObservationCount, yes: microstructure.yes, no: microstructure.no, summary: microstructure.summary, depthChanges: { yes: microstructure.yesDepthChange, no: microstructure.noDepthChange, total: microstructure.totalDepthChange }, visibleOrderChanges: microstructure.orderChanges, liquidityTrend: microstructure.liquidityTrend, activity: microstructure.activity, historyStatus: microstructure.historyStatus } : { provenance: "no-observation", historyObservationCount: 0, historyStatus: "not-observed" }, reason: snapshot.reason, message: snapshot.message };
}

function outcomeSummary(book: OutcomeOrderBook) {
  const bid = book.bestBid === null ? "no bid levels returned by the current decoder" : `best bid ${cents(book.bestBid)}`;
  const ask = book.bestAsk === null ? "no ask levels returned by the current decoder" : `best ask ${cents(book.bestAsk)}`;
  const spread = book.spread === null ? "spread unavailable because both sides are not present" : `spread ${(book.spread * 100).toFixed(2)}¢ per share`;
  const bidDepth = book.bids.length ? `Visible bid depth is $${book.bidDepth.toFixed(2)} USDC` : `Decoder-returned bid depth is $${book.bidDepth.toFixed(2)} USDC`;
  const askDepth = book.asks.length ? `visible ask depth is $${book.askDepth.toFixed(2)} USDC` : `decoder-returned ask depth is $${book.askDepth.toFixed(2)} USDC`;
  return `${book.outcome}: ${bid}; ${ask}; ${spread}. ${bidDepth} and ${askDepth}.`;
}

export function summarizeOrderBookForMira(snapshot: OrderBookSnapshot, microstructure?: MicrostructureResult | null) {
  if (snapshot.dataStatus === "unavailable") return `I couldn’t retrieve a verified Panta on-chain order-book snapshot. ${snapshot.message ?? "The market-data source is unavailable."}`;
  const partialNote = snapshot.dataStatus === "partial" ? " This is a partial snapshot, so displayed depth may not represent the full visible book." : "";
  const freshness = snapshot.freshness === "stale" ? " The last on-chain observation is stale." : snapshot.freshness === "recent" ? " This is a recent on-chain observation, not a real-time feed." : "";
  const pantaReference = snapshot.pantaReference.yesPrice !== null || snapshot.pantaReference.noPrice !== null
    ? ` Panta API reference prices are separate: YES ${snapshot.pantaReference.yesPrice === null ? "unavailable" : cents(snapshot.pantaReference.yesPrice)}, NO ${snapshot.pantaReference.noPrice === null ? "unavailable" : cents(snapshot.pantaReference.noPrice)}.`
    : "";
  const oneSided = explainOneSidedBook(snapshot.yes, snapshot.pantaReference.yesPrice) ?? explainOneSidedBook(snapshot.no, snapshot.pantaReference.noPrice);
  const decoderEmpty = [snapshot.yes, snapshot.no].every((book) => book.bids.length === 0 && book.asks.length === 0);
  const decoderNote = decoderEmpty ? " No bids or asks returned by the current decoder." : "";
  const depthSummary = microstructure ? ` MIRA-observed YES depth imbalance is ${microstructure.yes.depthImbalance === null ? "unavailable because total visible depth is zero" : microstructure.yes.depthImbalance.toFixed(3)} and NO depth imbalance is ${microstructure.no.depthImbalance === null ? "unavailable because total visible depth is zero" : microstructure.no.depthImbalance.toFixed(3)}; these are book-depth ratios, not probabilities. Liquidity trend: ${microstructure.liquidityTrend}.` : " Historical depth change is unavailable because no persisted comparison is available.";
  const hasPrevious = microstructure?.totalDepthChange !== null && microstructure?.totalDepthChange !== undefined;
  const changeSummary = microstructure ? `${hasPrevious ? ` Since the prior persisted observation: ${microstructure.orderChanges.bidAdditions.length} visible bid-level increases/additions, ${microstructure.orderChanges.bidRemovals.length} visible bid-level decreases/removals, ${microstructure.orderChanges.askAdditions.length} visible ask-level increases/additions, and ${microstructure.orderChanges.askRemovals.length} visible ask-level decreases/removals.` : " There is no earlier persisted observation for a book-change comparison."} Activity classification: ${microstructure.activity.status}; matched trade count ${microstructure.activity.tradeCount}${microstructure.activity.matchedVolume === null ? " and matched volume unavailable" : ` and verified matched volume $${microstructure.activity.matchedVolume.toFixed(2)} USDC`}.` : " Activity or historical change calculations are unavailable.";
  return `Panta · Solana observed this order book at ${new Date(snapshot.observedAt).toISOString()}${snapshot.slot === null ? "" : ` in slot ${snapshot.slot}`}.${decoderNote} ${outcomeSummary(snapshot.yes)} ${outcomeSummary(snapshot.no)}${oneSided ? ` ${oneSided}` : ""}${depthSummary}${changeSummary}${partialNote}${freshness}${pantaReference} Any midpoint is a book calculation, not a traded price.`;
}
