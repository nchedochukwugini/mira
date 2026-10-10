import { NextResponse } from "next/server";
import { claimSecondaryNotification, claimSecondaryOperation, finishSecondaryNotification, getSecondaryOperation, recordSecondaryExecution } from "@/lib/db";
import { assertSolanaMainnet, createSolanaMainnetConnection } from "@/lib/solana/rpc";
import { isSolanaSignature } from "@/lib/panta/transaction-security";
import { getMarketProvider } from "@/lib/providers/market-provider";
import { matchesPersistedSecondaryMessage } from "@/lib/panta/secondary-lifecycle";

export const dynamic = "force-dynamic";

async function notifyPanta(op: NonNullable<Awaited<ReturnType<typeof getSecondaryOperation>>>, signature: string) {
  if (op.notification_status === "delivered") return "delivered";
  if (!await claimSecondaryNotification({ id: op.id, signature })) {
    const fresh = await getSecondaryOperation(op.id);
    return fresh?.notification_status === "failed" || fresh?.notification_status === "pending" ? "pending" : fresh?.notification_status ?? "pending";
  }
  try {
    const provider = getMarketProvider();
    if (provider.source !== "panta") throw new Error("Panta provider is unavailable for secondary attribution.");
    // The existing generic /trades/ attribution call is keyed by signature. It is
    // distinct from /primaryordersubmit/ and is retried only with this same signature.
    await provider.attributeTrade({ signature, marketId: op.market_id, wallet: op.wallet_address });
    await finishSecondaryNotification({ id: op.id, signature, delivered: true });
    return "delivered";
  } catch {
    await finishSecondaryNotification({ id: op.id, signature, delivered: false });
    return "pending";
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { operationId?: string; signature?: string; wallet?: string };
    if (!body.operationId || !body.signature || !body.wallet || !isSolanaSignature(body.signature)) return NextResponse.json({ error: "A secondary operation ID, wallet, and valid Solana signature are required." }, { status: 400 });
    const op = await getSecondaryOperation(body.operationId);
    if (!op || op.wallet_address !== body.wallet || op.cluster !== "mainnet-beta") return NextResponse.json({ error: "Secondary build does not match the wallet or expected mainnet cluster." }, { status: 409 });
    if ((op.status === "confirmed" || op.status === "failed") && op.signature !== body.signature) return NextResponse.json({ error: "The persisted operation is already bound to a different signature." }, { status: 409 });
    if (op.status === "failed") return NextResponse.json({ status: "failed", idempotent: true, chainResult: op.chain_result });
    if (op.status === "confirmed") {
      const notificationStatus = await notifyPanta(op, body.signature);
      return NextResponse.json({ status: "confirmed_execution", idempotent: true, chainResult: op.chain_result, reconciliationStatus: op.reconciliation_status, notificationStatus });
    }
    const connection = createSolanaMainnetConnection();
    await assertSolanaMainnet(connection);
    const transaction = await connection.getTransaction(body.signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    if (!transaction) {
      const status = await connection.getSignatureStatuses([body.signature], { searchTransactionHistory: true });
      return NextResponse.json({ status: status.value[0]?.err ? "failed_metadata_pending" : "confirmation_pending", signature: body.signature, retrySafe: false }, { status: 202 });
    }
    const message = transaction.transaction.message as unknown as { serialize?: () => Uint8Array; staticAccountKeys?: Array<{ toBase58(): string }>; accountKeys?: Array<{ toBase58(): string }>; header?: { numRequiredSignatures: number }; recentBlockhash: string };
    const serialized = message.serialize?.();
    const signatureValue = transaction.transaction.signatures?.[0];
    const keys = message.staticAccountKeys ?? message.accountKeys ?? [];
    const exactMessage = matchesPersistedSecondaryMessage({ actual: serialized, expectedBase64: op.expected_message_base64,
      actualBlockhash: message.recentBlockhash, expectedBlockhash: op.recent_blockhash,
      firstSigner: keys[0]?.toBase58(), wallet: body.wallet, requiredSignatures: message.header?.numRequiredSignatures });
    if (!exactMessage) return NextResponse.json({ error: "On-chain message bytes do not match the persisted secondary validated build." }, { status: 409 });
    // Confirm the RPC transaction itself corresponds to the submitted base58 signature.
    const signatureMatches = typeof signatureValue === "string" ? signatureValue === body.signature : false;
    if (!signatureMatches) return NextResponse.json({ error: "RPC transaction signature does not match the submitted signature." }, { status: 409 });
    if (!transaction.meta) return NextResponse.json({ status: "execution_metadata_pending", signature: body.signature, retrySafe: false }, { status: 202 });
    const claim = await claimSecondaryOperation({ id: op.id, wallet: body.wallet, signature: body.signature, verifiedOnChain: true });
    if (claim === "conflict") return NextResponse.json({ error: "This operation is expired, already claimed by another signature, or does not match the connected wallet." }, { status: 409 });
    if (claim === "failed") return NextResponse.json({ status: claim, idempotent: true, chainResult: op.chain_result, reconciliationStatus: op.reconciliation_status });
    if (claim === "confirmed") {
      const notificationStatus = await notifyPanta(op, body.signature);
      return NextResponse.json({ status: "confirmed_execution", idempotent: true, chainResult: op.chain_result, reconciliationStatus: op.reconciliation_status, notificationStatus });
    }
    const succeeded = transaction.meta.err === null;
    const saved = await recordSecondaryExecution({ id: op.id, signature: body.signature, status: succeeded ? "confirmed" : "failed", result: {
      slot: transaction.slot, err: transaction.meta?.err ?? null, confirmationStatus: "confirmed",
      logMessages: transaction.meta?.logMessages ?? [], messageBase64: op.expected_message_base64,
    } });
    if (!saved) return NextResponse.json({ error: "Execution result could not be persisted; retry this same operation and signature." }, { status: 503 });
    const notificationStatus = succeeded ? await notifyPanta(op, body.signature) : "not_applicable";
    return NextResponse.json({ status: succeeded ? "confirmed_execution" : "failed", signature: body.signature, reconciliationStatus: succeeded ? "pending" : "not_required", notificationStatus });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Secondary transaction verification is temporarily unavailable.", retrySafe: false }, { status: 503 });
  }
}
