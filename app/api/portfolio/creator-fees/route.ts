import { NextRequest, NextResponse } from "next/server";
import { getMarketProvider } from "@/lib/providers/market-provider";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const wallet = request.nextUrl.searchParams.get("wallet")?.trim();
  if (!wallet) return NextResponse.json({ error: "A wallet address is required." }, { status: 400 });
  try {
    const provider = getMarketProvider();
    return NextResponse.json({ data: await provider.getCreatorFees(wallet), source: provider.source, updatedAt: new Date().toISOString() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Creator fees unavailable." }, { status: 502 });
  }
}
