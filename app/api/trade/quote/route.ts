import { NextResponse } from "next/server";
import { getMarketProvider } from "@/lib/providers/market-provider";
import { persistTradePreparation } from "@/lib/db";
import { isQuoteExpired, isTradeEligibleMarket, tradeIneligibilityReason } from "@/lib/panta/trade-safety";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { marketId?: string; outcome?: "YES" | "NO"; amountUsd?: number; wallet?: string };
    if (!body.marketId || !body.wallet || !["YES", "NO"].includes(body.outcome ?? "") || !Number.isFinite(body.amountUsd) || (body.amountUsd ?? 0) <= 0 || Number((body.amountUsd ?? 0).toFixed(2)) !== body.amountUsd) {
      return NextResponse.json({ error: "Market, outcome, positive amount, and wallet are required." }, { status: 400 });
    }
    const provider = getMarketProvider();
    const market = await provider.getMarket(body.marketId);
    if (!market || !isTradeEligibleMarket(market)) return NextResponse.json({ error: tradeIneligibilityReason(market) }, { status: 409 });
    const quote = await provider.getQuote({ marketId: body.marketId, outcome: body.outcome!, amountUsd: body.amountUsd!, wallet: body.wallet });
    if (quote.source !== "panta") return NextResponse.json({ data: quote, source: "demo", status: "demo-only", requiresWalletConfirmation: true });
    if (!quote.id || quote.marketId !== body.marketId || quote.outcome !== body.outcome || quote.amountUsd !== body.amountUsd
      || !quote.expiresAt || !Number.isFinite(Date.parse(quote.expiresAt)) || isQuoteExpired(quote.expiresAt)) return NextResponse.json({ error: "Panta returned incomplete, mismatched, or non-expiring quote data. No transaction was prepared." }, { status: 502 });
    const verifiedAgain = await provider.getMarket(body.marketId);
    if (!verifiedAgain || !isTradeEligibleMarket(verifiedAgain)) return NextResponse.json({ error: tradeIneligibilityReason(verifiedAgain) }, { status: 409 });
    await persistTradePreparation({ market: verifiedAgain, side: body.outcome!, amountUsdc: body.amountUsd!, quote: { id: quote.id, shares: quote.shares, averagePrice: quote.averagePrice, feeUsd: quote.feeUsd, expiresAt: quote.expiresAt } });
    return NextResponse.json({ data: quote, source: "panta", environment: quote.environment ?? "unknown", status: "quoted", requiresWalletConfirmation: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Quote unavailable." }, { status: 502 });
  }
}
