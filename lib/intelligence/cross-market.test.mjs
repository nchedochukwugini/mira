import test from "node:test";
import assert from "node:assert/strict";
import { buildCrossMarketReport, classifyEvidenceTiming, mergeMarketHistory, mergeSnapshotObservation } from "./cross-market.ts";
import { buildCrossMarketGroundingContext, createCrossMarketExplanation, validateCrossMarketExplanation } from "./cross-market-explanation.ts";

const market = (id, question, overrides = {}) => ({
  id, question, category: "economics", description: null, status: "active", yesProbability: 0.5, noProbability: 0.5,
  volumeUsd: null, liquidityUsd: null, priceChange24h: null, closeAt: null, updatedAt: null, imageUrl: null,
  history: [], relatedMarketIds: [], source: "panta", ...overrides,
});
const history = (prices, start = Date.parse("2026-10-01T12:00:00Z"), step = 5 * 60_000) => prices.map((yesProbability, index) => ({ timestamp: new Date(start + index * step).toISOString(), yesProbability }));

test("provider links and shared definitions establish relationship reasons", () => {
  const a = market("a", "Will Bitcoin exceed $120,000?", { relatedMarketIds: ["b"] });
  const b = market("b", "Will Bitcoin exceed $125,000?", { category: "crypto" });
  const result = buildCrossMarketReport({ primaryMarket: a, relatedMarkets: [b] }).relatedMarkets[0];
  assert.equal(result.relationship.type, "closely-related");
  assert.match(result.relationship.reasons.join(" "), /provider explicitly links/i);
});

test("opposing outcome language is separated from movement and date mismatch is reported", () => {
  const a = market("a", "Will the Fed cut rates in October?", { closeAt: "2026-10-15T00:00:00Z" });
  const b = market("b", "Will the Fed hold rates in October?", { closeAt: "2026-12-31T00:00:00Z" });
  const result = buildCrossMarketReport({ primaryMarket: a, relatedMarkets: [b] }).relatedMarkets[0];
  assert.equal(result.relationship.type, "opposing");
  assert.ok(result.relationship.reasons.some((item) => /resolution dates differ/i.test(item)));
});

test("aligned and divergent changes require timestamp overlap", () => {
  const a = market("a", "Bitcoin reaches 120k", { history: history([0.4, 0.43, 0.47]) });
  const b = market("b", "Bitcoin ETF inflows rise", { history: history([0.3, 0.32, 0.35]) });
  assert.equal(buildCrossMarketReport({ primaryMarket: a, relatedMarkets: [b] }).relatedMarkets[0].movement.status, "aligned");
  const c = market("c", "Bitcoin ETF inflows fall", { history: history([0.6, 0.57, 0.52]) });
  assert.equal(buildCrossMarketReport({ primaryMarket: a, relatedMarkets: [c] }).relatedMarkets[0].movement.status, "divergent");
});

test("insufficient observations and non-overlapping times do not establish movement", () => {
  const a = market("a", "Will Bitcoin rise?", { history: history([0.4, 0.5]) });
  const b = market("b", "Will Ethereum rise?", { history: history([0.4, 0.5], Date.parse("2026-10-03T12:00:00Z")) });
  const result = buildCrossMarketReport({ primaryMarket: a, relatedMarkets: [b] }).relatedMarkets[0];
  assert.equal(result.movement.status, "insufficient");
  assert.equal(result.movement.dataStatus, "limited");
  assert.equal(result.movement.timingAlignment.status, "non-overlapping");
});

test("invalid or absent timestamps are ignored and resolved data is historical", () => {
  const a = market("a", "Will Bitcoin rise?", { status: "resolved", history: [{ timestamp: "n/a", yesProbability: 0.3 }] });
  const b = market("b", "Will crypto rise?");
  const result = buildCrossMarketReport({ primaryMarket: a, relatedMarkets: [b] }).relatedMarkets[0];
  assert.equal(result.market.observationCount, 0);
  assert.ok(result.uncertainty.some((item) => /resolved/i.test(item)));
  assert.equal(result.movement.status, "insufficient");
});

test("market definitions remain visibly incomplete when provider omits criteria", () => {
  const a = market("a", "Will Bitcoin exceed $120,000 by December 31?");
  const b = market("b", "Will Bitcoin exceed $120,000 at any point before December 31?");
  const result = buildCrossMarketReport({ primaryMarket: a, relatedMarkets: [b] }).relatedMarkets[0];
  assert.notEqual(result.relationship.type, "equivalent");
  assert.equal(result.market.yesDefinition, null);
  assert.ok(result.uncertainty.some((item) => /criteria are unavailable/i.test(item)));
});

