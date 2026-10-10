import type { OrderBookSnapshot, OutcomeOrderBook } from "@/lib/panta/types";
import type { MicrostructureResult } from "@/lib/panta/microstructure";
import { explainOneSidedBook } from "@/lib/panta/microstructure";

const quotePrice = (price: number, asset: string | null | undefined) => `${price.toFixed(4)} ${asset ?? "quote"}/share`;

export function buildOrderBookFacts(snapshot: OrderBookSnapshot, microstructure?: MicrostructureResult | null) {
  const formatOutcome = (book: OutcomeOrderBook) => ({
    outcome: book.outcome,
    quoteAsset: snapshot.quoteAsset ?? null,
    bids: book.bids.map(({ price, size }) => ({ priceQuotePerShare: price, sizeShares: size })),
    asks: book.asks.map(({ price, size }) => ({ priceQuotePerShare: price, sizeShares: size })),
    bestBidQuotePerShare: book.bestBid,
    bestAskQuotePerShare: book.bestAsk,
    midpointQuotePerShare: book.midpoint,
    midpointUsdcPerShare: snapshot.quoteAsset === "USDC" ? book.midpoint : null,
    midpointIsTradedPrice: false,
    spreadQuotePerShare: book.spread,
    visibleBidDepthQuote: book.bidDepth,
    visibleAskDepthQuote: book.askDepth,
    // Legacy names are emitted only where their unit is actually USDC.
    bestBidUsdcPerShare: snapshot.quoteAsset === "USDC" ? book.bestBid : null,
    bestAskUsdcPerShare: snapshot.quoteAsset === "USDC" ? book.bestAsk : null,
    visibleBidDepthUsdc: snapshot.quoteAsset === "USDC" ? book.bidDepth : null,
    visibleAskDepthUsdc: snapshot.quoteAsset === "USDC" ? book.askDepth : null,
  });
  return { marketId: snapshot.marketId, quoteAsset: snapshot.quoteAsset ?? null, quoteAssetResolution: snapshot.quoteAssetResolution, source: snapshot.source, observedAt: snapshot.observedAt, retrievedAt: snapshot.retrievedAt, slot: snapshot.slot, dataStatus: snapshot.dataStatus, freshness: snapshot.freshness, pantaReference: snapshot.pantaReference, yes: formatOutcome(snapshot.yes), no: formatOutcome(snapshot.no), microstructure: microstructure ? { timestamp: microstructure.timestamp, quoteAsset: microstructure.quoteAsset, provenance: microstructure.provenance, historyObservationCount: microstructure.historyObservationCount, yes: microstructure.yes, no: microstructure.no, summary: microstructure.summary, depthChanges: { yes: microstructure.yesDepthChange, no: microstructure.noDepthChange, total: microstructure.totalDepthChange }, visibleOrderChanges: microstructure.orderChanges, liquidityTrend: microstructure.liquidityTrend, activity: microstructure.activity, historyStatus: microstructure.historyStatus } : { provenance: "no-observation", historyObservationCount: 0, historyStatus: "not-observed" }, reason: snapshot.reason, message: snapshot.message };
}

function outcomeSummary(book: OutcomeOrderBook) {
  const bid = book.bestBid === null ? "no bid levels returned by the current decoder" : `best bid ${quotePrice(book.bestBid, book.quoteAsset)}`;
  const ask = book.bestAsk === null ? "no ask levels returned by the current decoder" : `best ask ${quotePrice(book.bestAsk, book.quoteAsset)}`;
  const spread = book.spread === null ? "spread unavailable because both sides are not present" : `spread ${quotePrice(book.spread, book.quoteAsset)}`;
  const bidDepth = book.bids.length ? `Visible bid depth is ${book.bidDepth.toFixed(4)} ${book.quoteAsset ?? "unresolved quote asset"}` : `No decoded bid depth; numeric zero is not presented as a quote`;
  const askDepth = book.asks.length ? `visible ask depth is ${book.askDepth.toFixed(4)} ${book.quoteAsset ?? "unresolved quote asset"}` : `No decoded ask depth; numeric zero is not presented as a quote`;
  return `${book.outcome}: ${bid}; ${ask}; ${spread}. ${bidDepth} and ${askDepth}.`;
}

