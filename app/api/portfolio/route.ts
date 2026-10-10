import { NextRequest, NextResponse } from "next/server";
import { getMarketProvider } from "@/lib/providers/market-provider";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const wallet = request.nextUrl.searchParams.get("wallet")?.trim();
  if (!wallet) return NextResponse.json({ error: "A wallet address is required." }, { status: 400 });
  try {
    const provider = getMarketProvider();
    const positions = await provider.getPositions(wallet);
    return NextResponse.json({ data: positions, source: provider.source, updatedAt: new Date().toISOString() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Portfolio could not be loaded." }, { status: 502 });
  }
}
