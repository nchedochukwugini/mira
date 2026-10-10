import { NextResponse } from "next/server";
import { getPantaMicrostructureHistory } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ranges: Record<string, number> = { "1h": 60 * 60_000, "6h": 6 * 60 * 60_000, "1d": 24 * 60 * 60_000, "1w": 7 * 24 * 60 * 60_000 };

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!id || id.length > 96) return NextResponse.json({ error: "A valid Panta market id is required." }, { status: 400 });
  const params = new URL(request.url).searchParams;
  const now = Date.now();
  const range = params.get("range")?.toLowerCase();
  const startValue = Number(params.get("start"));
  const endValue = Number(params.get("end"));
  const limitValue = Number(params.get("maxPoints") ?? params.get("limit") ?? 200);
  const limit = Number.isFinite(limitValue) ? Math.max(1, Math.min(500, Math.floor(limitValue))) : 200;
  const interval = Number(params.get("interval"));
  const start = Number.isFinite(startValue) && params.has("start") ? startValue : range === "all" || !range ? undefined : ranges[range] ? now - ranges[range]! : undefined;
  const end = Number.isFinite(endValue) && params.has("end") ? endValue : undefined;
  try {
    let observations = await getPantaMicrostructureHistory(id, { start, end, limit: 500 });
    if (interval > 0 && Number.isFinite(interval)) {
      const buckets = new Set<number>();
      observations = observations.filter((point) => {
        const bucket = Math.floor(point.observedAt / interval);
        if (buckets.has(bucket)) return false;
        buckets.add(bucket);
        return true;
      });
    }
    if (observations.length > limit) {
      const step = (observations.length - 1) / (limit - 1 || 1);
      observations = Array.from({ length: limit }, (_, index) => observations[Math.round(index * step)]!).filter((point, index, all) => index === 0 || point.observedAt !== all[index - 1]!.observedAt);
    }
    return NextResponse.json({ marketId: id, provenance: "MIRA-observed", historyStatus: observations.length === 0 ? "not-observed" : observations.length === 1 ? "single-observation" : "sparse", observations }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ marketId: id, provenance: "MIRA-observed", historyStatus: "unavailable", observations: [] }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
