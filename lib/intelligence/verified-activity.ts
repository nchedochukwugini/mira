import type { Market, MarketProvider, OrderBookSnapshot } from "@/lib/panta/types";
import { semanticRelevance } from "@/lib/intelligence/core";

export type ActivityObservation = {
  subject: string;
  marketId?: string;
  marketQuestion?: string;
  status: "available" | "partial" | "unavailable" | "empty" | "error";
  verifiedMatchedEvents: number | null;
  observedAt?: string;
  source?: string;
  detail: string;
};

export async function compareVerifiedActivity(input: {
  subjects: string[];
  provider: MarketProvider;
  getSnapshot: (marketId: string) => Promise<OrderBookSnapshot>;
  now?: () => string;
}): Promise<{ retrievedAt: string; observations: ActivityObservation[]; answer: string }> {
  const retrievedAt = (input.now ?? (() => new Date().toISOString()))();
  const observations = await Promise.all(input.subjects.slice(0, 2).map(async (subject): Promise<ActivityObservation> => {
    let candidates: Market[];
    try {
      candidates = await input.provider.discoverMarkets(subject);
    } catch {
      return { subject, status: "error", verifiedMatchedEvents: null, detail: "Market discovery failed; activity could not be checked." };
    }
    const match = candidates
      .map((market) => ({ market, score: semanticRelevance(subject, market) }))
      .filter(({ market, score }) => market.source === "panta" && market.status === "active" && score > 0)
      .sort((a, b) => b.score - a.score || a.market.id.localeCompare(b.market.id))[0]?.market;
    if (!match) return {
      subject, status: candidates.length ? "unavailable" : "empty", verifiedMatchedEvents: null,
      detail: candidates.length ? "The catalog returned candidates but no active Panta market could be matched confidently." : "Panta returned no matching catalog entries.",
    };
    let snapshot: OrderBookSnapshot;
    try {
      snapshot = await input.getSnapshot(match.id);
    } catch {
      return { subject, marketId: match.id, marketQuestion: match.question, status: "error", verifiedMatchedEvents: null, detail: "The on-chain activity read failed." };
    }
    if (snapshot.dataStatus === "unavailable" || snapshot.activityStatus === "unavailable") return {
      subject, marketId: match.id, marketQuestion: match.question, status: "unavailable", verifiedMatchedEvents: null,
      observedAt: new Date(snapshot.observedAt).toISOString(), source: snapshot.source, detail: snapshot.message ?? "Verified on-chain activity is unavailable.",
    };
    const matches = snapshot.activity.filter((event) => event.kind === "order_matched" && event.verificationStatus === "matched-event-verified");
    if (snapshot.activityStatus === "partial" || snapshot.dataStatus === "partial") return {
      subject, marketId: match.id, marketQuestion: match.question, status: "partial", verifiedMatchedEvents: matches.length,
      observedAt: new Date(snapshot.observedAt).toISOString(), source: snapshot.source,
      detail: matches.length ? `At least ${matches.length} verified matched event(s) were decoded; the activity window is partial.` : "The activity window is partial and contains no decoded matched event; this does not establish that no trades occurred.",
    };
    return {
      subject, marketId: match.id, marketQuestion: match.question, status: "available", verifiedMatchedEvents: matches.length,
      observedAt: new Date(snapshot.observedAt).toISOString(), source: snapshot.source,
      detail: matches.length ? `${matches.length} verified matched event(s) were decoded in the bounded activity observation.` : "No verified matched event was decoded in this bounded observation; this does not establish that no trades occurred outside the observed window.",
    };
  }));
  const answer = observations.map((item) => item.marketQuestion
    ? `${item.marketQuestion}: ${item.detail}`
    : `${item.subject}: ${item.detail}`).join("\n\n");
  return { retrievedAt, observations, answer };
}
