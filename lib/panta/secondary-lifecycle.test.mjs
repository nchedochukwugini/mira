import assert from "node:assert/strict";
import test from "node:test";
import { matchesPersistedSecondaryMessage, reconcileSecondaryOrder } from "./secondary-lifecycle.ts";

const message = Buffer.from([1, 2, 3, 4]);
const valid = { actual: message, expectedBase64: message.toString("base64"), actualBlockhash: "blockhash", expectedBlockhash: "blockhash", firstSigner: "wallet", wallet: "wallet", requiredSignatures: 1 };

test("persisted secondary build binding rejects altered bytes, wallet, blockhash, or signer count", () => {
  assert.equal(matchesPersistedSecondaryMessage(valid), true);
  assert.equal(matchesPersistedSecondaryMessage({ ...valid, actual: Buffer.from([1, 2, 9, 4]) }), false);
  assert.equal(matchesPersistedSecondaryMessage({ ...valid, firstSigner: "other" }), false);
  assert.equal(matchesPersistedSecondaryMessage({ ...valid, actualBlockhash: "stale" }), false);
  assert.equal(matchesPersistedSecondaryMessage({ ...valid, requiredSignatures: 2 }), false);
  assert.equal(matchesPersistedSecondaryMessage({ ...valid, expectedBase64: "not-base64!" }), false);
});

const node = { address: "order", owner: "wallet", event: "market", priceLevel: "level", amount: 700_000n, originalAmount: 1_000_000n, side: "YES", orderType: "ask", intent: "sell", priceLamports: 500_000_000n, previous: "system", next: "system" };
const args = { operationType: "placement", transactionSucceeded: true, targetAddress: "order", market: "market", wallet: "wallet", side: "YES", node };

test("secondary order reconciliation distinguishes open, partial, full, canceled, failed, and unavailable state", () => {
  assert.equal(reconcileSecondaryOrder({ ...args, node: { ...node, amount: node.originalAmount } }).order.status, "open");
  assert.equal(reconcileSecondaryOrder(args).order.status, "partially_filled_open");
  assert.equal(reconcileSecondaryOrder({ ...args, node: { ...node, amount: 0n } }).order.status, "filled");
  assert.equal(reconcileSecondaryOrder({ ...args, node: null }).status, "outcome_unknown");
  assert.equal(reconcileSecondaryOrder({ ...args, transactionSucceeded: false }).order.status, "transaction_failed");
  assert.equal(reconcileSecondaryOrder({ ...args, operationType: "cancellation", node: null }).order.status, "cancelled_account_closed");
  assert.equal(reconcileSecondaryOrder({ ...args, operationType: "cancellation", node }).status, "pending");
  assert.equal(reconcileSecondaryOrder({ ...args, node: { ...node, owner: "another-wallet" } }).status, "mismatched_account");
});
