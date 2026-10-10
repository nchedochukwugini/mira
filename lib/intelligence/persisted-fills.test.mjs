import test from "node:test";
import assert from "node:assert/strict";
import { summarizePersistedFills } from "./persisted-fills.ts";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
const fixture = [
  { marketId: "m1", eventPda: "event-1", signature: "historical-fixture-a", eventIndex: 0, slot: 10, blockTime: "2025-01-01T00:00:00.000Z", outcome: "YES", price: .4, shareQuantity: 5, quoteAsset: { status: "verified", mint: USDC, symbol: "USDC", decimals: 6, network: "mainnet-beta", source: "on-chain-market-config", reason: null }, quoteNotional: "2", quoteNotionalStatus: "calculated", decoderVersion: "historical-test-fixture" },
  { marketId: "m1", eventPda: "event-1", signature: "historical-fixture-b", eventIndex: 1, slot: 11, blockTime: "2025-01-01T00:01:00.000Z", outcome: "NO", price: .6, shareQuantity: 3, quoteAsset: { status: "verified", mint: USDC, symbol: "USDC", decimals: 6, network: "mainnet-beta", source: "on-chain-market-config", reason: null }, quoteNotional: "1.8", quoteNotionalStatus: "calculated", decoderVersion: "historical-test-fixture" },
];

test("groups exact verified quote notionals with historical fixture records", () => {
  const result = summarizePersistedFills({ marketId: "m1", eventPda: "event-1", fills: [...fixture, fixture[0]], initialScanComplete: true, unresolvedCount: 0 });
  assert.equal(result.verifiedFillCount, 2);
  assert.equal(result.metrics.totalShares, 8);
  assert.equal(result.metrics.quoteAssetGroups[0].quoteNotional, "3.8");
  assert.deepEqual(result.metrics.quoteAssetGroups[0].priceRange, { min: .4, max: .6 });
  assert.equal(result.metrics.yesFillCount, 1);
  assert.equal(result.metrics.noFillCount, 1);
  assert.equal(result.transactions[0].signature, "historical-fixture-a");
  assert.equal(result.transactions[0].quoteMint, USDC);
});

test("isolates markets and Event PDAs and filters malformed fills", () => {
  const result = summarizePersistedFills({ marketId: "m1", eventPda: "event-1", fills: [...fixture,
    { ...fixture[0], marketId: "m2", signature: "other-market" }, { ...fixture[0], eventPda: "event-2", signature: "other-event" },
    { ...fixture[0], signature: "invalid-quantity", shareQuantity: 0 }, { ...fixture[0], signature: "invalid-price", price: 2 },
  ], initialScanComplete: true, unresolvedCount: 0 });
  assert.equal(result.verifiedFillCount, 2);
  assert.ok(result.transactions.every((item) => !["other-market", "other-event", "invalid-quantity", "invalid-price"].includes(item.signature)));
});

test("unknown denomination never trusts a populated legacy usdc_value", () => {
  const legacy = fixture.map((fill) => ({ ...fill, legacyUsdcValue: 900, quoteAsset: { status: "unknown", mint: null, symbol: null, decimals: null, network: "mainnet-beta", source: "none", reason: "Historical denomination not verified." }, quoteNotional: null, quoteNotionalStatus: "unverified" }));
  const result = summarizePersistedFills({ marketId: "m1", fills: legacy, initialScanComplete: true, unresolvedCount: 0 });
  assert.equal(result.metrics.totalShares, 8);
  assert.equal(result.metrics.quoteAssetGroups[0].quoteNotional, null);
  assert.equal(result.metrics.quoteAssetGroups[0].notionalStatus, "unverified");
  assert.ok(result.limitations.some((item) => /legacy usdc_value is not treated/.test(item)));
});

test("separates verified quote mints even when display symbols match", () => {
  const other = { ...fixture[0], signature: "other-token", quoteAsset: { ...fixture[0].quoteAsset, mint: USDT }, quoteNotional: "12", shareQuantity: 20 };
  const result = summarizePersistedFills({ marketId: "m1", fills: [fixture[0], other], initialScanComplete: true, unresolvedCount: 0 });
  assert.equal(result.metrics.quoteAssetGroups.length, 2);
  assert.deepEqual(new Set(result.metrics.quoteAssetGroups.map((group) => group.mint)), new Set([USDC, USDT]));
  assert.deepEqual(new Set(result.metrics.quoteAssetGroups.map((group) => group.quoteNotional)), new Set(["2", "12"]));
});

test("missing timestamps retain count and shares, while partial scan and freshness remain separate", () => {
  const result = summarizePersistedFills({ marketId: "m1", fills: [{ ...fixture[0], blockTime: null }], initialScanComplete: false, unresolvedCount: 1, lastScanAt: "2026-10-10T11:59:00.000Z", now: "2026-10-10T12:00:00.000Z" });
  assert.equal(result.verifiedFillCount, 1);
  assert.equal(result.metrics.totalShares, 5);
  assert.equal(result.lastFillAt, null);
  assert.equal(result.coverageStatus, "partial");
  assert.equal(result.freshnessStatus, "fresh");
  assert.ok(result.limitations.some((item) => /lack block timestamps/.test(item)));
});

test("empty history and unavailable storage are distinct and do not fabricate notional", () => {
  const empty = summarizePersistedFills({ marketId: "m1", fills: [], initialScanComplete: true, unresolvedCount: 0 });
  assert.equal(empty.status, "empty");
  assert.equal(empty.verifiedFillCount, 0);
  assert.equal(empty.metrics.quoteAssetGroups.length, 0);
  const unavailable = summarizePersistedFills({ marketId: "m1", fills: [], initialScanComplete: false, unresolvedCount: 0, unavailable: true });
  assert.equal(unavailable.status, "unavailable");
  assert.equal(unavailable.verifiedFillCount, null);
  assert.equal(unavailable.metrics, null);
});
