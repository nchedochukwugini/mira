import assert from "node:assert/strict";
import test from "node:test";
import { buildMarketIntelligenceContext, buildDeterministicMarketIntelligence, synthesizeMarketIntelligence, validateMarketIntelligenceExplanation } from "./market-intelligence.ts";

const market = (overrides = {}) => ({ id: "m1", question: "Will the event happen?", category: "Sports", description: null, status: "active", yesProbability: 0.54, noProbability: 0.46, volumeUsd: 1200, liquidityUsd: 300, priceChange24h: null, closeAt: null, updatedAt: "2026-10-08T10:00:00.000Z", imageUrl: null, history: [], relatedMarketIds: [], source: "panta", ...overrides });
const evidence = { id: "src1", claim: "A public source reports an event update.", summary: "An event update was reported.", title: "Official update", source: "Official source", domain: "example.gov", url: "https://example.gov/event", publishedAt: null, retrievedAt: "2026-10-08T10:00:00.000Z", publishedAtPrecision: "unknown", direction: "neutral", relevance: "high", reliability: "high", reliabilityReason: "Official", evidenceType: "official", pageRetrieved: true, freshness: "undated" };
const context = (overrides = {}) => buildMarketIntelligenceContext({ market: market(), research: [evidence], researchStatus: "available", ...overrides });

test("market context preserves exact provider prices, classifies partial and resolved state", () => {
  const value = context();
  assert.equal(value.market.yesPrice, 0.54);
  assert.equal(value.market.resolutionStatus, "unresolved");
  assert.equal(value.research.evidence[0].id, "E1");
  assert.equal(value.research.evidence[0].category, "supports-reported-fact");
  assert.ok(value.uncertainty.some((line) => /publication time/.test(line)));
  const resolved = context({ market: market({ status: "resolved" }) });
  assert.equal(resolved.market.resolutionStatus, "resolved");
  assert.match(buildDeterministicMarketIntelligence(resolved), /historical context/);
  assert.match(buildDeterministicMarketIntelligence(buildMarketIntelligenceContext({ market: null })), /unavailable/);
});

test("Panta lookup failure preserves already retrieved research and event context", () => {
  const value = buildMarketIntelligenceContext({
    market: null,
    research: [evidence],
    researchStatus: "available",
    researchedAt: evidence.retrievedAt,
  });
  assert.equal(value.market, null);
  assert.equal(value.research.evidence[0].id, "E1");
  assert.equal(value.evidenceReferences.E1, evidence.id);
  assert.equal(value.dataQuality.sources.find((item) => item.name === "Persisted research")?.status, "available");
  assert.match(buildDeterministicMarketIntelligence(value), /market data is unavailable/);
});

test("an insufficient event diff cannot claim new research or event changes", () => {
  const event = {
    event: { title: "Reported event", status: "awaiting-decision", summary: "Current report", lastUpdatedAt: "2026-10-08T10:00:00.000Z", evidenceIds: [evidence.id], timeline: [] },
    freshness: "fresh",
    diff: { status: "insufficient", summary: "There is not enough retained prior evidence to establish what materially changed.", newEvidence: [evidence], updatedEvidence: [], removedOrRetractedClaims: [], changedClaims: [evidence], contradictions: [] },
  };
  const value = context({ events: event });
  assert.equal(value.changes.some((change) => change.category === "research" || change.category === "event"), false);
  assert.ok(value.uncertainty.some((line) => /not enough retained prior evidence/.test(line)));
});

test("prices remain market quotes; no history means no invented observed change", () => {
  const value = context();
  assert.equal(value.pricing.observations.length, 1);
  assert.equal(value.pricing.historyStatus, "insufficient");
  assert.equal(value.changes.length, 0);
  assert.match(value.pricing.note, /not MIRA outcome probabilities/);
  assert.match(buildDeterministicMarketIntelligence(value), /54\.0%/);
  assert.match(buildDeterministicMarketIntelligence(value), /not MIRA forecasts/);
  assert.match(buildDeterministicMarketIntelligence(value), /not enough observed history/);
});

test("only persisted timestamped price observations establish movement", () => {
  const point = (observedAt, yesPrice) => ({ marketId: "m1", observedAt, slot: observedAt, source: "panta-solana", provenance: "MIRA-observed", dataStatus: "complete", yes: {}, no: {}, pantaReference: { yesPrice, noPrice: null, observedAt: null }, activity: [], activityStatus: "complete" });
  const value = context({ history: [point(1_000, 0.51), point(2_000, 0.54)] });
  assert.equal(value.pricing.historyStatus, "available");
  assert.equal(value.pricing.changes[0].previousValue, 0.51);
  assert.equal(value.pricing.changes[0].currentValue, 0.54);
  assert.match(value.changes[0].summary, /observed timestamps/);
});

test("zero depth delta is not presented as an observed liquidity change", () => {
  const value = context({ microstructure: { totalDepthChange: { change: 0 } } });
  assert.equal(value.changes.some((change) => change.category === "structure"), false);
});

test("unavailable CLOB and activity stay explicit and placements are not fills", () => {
  const value = context({ snapshot: { dataStatus: "unavailable", message: "RPC unavailable", activity: [], activityStatus: "unavailable" } });
  assert.equal(value.structure.status, "unavailable");
  assert.equal(value.activity.verifiedMatchedTrades, 0);
  assert.match(value.activity.note, /no matched fill was verified/);
  assert.ok(value.uncertainty.some((line) => /RPC unavailable/.test(line)));
});

