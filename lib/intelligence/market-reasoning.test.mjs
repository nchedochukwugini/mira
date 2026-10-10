import assert from "node:assert/strict";
import test from "node:test";
import { buildMarketReasoning } from "./market-reasoning.ts";
import { calculateMicrostructure } from "../panta/microstructure.ts";

const level = (price, size) => ({ price, size, side: "bid" });
function book({ bids = [], asks = [] } = {}) {
  const bidDepth = bids.reduce((sum, item) => sum + item.price * item.size, 0);
  const askDepth = asks.reduce((sum, item) => sum + item.price * item.size, 0);
  return { bids: bids.map((item) => ({ ...item, side: "bid" })), asks: asks.map((item) => ({ ...item, side: "ask" })), bestBid: bids[0]?.price ?? null, bestAsk: asks[0]?.price ?? null, midpoint: bids.length && asks.length ? (bids[0].price + asks[0].price) / 2 : null, spread: bids.length && asks.length ? asks[0].price - bids[0].price : null, bidDepth, askDepth };
}
function point(time, yes, no = book(), activity = []) {
  return { marketId: "market-1", observedAt: time, slot: time, source: "panta-solana", provenance: "MIRA-observed", dataStatus: "complete", yes: { ...yes, bidDepth: yes.bidDepth, askDepth: yes.askDepth }, no: { ...no, bidDepth: no.bidDepth, askDepth: no.askDepth }, pantaReference: { yesPrice: 0.5, noPrice: 0.5, observedAt: null }, activity, activityStatus: "complete" };
}
function market(overrides = {}) {
  return { id: "market-1", question: "Will this happen?", category: null, description: null, status: "active", yesProbability: 0.52, noProbability: 0.48, volumeUsd: 1000, liquidityUsd: null, priceChange24h: null, closeAt: null, updatedAt: new Date(2_000).toISOString(), imageUrl: null, history: [], relatedMarketIds: [], source: "panta", ...overrides };
}
function snapshot(yes, no = book(), activity = [], dataStatus = "complete") {
  return { marketId: "market-1", marketQuestion: "Will this happen?", source: "panta-solana", sourceLabel: "Panta · Solana", observedAt: 2_000, slot: 2, pantaReference: { yesPrice: 0.52, noPrice: 0.48, observedAt: new Date(2_000).toISOString() }, dataStatus, freshness: "live", yes, no, activity, activityStatus: "complete", historyStatus: "available" };
}
const micro = (history) => calculateMicrostructure(history);

test("Panta price movement reports 48 to 52 as a price signal, not a forecast", () => {
  const result = buildMarketReasoning({ market: market({ history: [{ timestamp: new Date(1_000).toISOString(), yesProbability: 0.48 }] }), snapshot: null, microstructure: null, history: [], research: [], researchStatus: "not-run" });
  const signal = result.signals.find((item) => item.kind === "PRICE_MOVEMENT");
  assert.match(signal.observed, /48\.0¢ → 52\.0¢/);
  assert.equal(signal.classification, "supports-yes");
  assert.match(signal.interpretation, /does not establish a forecast/);
});

test("two-sided books calculate 4 cent spreads, and later 2 cent spreads are narrowing", () => {
  const before = point(1_000, book({ bids: [level(0.48, 100)], asks: [{ price: 0.52, size: 100 }] }));
  const after = point(2_000, book({ bids: [level(0.49, 100)], asks: [{ price: 0.51, size: 100 }] }));
  const m = micro([before, after]);
  assert.ok(Math.abs(m.yes.spread - 0.02) < 1e-12);
  const result = buildMarketReasoning({ market: market(), snapshot: snapshot(book({ bids: [level(0.49, 100)], asks: [{ price: 0.51, size: 100 }] })), microstructure: m, history: [before, after], research: [], researchStatus: "not-run" });
  assert.ok(result.changes.some((item) => item.type === "spread" && item.previousValue === 0.04 && item.currentValue === 0.02));
  assert.ok(result.signals.some((item) => item.kind === "SPREAD_NARROWING"));
});

