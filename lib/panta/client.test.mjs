import test from "node:test";
import assert from "node:assert/strict";
process.env.PANTA_API_KEY ??= "pk_test_panta-client-test";
const { applyAuthoritativeQuoteMetadata, mergeMarketCatalogQuotes, pantaTransportFailure, PantaClient } = await import("./client.ts");

const market = (overrides = {}) => ({
  id: "panta-market", question: "Will this resolve?", category: "test", description: null,
  status: "active", yesProbability: null, noProbability: null, volumeUsd: null, totalVolumeUsd: null,
  liquidityUsd: null, primaryPoolLiquidityUsd: null, priceChange24h: null, closeAt: null, updatedAt: null,
  imageUrl: null, history: [], relatedMarketIds: [], source: "panta", ...overrides,
});

test("Panta timeout and caller cancellation keep distinct, safe transport results", () => {
  assert.deepEqual(pantaTransportFailure(new DOMException("private upstream detail", "TimeoutError")), { message: "Panta API request timed out.", status: 504 });
  assert.deepEqual(pantaTransportFailure(new DOMException("aborted", "AbortError")), { message: "Panta API request was cancelled.", status: 499 });
  assert.deepEqual(pantaTransportFailure(new Error("secret upstream detail")), { message: "Could not reach the Panta API.", status: 502 });
});

test("authoritative quote resolution preserves SOL authority and diagnoses a conflicting legacy USDC label", async () => {
  const { normalizePantaMarket } = await import("../intelligence/core.ts");
  const raw = normalizePantaMarket({ marketId: "market-sol", quoteAsset: "usdc", primaryPoolLamports: "11547196079", volumeUsdc: "11047.196079", totalVolumeUsdc: "11547.196079", yesPrice: "0.372", noPrice: "0.628", priceSource: "secondary_last_trade" });
  const result = applyAuthoritativeQuoteMetadata(raw, { eventPda: "market-sol", quoteAsset: "sol" }, "2026-10-10T15:00:00.000Z");
  assert.equal(result.quoteAsset, "SOL");
  assert.equal(result.quoteAssetResolution?.status, "conflict");
  assert.equal(result.quoteAssetResolution?.rawProvider, "usdc");
  assert.equal(result.primaryPoolLiquidity?.amount, 11.547196079);
  assert.equal(result.primaryPoolLiquidity?.asset, "SOL");
  assert.equal(result.primaryPoolLiquidityUsd, null);
  assert.equal(result.volumeUsd, null);
  assert.equal(result.activeVolume?.amount, null, "a conflicting *_Usdc field is not relabeled as SOL");
  assert.equal(result.yesProbability, null, "legacy last-trade prices do not become probabilities for SOL markets");
  assert.equal(result.pantaPrices?.yes, null, "price units are unavailable while quote metadata conflicts");
});

test("verified SOL markets preserve quote-denominated inline observations", async () => {
  const { normalizePantaMarket } = await import("../intelligence/core.ts");
  const point = { timestamp: "2026-10-10T14:00:00.000Z", yesProbability: 0.42 };
  const raw = normalizePantaMarket({ marketId: "market-sol-history", quoteAsset: "sol", history: [point] });
  const resolved = applyAuthoritativeQuoteMetadata(raw, { eventPda: raw.id, quoteAsset: "SOL" });
  assert.equal(resolved.quoteAsset, "SOL");
  assert.deepEqual(resolved.history, [point]);
});

