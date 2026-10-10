import { NextResponse } from "next/server";
import { explainMarketReasoning } from "@/lib/ai";
import { getLatestMarketResearch, getPantaMicrostructureHistory } from "@/lib/db";
import { buildMarketReasoning } from "@/lib/intelligence/market-reasoning";
import { getMarketProvider } from "@/lib/providers/market-provider";
import { getPantaOrderBookSnapshot } from "@/lib/panta/clob";
import { getSnapshotMicrostructure } from "@/lib/panta/microstructure-service";
import type { OrderBookSnapshot } from "@/lib/panta/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!id || id.length > 96) return NextResponse.json({ error: "A valid Panta market id is required." }, { status: 400 });
  const provider = getMarketProvider();
  try {
    const market = await provider.getMarket(id);
    if (!market) return NextResponse.json({ error: "Market not found." }, { status: 404 });
    if (market.source !== "panta") return NextResponse.json({ error: "Market reasoning requires a Panta market." }, { status: 400 });
    const [bookResult, historyResult, researchResult] = await Promise.allSettled([
      getPantaOrderBookSnapshot(id),
      getPantaMicrostructureHistory(id, { limit: 500 }),
      getLatestMarketResearch(id),
    ]);
    const snapshot: OrderBookSnapshot | null = bookResult.status === "fulfilled" && bookResult.value.dataStatus !== "unavailable" ? bookResult.value : null;
    const history = historyResult.status === "fulfilled" ? historyResult.value : [];
    const research = researchResult.status === "fulfilled" ? researchResult.value.evidence : [];
    const researchStatus = researchResult.status === "rejected" ? "unavailable" : researchResult.value.status;
    const microstructure = snapshot ? await getSnapshotMicrostructure(snapshot).catch(() => null) : null;
    const reasoning = buildMarketReasoning({ market, snapshot: bookResult.status === "fulfilled" ? bookResult.value : null, microstructure, history, historyStatus: historyResult.status === "rejected" ? "unavailable" : history.length ? "available" : "not-observed", research, researchStatus });
    const question = new URL(request.url).searchParams.get("question") ?? "What's happening with this market?";
    const narrative = market.status === "resolved" ? reasoning.explanation : await explainMarketReasoning(question, reasoning).catch(() => null) ?? reasoning.explanation;
    return NextResponse.json({ reasoning, narrative, narrativeSource: narrative === reasoning.explanation ? "deterministic" : "groq", provider: provider.source, environment: provider.environment ?? "unknown" }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Market reasoning could not be completed." }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
