import { NextResponse } from "next/server";
import { getMarketProvider, getProviderMode } from "@/lib/providers/market-provider";
import type { PantaTradeBuild } from "@/lib/panta/types";
import { getTradeTicketByQuoteId, updateTradeTicket } from "@/lib/db";
import { isQuoteExpired, isTradeEligibleMarket, tradeIneligibilityReason } from "@/lib/panta/trade-safety";
import { validatePrimaryBuild } from "@/lib/panta/transaction-security";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { quoteId?: string; wallet?: string };
    if (!body.quoteId || !body.wallet) return NextResponse.json({ error: "A live quote and wallet are required." }, { status: 400 });
    const provider = getMarketProvider();
    if (provider.source !== "panta") return NextResponse.json({ error: "Demo quotes cannot build a transaction." }, { status: 409 });
    const ticket = await getTradeTicketByQuoteId(body.quoteId);
    if (!ticket || ticket.status !== "quoted" || !ticket.expires_at || isQuoteExpired(new Date(ticket.expires_at).toISOString())) return NextResponse.json({ error: "This quote is missing, expired, or has no verifiable expiry. Request a fresh quote." }, { status: 409 });
    const market = await provider.getMarket(String(ticket.market_id));
    if (!market || !isTradeEligibleMarket(market)) return NextResponse.json({ error: tradeIneligibilityReason(market) }, { status: 409 });
    if (String(ticket.side).toUpperCase() !== "YES" && String(ticket.side).toUpperCase() !== "NO") return NextResponse.json({ error: "The quote contains an unsupported primary outcome." }, { status: 409 });
    const raw = await provider.buildTrade({ quoteId: body.quoteId, wallet: body.wallet });
    const row = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
    if (typeof row.orderId !== "string" || typeof row.quoteId !== "string" || row.quoteId !== body.quoteId
      || typeof row.wallet !== "string" || row.wallet !== body.wallet || typeof row.marketId !== "string" || row.marketId !== ticket.market_id
      || typeof row.side !== "string" || row.side !== String(ticket.side).toLowerCase() || typeof row.amountUsdc !== "string"
      || typeof row.recentBlockhash !== "string" || !row.recentBlockhash || !Number.isInteger(row.lastValidBlockHeight)) {
      return NextResponse.json({ error: "Panta returned an incomplete or quote-mismatched primary build. No signable transaction was returned." }, { status: 502 });
    }
    const validation = await validatePrimaryBuild({
      raw, wallet: body.wallet, eventAddress: String(ticket.market_id), side: String(ticket.side).toUpperCase() as "YES" | "NO",
      amountUsdc: String(ticket.amount_usdc), quoteId: body.quoteId,
    });
    const data: PantaTradeBuild = {
      orderId: row.orderId, quoteId: body.quoteId, wallet: body.wallet, marketId: String(ticket.market_id),
      side: String(ticket.side).toLowerCase() as "yes" | "no", amountUsdc: String(row.amountUsdc),
      expectedShares: typeof row.expectedShares === "string" ? row.expectedShares : null,
      feeUsdc: typeof row.feeUsdc === "string" ? row.feeUsdc : null,
      instructions: validation.instructions, recentBlockhash: row.recentBlockhash,
      lastValidBlockHeight: row.lastValidBlockHeight as number,
      expiresAt: typeof row.expiresAt === "string" ? row.expiresAt : null,
      source: "panta", environment: provider.environment ?? "unknown",
    };
    const ticketId = await updateTradeTicket(data.quoteId, "prepared", data.orderId, data.wallet, {
      instructions: data.instructions, recentBlockhash: data.recentBlockhash,
      lastValidBlockHeight: data.lastValidBlockHeight, fingerprint: validation.fingerprint,
      expiresAt: data.expiresAt, contextSlot: validation.contextSlot, validatedAt: new Date().toISOString(),
    });
    if (!ticketId) return NextResponse.json({ error: "This quote was prepared concurrently or expired. Request a fresh quote." }, { status: 409 });
    return NextResponse.json({ data, source: provider.source, environment: provider.environment ?? "unknown", status: "prepared", walletConfirmationRequired: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Transaction could not be prepared.", source: getProviderMode() }, { status: 502 });
  }
}
