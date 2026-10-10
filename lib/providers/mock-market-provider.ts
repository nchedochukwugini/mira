import { demoMarkets } from "@/lib/mock/markets";
import type { Market, MarketProvider, Position, TradeQuote } from "@/lib/panta/types";
import { semanticRelevance } from "@/lib/intelligence/core";

export class MockMarketProvider implements MarketProvider {
  readonly source = "demo" as const;

  async discoverMarkets(query?: string): Promise<Market[]> {
    if (!query?.trim()) return demoMarkets;
    const matches = demoMarkets.filter((market) => semanticRelevance(query, market) > 0);
    return matches;
  }

  async getMarket(id: string): Promise<Market | null> {
    return demoMarkets.find((market) => market.id === id) ?? null;
  }

  async getMarketTrades(): Promise<unknown[]> {
    return [];
  }

  async getPositions(): Promise<Position[]> {
    return [];
  }

  async getQuote(input: { marketId: string; outcome: "YES" | "NO"; amountUsd: number }): Promise<TradeQuote> {
    const market = demoMarkets.find((candidate) => candidate.id === input.marketId);
    const price = market ? input.outcome === "YES" ? market.yesProbability : market.noProbability : null;
    return {
      id: `demo-quote-${Date.now()}`,
      marketId: input.marketId,
      outcome: input.outcome,
      amountUsd: input.amountUsd,
      shares: price && price > 0 ? input.amountUsd / price : null,
      averagePrice: price,
      feeUsd: null,
      expiresAt: null,
      raw: { notice: "Demo quote only. No trade can be submitted from the demo provider." },
      source: "demo",
      environment: "unknown",
    };
  }

  async buildTrade(): Promise<unknown> {
    throw new Error("Transaction building requires the live Panta provider.");
  }

  async submitTrade(): Promise<unknown> { throw new Error("Demo transactions cannot be submitted."); }
  async verifyTrade(): Promise<unknown> { throw new Error("Demo transactions cannot be verified."); }

  async getCreatorFees(): Promise<unknown> {
    return { source: "demo", data: [], notice: "Creator fee data is not available in demo mode." };
  }

  async buildClaim(): Promise<unknown> {
    throw new Error("Claim transactions require the live Panta provider.");
  }

  async attributeTrade(): Promise<unknown> {
    throw new Error("Trade attribution requires the live Panta provider.");
  }
}

export const demoMarketProvider = new MockMarketProvider();