test("Groq validator rejects invalid evidence, fabricated metrics, prediction, causality and trading advice", () => {
  const value = context();
  const validate = (answer, evidenceIds = ["E1"]) => validateMarketIntelligenceExplanation({ answer, evidenceIds }, value);
  assert.equal(validate("The available source reports an event update, and current market data remains incomplete.")?.evidenceIds[0], "E1");
  assert.equal(validate("The market moved by 12 points and will win.", ["E9"]), null);
  assert.equal(validate("YES will likely win based on the available market context."), null);
  assert.equal(validate("The event caused the price to rise, and this means an outcome will follow."), null);
  assert.equal(validate("You should buy YES given the available context."), null);
});

test("Groq failure or rejected grounding uses deterministic fallback; resolved market skips Groq", async () => {
  const value = context();
  const failed = await synthesizeMarketIntelligence(value, false, async () => { throw new Error("provider down"); });
  assert.equal(failed.explanationMode, "deterministic");
  assert.match(failed.answer, /What remains uncertain/);
  let called = false;
  const resolved = await synthesizeMarketIntelligence(context({ market: market({ status: "resolved" }) }), false, async () => { called = true; return null; });
  assert.equal(called, false);
  assert.equal(resolved.explanationMode, "deterministic");
});

test("persisted quote-denominated fill evidence reaches the existing explanation input while missing fills preserve book analysis", async () => {
  const fills = { source: "persisted-verified-fills", marketId: "m1", eventPda: "event-1", status: "partial", lastScanAt: "2026-10-08T10:02:00.000Z", freshnessStatus: "fresh", observedFrom: "2026-10-08T10:00:00.000Z", observedTo: "2026-10-08T10:01:00.000Z", lastFillAt: "2026-10-08T10:01:00.000Z", verifiedFillCount: 1, metrics: { totalShares: 3, yesFillCount: 1, noFillCount: 0, quoteAssetGroups: [{ status: "verified", mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", symbol: "USDC", decimals: 6, network: "mainnet-beta", source: "on-chain-market-config", fillCount: 1, shareQuantity: 3, priceRange: { min: .5, max: .5 }, latestPrice: .5, firstToLastPriceChange: null, priceObservationFrom: null, priceObservationTo: null, quoteNotional: "1.5", notionalStatus: "calculated", reason: null }] }, coverageStatus: "partial", limitations: ["Historical backfill has not completed; this is an observed sample."], transactions: [{ signature: "historical-fixture-signature", eventIndex: 0, slot: 10, blockTime: "2026-10-08T10:01:00.000Z", outcome: "YES", price: .5, shareQuantity: 3, quoteMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", quoteSymbol: "USDC", quoteStatus: "verified" }] };
  const value = context({ persistedFills: fills, snapshot: { dataStatus: "complete", activity: [], activityStatus: "complete" } });
  assert.equal(value.persistedFills.transactions[0].signature, "historical-fixture-signature");
  assert.equal(value.evidenceReferences.F1, "historical-fixture-signature:0");
  assert.equal(value.dataQuality.sources.find((item) => item.name === "Persisted verified fills")?.status, "partial");
  assert.ok(validateMarketIntelligenceExplanation({ answer: "The recorded evidence describes a verified fill in the retained market sample, with incomplete history and no established outcome implication.", evidenceIds: ["F1"] }, value));
  let modelInput;
  await synthesizeMarketIntelligence(value, false, async ({ data }) => { modelInput = data; return null; });
  assert.equal(modelInput.persistedFills.verifiedFillCount, 1);
  assert.equal(modelInput.persistedFills.metrics.quoteAssetGroups[0].quoteNotional, "1.5");
  assert.match(buildDeterministicMarketIntelligence(value), /1\.5 USDC/);
  const noFills = context({ persistedFills: undefined, snapshot: { dataStatus: "complete", activity: [], activityStatus: "complete" } });
  assert.equal(noFills.structure.status, "complete");
  assert.equal(noFills.persistedFills.status, "unavailable");
});

test("unknown quote denomination keeps share and price evidence without calling it USDC or USD", () => {
  const unknownFills = { source: "persisted-verified-fills", marketId: "m1", eventPda: "event-1", status: "partial", lastScanAt: null, freshnessStatus: "unavailable", observedFrom: null, observedTo: null, lastFillAt: null, verifiedFillCount: 1, metrics: { totalShares: 4, yesFillCount: 1, noFillCount: 0, quoteAssetGroups: [{ status: "unknown", mint: null, symbol: null, decimals: null, network: "mainnet-beta", source: "none", fillCount: 1, shareQuantity: 4, priceRange: { min: .4, max: .4 }, latestPrice: .4, firstToLastPriceChange: null, priceObservationFrom: null, priceObservationTo: null, quoteNotional: null, notionalStatus: "unverified", reason: "Quote mint was not present in the verified instruction." }] }, coverageStatus: "partial", limitations: ["Quote-token identity could not be verified."], transactions: [] };
  const value = context({ persistedFills: unknownFills });
  const answer = buildDeterministicMarketIntelligence(value);
  assert.match(answer, /4 shares/);
  assert.match(answer, /unknown quote-token identity/);
  assert.match(answer, /quote notional unavailable/);
  assert.doesNotMatch(answer, /(?:\$\s*\d|\d+\s+USDC|\d+\s+USD)/i);
});
