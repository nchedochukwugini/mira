import test from "node:test";
import assert from "node:assert/strict";
import * as engine from "./microstructure.ts";
import { buildOrderBookFacts, summarizeOrderBookForMira } from "../intelligence/order-book-context.ts";

function book({ bids = [], asks = [], bidDepth = 0, askDepth = 0, bestBid = bids[0]?.price ?? null, bestAsk = asks[0]?.price ?? null } = {}) {
  return { bids: bids.map(({ price, size }) => ({ price, size })), asks: asks.map(({ price, size }) => ({ price, size })), bestBid, bestAsk, bidDepth, askDepth };
}
function point(observedAt, yes, no = book(), activity = [], activityStatus = "complete") {
  return { marketId: "market-1", quoteAsset: "USDC", observedAt, slot: observedAt, source: "panta-solana", provenance: "MIRA-observed", dataStatus: "complete", yes, no, pantaReference: { yesPrice: 0.5, noPrice: 0.5, observedAt: null }, activity, activityStatus };
}

test("midpoint, spread and spread bps preserve missing-side and zero-midpoint semantics", () => {
  assert.equal(engine.calculateMidpoint(0.4, 0.6), 0.5);
  assert.equal(engine.calculateMidpoint(null, 0.6), null);
  assert.equal(engine.calculateMidpoint(0.4, null), null);
  assert.ok(Math.abs(engine.calculateSpread(0.4, 0.6) - 0.2) < 1e-12);
  assert.equal(engine.calculateSpread(0.5, 0.5), 0);
  assert.equal(engine.calculateSpread(null, 0.5), null);
  const metrics = engine.calculateMicrostructure([point(1, book({ bids: [{ price: -1, size: 1 }], asks: [{ price: 1, size: 1 }], bidDepth: 1, askDepth: 1 }))]);
  assert.equal(metrics.yes.spreadBps, null);
  const valid = engine.calculateMicrostructure([point(1, book({ bids: [{ price: 0.4, size: 2 }], asks: [{ price: 0.6, size: 2 }], bidDepth: 0.8, askDepth: 1.2 }))]);
  assert.ok(Math.abs(valid.yes.spreadBps - 4000) < 1e-9);
  const locked = engine.calculateMicrostructure([point(1, book({ bids: [{ price: 0.5, size: 1 }], asks: [{ price: 0.5, size: 1 }], bidDepth: 0.5, askDepth: 0.5 }))]);
  assert.equal(locked.yes.spreadBps, 0);
});

test("depth imbalance covers bid-heavy, ask-heavy, balanced, and empty books", () => {
  assert.equal(engine.calculateDepthImbalance(3, 1), 0.5);
  assert.equal(engine.calculateDepthImbalance(1, 3), -0.5);
  assert.equal(engine.calculateDepthImbalance(2, 2), 0);
  assert.equal(engine.calculateDepthImbalance(0, 0), null);
});

test("depth deltas handle increase, decrease, and zero baseline without infinity", () => {
  assert.deepEqual(engine.calculateDepthDelta(10, 15), { change: 5, percentChange: 50, percentStatus: "comparable" });
  assert.deepEqual(engine.calculateDepthDelta(10, 5), { change: -5, percentChange: -50, percentStatus: "comparable" });
  assert.deepEqual(engine.calculateDepthDelta(0, 5), { change: 5, percentChange: null, percentStatus: "not-comparable" });
});

test("book transitions identify added, removed, increased, and decreased visible levels", () => {
  const before = point(1, book({ bids: [{ price: 0.4, size: 2 }, { price: 0.3, size: 3 }], asks: [{ price: 0.6, size: 4 }], bidDepth: 1.7, askDepth: 2.4 }));
  const after = point(2, book({ bids: [{ price: 0.4, size: 5 }, { price: 0.2, size: 1 }], asks: [{ price: 0.6, size: 2 }, { price: 0.7, size: 3 }], bidDepth: 2.2, askDepth: 3.3 }));
  const result = engine.calculateMicrostructure([before, after]);
  assert.deepEqual(result.orderChanges.bidAdditions, [{ price: 0.4, sizeChange: 3 }, { price: 0.2, sizeChange: 1 }]);
  assert.deepEqual(result.orderChanges.bidRemovals, [{ price: 0.3, sizeChange: 3 }]);
  assert.deepEqual(result.orderChanges.askAdditions, [{ price: 0.7, sizeChange: 3 }]);
  assert.deepEqual(result.orderChanges.askRemovals, [{ price: 0.6, sizeChange: 2 }]);
  assert.equal(result.liquidityTrend, "changed");
});

