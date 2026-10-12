import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("./core.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const core = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`);

const now = Date.parse("2026-10-06T12:00:00.000Z");

test("Panta market normalization preserves real titles and leaves genuinely missing titles explicit", () => {
  const titled = core.normalizePantaMarket({ marketId: "provider-id", title: "Will Bitcoin reach $100,000?", status: "open", phase: "primary", resolved: false });
  assert.equal(titled.question, "Will Bitcoin reach $100,000?");
  assert.equal(titled.id, "provider-id");
  const untitled = core.normalizePantaMarket({ marketId: "provider-id-2", title: "", status: "open", phase: "primary", resolved: false });
  assert.equal(untitled.question, "Market title unavailable");
  assert.equal(untitled.id, "provider-id-2");
});

function market(overrides = {}) {
  return {
    id: "market-1",
    question: "Will the Federal Reserve cut rates?",
    category: "Economy",
    description: "Federal Reserve policy market",
    status: "active",
    yesProbability: 0.5,
    noProbability: 0.5,
    volumeUsd: 1000,
    liquidityUsd: 250,
    priceChange24h: null,
    closeAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-10-06T11:00:00.000Z",
    imageUrl: null,
    history: [],
    relatedMarketIds: [],
    source: "panta",
    ...overrides,
  };
}

test("normalizes documented Panta catalog and detail fields without filling missing values", () => {
  const listed = core.normalizePantaMarket({ marketId: "pda-1", title: "ETH above $5k?", category: "crypto", phase: "primary", status: "open", resolved: false, startTime: 1798000000, endTime: 1798765199, volumeUsdc: "1200.00", yesPrice: null, noPrice: null });
  assert.equal(listed.id, "pda-1");
  assert.equal(listed.question, "ETH above $5k?");
  assert.equal(listed.yesProbability, null);
  assert.equal(listed.noProbability, null);
  assert.equal(listed.liquidityUsd, null);
  assert.equal(listed.primaryPoolLiquidityUsd, null);
  assert.equal(listed.volumeUsd, null, "the raw normalizer does not trust unit-bearing Panta fields as USD before event metadata is verified");
  assert.equal(listed.status, "active");
  assert.equal(listed.startAt, new Date(1798000000 * 1000).toISOString());
  assert.equal(listed.closeAt, new Date(1798765199 * 1000).toISOString());
  const detailed = core.normalizePantaMarket({ marketId: "pda-1", title: "ETH above $5k?", phase: "primary", status: "open", resolved: false, startTime: 1798000000, endTime: 1798765199, volumeUsdc: "1200.00", yesPrice: "0.52", noPrice: "0.48", primaryYesPrice: "0.52", primaryNoPrice: "0.48" });
  assert.equal(detailed.yesProbability, 0.52);
  assert.equal(detailed.noProbability, 0.48);
  assert.equal(detailed.source, "panta");
  const untitled = core.normalizePantaMarket({ marketId: "missing-title", images: ["https://example.invalid/market.jpg"], totalVolumeUsdc: "500", liquidity: "42" });
  assert.equal(untitled.question, "Market title unavailable");
  assert.equal(untitled.imageUrl, "https://example.invalid/market.jpg");
  assert.equal(untitled.volumeUsd, null, "generic volume is not assumed to be USD");
  assert.equal(untitled.liquidityUsd, null, "unverified generic liquidity is unavailable");
  assert.equal(untitled.status, "unknown", "incomplete provider flags never become active by inference");
});

test("maps only authoritatively resolved primary-pool base units and keeps volume and CLOB liquidity separate", async () => {
  const { applyAuthoritativeQuoteMetadata } = await import("../panta/client.ts");
  const detail = core.normalizePantaMarket({ marketId: "pool-market", title: "Resolved market", quoteAsset: "usdc", primaryPoolLamports: "200563692", totalVolumeUsdc: "251.704614", volumeUsdc: "246.704614" });
  assert.equal(detail.primaryPoolLiquidity?.amount, null, "raw quote labels are not trusted before authoritative event resolution");
  const resolved = applyAuthoritativeQuoteMetadata(detail, { id: "pool-market", eventPda: "verified-event-pda", quoteAsset: "usdc" });
  assert.equal(resolved.primaryPoolLiquidity?.amount, 200.563692);
  assert.equal(resolved.primaryPoolLiquidityUsd, null, "USD conversion is unavailable without a timestamped conversion source");
  assert.equal(resolved.volumeUsd, null, "USDC volume does not silently become USD");
  assert.equal(resolved.totalVolumeUsd, null, "USDC total volume is retained separately in quote units");
  assert.equal(resolved.activeVolume?.amount, 246.704614);
  assert.equal(resolved.totalVolume?.amount, 251.704614);
  assert.equal(resolved.liquidityUsd, null, "primary pool does not populate generic liquidity");
  assert.equal(core.normalizePantaMarket({ marketId: "non-usdc", quoteAsset: "sol", primaryPoolLamports: "200563692" }).primaryPoolLiquidity?.amount, null);
  assert.equal(core.normalizePantaMarket({ marketId: "malformed", quoteAsset: "usdc", primaryPoolLamports: "200.5" }).primaryPoolLiquidity?.rawBaseUnits, null);
  assert.equal(core.normalizePantaMarket({ marketId: "missing", quoteAsset: "usdc", totalVolumeUsdc: "251.704614" }).primaryPoolLiquidity?.rawBaseUnits, null);
  assert.equal(core.normalizePantaMarket({ marketId: "no-quote", primaryPoolLamports: "200563692" }).primaryPoolLiquidity?.rawBaseUnits, "200563692");
});

test("secondary prices never fall back to primary-phase prices", () => {
  const secondary = core.normalizePantaMarket({
    marketId: "secondary-price-missing", title: "Secondary event", phase: "secondary", status: "secondary_active", resolved: false,
    primaryYesPrice: "0.83", primaryNoPrice: "0.17", secondaryYesPrice: null, secondaryNoPrice: null,
  });
  assert.equal(secondary.yesProbability, null);
  assert.equal(secondary.noProbability, null);
  const primary = core.normalizePantaMarket({
    marketId: "primary-price-missing", title: "Primary event", phase: "primary", status: "open", resolved: false,
    primaryYesPrice: null, primaryNoPrice: null, secondaryYesPrice: "0.71", secondaryNoPrice: "0.29",
  });
  assert.equal(primary.yesProbability, null);
  assert.equal(primary.noProbability, null);
});

test("untagged secondary price fields are not treated as current provider prices", () => {
  const market = core.normalizePantaMarket({
    marketId: "secondary-untagged-price", title: "Secondary event", phase: "secondary", status: "secondary_active", resolved: false,
    secondaryYesPrice: "0.5", secondaryNoPrice: "0.5",
  });
  assert.equal(market.yesProbability, null);
  assert.equal(market.noProbability, null);
  assert.equal(market.priceProvenance.kind, "unknown");
  const tagged = core.normalizePantaMarket({
    marketId: "secondary-tagged-price", title: "Secondary event", phase: "secondary", status: "secondary_active", resolved: false,
    secondaryYesPrice: "0.516847710", secondaryNoPrice: "0.483152290", priceSource: "secondary_last_trade",
  });
  assert.equal(tagged.yesProbability, 0.51684771);
  assert.equal(tagged.noProbability, 0.48315229);
  assert.equal(tagged.priceProvenance.kind, "last_trade");
});

test("secondary detail status requires an explicit active flag and unresolved state", () => {
  const detail = core.normalizePantaMarket({
    marketId: "secondary-detail", title: "Secondary event", phase: "secondary", status: "secondary",
    isActive: true, isResolved: false, isGraduated: true,
  });
  assert.equal(detail?.status, "active");
  assert.equal(core.normalizePantaMarket({
    marketId: "secondary-detail-inactive", phase: "secondary", status: "secondary", isActive: false, isResolved: false,
  })?.status, "closed");
  assert.equal(core.normalizePantaMarket({
    marketId: "secondary-detail-no-flag", phase: "secondary", status: "secondary", isResolved: false,
  })?.status, "unknown");
  assert.equal(core.normalizePantaMarket({
    marketId: "secondary-detail-no-resolution", phase: "secondary", status: "secondary", isActive: true,
  })?.status, "unknown");
});

test("validates probabilities and preserves a contradictory pair for warnings", () => {
  assert.equal(core.normalizeProbability("52"), 0.52);
  assert.equal(core.normalizeProbability("0.52"), 0.52);
  assert.equal(core.normalizeProbability("101"), null);
  assert.equal(core.normalizeProbability(-0.1), null);
  const snapshot = core.createSnapshot(market({ yesProbability: 0.9, noProbability: 0.9 }), new Date(now).toISOString());
  assert.ok(snapshot.warnings.some((warning) => warning.includes("do not sum")));
  assert.equal(snapshot.dataStatus, "partial");
});

test("calculates signed probability and relative movement only from a timestamped baseline", () => {
  const previous = new Date(now - 24 * 60 * 60_000).toISOString();
  const result = core.calculateMovement(market({ yesProbability: 0.6, history: [{ timestamp: previous, yesProbability: 0.5 }] }), "24h", now);
  assert.ok(Math.abs(result.absoluteChange - 0.1) < 1e-12);
  assert.ok(Math.abs(result.percentageChange - 0.2) < 1e-12);
  assert.equal(result.previousProbability, 0.5);
  assert.equal(result.currentProbability, 0.6);
  assert.equal(core.calculateMovement(market(), "24h", now), null);
  const zeroBaseline = core.calculateMovement(market({ yesProbability: 0.1, history: [{ timestamp: previous, yesProbability: 0 }] }), "24h", now);
  assert.equal(zeroBaseline.percentageChange, null);
});

test("rejects stale or out-of-window price history", () => {
  const stale = new Date(now - 4 * 24 * 60 * 60_000).toISOString();
  assert.equal(core.calculateMovement(market({ history: [{ timestamp: stale, yesProbability: 0.4 }] }), "24h", now), null);
  assert.equal(core.dataStatusForMarket(market({ updatedAt: stale }), now), "partial");
});

test("extracts the supported structured question intents and entities", () => {
  assert.deepEqual(core.extractMarketIntent("What markets are most sensitive to the Fed?").entities, ["Federal Reserve"]);
  assert.equal(core.extractMarketIntent("Compare BTC and ETH probabilities").intent, "probability_comparison");
  assert.equal(core.extractMarketIntent("Show the biggest movers over 24 hours").intent, "biggest_movers");
  assert.equal(core.extractMarketIntent("Find related Bitcoin markets").intent, "related_markets");
  assert.equal(core.extractMarketIntent("What is the impact of CPI?").intent, "event_impact");
  assert.equal(core.extractMarketIntent("Which markets are trending?").intent, "trend_analysis");
  assert.equal(core.extractMarketIntent("Which markets have the highest liquidity?").intent, "liquidity_analysis");
  assert.equal(core.extractMarketIntent("Which markets have the highest volume?").intent, "volume_analysis");
  assert.equal(core.extractMarketIntent("Find markets closing soon").intent, "closing_soon");
  assert.deepEqual(core.extractMarketIntent("Show me sports markets").entities, ["Sports"]);
  assert.deepEqual(core.extractMarketIntent("Compare current Bitcoin and Ethereum probabilities").entities, ["Bitcoin", "Ethereum"]);
});

test("selects distinct current markets for an asset comparison and reports their actual prices", () => {
  const bitcoinOther = market({ id: "btc-older", question: "Will Bitcoin exceed $90,000?", yesProbability: 0.44, noProbability: 0.56, volumeUsd: 500 });
  const bitcoin = market({ id: "btc-current", question: "Will Bitcoin exceed $100,000?", yesProbability: 0.62, noProbability: 0.38, volumeUsd: 5000 });
  const ethereum = market({ id: "eth-current", question: "Will Ethereum exceed $5,000?", yesProbability: 0.49, noProbability: 0.51, volumeUsd: 1800 });
  const selected = core.selectComparisonMarkets([bitcoinOther, bitcoin, ethereum], ["Bitcoin", "Ethereum"]);
  assert.deepEqual([...selected.values()].map((item) => item.id), ["btc-current", "eth-current"]);
  const answer = core.summarizeProbabilityComparison(["Bitcoin", "Ethereum"], selected);
  assert.match(answer, /Bitcoin.*YES 62\.0%, NO 38\.0%/);
  assert.match(answer, /Ethereum.*YES 49\.0%, NO 51\.0%/);
  assert.match(answer, /13\.0 percentage points/);
  assert.match(answer, /not MIRA forecasts/);
});

test("probability comparison states clearly when one asset price is unavailable", () => {
  const selected = new Map([
    ["Bitcoin", market({ question: "Bitcoin market", yesProbability: 0.6 })],
    ["Ethereum", market({ id: "eth", question: "Ethereum market", yesProbability: null, noProbability: 0.4 })],
  ]);
  const answer = core.summarizeProbabilityComparison(["Bitcoin", "Ethereum"], selected);
  assert.match(answer, /YES unavailable/);
  assert.match(answer, /can’t compare both YES prices/);
});

test("current probability comparisons explain when matching Panta markets are resolved", () => {
  const resolved = [
    market({ id: "btc-resolved", question: "Will Bitcoin hit $85k?", status: "resolved" }),
    market({ id: "eth-resolved", question: "Will ETH be above $5k?", status: "resolved" }),
  ];
  const answer = core.summarizeUnavailableComparison(["Bitcoin", "Ethereum"], resolved);
  assert.match(answer, /Bitcoin and Ethereum market matches, but they are resolved/);
  assert.match(answer, /excluded their final prices/);
  assert.match(answer, /no open matching markets/);
});

test("ranks by semantic relevance, measured movement, and available liquidity", () => {
  const fed = market({ id: "fed", question: "Federal Reserve rate decision" });
  const bitcoin = market({ id: "btc", question: "Bitcoin above $120,000?", category: "Crypto", description: "Digital asset market" });
  assert.ok(core.semanticRelevance("markets sensitive to the Fed", fed) > core.semanticRelevance("markets sensitive to the Fed", bitcoin));
  const movers = core.rankMarkets("biggest movers", [fed, bitcoin], [
    { marketId: "fed", percentageChange: 0.1, absoluteChange: 0.05 },
    { marketId: "btc", percentageChange: -0.3, absoluteChange: -0.1 },
  ], core.extractMarketIntent("biggest movers"), now);
  assert.equal(movers[0].marketId, "btc");
  const liquidity = core.rankMarkets("highest liquidity", [fed, bitcoin], [], core.extractMarketIntent("highest liquidity"), now);
  assert.equal(liquidity.length, 2);
  assert.equal(core.rankMarkets("highest liquidity", [market({ liquidityUsd: null })], [], core.extractMarketIntent("highest liquidity"), now)[0].signals.includes("provider liquidity available"), false);
  const volume = core.rankMarkets("highest volume", [fed, bitcoin], [], core.extractMarketIntent("highest volume"), now);
  assert.equal(volume[0].marketId, "fed");
  const volumeBiased = market({ id: "popular-unrelated", question: "Will a movie win an award?", volumeUsd: 900_000_000 });
  assert.equal(core.rankMarkets("Bitcoin markets", [volumeBiased, bitcoin], [], core.extractMarketIntent("Bitcoin markets"), now)[0].marketId, "btc");
  assert.equal(core.rankMarkets("highest volume", [volumeBiased, bitcoin], [], core.extractMarketIntent("highest volume"), now)[0].marketId, "popular-unrelated");
});

test("ranks closing markets by the next real future close and keeps missing dates last", () => {
  const later = market({ id: "later", closeAt: "2026-10-10T00:00:00.000Z" });
  const soon = market({ id: "soon", closeAt: "2026-10-06T13:00:00.000Z" });
  const absent = market({ id: "absent", closeAt: null });
  const ranked = core.rankMarkets("markets closing soon", [later, absent, soon], [], core.extractMarketIntent("markets closing soon"), now);
  assert.deepEqual(ranked.map((item) => item.marketId), ["soon", "later", "absent"]);
});

test("keeps resolved markets below current markets in ranked results", () => {
  const resolved = market({ id: "resolved", status: "resolved", question: "Bitcoin price market" });
  const active = market({ id: "active", status: "active", question: "Bitcoin price market" });
  const ranked = core.rankMarkets("Bitcoin", [resolved, active], [], core.extractMarketIntent("Bitcoin"), now);
  assert.deepEqual(ranked.map((item) => item.marketId), ["active", "resolved"]);
});

test("scores provider links and transparent topic relationships without claiming causation", () => {
  const fed = market({ id: "fed", relatedMarketIds: ["cpi"] });
  const cpi = market({ id: "cpi", question: "Will inflation fall below 3%?", category: "Economy" });
  const bitcoin = market({ id: "btc", question: "Will Bitcoin exceed $120k?", category: "Crypto" });
  const edges = core.buildRelatedMarkets([fed, cpi, bitcoin], core.extractMarketIntent("Fed and inflation markets"));
  assert.equal(edges.find((edge) => edge.marketId === "fed" && edge.relatedMarketId === "cpi").relationship, "provider_link");
  assert.ok(edges.find((edge) => edge.marketId === "fed" && edge.relatedMarketId === "cpi").relevanceScore > 0.9);
  assert.ok(edges.every((edge) => !/caused|causes/i.test(edge.explanation) || /does not establish causation/i.test(edge.explanation)));
});

test("reports demo, live, partial, and unavailable data status", () => {
  assert.equal(core.dataStatusForMarket(market({ source: "demo" }), now), "demo");
  assert.equal(core.dataStatusForMarket(market(), now), "live");
  assert.equal(core.dataStatusForMarket(market({ liquidityUsd: null }), now), "live");
  assert.equal(core.dataStatusForMarket(market({ updatedAt: null }), now), "partial");
  assert.equal(core.dataStatusForMarket(market({ volumeUsd: null }), now), "partial");
  assert.equal(core.dataStatusForMarket(market({ yesProbability: null }), now), "partial");
  assert.equal(core.createSnapshot(market(), new Date(now).toISOString()).source, "panta");
  assert.equal(core.createSnapshot(market({ volumeUsd: null }), new Date(now).toISOString()).dataStatus, "partial");
  const missing = core.createEmptyAnalysisResult("Fed sensitivity", core.extractMarketIntent("Fed sensitivity"), "panta", now);
  assert.equal(missing.dataStatus, "unavailable");
  assert.equal(missing.confidence, "insufficient");
  assert.deepEqual(missing.markets, []);
});

test("does not infer price, volume, or movement when Panta fields and history are absent", () => {
  const sparse = market({ yesProbability: null, noProbability: null, volumeUsd: null, priceChange24h: 0.25, history: [] });
  assert.equal(core.calculateMovement(sparse, "24h", now), null);
  assert.equal(core.dataStatusForMarket(sparse, now), "partial");
  assert.equal(core.rankMarkets("highest volume", [sparse], [], core.extractMarketIntent("highest volume"), now)[0].signals.includes("provider volume available"), false);
});

test("handles one market, missing fields, and category-only related context", () => {
  const one = market({ id: "one", noProbability: null, volumeUsd: null, liquidityUsd: null, history: [] });
  const snapshot = core.createSnapshot(one, new Date(now).toISOString());
  assert.equal(snapshot.dataStatus, "partial");
  assert.ok(snapshot.warnings.some((warning) => warning.includes("volume")));
  assert.ok(snapshot.warnings.some((warning) => warning.includes("liquidity")));
  assert.equal(core.rankMarkets("Federal Reserve", [one], [], undefined, now).length, 1);
  assert.deepEqual(core.buildRelatedMarkets([one], core.extractMarketIntent("Federal Reserve")), []);
  const neighbor = market({ id: "two", question: "Another event", description: "", category: "Economy" });
  const categoryEdge = core.buildRelatedMarkets([one, neighbor], core.extractMarketIntent("Federal Reserve"))[0];
  assert.equal(categoryEdge.relationship, "category_overlap");
  assert.match(categoryEdge.explanation, /does not imply/);
});