test("authoritative registry joins the Panta UUID to its distinct Solana Event PDA", async () => {
  const { normalizePantaMarket } = await import("../intelligence/core.ts");
  const market = normalizePantaMarket({ marketId: "2fb6c4bb-1800-493d-b67c-91ca4bb8bd59", quoteAsset: "usdc" });
  const resolved = applyAuthoritativeQuoteMetadata(market, { id: market.id, eventPda: "CfGvLVSf5jnUoFCX2bTbsYANgVCtb6DiztHPSkc39yjq", title: "Registry title", creatorAddress: "Registry creator", quoteAsset: "sol" });
  assert.equal(resolved.pantaEventPda, "CfGvLVSf5jnUoFCX2bTbsYANgVCtb6DiztHPSkc39yjq");
  assert.equal(resolved.pantaEventRegistryTitle, "Registry title");
  assert.equal(resolved.pantaEventRegistryCreator, "Registry creator");
  assert.equal(resolved.quoteAsset, "SOL");
  assert.equal(resolved.quoteAssetResolution?.status, "conflict");
});

test("USDC pool and volume keep token units; USD requires an explicit timestamped conversion", async () => {
  const { normalizePantaMarket } = await import("../intelligence/core.ts");
  const raw = normalizePantaMarket({ marketId: "market-usdc", quoteAsset: "usdc", primaryPoolLamports: "200563692", volumeUsdc: "246.704614", totalVolumeUsdc: "251.704614" });
  const resolved = applyAuthoritativeQuoteMetadata(raw, { eventPda: "market-usdc", quoteAsset: "USDC" }, "2026-10-10T15:00:00.000Z");
  assert.equal(resolved.primaryPoolLiquidity?.amount, 200.563692);
  assert.equal(resolved.primaryPoolLiquidity?.asset, "USDC");
  assert.equal(resolved.primaryPoolLiquidityUsd, null);
  assert.equal(resolved.activeVolume?.amount, 246.704614);
  assert.equal(resolved.totalVolume?.amount, 251.704614);
  assert.equal(resolved.volumeUsd, null);
  const converted = applyAuthoritativeQuoteMetadata({ ...raw, usdConversion: { usdPerQuote: 1, source: "verified fixture rate", observedAt: new Date(Date.now() - 1_000).toISOString() } }, { eventPda: "market-usdc", quoteAsset: "usdc" });
  assert.equal(converted.primaryPoolLiquidityUsd, 200.563692);
  assert.equal(converted.volumeUsd, 246.704614);
});

test("missing, unsupported, stale and mismatched authoritative quote metadata never trusts the legacy value", async () => {
  const { normalizePantaMarket } = await import("../intelligence/core.ts");
  const raw = normalizePantaMarket({ marketId: "market-x", quoteAsset: "usdc", primaryPoolLamports: "1000000" });
  for (const metadata of [null, { eventPda: "other", quoteAsset: "sol" }, { eventPda: "market-x", quoteAsset: "BTC" }, { eventPda: "market-x" }]) {
    const value = applyAuthoritativeQuoteMetadata(raw, metadata);
    assert.equal(value.quoteAsset, null);
    assert.ok(["unresolved", "unsupported"].includes(value.quoteAssetResolution?.status ?? ""));
    assert.equal(value.yesProbability, null, "unresolved quote metadata never leaves an unlabeled price visible");
    assert.equal(value.pantaPrices?.yes, null);
    assert.deepEqual(value.history, []);
    assert.equal(value.primaryPoolLiquidity?.amount, null);
    assert.equal(value.primaryPoolLiquidityUsd, null);
  }
  const stale = applyAuthoritativeQuoteMetadata({ ...raw, usdConversion: { usdPerQuote: 1, source: "old", observedAt: "2020-01-01T00:00:00.000Z" } }, { eventPda: "market-x", quoteAsset: "usdc" });
  assert.equal(stale.primaryPoolLiquidityUsd, null);
});

