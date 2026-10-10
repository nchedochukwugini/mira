import { NextResponse } from "next/server";
import { getMarketProvider } from "@/lib/providers/market-provider";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { signature?: string; marketId?: string; wallet?: string };
    if (!body.signature || !body.marketId || !body.wallet) return NextResponse.json({ error: "Transaction signature, market, and wallet are required." }, { status: 400 });
    const provider = getMarketProvider();
    if (provider.source !== "panta") return NextResponse.json({ error: "Demo transactions cannot be attributed." }, { status: 409 });
    const result = await provider.attributeTrade({ signature: body.signature, marketId: body.marketId, wallet: body.wallet });
    return NextResponse.json({ data: result, source: provider.source });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Trade attribution failed." }, { status: 502 });
  }
}
