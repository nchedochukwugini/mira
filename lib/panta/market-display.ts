import type { Market } from "@/lib/panta/types";

export function marketStatusLabel(status: Market["status"]): string {
  return status === "unknown" ? "UNVERIFIED" : status.toUpperCase();
}

export function formatQuoteAmount(amount: number | null | undefined, asset: string | null | undefined): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount) || !asset) return "Unavailable";
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 }).format(amount)} ${asset}`;
}

export function marketPoolLiquidityDisplay(market: Market) {
  const pool = market.primaryPoolLiquidity;
  const usd = market.primaryPoolLiquidityUsd;
  return {
    label: "Finalized primary-pool liquidity",
    value: `${formatQuoteAmount(pool?.amount, pool?.asset)}${usd !== null && usd !== undefined ? ` (${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(usd)})` : ""}`,
    title: `Finalized primary-pool snapshot${pool?.source ? ` from ${pool.source}` : ""}${pool?.observedAt ? ` at ${pool.observedAt}` : ""}${pool?.slot !== null && pool?.slot !== undefined ? ` (slot ${pool.slot})` : ""}; this is not current executable order-book depth.${market.primaryPoolLiquidityStatus === "conflict" ? " The detail API amount conflicts with the on-chain Event account; the on-chain amount is displayed." : ""}${market.quoteAssetResolution?.status === "conflict" ? ` Metadata conflict: ${market.quoteAssetResolution.message}` : ""}`,
  };
}

export function formatProviderPrice(market: Market, outcome: "YES" | "NO"): string {
  if (market.quoteAsset === "USDC") {
    if (!market.priceProvenance || market.priceProvenance.kind === "unknown") return "No quote";
    const value = outcome === "YES" ? market.yesProbability : market.noProbability;
    return value === null ? "No quote" : `${(value * 100).toFixed(0)}%`;
  }
  const value = outcome === "YES" ? market.pantaPrices?.yes : market.pantaPrices?.no;
  return value === null || value === undefined || !market.pantaPrices?.quoteAsset ? "No quote" : `${value.toFixed(4)} ${market.pantaPrices.quoteAsset}/share`;
}
