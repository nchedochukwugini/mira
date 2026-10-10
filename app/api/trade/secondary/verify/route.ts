import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { getSecondaryOperation, recordSecondaryReconciliation } from "@/lib/db";
import { decodeOrderNode, PANTA_CLOB_PROGRAM_ID } from "@/lib/panta/clob-layout";
import { assertSolanaMainnet, createSolanaMainnetConnection } from "@/lib/solana/rpc";
import { reconcileSecondaryOrder } from "@/lib/panta/secondary-lifecycle";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { operationId?: string; wallet?: string; signature?: string };
    if (!body.operationId || !body.wallet || !body.signature) return NextResponse.json({ error: "Operation ID, wallet, and signature are required." }, { status: 400 });
    const operation = await getSecondaryOperation(body.operationId);
    if (!operation || operation.wallet_address !== body.wallet || operation.signature !== body.signature) return NextResponse.json({ error: "Signature is not bound to this persisted secondary operation and wallet." }, { status: 409 });
    if (operation.status !== "confirmed") return NextResponse.json({ status: operation.status, reconciliationStatus: operation.reconciliation_status, chainResult: operation.chain_result });
    const connection = createSolanaMainnetConnection();
    await assertSolanaMainnet(connection);
    const rawIx = operation.expected_instructions[0] as { accounts?: Array<{ pubkey?: string }> } | undefined;
    const target = operation.operation_type === "placement" ? rawIx?.accounts?.[5]?.pubkey : operation.target_order;
    if (!target) return NextResponse.json({ status: "confirmed_execution", reconciliationStatus: "incomplete_metadata" });
    const account = await connection.getAccountInfo(new PublicKey(target), "confirmed");
    if (account && !account.owner.equals(new PublicKey(PANTA_CLOB_PROGRAM_ID))) return NextResponse.json({ status: "confirmed_execution", reconciliationStatus: "malformed_account" });
    const decoded = account ? decodeOrderNode(target, account.data) : null;
    if (account && !decoded) return NextResponse.json({ status: "confirmed_execution", reconciliationStatus: "malformed_account" });
    const chainResult = operation.chain_result as { err?: unknown } | null;
    const result = reconcileSecondaryOrder({ operationType: operation.operation_type, transactionSucceeded: chainResult?.err === null,
      targetAddress: target, market: operation.market_id, wallet: operation.wallet_address, side: operation.side, node: decoded });
    await recordSecondaryReconciliation({ id: operation.id, status: result.status, order: result.order });
    return NextResponse.json({ status: "confirmed_execution", reconciliationStatus: result.status, order: result.order });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Secondary order reconciliation is unavailable.", status: "reconciliation_pending" }, { status: 503 });
  }
}
