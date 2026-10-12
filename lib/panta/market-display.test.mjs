import test from "node:test";
import assert from "node:assert/strict";
import { formatProviderPrice, formatQuoteAmount, marketPoolLiquidityDisplay } from "./market-display.ts";

const market = (overrides = {}) => ({
  id: "pda", question: "Example", category: null, description: null, status: "active", yesProbability: null, noProbability: null,
  volumeUsd: null, totalVolumeUsd: null, liquidityUsd: null, primaryPoolLiquidityUsd: null, priceChange24h: null, closeAt: null,
  updatedAt: null, imageUrl: null, history: [], relatedMarketIds: [], source: "panta", ...overrides,
});

test("market display preserves quote units and keeps primary pool separate from executable depth", () => {
  const view = marketPoolLiquidityDisplay(market({
    quoteAsset: "SOL", primaryPoolLiquidity: { amount: 11.547196079, asset: "SOL", source: "panta-event-account", observedAt: "2026-10-10T15:33:56Z", rawBaseUnits: "11547196079", baseUnitsPerUnit: 1e9, state: "finalized_snapshot" },
  }));
  assert.equal(view.label, "Finalized primary-pool liquidity");
  assert.equal(view.value, "11.5472 SOL");
  assert.match(view.title, /not current executable order-book depth/);
  assert.equal(formatQuoteAmount(null, "SOL"), "Unavailable");
});

test("conflicting metadata is visible and never formats a stale price as a quote", () => {
  const example = market({
    quoteAsset: "SOL", quoteAssetResolution: { asset: "SOL", status: "conflict", source: "panta-event-registry", observedAt: "2026-10-10T15:00:00Z", rawAuthoritative: "sol", rawProvider: "usdc", message: "Legacy says USDC; event says SOL." },
    primaryPoolLiquidity: { amount: null, asset: null, source: null, observedAt: null, rawBaseUnits: "123", baseUnitsPerUnit: null, state: "unavailable" },
    pantaPrices: { yes: null, no: null, quoteAsset: null, kind: "last_trade", observedAt: null },
  });
  const view = marketPoolLiquidityDisplay(example);
  assert.match(view.title, /Legacy says USDC/);
  assert.equal(view.value, "Unavailable");
  assert.equal(formatProviderPrice(example, "YES"), "No quote");
});

test("a verified SOL provider price is shown as quote per share, not as a probability", () => {
  const example = market({ quoteAsset: "SOL", pantaPrices: { yes: 0.8, no: 0.7, quoteAsset: "SOL", kind: "last_trade", observedAt: "2026-10-10T15:00:00Z" } });
  assert.equal(formatProviderPrice(example, "YES"), "0.8000 SOL/share");
});