test("one-sided, empty, and two-sided books remain structurally distinct", () => {
  assert.equal(engine.calculateMicrostructure([point(1, book({ bids: [{ price: 1, size: 1 }], bidDepth: 1 }))]).yes.bookState, "bid-only");
  assert.equal(engine.calculateMicrostructure([point(1, book({ asks: [{ price: 0.4, size: 2 }], askDepth: 0.8 }))]).yes.bookState, "ask-only");
  assert.equal(engine.calculateMicrostructure([point(1, book())]).yes.bookState, "empty");
  const twoSided = engine.calculateMicrostructure([point(1, book({ bids: [{ price: 0.4, size: 2 }], asks: [{ price: 0.6, size: 2 }], bidDepth: 0.8, askDepth: 1.2 }))]);
  assert.equal(twoSided.yes.bookState, "two-sided");
  assert.equal(twoSided.yes.midpoint, 0.5);
  assert.ok(Math.abs(twoSided.yes.spread - 0.2) < 1e-12);
});

test("spread regime uses a documented relative median and waits for three observations", () => {
  const spreadPoint = (time, spread) => point(time, book({ bids: [{ price: 0.4, size: 1 }], asks: [{ price: 0.4 + spread, size: 1 }], bidDepth: 0.4, askDepth: 0.4 + spread }));
  assert.equal(engine.calculateMicrostructure([spreadPoint(1, 0.01), spreadPoint(2, 0.02)]).yes.spreadRegime, "unavailable");
  assert.equal(engine.calculateMicrostructure([spreadPoint(1, 0.01), spreadPoint(2, 0.02), spreadPoint(3, 0.03)]).yes.spreadRegime, "wide");
  assert.equal(engine.calculateMicrostructure([spreadPoint(1, 0.03), spreadPoint(2, 0.02), spreadPoint(3, 0.01)]).yes.spreadRegime, "tight");
  assert.equal(engine.calculateMicrostructure([spreadPoint(1, 0.02), spreadPoint(2, 0.02), spreadPoint(3, 0.02)]).yes.spreadRegime, "normal");
});

test("history status and liquidity trend never infer a trend from one or two sparse observations", () => {
  assert.equal(engine.calculateMicrostructure([]), null);
  assert.equal(engine.calculateMicrostructure([point(1, book())]).summary.historyStatus, "single-observation");
  assert.equal(engine.calculateMicrostructure([point(1, book())]).liquidityTrend, "insufficient-history");
  assert.equal(engine.calculateMicrostructure([point(1, book()), point(2, book({ bids: [{ price: 0.2, size: 1 }], bidDepth: 0.2 }))]).liquidityTrend, "changed");
  const history = [1, 2, 3].map((time, index) => point(time, book({ bids: [{ price: 0.2, size: index + 1 }], bidDepth: (index + 1) * 0.2 })));
  assert.equal(engine.calculateMicrostructure(history).liquidityTrend, "increasing");
  assert.equal(engine.calculateMicrostructure(history).summary.historyStatus, "sparse");
});

test("activity separates order placement, cancellation, matched evidence, and unknown activity", () => {
  const activity = (kind) => [{ signature: `sig-${kind}`, observedAt: 1, kind, instruction: kind }];
  for (const [kind, expected] of [["order_placed", "orders"], ["order_cancelled", "cancellations"], ["order_matched", "matched-trades"], ["unknown", "unknown"]]) {
    const result = engine.calculateMicrostructure([point(1, book(), book(), activity(kind))]);
    assert.equal(result.activity.status, expected);
  }
  const unavailable = engine.calculateMicrostructure([point(1, book(), book(), [], "unavailable")]);
  assert.equal(unavailable.activity.status, "unavailable");
  assert.equal(unavailable.activity.tradeCount, 0);
  assert.equal(unavailable.activity.matchedVolume, null);
});

