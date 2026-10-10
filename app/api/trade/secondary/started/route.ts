import { NextResponse } from "next/server";
import { getSecondaryOperation, recordSecondarySubmissionInitiated } from "@/lib/db";
import { assertSolanaMainnet, createSolanaMainnetConnection } from "@/lib/solana/rpc";
import { isSolanaSignature } from "@/lib/panta/transaction-security";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { operationId?: string; signature?: string; wallet?: string };
    if (!body.operationId || !body.signature || !body.wallet || !isSolanaSignature(body.signature)) return NextResponse.json({ error: "Operation ID, wallet, and signature are required." }, { status: 400 });
    const operation = await getSecondaryOperation(body.operationId);
    if (!operation || operation.wallet_address !== body.wallet || operation.cluster !== "mainnet-beta") return NextResponse.json({ error: "Submission does not match a persisted mainnet build and wallet." }, { status: 409 });
    const connection = createSolanaMainnetConnection(); await assertSolanaMainnet(connection);
    const response = await connection.getSignatureStatuses([body.signature], { searchTransactionHistory: true });
    const observed = response.value[0];
    if (!observed) return NextResponse.json({ status: "broadcast_not_seen", retrySameSignature: true }, { status: 202 });
    if (!await recordSecondarySubmissionInitiated({ id: operation.id, wallet: body.wallet, signature: body.signature, seenOnChain: true })) {
      const existing = await getSecondaryOperation(operation.id);
      if (existing?.signature !== body.signature) return NextResponse.json({ error: "A different signature already claimed this operation." }, { status: 409 });
    }
    return NextResponse.json({ status: "submission_initiated", signature: body.signature, observedStatus: observed.confirmationStatus ?? "processed", executionError: observed.err });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not record the observed submission.", retrySameSignature: true }, { status: 503 });
  }
}
