import { NextResponse } from "next/server";
import { getMarketProvider } from "@/lib/providers/market-provider";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const provider = getMarketProvider();
    return NextResponse.json({ data: await provider.getMarketTrades(id), source: provider.source, updatedAt: new Date().toISOString() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Market trades unavailable." }, { status: 502 });
  }
}