test("bid-depth increases from 2000 to 4000 are classified as YES-side visible liquidity", () => {
  const previous = point(1_000, book({ bids: [level(1, 2_000)] }));
  const current = point(2_000, book({ bids: [level(1, 4_000)] }));
  const result = buildMarketReasoning({ market: market(), snapshot: snapshot(current.yes, current.no), microstructure: micro([previous, current]), history: [previous, current], research: [], researchStatus: "not-run" });
  const signal = result.signals.find((item) => item.kind === "BID_LIQUIDITY_INCREASE");
  assert.match(signal.observed, /\$2000\.00 → \$4000\.00/);
  assert.equal(signal.classification, "supports-yes");
  assert.match(signal.interpretation, /not an outcome probability/);
});

test("ask-depth increases from 2000 to 4500 oppose that outcome-side liquidity", () => {
  const previous = point(1_000, book(), book({ asks: [{ price: 1, size: 2_000 }] }));
  const current = point(2_000, book(), book({ asks: [{ price: 1, size: 4_500 }] }));
  const result = buildMarketReasoning({ market: market(), snapshot: snapshot(current.yes, current.no), microstructure: micro([previous, current]), history: [previous, current], research: [], researchStatus: "not-run" });
  const signal = result.signals.find((item) => item.kind === "ASK_LIQUIDITY_INCREASE");
  assert.equal(signal.classification, "opposes-no");
  assert.match(signal.observed, /\$2000\.00 → \$4500\.00/);
});

test("positive, negative, zero, and empty depth imbalance stay book ratios", () => {
  const cases = [
    { bid: 3, ask: 1, expected: "supports-yes", direction: "BID_MORE" },
    { bid: 1, ask: 3, expected: "opposes-yes", direction: "ASK_MORE" },
    { bid: 2, ask: 2, expected: "neutral", direction: "NEUTRAL" },
  ];
  for (const item of cases) {
    const yes = book({ bids: [level(1, item.bid)], asks: [{ price: 1, size: item.ask }] });
    const p = point(1_000, yes);
    const result = buildMarketReasoning({ market: market(), snapshot: snapshot(yes), microstructure: micro([p]), history: [p], research: [], researchStatus: "not-run" });
    const signal = result.signals.find((value) => value.kind === "DEPTH_IMBALANCE" && value.outcome === "YES");
    assert.equal(signal.classification, item.expected);
    assert.equal(signal.direction, item.direction);
    assert.match(signal.interpretation, /not a probability/);
  }
  const empty = book();
  const p = point(1_000, empty);
  const result = buildMarketReasoning({ market: market(), snapshot: snapshot(empty), microstructure: micro([p]), history: [p], research: [], researchStatus: "not-run" });
  assert.equal(result.signals.find((item) => item.kind === "DEPTH_IMBALANCE" && item.outcome === "YES"), undefined);
});

test("bid-only, ask-only, empty, and two-sided books keep correct price semantics", () => {
  const bidOnly = book({ bids: [level(1, 5)] });
  const askOnly = book({ asks: [{ price: 0.6, size: 5 }] });
  const empty = book();
  const twoSided = book({ bids: [level(0.48, 1)], asks: [{ price: 0.52, size: 1 }] });
  assert.equal(bidOnly.midpoint, null); assert.equal(bidOnly.spread, null);
  assert.equal(askOnly.midpoint, null); assert.equal(askOnly.spread, null);
  assert.equal(empty.midpoint, null); assert.equal(empty.spread, null);
  assert.equal(twoSided.midpoint, 0.5); assert.ok(Math.abs(twoSided.spread - 0.04) < 1e-12);
  const make = (yes) => buildMarketReasoning({ market: market(), snapshot: snapshot(yes), microstructure: null, history: [], research: [], researchStatus: "not-run" });
  assert.match(make(bidOnly).signals.find((item) => item.kind === "BOOK_STATE").interpretation, /visible bids but no asks/);
  assert.match(make(askOnly).signals.find((item) => item.kind === "BOOK_STATE").interpretation, /visible asks but no bids/);
  assert.match(make(empty).signals.find((item) => item.kind === "BOOK_STATE").interpretation, /no visible liquidity/);
  assert.match(make(twoSided).signals.find((item) => item.kind === "BOOK_STATE").interpretation, /not a traded price/);
});

