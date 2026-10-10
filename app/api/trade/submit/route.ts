import { NextResponse } from "next/server";
import { getMarketProvider } from "@/lib/providers/market-provider";
import { claimTradeTicketForSubmission, getTradeTicketByOrderId, markTradeTicketSubmitted, persistTransaction } from "@/lib/db";
import { isQuoteExpired, isTradeEligibleMarket, tradeIneligibilityReason } from "@/lib/panta/trade-safety";
import { isSolanaSignature, validateObservedTransaction, type WalletInstruction } from "@/lib/panta/transaction-security";
import { assertSolanaMainnet, createSolanaMainnetConnection } from "@/lib/solana/rpc";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { orderId?: string; signature?: string; wallet?: string };
    if (!body.orderId || !body.signature || !body.wallet) return NextResponse.json({ error: "Panta order, real transaction signature, and wallet are required." }, { status: 400 });
    if (!isSolanaSignature(body.signature)) return NextResponse.json({ error: "A valid Solana transaction signature is required." }, { status: 400 });
    const provider = getMarketProvider();
    if (provider.source !== "panta") return NextResponse.json({ error: "Demo transactions cannot be submitted." }, { status: 409 });
    const ticket = await getTradeTicketByOrderId(body.orderId);
    const validation = ticket?.metadata?.buildValidation;
    if (!ticket || ticket.status !== "prepared" || ticket.wallet !== body.wallet || !validation?.fingerprint
      || !Array.isArray(validation.instructions) || typeof validation.recentBlockhash !== "string"
      || (typeof validation.expiresAt === "string" && isQuoteExpired(validation.expiresAt))
      || isQuoteExpired(ticket.expires_at ? new Date(ticket.expires_at).toISOString() : null)) {
      return NextResponse.json({ error: "This trade has no current server-validated build ticket, is expired, or does not match the connected wallet. Request a newly validated build." }, { status: 409 });
    }
    const market = await provider.getMarket(String(ticket.market_id));
    if (!market || !isTradeEligibleMarket(market)) return NextResponse.json({ error: `${tradeIneligibilityReason(market)} The submitted transaction was not sent to Panta.` }, { status: 409 });
    let chainTransaction;
    try {
      const connection = createSolanaMainnetConnection();
      await assertSolanaMainnet(connection);
      chainTransaction = await connection.getTransaction(body.signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    } catch {
      return NextResponse.json({ error: "MIRA could not verify this signature on the configured Solana mainnet RPC. Panta was not notified." }, { status: 503 });
    }
    if (!chainTransaction || !validateObservedTransaction({ transaction: chainTransaction, signature: body.signature, wallet: body.wallet, recentBlockhash: validation.recentBlockhash, instructions: validation.instructions as WalletInstruction[] })) {
      return NextResponse.json({ error: "The confirmed chain transaction does not exactly match the validated build ticket. Panta was not notified." }, { status: 409 });
    }
    const claimed = await claimTradeTicketForSubmission({ orderId: body.orderId, wallet: body.wallet, signature: body.signature });
    if (!claimed) return NextResponse.json({ error: "This validated trade ticket or transaction signature has already been claimed for submission. Do not retry." }, { status: 409 });
    const data = await provider.submitTrade({ orderId: body.orderId, signature: body.signature, wallet: body.wallet });
    try { await persistTransaction({ orderId: body.orderId, signature: body.signature, walletAddress: body.wallet, status: "submitted" }); } catch { /* Persistence must not change the Panta submission response. */ }
    await markTradeTicketSubmitted(body.orderId, body.signature);
    return NextResponse.json({ data, status: "submitted", environment: provider.environment ?? "unknown" });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Panta could not register the broadcast transaction." }, { status: 502 });
  }
}
