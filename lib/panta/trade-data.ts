import type { TradeQuote } from "@/lib/panta/types";

export function normalizePantaQuote(payload: unknown, environment: "test" | "live" | "unknown"): TradeQuote {
  const outer = object(payload);
  const row = object(outer.data ?? payload);
  const side = typeof row.side === "string" ? row.side.toUpperCase() : "";
  const amount = finiteNumber(row.amountUsdc);
  const averagePrice = finiteNumber(row.avgPrice);
  return {
    id: text(row.quoteId) ?? "",
    marketId: text(row.marketId) ?? "",
    outcome: side === "NO" ? "NO" : side === "YES" ? "YES" : "" as TradeQuote["outcome"],
    amountUsd: amount ?? Number.NaN,
    shares: finiteNumber(row.shares),
    averagePrice: averagePrice === null ? null : averagePrice > 1 && averagePrice <= 100 ? averagePrice / 100 : averagePrice <= 1 ? averagePrice : null,
    feeUsd: finiteNumber(row.feeUsdc),
    expiresAt: text(row.expiresAt),
    raw: payload,
    source: "panta",
    environment,
  };
}

function object(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function text(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim() : null; }
function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}
