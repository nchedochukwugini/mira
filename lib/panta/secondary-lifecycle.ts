import type { DecodedOrderNode } from "@/lib/panta/clob-layout";

export function matchesPersistedSecondaryMessage(input: {
  actual: Uint8Array | null | undefined; expectedBase64: string; actualBlockhash: string;
  expectedBlockhash: string; firstSigner: string | undefined; wallet: string; requiredSignatures: number | undefined;
}): boolean {
  if (!input.actual || input.actualBlockhash !== input.expectedBlockhash || input.firstSigner !== input.wallet || input.requiredSignatures !== 1) return false;
  const expected = Buffer.from(input.expectedBase64, "base64");
  return expected.length > 0 && expected.toString("base64") === input.expectedBase64 && Buffer.from(input.actual).equals(expected);
}

export type SecondaryReconciliation = { status: string; order: Record<string, unknown> };

/** Reconcile only state evidenced by the confirmed instruction and currently decoded OrderNode. */
export function reconcileSecondaryOrder(input: {
  operationType: "placement" | "cancellation"; transactionSucceeded: boolean; targetAddress: string;
  market: string; wallet: string; side: string | null; node: DecodedOrderNode | null;
}): SecondaryReconciliation {
  if (!input.transactionSucceeded) return { status: "not_required", order: { address: input.targetAddress, status: "transaction_failed" } };
  if (input.operationType === "cancellation") {
    if (!input.node) return { status: "reconciled", order: { address: input.targetAddress, status: "cancelled_account_closed", evidence: "Confirmed cancellation succeeded and the target account is absent at the reconciliation read." } };
    if (input.node.event !== input.market || input.node.owner !== input.wallet || input.node.side !== input.side) return { status: "mismatched_account", order: { address: input.targetAddress, status: "unknown", reason: "The current target account no longer matches the persisted owner and market." } };
    return { status: "pending", order: { address: input.targetAddress, status: "still_present_after_cancel", remainingShares: input.node.amount.toString() } };
  }
  if (!input.node) return { status: "outcome_unknown", order: { address: input.targetAddress, status: "unknown", reason: "OrderNode is absent; full fill, cancellation, or reaping cannot be distinguished from this account read alone." } };
  if (input.node.event !== input.market || input.node.owner !== input.wallet || input.node.side !== input.side || input.node.amount < BigInt(0) || input.node.originalAmount < input.node.amount) {
    return { status: "mismatched_account", order: { address: input.targetAddress, status: "unknown", reason: "Decoded OrderNode does not match the persisted operation." } };
  }
  const matched = input.node.originalAmount - input.node.amount;
  const state = input.node.amount === BigInt(0) ? "filled" : matched > BigInt(0) ? "partially_filled_open" : "open";
  return { status: "reconciled", order: { address: input.targetAddress, status: state, side: input.node.side, priceUnits: input.node.priceLamports.toString(), originalShares: input.node.originalAmount.toString(), remainingShares: input.node.amount.toString(), matchedShares: matched.toString(), settlement: "unknown; token and position accounting not inferred from OrderNode" } };
}
