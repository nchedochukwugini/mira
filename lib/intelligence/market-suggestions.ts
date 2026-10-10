import type { Market } from "@/lib/panta/types";
import { semanticRelevance } from "@/lib/intelligence/core";
import { isSecondaryMarketCandidate, isTradeEligibleMarket } from "@/lib/panta/trade-safety";

export function rankDiscoveredMarkets(query: string, markets: Market[]): Market[] {
  const historical = /\b(yesterday|past|historical|history|previous|last week|last month|resolved markets?)\b/i.test(query);
  return markets
    .map((market) => ({ market, relevance: semanticRelevance(query, market) }))
    .filter((item) => item.relevance > 0)
    .sort((left, right) => {
      const statusRank = (market: Market) => historical
        ? market.status === "resolved" ? 3 : market.status === "closed" ? 2 : market.status === "active" ? 1 : 0
        : market.status === "active" ? 3 : market.status === "unknown" ? 2 : market.status === "closed" ? 1 : 0;
      const completeness = (market: Market) => Number(market.question !== "Market title unavailable")
        + Number(market.yesProbability !== null) + Number(market.noProbability !== null)
        + Number(market.volumeUsd !== null) + Number(market.closeAt !== null);
      return right.relevance - left.relevance
        || statusRank(right.market) - statusRank(left.market)
        || completeness(right.market) - completeness(left.market)
        || (right.market.volumeUsd ?? -1) - (left.market.volumeUsd ?? -1)
        || left.market.id.localeCompare(right.market.id);
    })
    .map(({ market }) => market);
}

/** Rank only records supplied by the configured provider; no fallback inventory. */
export function rankMarketSuggestions(markets: Market[], now = Date.now()): Market[] {
  return markets
    .filter((market) => market.id.trim() && market.question.trim() && market.question !== "Market title unavailable")
    .filter((market) => market.source === "panta" && (isTradeEligibleMarket(market, now) || isSecondaryMarketCandidate(market, now)))
    .sort((left, right) => {
      const active = Number(right.status === "active") - Number(left.status === "active");
      const completeness = (market: Market) => Number(market.yesProbability !== null) + Number(market.noProbability !== null) + Number(market.volumeUsd !== null) + Number(market.closeAt !== null);
      return active || completeness(right) - completeness(left)
        || (right.volumeUsd ?? -1) - (left.volumeUsd ?? -1)
        || left.question.localeCompare(right.question);
    });
}