test("report does not infer causal claims or probabilities for another market", () => {
  const a = market("a", "Will Bitcoin rise?", { history: history([0.3, 0.35, 0.39]) });
  const b = market("b", "Will Ethereum rise?", { history: history([0.4, 0.44, 0.48]) });
  const report = buildCrossMarketReport({ primaryMarket: a, relatedMarkets: [b] });
  assert.equal("causalEvidence" in report.relatedMarkets[0], false);
  assert.equal("predictedProbability" in report.relatedMarkets[0], false);
  assert.equal(report.relatedMarkets[0].movement.dataStatus, "sufficient");
});

test("stored snapshot observations merge by real timestamp without interpolating gaps", () => {
  const initial = market("a", "Will Bitcoin rise?", { history: history([0.4, 0.43]) });
  const merged = mergeMarketHistory(initial, [
    { timestamp: "2026-10-01T12:05:00.000Z", yesProbability: 0.45 },
    { timestamp: "2026-10-01T12:30:00.000Z", yesProbability: 0.5 },
  ]);
  assert.equal(merged.history.length, 3);
  assert.deepEqual(merged.history.map((point) => point.timestamp), ["2026-10-01T12:00:00.000Z", "2026-10-01T12:05:00.000Z", "2026-10-01T12:30:00.000Z"]);
});

test("duplicate snapshots collapse and irregular real observations remain intact", () => {
  const merged = mergeMarketHistory(market("a", "Bitcoin"), [
    { timestamp: "2026-10-01T12:00:00Z", yesProbability: 0.4 },
    { timestamp: "2026-10-01T12:00:00Z", yesProbability: 0.41 },
    { timestamp: "2026-10-01T12:47:00Z", yesProbability: 0.45 },
  ]);
  assert.equal(merged.history.length, 2);
  assert.equal(merged.history[1].timestamp, "2026-10-01T12:47:00Z");
});

test("current CLOB quote is included only with its real observation timestamp", () => {
  const base = market("a", "Bitcoin", { history: history([0.4, 0.45]) });
  const merged = mergeSnapshotObservation(base, { pantaReference: { yesPrice: 0.5, noPrice: 0.5, observedAt: "2026-10-01T12:15:00Z" } });
  assert.equal(merged.yesProbability, 0.5);
  assert.equal(merged.history.length, 3);
  const missing = mergeSnapshotObservation(base, { pantaReference: { yesPrice: 0.5, noPrice: 0.5, observedAt: null } });
  assert.equal(missing.history.length, 2);
});

test("evidence timing separates undated publication from an unavailable movement window", () => {
  const start = Date.parse("2026-10-01T12:00:00Z");
  const end = Date.parse("2026-10-01T13:00:00Z");
  assert.equal(classifyEvidenceTiming(null, start, end), "undated");
  assert.equal(classifyEvidenceTiming("2026-10-01T12:30:00Z", null, null), "unknown");
  assert.equal(classifyEvidenceTiming("2026-10-01T11:30:00Z", start, end), "before_move");
  assert.equal(classifyEvidenceTiming("2026-10-01T12:30:00Z", start, end), "during_move");
  assert.equal(classifyEvidenceTiming("2026-10-01T13:30:00Z", start, end), "after_move");
});

test("same-window explicit opposite outcomes are strong only with identical definitions", () => {
  const a = market("a", "Will the Fed cut rates?", { description: "Fed decision in October", closeAt: "2026-10-31T00:00:00Z" });
  const b = market("b", "Will the Fed not cut rates?", { description: "Fed decision in October", closeAt: "2026-10-31T00:00:00Z" });
  const result = buildCrossMarketReport({ primaryMarket: a, relatedMarkets: [b] }).relatedMarkets[0];
  assert.equal(result.contradictionStrength, "strong");
  assert.match(result.contradictions.join(" "), /mutually exclusive outcomes/i);
});

test("different resolution windows or definitions keep opposite wording potential", () => {
  const a = market("a", "Will the Fed cut rates?", { description: "Fed decision in October", closeAt: "2026-10-31T00:00:00Z" });
  const b = market("b", "Will the Fed not cut rates?", { description: "Fed decision in December", closeAt: "2026-12-31T00:00:00Z" });
  const result = buildCrossMarketReport({ primaryMarket: a, relatedMarkets: [b] }).relatedMarkets[0];
  assert.equal(result.contradictionStrength, "potential");
  assert.ok(result.contradictions.some((item) => /different resolution dates/i.test(item)));
});