test("market detail fills missing provider fields from the matching Panta catalog row", () => {
  const detail = market({ yesProbability: 0.61 });
  const catalog = market({ imageUrl: "https://images.example.invalid/catalog.jpg", yesProbability: 0.63, noProbability: 0.37, volumeUsd: 318, liquidityUsd: 42, updatedAt: "2026-10-08T10:00:00.000Z", history: [{ timestamp: "2026-10-08T09:00:00.000Z", yesProbability: 0.6 }] });
  const merged = mergeMarketCatalogQuotes(detail, catalog);
  assert.equal(merged.yesProbability, null, "conflicting endpoint quotes remain unavailable");
  assert.equal(merged.noProbability, 0.37, "missing detail quote uses provider catalog value");
  assert.equal(merged.volumeUsd, 318);
  assert.equal(merged.totalVolumeUsd, null);
  assert.equal(merged.liquidityUsd, 42);
  assert.equal(merged.updatedAt, "2026-10-08T10:00:00.000Z");
  assert.equal(merged.history[0]?.yesProbability, 0.6);
  assert.equal(merged.imageUrl, "https://images.example.invalid/catalog.jpg", "a missing detail image falls back to the matching catalog image");
  assert.equal(mergeMarketCatalogQuotes(market({ imageUrl: "https://images.example.invalid/detail.jpg" }), catalog).imageUrl, "https://images.example.invalid/detail.jpg", "a detail image takes precedence when present");
  assert.equal(mergeMarketCatalogQuotes(detail, undefined).noProbability, null, "no catalog value remains unavailable");
});

test("complete market details still recover an image omitted by the detail endpoint", async () => {
  const originalFetch = globalThis.fetch;
  const marketId = "primary-image-market";
  const detailRow = {
    marketId, title: "Will this primary market resolve?", category: "Crypto", phase: "primary",
    status: "active", resolved: false, startTime: Math.floor(Date.now() / 1000) - 60,
    endTime: Math.floor(Date.now() / 1000) + 86_400, quoteAsset: "usdc", yesPrice: "0.52", noPrice: "0.48",
  };
  const catalogRow = { ...detailRow, imageUrl: "https://images.example.invalid/primary-market.jpg" };
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.hostname === "production-api.balr.fun") return new Response(JSON.stringify([{ eventPda: marketId, quoteAsset: "usdc" }]), { status: 200 });
    if (url.pathname === `/api/v1/markets/${marketId}/`) return new Response(JSON.stringify(detailRow), { status: 200 });
    if (url.pathname === "/api/v1/markets/") return new Response(JSON.stringify({ items: [catalogRow], nextCursor: null }), { status: 200 });
    throw new Error(`Unexpected Panta test request: ${url.pathname}`);
  };
  try {
    const result = await new PantaClient().getMarket(marketId);
    assert.equal(result?.yesProbability, 0.52, "the complete detail prices are preserved");
    assert.equal(result?.imageUrl, "https://images.example.invalid/primary-market.jpg");
  } finally { globalThis.fetch = originalFetch; }
});

test("market catalog title fills a missing detail title without inventing descriptive data", () => {
  const detail = market({ question: "Market title unavailable" });
  const titledCatalog = market({ question: "Will Bitcoin reach $100,000?" });
  assert.equal(mergeMarketCatalogQuotes(detail, titledCatalog).question, titledCatalog.question);
  assert.equal(mergeMarketCatalogQuotes(market(), market({ question: "Market title unavailable" })).question, "Will this resolve?");
  const incomplete = market({ question: "Market title unavailable" });
  assert.equal(mergeMarketCatalogQuotes(incomplete, market({ question: "Market title unavailable" })).question, "Market title unavailable");
});