test("one observation cannot establish a trend and sparse history stays explicit", () => {
  const p = point(1_000, book({ bids: [level(0.4, 10)], asks: [{ price: 0.6, size: 10 }] }));
  const result = buildMarketReasoning({ market: market(), snapshot: null, microstructure: micro([p]), history: [p], research: [], researchStatus: "not-run" });
  assert.equal(result.changes.length, 0);
  assert.equal(result.dataStatus, "complete");
  assert.ok(result.uncertainty.some((item) => /only one complete order-book observation/.test(item)));
});

test("placement and cancellation are not fills; only verified matched events are counted", () => {
  const events = ["order_placed", "order_cancelled", "order_matched"].map((kind) => ({ kind, instruction: kind, signature: `${kind}-sig`, outcome: "YES", observedAt: 2_000, price: 0.5, size: 2 }));
  const result = buildMarketReasoning({ market: market(), snapshot: snapshot(book(), book(), events), microstructure: null, history: [], research: [], researchStatus: "not-run" });
  assert.deepEqual(result.signals.filter((item) => ["ORDER_PLACEMENT", "ORDER_CANCELLATION", "VERIFIED_MATCHED_TRADE"].includes(item.kind)).map((item) => item.kind), ["ORDER_PLACEMENT", "ORDER_CANCELLATION", "VERIFIED_MATCHED_TRADE"]);
  assert.match(result.signals.find((item) => item.kind === "ORDER_PLACEMENT").interpretation, /does not prove.*filled/);
  assert.equal(result.signals.find((item) => item.kind === "ORDER_CANCELLATION").classification, "neutral");
});

test("retrieved supporting and opposing research stays separate and contradictory evidence adds uncertainty", () => {
  const evidence = (id, direction) => ({ id, claim: `Claim ${id}`, summary: `Summary ${id}`, title: `Source ${id}`, source: "Official source", domain: "example.gov", url: `https://example.gov/${id}`, publishedAt: null, retrievedAt: new Date(2_000).toISOString(), direction, relevance: "high", reliability: "high", reliabilityReason: "official", evidenceType: "official", pageRetrieved: true, freshness: "undated" });
  const result = buildMarketReasoning({ market: market(), snapshot: null, microstructure: null, history: [], research: [evidence("yes", "supports-yes"), evidence("no", "supports-no")], researchStatus: "available" });
  assert.equal(result.supportingSignals.length, 2);
  assert.ok(result.supportingSignals.some((item) => item.classification === "supports-yes"));
  assert.ok(result.supportingSignals.some((item) => item.classification === "supports-no"));
  assert.ok(result.uncertainty.some((item) => /mixed across YES and NO/.test(item)));
  assert.equal(result.signals.find((item) => item.sourceUrl)?.sourceUrl, "https://example.gov/yes");
});

test("resolved markets are historical and insufficient market context remains explicit", () => {
  const resolved = buildMarketReasoning({ market: market({ status: "resolved" }), snapshot: null, microstructure: null, history: [], research: [], researchStatus: "not-run" });
  assert.match(resolved.explanation, /resolved.*historical context/i);
  assert.equal(resolved.marketState, "resolved");
  const empty = buildMarketReasoning({ market: market({ yesProbability: null, noProbability: null }), snapshot: null, microstructure: null, history: [], research: [], researchStatus: "not-run" });
  assert.equal(empty.dataStatus, "insufficient");
  assert.equal(empty.evidenceQuality, "insufficient");
});
