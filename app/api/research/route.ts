import { NextResponse } from "next/server";
import { classifyConversationMessage } from "@/lib/intelligence/conversation";
import { getMarketProvider } from "@/lib/providers/market-provider";
import { runResearch } from "@/lib/research";
import type { ResearchDepth } from "@/lib/research/types";
import { persistMarketObservation, persistResearch } from "@/lib/db";
import { PantaError } from "@/lib/panta/client";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { marketId?: unknown; query?: unknown; depth?: unknown; refresh?: unknown; priorEvidence?: unknown; conversationId?: unknown };
    const query = typeof body.query === "string" ? body.query.trim().slice(0, 500) : "Research this market";
    const marketId = typeof body.marketId === "string" ? body.marketId.slice(0, 160) : undefined;
    const depth: ResearchDepth = body.depth === "quick" || body.depth === "full" ? body.depth : "deep";
    const provider = getMarketProvider();
    const market = marketId ? await provider.getMarket(marketId) : null;
    const decision = classifyConversationMessage(query, { markets: market ? [{ id: market.id, question: market.question }] : [], activeMarketId: market?.id });
    if (decision.intent !== "research" && !marketId) return NextResponse.json({ error: "Use a natural-language research request or provide a marketId." }, { status: 400 });
    const priorEvidence = Array.isArray(body.priorEvidence) ? body.priorEvidence.slice(0, 30).flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const url = (entry as { url?: unknown }).url;
      try { if (typeof url === "string" && new URL(url).protocol === "https:") return [{ url: url.slice(0, 1500) }]; } catch {}
      return [];
    }) : undefined;
    const report = await runResearch({ question: query, marketId, contextMarkets: market ? [{ id: market.id, question: market.question }] : [], provider, depth, refresh: body.refresh === true, priorEvidence, signal: request.signal });
    if (request.signal.aborted) return NextResponse.json({ error: "Research request was cancelled.", errorCode: "cancelled" }, { status: 499 });
    if (report.market) await persistMarketObservation(report.market);
    await persistResearch(report, typeof body.conversationId === "string" ? body.conversationId : undefined);
    const marketData = report.market ? {
      source: report.market.source, environment: provider.environment ?? "unknown", status: report.market.status,
      yesProbability: report.market.yesProbability, noProbability: report.market.noProbability,
      volumeUsd: report.market.volumeUsd, closeAt: report.market.closeAt, updatedAt: report.market.updatedAt,
      metrics: report.marketMetrics,
    } : null;
    return NextResponse.json({ market: report.market, marketData, research: {
      status: report.status, searchStatus: report.searchStatus, searchMessage: report.searchMessage,
      summary: report.conclusion, keyFindings: report.keyFindings,
      supportingEvidence: report.evidence.filter((item) => item.direction === "supports-yes"),
      opposingEvidence: report.evidence.filter((item) => item.direction === "supports-no"),
      neutralEvidence: report.evidence.filter((item) => item.direction === "neutral"),
      uncertainties: report.uncertainty, assessment: report.assessment, whatChanged: report.whatChanged, whatCouldChange: report.whatCouldChange,
      sources: report.evidence, plan: report.plan, relatedMarkets: report.relatedMarkets,
      researchedAt: report.researchedAt, refreshed: report.refreshed,
      synthesisMode: report.synthesisMode, synthesisMessage: report.synthesisMessage,
      eventIntelligence: report.eventIntelligence,
    } });
  } catch (error) {
    if (request.signal.aborted || error instanceof Error && error.name === "AbortError") return NextResponse.json({ error: "Research request was cancelled.", errorCode: "cancelled" }, { status: 499 });
    if (error instanceof PantaError) return NextResponse.json({ error: error.message, errorCode: error.status === 504 ? "timeout" : "panta_unavailable" }, { status: error.status ?? 502 });
    if (error instanceof Error && error.name === "TimeoutError") return NextResponse.json({ error: "Research timed out while waiting for an upstream source.", errorCode: "timeout" }, { status: 504 });
    return NextResponse.json({ error: "Research could not be completed.", errorCode: "research_unavailable" }, { status: 502 });
  }
}
