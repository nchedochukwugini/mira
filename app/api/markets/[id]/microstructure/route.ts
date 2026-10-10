import { NextResponse } from "next/server";
import { getPantaOrderBookSnapshot } from "@/lib/panta/clob";
import { getSnapshotMicrostructure } from "@/lib/panta/microstructure-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!id || id.length > 96) return NextResponse.json({ error: "A valid Panta market id is required." }, { status: 400 });
  try {
    const snapshot = await getPantaOrderBookSnapshot(id);
    const metrics = await getSnapshotMicrostructure(snapshot);
    const unavailableOutcome = { bestBid: null, bestAsk: null, midpoint: null, spread: null, spreadBps: null, bidDepth: 0, askDepth: 0, totalDepth: 0, depthImbalance: null, bidLevelCount: 0, askLevelCount: 0, bookState: "empty", spreadRegime: "unavailable" };
    return NextResponse.json({ marketId: id, timestamp: metrics?.timestamp ?? null, historyStatus: metrics?.historyStatus ?? "not-observed", current: metrics, yes: metrics?.yes ?? unavailableOutcome, no: metrics?.no ?? unavailableOutcome, activity: metrics?.activity ?? { status: "unavailable", orderActivity: 0, cancellationActivity: 0, tradeCount: 0, matchedVolume: null, events: [], evidenceStatus: "unavailable" }, summary: metrics?.summary ?? null, source: "panta-solana", currentProvenance: metrics?.provenance ?? "unavailable", historyProvenance: "MIRA-observed" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ marketId: id, timestamp: null, historyStatus: "unavailable", current: null, source: "panta-solana", currentProvenance: "unavailable", historyProvenance: "MIRA-observed" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