test("grounding accepts only mapped evidence IDs and rejects unsupported numeric and causal claims", () => {
  const report = buildCrossMarketReport({ primaryMarket: market("a", "Bitcoin rises"), relatedMarkets: [market("b", "Bitcoin falls")] });
  const allowed = new Set(["E1"]);
  const base = { summary: "These markets are compared.", relationshipExplanation: "They are related by the shared Bitcoin topic.", movementExplanation: "Movement is insufficient.", evidenceExplanation: "Source E1 is undated.", uncertainty: ["Timing cannot be established."], evidenceIds: ["E1"] };
  assert.ok(validateCrossMarketExplanation(base, allowed, report));
  assert.equal(validateCrossMarketExplanation({ ...base, evidenceIds: ["E99"] }, allowed, report), null);
  assert.equal(validateCrossMarketExplanation({ ...base, movementExplanation: "Bitcoin rose 73 percent." }, allowed, report), null);
  assert.equal(validateCrossMarketExplanation({ ...base, summary: "The Fed caused Bitcoin to rise." }, allowed, report), null);
});

test("Groq grounding context contains only report, bounded evidence, mapped IDs, and verified market state", () => {
  const report = buildCrossMarketReport({ primaryMarket: market("a", "Bitcoin rises"), relatedMarkets: [] });
  const context = buildCrossMarketGroundingContext(report, [], [{ marketId: "a", status: "unavailable" }]);
  assert.deepEqual(context.allowedEvidenceIds, []);
  assert.deepEqual(context.verifiedMarketState, [{ marketId: "a", status: "unavailable" }]);
  assert.equal("database" in context, false);
});

test("valid grounded Groq explanation maps compact evidence IDs", async () => {
  const report = buildCrossMarketReport({ primaryMarket: market("a", "Bitcoin rises"), relatedMarkets: [market("b", "Bitcoin outlook")] });
  const evidence = [{ id: "source-row-1", title: "Bitcoin report", source: "example.com", domain: "example.com", url: "https://example.com/report", publishedAt: null, retrievedAt: "2026-10-07T10:00:00Z", summary: "A report discusses Bitcoin.", claim: "A report discusses Bitcoin.", direction: "neutral", relevance: "medium", reliability: "medium", reliabilityReason: "test", evidenceType: "reporting", pageRetrieved: true, freshness: "undated" }];
  const generated = { summary: "Compared the two supplied markets.", relationshipExplanation: `They are ${report.relatedMarkets[0].relationship.type} with ${report.relatedMarkets[0].relationship.confidence} confidence.`, movementExplanation: `Movement is ${report.relatedMarkets[0].movement.status}.`, evidenceExplanation: "E1 is undated, so its timing is unknown.", uncertainty: ["The evidence does not establish causation."], evidenceIds: ["E1"] };
  const result = await createCrossMarketExplanation({ report, evidence, generate: async (input) => input.validate(generated) });
  assert.equal(result.mode, "groq");
  assert.deepEqual(result.explanation.evidenceIds, ["E1"]);
  const omitted = await createCrossMarketExplanation({ report, evidence, generate: async (input) => input.validate({ ...generated, evidenceIds: [] }) });
  assert.equal(omitted.mode, "deterministic");
  assert.deepEqual(omitted.explanation.evidenceIds, ["E1"]);
  assert.match(omitted.explanation.evidenceExplanation, /supplied research sources/i);
});

test("invalid evidence IDs, unsupported claims, malformed output, and Groq failure use deterministic fallback", async () => {
  const report = buildCrossMarketReport({ primaryMarket: market("a", "Bitcoin rises"), relatedMarkets: [market("b", "Bitcoin outlook")] });
  const generated = { summary: "Compared the supplied markets.", relationshipExplanation: "The markets are related.", movementExplanation: "Movement is insufficient.", evidenceExplanation: "No external evidence was supplied.", uncertainty: [], evidenceIds: [] };
  const mock = (value) => async (input) => input.validate(value);
  for (const generate of [
    mock({ ...generated, evidenceIds: ["E99"] }),
    mock({ ...generated, summary: "The Fed caused Bitcoin to rise by 79 percent." }),
    mock({ summary: "malformed" }),
    async () => { throw new Error("Groq unavailable"); },
  ]) {
    const result = await createCrossMarketExplanation({ report, generate });
    assert.equal(result.mode, "deterministic");
    assert.ok(result.explanation.movementExplanation.length > 0);
  }
});