export function summarizeOrderBookForMira(snapshot: OrderBookSnapshot, microstructure?: MicrostructureResult | null) {
  if (snapshot.dataStatus === "unavailable") return `I couldn’t retrieve a verified Panta on-chain order-book snapshot. ${snapshot.message ?? "The market-data source is unavailable."}`;
  const partialNote = snapshot.dataStatus === "partial" ? " This is a partial snapshot, so displayed depth may not represent the full visible book." : "";
  const freshness = snapshot.freshness === "stale" ? " The last on-chain observation is stale." : snapshot.freshness === "recent" ? " This is a recent on-chain observation, not a real-time feed." : "";
  const pantaReference = snapshot.pantaReference.yesPrice !== null || snapshot.pantaReference.noPrice !== null
    ? ` Panta API ${snapshot.pantaReference.kind === "last_trade" ? "last matched trade" : "reference"} values are separate: YES ${snapshot.pantaReference.yesPrice === null ? "unavailable" : quotePrice(snapshot.pantaReference.yesPrice, snapshot.quoteAsset)}, NO ${snapshot.pantaReference.noPrice === null ? "unavailable" : quotePrice(snapshot.pantaReference.noPrice, snapshot.quoteAsset)}.`
    : "";
  const oneSided = explainOneSidedBook(snapshot.yes, snapshot.pantaReference.yesPrice) ?? explainOneSidedBook(snapshot.no, snapshot.pantaReference.noPrice);
  const decoderEmpty = [snapshot.yes, snapshot.no].every((book) => book.bids.length === 0 && book.asks.length === 0);
  const decoderNote = decoderEmpty ? " No bids or asks returned by the current decoder." : "";
  const depthSummary = microstructure ? ` MIRA-observed YES depth imbalance is ${microstructure.yes.depthImbalance === null ? "unavailable because total visible depth is zero" : microstructure.yes.depthImbalance.toFixed(3)} and NO depth imbalance is ${microstructure.no.depthImbalance === null ? "unavailable because total visible depth is zero" : microstructure.no.depthImbalance.toFixed(3)}; these are book-depth ratios, not probabilities. Liquidity trend: ${microstructure.liquidityTrend}.` : " Historical depth change is unavailable because no persisted comparison is available.";
  const hasPrevious = microstructure?.totalDepthChange !== null && microstructure?.totalDepthChange !== undefined;
  const changeSummary = microstructure ? `${hasPrevious ? ` Since the prior persisted observation: ${microstructure.orderChanges.bidAdditions.length} visible bid-level increases/additions, ${microstructure.orderChanges.bidRemovals.length} visible bid-level decreases/removals, ${microstructure.orderChanges.askAdditions.length} visible ask-level increases/additions, and ${microstructure.orderChanges.askRemovals.length} visible ask-level decreases/removals.` : " There is no earlier persisted observation for a book-change comparison."} Activity classification: ${microstructure.activity.status}; matched trade count ${microstructure.activity.tradeCount}${microstructure.activity.matchedVolume === null ? " and matched volume unavailable" : ` and verified matched volume ${microstructure.activity.matchedVolume.toFixed(4)} ${snapshot.quoteAsset ?? "quote"}`}.` : " Activity or historical change calculations are unavailable.";
  return `Panta · Solana observed this order book at ${new Date(snapshot.observedAt).toISOString()}${snapshot.slot === null ? "" : ` in slot ${snapshot.slot}`}; quote asset ${snapshot.quoteAsset ?? "unresolved"}.${decoderNote} ${outcomeSummary(snapshot.yes)} ${outcomeSummary(snapshot.no)}${oneSided ? ` ${oneSided}` : ""}${depthSummary}${changeSummary}${partialNote}${freshness}${pantaReference} Any midpoint is a book calculation, not a traded price.`;
}
