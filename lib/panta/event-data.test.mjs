import test from "node:test";
import assert from "node:assert/strict";
process.env.PANTA_API_KEY ??= "pk_test-event-data-test";
const { applyAuthoritativeQuoteMetadata } = await import("./client.ts");
const { applyDecodedPantaEvent } = await import("./event-data.ts");
const { normalizePantaMarket } = await import("../intelligence/core.ts");

function event({ pool = 11_547_196_079n, active = 11_047_196_079n, total = 11_547_196_079n } = {}) {
  return { question: "Verified on-chain title", primaryPoolBaseUnits: pool, activeVolumeBaseUnits: active, totalVolumeBaseUnits: total };
}

test("verified Event title fills a missing provider title", () => {
  const raw = normalizePantaMarket({ marketId: "event-pda", quoteAsset: "usdc" });
  const trusted = applyAuthoritativeQuoteMetadata(raw, { eventPda: "event-pda", quoteAsset: "usdc" });
  const result = applyDecodedPantaEvent(trusted, event(), new Date().toISOString());
  assert.equal(result.question, "Verified on-chain title");
});

test("on-chain Event enrichment uses SOL units and keeps pool, active volume, and total volume distinct", () => {
  const raw = normalizePantaMarket({ marketId: "sol-pda", quoteAsset: "usdc", primaryPoolLamports: "11547196079", volumeUsdc: "11047.196079" });
  const trusted = applyAuthoritativeQuoteMetadata(raw, { eventPda: "sol-pda", quoteAsset: "sol" });
  const result = applyDecodedPantaEvent(trusted, event(), "2026-10-10T15:33:56.000Z", 455_321_434);
  assert.equal(result.primaryPoolLiquidity?.amount, 11.547196079);
  assert.equal(result.primaryPoolLiquidity?.asset, "SOL");
  assert.equal(result.primaryPoolLiquidity?.state, "finalized_snapshot");
  assert.equal(result.primaryPoolLiquidity?.slot, 455_321_434);
  assert.equal(result.activeVolume?.slot, 455_321_434);
  assert.equal(result.activeVolume?.amount, 11.047196079);
  assert.equal(result.totalVolume?.amount, 11.547196079);
  assert.equal(result.volumeUsd, null);
  assert.equal(result.primaryPoolLiquidityUsd, null);
  assert.equal(result.primaryPoolLiquidityStatus, "verified");
});

test("detail conflicts are preserved while the exact Event account amount becomes authoritative", () => {
  const raw = normalizePantaMarket({ marketId: "conflicted", quoteAsset: "usdc", primaryPoolLamports: "1000000000" });
  const trusted = applyAuthoritativeQuoteMetadata(raw, { eventPda: "conflicted", quoteAsset: "SOL" });
  const result = applyDecodedPantaEvent(trusted, event(), new Date().toISOString());
  assert.equal(result.quoteAssetResolution?.status, "conflict");
  assert.equal(result.quoteAssetResolution?.rawProvider, "usdc");
  assert.equal(result.primaryPoolLiquidity?.rawBaseUnits, "11547196079");
  assert.equal(result.primaryPoolLiquidity?.amount, 11.547196079);
  assert.equal(result.primaryPoolLiquidityStatus, "conflict");
});

test("USDC base units use six decimals and USD is calculated only with a fresh explicit conversion", () => {
  const raw = normalizePantaMarket({ marketId: "usdc-pda", quoteAsset: "usdc", primaryPoolLamports: "200563692", volumeUsdc: "246704614", totalVolumeUsdc: "251704614" });
  const trusted = applyAuthoritativeQuoteMetadata(raw, { eventPda: "usdc-pda", quoteAsset: "usdc" });
  const amountData = event({ pool: 200_563_692n, active: 246_704_614n, total: 251_704_614n });
  const withoutFx = applyDecodedPantaEvent(trusted, amountData, new Date().toISOString());
  assert.equal(withoutFx.primaryPoolLiquidity?.amount, 200.563692);
  assert.equal(withoutFx.activeVolume?.amount, 246.704614);
  assert.equal(withoutFx.totalVolume?.amount, 251.704614);
  assert.equal(withoutFx.primaryPoolLiquidityUsd, null);
  const converted = applyDecodedPantaEvent({ ...trusted, usdConversion: { usdPerQuote: 1.001, source: "verified quote feed", observedAt: new Date(Date.now() - 1_000).toISOString() } }, amountData, new Date().toISOString());
  assert.ok(Math.abs(converted.primaryPoolLiquidityUsd - 200.764255692) < 1e-9);
  assert.ok(Math.abs(converted.volumeUsd - 246.951318614) < 1e-9);
});

test("unsupported quote assets keep on-chain raw amounts but do not normalize units", () => {
  const raw = normalizePantaMarket({ marketId: "unsupported", quoteAsset: "btc", primaryPoolLamports: "1000000000" });
  const result = applyAuthoritativeQuoteMetadata(raw, { eventPda: "unsupported", quoteAsset: "btc" });
  const enriched = applyDecodedPantaEvent(result, event(), new Date().toISOString());
  assert.equal(enriched.primaryPoolLiquidity?.rawBaseUnits, "11547196079");
  assert.equal(enriched.primaryPoolLiquidity?.amount, null);
  assert.equal(enriched.activeVolume?.amount, null);
  assert.equal(enriched.totalVolume?.amount, null);
});
