import { NextResponse } from "next/server";
import { getMarketProvider } from "@/lib/providers/market-provider";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const provider = getMarketProvider();
    const market = await provider.getMarket(id);
    return market
      ? NextResponse.json({ data: market, source: provider.source, environment: provider.environment ?? "unknown", updatedAt: new Date().toISOString() })
      : NextResponse.json({ error: "Market not found." }, { status: 404 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Market lookup failed." }, { status: 502 });
  }
}
