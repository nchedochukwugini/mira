import { NextResponse } from "next/server";
import { getMarketProvider } from "@/lib/providers/market-provider";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const requestedRange = new URL(request.url).searchParams.get("range") ?? "1d";
  const provider = getMarketProvider();
  try {
    const data = await provider.getMarketHistory(id, requestedRange);
    return NextResponse.json({ data, source: provider.source, environment: provider.environment ?? "unknown" });
  } catch {
    return NextResponse.json({ error: "Market history could not be retrieved.", errorCode: "history_unavailable" }, { status: 502 });
  }
}
