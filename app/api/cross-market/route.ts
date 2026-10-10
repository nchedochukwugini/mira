import { NextResponse } from "next/server";
import { buildCrossMarketReport, classifyEvidenceTiming, mergeMarketHistory, mergeSnapshotObservation } from "@/lib/intelligence/cross-market";
import { getMarketProvider } from "@/lib/providers/market-provider";
import { getPantaOrderBookSnapshot } from "@/lib/panta/clob";
import { getSnapshotMicrostructure } from "@/lib/panta/microstructure-service";
import { getLatestMarketResearch, getPantaMicrostructureHistory } from "@/lib/db";
import { runResearch } from "@/lib/research";
import { persistResearch } from "@/lib/db";
import { explainCrossMarket } from "@/lib/intelligence/cross-market-explanation";
import type { ResearchEvidence } from "@/lib/research/types";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { primaryMarketId?: unknown; relatedMarketIds?: unknown; research?: unknown };
    if (typeof body.primaryMarketId !== "string" || !body.primaryMarketId.trim()) return NextResponse.json({ error: "A primary market ID is required." }, { status: 400 });
    const requestedIds = Array.isArray(body.relatedMarketIds) ? [...new Set(body.relatedMarketIds.filter((id): id is string => typeof id === "string" && id.length <= 160 && id !== body.primaryMarketId))].slice(0, 8) : [];
    const provider = getMarketProvider();
    const primary = await provider.getMarket(body.primaryMarketId);
    if (!primary) return NextResponse.json({ error: "Primary market was not found." }, { status: 404 });
    let ids = requestedIds.length ? requestedIds : primary.relatedMarketIds.slice(0, 8);
    if (!ids.length) ids = (await provider.discoverMarkets(primary.question).catch(() => [])).filter((market) => market.id !== primary.id).slice(0, 4).map((market) => market.id);
    const related = await Promise.all(ids.map((id) => provider.getMarket(id)));
    const markets = related.filter((market): market is NonNullable<typeof market> => Boolean(market));
    const marketsWithStoredHistory = await Promise.all([primary, ...markets].map(async (market) => {
      if (market.source !== "panta") return market;
      const snapshots = await getPantaMicrostructureHistory(market.id, { limit: 500 }).catch(() => []);
      const savedPoints = snapshots.flatMap((snapshot) => {
        const timestamp = snapshot.pantaReference.observedAt;
        const yesProbability = snapshot.pantaReference.yesPrice;
        return timestamp && Number.isFinite(Date.parse(timestamp)) && yesProbability !== null
          ? [{ timestamp, yesProbability }]
          : [];
      });
      return mergeMarketHistory(market, savedPoints);
    }));
    const [primaryWithHistory, ...relatedWithHistory] = marketsWithStoredHistory;
    const idsToInspect = [primary, ...markets].filter((market) => market.source === "panta" && market.status !== "resolved");
    const [books, storedResearch] = await Promise.all([
      Promise.all(idsToInspect.map(async (market) => {
        const snapshot = await getPantaOrderBookSnapshot(market.id).catch(() => null);
        return { marketId: market.id, snapshot, microstructure: snapshot ? await getSnapshotMicrostructure(snapshot).catch(() => null) : null };
      })),
      Promise.all([primary, ...markets].map(async (market) => {
        const result = await getLatestMarketResearch(market.id).catch(() => ({ status: "not-run" as const, evidence: [] }));
        return { marketId: market.id, ...result };
      })),
    ]);
    const currentMarkets = [primaryWithHistory!, ...relatedWithHistory].map((market) => {
      const snapshot = books.find((entry) => entry.marketId === market.id)?.snapshot;
      return snapshot ? mergeSnapshotObservation(market, snapshot) : market;
    });
    const [currentPrimary, ...currentRelated] = currentMarkets;
    const report = buildCrossMarketReport({ primaryMarket: currentPrimary!, relatedMarkets: currentRelated });
    let sharedResearch: unknown = null;
    let groundingEvidence: ResearchEvidence[] = storedResearch.flatMap((entry) => entry.evidence);
    let freshEvidence: Array<{ marketId: string; title: string; source: string; url: string; publishedAt: string | null; retrievedAt: string }> = [];
    const researchableRelationship = report.relatedMarkets.some((item) =>
      item.relationship.reasons.some((reason) => /provider explicitly links/i.test(reason))
      || ["equivalent", "closely-related"].includes(item.relationship.type)
      || (item.relationship.type === "opposing" && item.relationship.confidence === "high" && primary.closeAt === item.market.closeAt)
      || (item.movement.dataStatus === "sufficient" && item.movement.observations.length >= 2)
    );
    if (body.research === true && markets.length && researchableRelationship) {
      const query = `Investigate possible shared external events connecting these prediction markets. Compare definitions and timeline; do not assume a causal link. Primary: ${primary.question}. Comparison: ${markets.map((market) => market.question).join(" | ")}`.slice(0, 500);
      const evidenceUrls = storedResearch.flatMap((entry) => entry.evidence.map((item) => ({ url: item.url })));
      const result = await runResearch({ question: query, marketId: primary.id, contextMarkets: [primary, ...markets].map(({ id, question }) => ({ id, question })), provider, depth: "deep", priorEvidence: evidenceUrls });
      if (result.market) await persistResearch(result);
      groundingEvidence = result.evidence;
      freshEvidence = result.evidence.map(({ title, source, url, publishedAt, retrievedAt }) => ({ marketId: primary.id, title, source, url, publishedAt, retrievedAt }));
      sharedResearch = { status: result.status, conclusion: result.conclusion, researchedAt: result.researchedAt, refreshed: result.refreshed, evidence: result.evidence.map(({ title, source, url, publishedAt, retrievedAt, claim, summary }) => ({ title, source, url, publishedAt, retrievedAt, claim, summary })) };
    } else if (body.research === true) {
      sharedResearch = { status: "skipped", conclusion: "The deterministic relationship check did not find a strong enough connection to search for a shared event.", researchedAt: new Date().toISOString(), refreshed: false, evidence: [] };
    }
    const movementTimes = report.relatedMarkets.flatMap((item) => item.movement.observations.map((observation) => Date.parse(observation.to))).filter(Number.isFinite);
    const movementStart = movementTimes.length ? Math.min(...movementTimes) : null;
    const movementEnd = movementTimes.length ? Math.max(...movementTimes) : null;
    const timingFor = (marketId: string, item: { title: string; source: string; url: string; publishedAt: string | null; retrievedAt: string }) => {
      const timing = classifyEvidenceTiming(item.publishedAt, movementStart, movementEnd);
      return { marketId, title: item.title, source: item.source, url: item.url, publishedAt: item.publishedAt, retrievedAt: item.retrievedAt, timing };
    };
    const evidenceTiming = [...storedResearch.flatMap((entry) => entry.evidence.map((item) => timingFor(entry.marketId, item))), ...freshEvidence.map((item) => timingFor(item.marketId, item))];
    const verifiedMarketState = books.map(({ marketId, snapshot, microstructure }) => snapshot ? ({
      marketId, source: snapshot.source, observedAt: snapshot.observedAt, slot: snapshot.slot,
      pantaReference: snapshot.pantaReference, dataStatus: snapshot.dataStatus, freshness: snapshot.freshness,
      yes: { bestBid: snapshot.yes.bestBid, bestAsk: snapshot.yes.bestAsk, midpoint: snapshot.yes.midpoint, spread: snapshot.yes.spread, bidDepth: snapshot.yes.bidDepth, askDepth: snapshot.yes.askDepth },
      no: { bestBid: snapshot.no.bestBid, bestAsk: snapshot.no.bestAsk, midpoint: snapshot.no.midpoint, spread: snapshot.no.spread, bidDepth: snapshot.no.bidDepth, askDepth: snapshot.no.askDepth },
      activityStatus: snapshot.activityStatus, historyStatus: snapshot.historyStatus, microstructure,
    }) : ({ marketId, source: "panta-solana", status: "unavailable" }));
    const grounded = await explainCrossMarket(report, groundingEvidence, verifiedMarketState).catch(() => null);
    const evidenceReferences = groundingEvidence.slice(0, 12).map(({ title, source, url, publishedAt, retrievedAt }, index) => ({ id: `E${index + 1}`, title, source, url, publishedAt, retrievedAt }));
    return NextResponse.json({ report, explanation: grounded?.explanation, explanationMode: grounded?.mode ?? "deterministic", evidenceReferences, microstructure: books, research: storedResearch, sharedResearch, evidenceTiming, source: provider.source, environment: provider.environment ?? "unknown", generatedAt: new Date().toISOString() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Cross-market analysis is unavailable." }, { status: 502 });
  }
}
