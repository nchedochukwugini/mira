import test from "node:test";
import assert from "node:assert/strict";
process.env.PANTA_API_KEY ??= "pk_test_panta-client-test";
const { mergeMarketCatalogQuotes, pantaTransportFailure, PantaClient } = await import("./client.ts");

const market = (overrides = {}) => ({
  id: "panta-market", question: "Will this resolve?", category: "test", description: null,
  status: "active", yesProbability: null, noProbability: null, volumeUsd: null,
  liquidityUsd: null, priceChange24h: null, closeAt: null, updatedAt: null,
  imageUrl: null, history: [], relatedMarketIds: [], source: "panta", ...overrides,
});

test("Panta timeout and caller cancellation keep distinct, safe transport results", () => {
  assert.deepEqual(pantaTransportFailure(new DOMException("private upstream detail", "TimeoutError")), { message: "Panta API request timed out.", status: 504 });
  assert.deepEqual(pantaTransportFailure(new DOMException("aborted", "AbortError")), { message: "Panta API request was cancelled.", status: 499 });
  assert.deepEqual(pantaTransportFailure(new Error("secret upstream detail")), { message: "Could not reach the Panta API.", status: 502 });
});

test("market detail fills missing provider fields from the matching Panta catalog row", () => {
  const detail = market({ yesProbability: 0.61 });
  const catalog = market({ yesProbability: 0.63, noProbability: 0.37, volumeUsd: 318, liquidityUsd: 42, updatedAt: "2026-10-08T10:00:00.000Z", history: [{ timestamp: "2026-10-08T09:00:00.000Z", yesProbability: 0.6 }] });
  const merged = mergeMarketCatalogQuotes(detail, catalog);
  assert.equal(merged.yesProbability, null, "conflicting endpoint quotes remain unavailable");
  assert.equal(merged.noProbability, 0.37, "missing detail quote uses provider catalog value");
  assert.equal(merged.volumeUsd, 318);
  assert.equal(merged.liquidityUsd, 42);
  assert.equal(merged.updatedAt, "2026-10-08T10:00:00.000Z");
  assert.equal(merged.history[0]?.yesProbability, 0.6);
  assert.equal(mergeMarketCatalogQuotes(detail, undefined).noProbability, null, "no catalog value remains unavailable");
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
    startTime: 1791396646, endTime: 1791640800,
  };
  const detailRow = {
    ...catalogRow, status: "secondary", volumeUsdc: "318.036406", yesPrice: "0.51684771", noPrice: "0.48315229",
    secondaryYesPrice: "516847710", secondaryNoPrice: "483152290", isGraduated: true,
    programId: "6gM5afTQBq5VZCfgpGqcsqzfWd5maLSCKWtGjbEobZMp",
  };
  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    const payload = url.includes("/markets/secondary-market/") ? detailRow : { items: [catalogRow], nextCursor: null };
    return new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const discovered = await new PantaClient().discoverMarkets();
    assert.equal(calls.length, 2, "one documented detail lookup supplements the active secondary catalog row");
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