test("catalog discovery resolves current secondary fields from detail and keeps conflicting volume unknown", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const catalogRow = {
    marketId: "secondary-market", title: "Will this happen?", category: "Sports", phase: "secondary",
    status: "secondary_active", resolved: false, volumeUsdc: "0.00", yesPrice: null, noPrice: null,
    startTime: 1791396646, endTime: 1999999999,
  };
  const detailRow = {
    ...catalogRow, status: "secondary", volumeUsdc: "318.036406", yesPrice: "0.51684771", noPrice: "0.48315229",
    secondaryYesPrice: "516847710", secondaryNoPrice: "483152290", isGraduated: true,
    programId: "6gM5afTQBq5VZCfgpGqcsqzfWd5maLSCKWtGjbEobZMp",
  };
  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("production-api.balr.fun/api/v1/events")) return new Response(JSON.stringify([{ eventPda: "secondary-market", quoteAsset: "usdc" }]), { status: 200 });
    const payload = url.includes("/markets/secondary-market/") ? detailRow : { items: [catalogRow], nextCursor: null };
    return new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const discovered = await new PantaClient().discoverMarkets();
    assert.equal(calls.length, 3, "one official event metadata fetch and one bounded detail lookup supplement discovery");
    assert.equal(discovered[0]?.yesProbability, 0.51684771);
    assert.equal(discovered[0]?.noProbability, 0.48315229);
    assert.equal(discovered[0]?.volumeUsd, null, "conflicting endpoint volume is not silently selected");
    assert.equal(discovered[0]?.status, "active", "detail status is corroborated by the matching active catalog status");
    assert.equal(discovered[0]?.pantaSecondaryActive, true);
    assert.equal(discovered[0]?.pantaIsGraduated, true);
    assert.equal(discovered[0]?.pantaProgramId, detailRow.programId);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("catalog cards receive bounded cached primary-pool detail enrichment without changing volume", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const catalogRow = { marketId: "pool-card", title: "Resolved pool market", phase: "primary", status: "resolved", resolved: true, volumeUsdc: "246.704614", totalVolumeUsdc: "251.704614", quoteAsset: "usdc" };
  const detailRow = { ...catalogRow, primaryPoolLamports: "200563692" };
  globalThis.fetch = async (input) => {
    const url = String(input); calls.push(url);
    if (url.includes("production-api.balr.fun/api/v1/events")) return new Response(JSON.stringify([{ eventPda: "pool-card", quoteAsset: "usdc" }]), { status: 200 });
    const payload = url.includes("/markets/pool-card/") ? detailRow : { items: [catalogRow], nextCursor: null };
    return new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const client = new PantaClient();
    const first = await client.discoverMarkets();
    const second = await client.discoverMarkets();
    assert.equal(first[0]?.primaryPoolLiquidity?.amount, 200.563692);
    assert.equal(first[0]?.primaryPoolLiquidityUsd, null, "USDC is kept in quote units unless a timestamped conversion is supplied");
    assert.equal(first[0]?.activeVolume?.amount, 246.704614);
    assert.equal(first[0]?.totalVolume?.amount, 251.704614);
    assert.equal(first[0]?.volumeUsd, null);
    assert.equal(first[0]?.liquidityUsd, null);
    assert.equal(second[0]?.primaryPoolLiquidity?.amount, 200.563692);
    assert.equal(calls.filter((url) => url.includes("/markets/pool-card/")).length, 1, "detail enrichment is cached");
  } finally { globalThis.fetch = originalFetch; }
});

test("catalog detail failures leave primary-pool liquidity unavailable", async () => {
  const originalFetch = globalThis.fetch;
  let detailCalls = 0;
  globalThis.fetch = async (input) => {
    if (String(input).includes("production-api.balr.fun/api/v1/events")) return new Response(JSON.stringify([{ eventPda: "failing-pool", quoteAsset: "usdc" }]), { status: 200 });
    if (String(input).includes("/markets/failing-pool/")) { detailCalls += 1; return new Response("unavailable", { status: 503 }); }
    return new Response(JSON.stringify({ items: [{ marketId: "failing-pool", title: "Pool market", phase: "primary", status: "resolved", resolved: true, quoteAsset: "usdc", volumeUsdc: "10" }], nextCursor: null }), { status: 200 });
  };
  try {
    const client = new PantaClient();
    const discovered = await client.discoverMarkets();
    await client.discoverMarkets();
    assert.equal(discovered[0]?.primaryPoolLiquidityUsd, null);
    assert.equal(discovered[0]?.activeVolume?.amount, 10);
    assert.equal(detailCalls, 1, "failed detail enrichment is cached briefly");
  } finally { globalThis.fetch = originalFetch; }
});