test("one-sided explanation keeps Panta reference separate and rejects probability interpretation", () => {
  const visibleYes = { outcome: "YES", quoteAsset: "USDC", bids: [{ price: 1, size: 1, side: "bid" }], asks: [], bestBid: 1, bestAsk: null, midpoint: null, spread: null, bidDepth: 1, askDepth: 0 };
  const text = engine.explainOneSidedBook(visibleYes, 0.5);
  assert.equal(text, "The current decoder returned a one-sided YES book: a 1.0000 USDC/share bid is present, but it returned no ask level. Panta's separate reference price is 0.5000 USDC/share. Because there is no two-sided quote in the decoded snapshot, the bid should not be treated as a reliable market probability.");
});

test("snapshot provenance and observation time survive normalization", () => {
  const snapshot = { marketId: "market-1", marketQuestion: "Will it happen?", source: "panta-solana", sourceLabel: "Panta · Solana", observedAt: 123456, slot: 42, pantaReference: { yesPrice: 0.5, noPrice: 0.5, observedAt: "2026-01-01" }, dataStatus: "complete", freshness: "live", yes: { ...book(), outcome: "YES" }, no: { ...book(), outcome: "NO" }, activity: [], activityStatus: "complete", historyStatus: "not_collected" };
  const observation = engine.toMicrostructureHistory(snapshot);
  assert.equal(observation.source, "panta-solana");
  assert.equal(observation.provenance, "current-live");
  assert.equal(observation.observedAt, 123456);
  assert.equal(observation.slot, 42);
  assert.equal(observation.pantaReference.yesPrice, 0.5);
});

test("MIRA response uses the required cautious one-sided YES wording", () => {
  const yes = { outcome: "YES", quoteAsset: "USDC", bids: [{ price: 1, size: 1, side: "bid" }], asks: [], bestBid: 1, bestAsk: null, midpoint: null, spread: null, bidDepth: 1, askDepth: 0 };
  const no = { outcome: "NO", bids: [], asks: [], bestBid: null, bestAsk: null, midpoint: null, spread: null, bidDepth: 0, askDepth: 0 };
  const reply = summarizeOrderBookForMira({ marketId: "m", marketQuestion: "question", source: "panta-solana", sourceLabel: "Panta · Solana", observedAt: 1, slot: 2, pantaReference: { yesPrice: 0.5, noPrice: 0.5, observedAt: null }, dataStatus: "complete", freshness: "live", yes, no, activity: [], activityStatus: "complete", historyStatus: "not_collected" });
  assert.match(reply, /current decoder returned a one-sided YES book: a 1\.0000 USDC\/share bid is present, but it returned no ask level/i);
  assert.match(reply, /Panta's separate reference price is 0\.5000 USDC\/share/);
  assert.match(reply, /should not be treated as a reliable market probability/);
  assert.doesNotMatch(reply, /YES is trading at 100%/i);
});

test("Groq context receives calculated microstructure and separate price provenance", () => {
  const yes = { outcome: "YES", bids: [{ price: 0.4, size: 2, side: "bid" }], asks: [{ price: 0.6, size: 2, side: "ask" }], bestBid: 0.4, bestAsk: 0.6, midpoint: 0.5, spread: 0.2, bidDepth: 0.8, askDepth: 1.2 };
  const no = { outcome: "NO", bids: [], asks: [], bestBid: null, bestAsk: null, midpoint: null, spread: null, bidDepth: 0, askDepth: 0 };
  const snapshot = { marketId: "market-1", marketQuestion: "Will it happen?", quoteAsset: "USDC", source: "panta-solana", sourceLabel: "Panta · Solana", observedAt: 3, slot: 9, pantaReference: { yesPrice: 0.5, noPrice: 0.5, observedAt: "2026-10-07" }, dataStatus: "complete", freshness: "live", yes, no, activity: [], activityStatus: "complete", historyStatus: "available" };
  const metrics = engine.calculateMicrostructure([point(1, yes), point(2, yes), { ...point(3, yes), provenance: "current-live" }]);
  const facts = buildOrderBookFacts(snapshot, metrics);
  assert.equal(facts.pantaReference.yesPrice, 0.5);
  assert.equal(facts.yes.midpointUsdcPerShare, 0.5);
  assert.ok(Math.abs(facts.microstructure.yes.spread - 0.2) < 1e-12);
  assert.equal(facts.microstructure.provenance, "current-live");
  assert.equal(facts.microstructure.historyObservationCount, 2);
});
