import { NextRequest, NextResponse } from "next/server";
import { getMarketProvider, getProviderMode } from "@/lib/providers/market-provider";
import { PantaError } from "@/lib/panta/client";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const provider = getMarketProvider();
    const query = request.nextUrl.searchParams.get("q") ?? undefined;
    const discovered = await provider.discoverMarkets(query);
    // Catalog rows already contain the discovery fields and image. Fetch the
    // detail endpoint only when a user opens a market, keeping large catalogs fast.
    return NextResponse.json({ data: discovered, source: provider.source, environment: provider.environment ?? "unknown", updatedAt: new Date().toISOString() });
  } catch (error) {
    if (error instanceof PantaError) return NextResponse.json({ error: error.message, errorCode: error.status === 504 ? "timeout" : "panta_unavailable", source: getProviderMode() }, { status: error.status ?? 502 });
    return NextResponse.json({ error: "Market discovery could not be completed.", errorCode: "market_discovery_unavailable", source: getProviderMode() }, { status: 502 });
  }
}