test("catalog enrichment never exceeds the existing sixteen-detail request bound", { concurrency: false }, async () => {
  const originalFetch = globalThis.fetch;
  const rows = Array.from({ length: 20 }, (_, index) => ({ marketId: `bounded-${index}`, title: `Market ${index}`, phase: "primary", status: "resolved", resolved: true, quoteAsset: "usdc" }));
  let detailCalls = 0;
  const requestedUrls = [];
  globalThis.fetch = async (input) => {
    requestedUrls.push(String(input));
    if (String(input).includes("production-api.balr.fun/api/v1/events")) return new Response(JSON.stringify(rows.map(({ marketId }) => ({ eventPda: marketId, quoteAsset: "usdc" }))), { status: 200 });
    if (String(input).includes("/markets/?limit=50")) return new Response(JSON.stringify({ items: rows, nextCursor: null }), { status: 200 });
    detailCalls += 1;
    const id = String(input).match(/markets\/(bounded-\d+)\//)?.[1];
    return new Response(JSON.stringify({ marketId: id, phase: "primary", quoteAsset: "usdc", primaryPoolLamports: "1000000" }), { status: 200 });
  };
  try {
    const discovered = await new PantaClient().discoverMarkets();
    assert.equal(detailCalls, 16, `requests were: ${requestedUrls.join(", ")}`);
    assert.equal(discovered.filter((item) => item.primaryPoolLiquidity?.amount === 1).length, 16, "USDC base units use six decimals");
    assert.equal(discovered.filter((item) => item.primaryPoolLiquidity?.amount === null).length, 4);
  } finally { globalThis.fetch = originalFetch; }
});

test("unresolved secondary candidates hydrate before primary pool enrichment", { concurrency: false }, async () => {
  const originalFetch = globalThis.fetch;
  const primaryRows = Array.from({ length: 20 }, (_, index) => ({ marketId: `old-primary-${index}`, title: `Resolved market ${index}`, phase: "primary", status: "resolved", resolved: true, quoteAsset: "usdc" }));
  const secondaryRows = [
    { marketId: "active-secondary-first", title: "Active secondary one", phase: "secondary", status: "active", resolved: false },
    { marketId: "active-secondary-second", title: "Active secondary two", phase: "secondary", status: "secondary", resolved: false },
  ];
  const detailRequests = [];
  const eventRows = [...primaryRows, ...secondaryRows].map(({ marketId }) => ({ eventPda: marketId, quoteAsset: "usdc" }));
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.hostname === "production-api.balr.fun") return new Response(JSON.stringify(eventRows), { status: 200 });
    if (url.pathname === "/api/v1/markets/") return new Response(JSON.stringify({ items: [...primaryRows, ...secondaryRows], nextCursor: null }), { status: 200 });
    const id = url.pathname.match(/\/markets\/([^/]+)\//)?.[1];
    detailRequests.push(id);
    if (id?.startsWith("active-secondary-")) return new Response(JSON.stringify({ marketId: id, title: id, phase: "secondary", status: "secondary", isActive: true, resolved: false, isGraduated: true, programId: "6gM5afTQBq5VZCfgpGqcsqzfWd5maLSCKWtGjbEobZMp" }), { status: 200 });
    return new Response(JSON.stringify({ marketId: id, phase: "primary", status: "resolved", resolved: true, primaryPoolLamports: "1000000" }), { status: 200 });
  };
  try {
    const discovered = await new PantaClient().discoverMarkets();
    assert.deepEqual(detailRequests.slice(0, 2), ["active-secondary-first", "active-secondary-second"]);
    assert.equal(detailRequests.length, 16, "secondary status hydration stays inside the existing request cap");
    assert.equal(discovered.find((item) => item.id === "active-secondary-second")?.status, "active", "an unresolved secondary listing is status-checked through its detail endpoint");
  } finally { globalThis.fetch = originalFetch; }
});
