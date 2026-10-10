import { NextResponse } from "next/server";
import { getMarketProvider } from "@/lib/providers/market-provider";
import { getTradeTicketByOrderId, persistTransaction } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { orderId?: string; signature?: string; wallet?: string };
    if (!body.orderId || !body.signature || !body.wallet) return NextResponse.json({ error: "Panta order, transaction signature, and wallet are required." }, { status: 400 });
    const provider = getMarketProvider();
    if (provider.source !== "panta") return NextResponse.json({ error: "Demo transactions cannot be verified." }, { status: 409 });
    const ticket = await getTradeTicketByOrderId(body.orderId);
    if (!ticket || ticket.status !== "submitted" || ticket.wallet !== body.wallet || ticket.metadata?.submissionSignature !== body.signature) {
      return NextResponse.json({ error: "This signature is not the confirmed, validated submission attached to the connected wallet and order." }, { status: 409 });
    }
    const data = await provider.verifyTrade({ orderId: body.orderId, signature: body.signature, wallet: body.wallet });
    const statusValue = data && typeof data === "object" ? (data as Record<string, unknown>).status : undefined;
    const status = typeof statusValue === "string" ? statusValue : "unknown";
    try { await persistTransaction({ orderId: body.orderId, signature: body.signature, walletAddress: body.wallet, status, confirmed: /confirm|success|settled/i.test(status) }); } catch { /* Persistence must not change Panta verification behavior. */ }
    return NextResponse.json({ data, status, environment: provider.environment ?? "unknown" });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Panta could not verify the transaction." }, { status: 502 });
  }
}
