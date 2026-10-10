import type { MarketStatus } from "@/lib/panta/types";

export function isResolvedMarket(status: MarketStatus): boolean {
  return status === "resolved";
}
