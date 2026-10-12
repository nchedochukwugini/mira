import assert from "node:assert/strict";
import test from "node:test";
import { fitsSecondaryTransactionLimits, MAX_SECONDARY_TRANSACTION_ACCOUNTS, MAX_SECONDARY_TRANSACTION_BYTES } from "./secondary-transaction-limits.ts";

test("accepts a v0 transaction at the conservative byte and account limits", () => {
  assert.equal(fitsSecondaryTransactionLimits({ serializedBytes: MAX_SECONDARY_TRANSACTION_BYTES, accountCount: MAX_SECONDARY_TRANSACTION_ACCOUNTS }), true);
});

test("rejects oversized or invalid secondary transaction sizes before persistence", () => {
  assert.equal(fitsSecondaryTransactionLimits({ serializedBytes: MAX_SECONDARY_TRANSACTION_BYTES + 1, accountCount: 20 }), false);
  assert.equal(fitsSecondaryTransactionLimits({ serializedBytes: 500, accountCount: MAX_SECONDARY_TRANSACTION_ACCOUNTS + 1 }), false);
  assert.equal(fitsSecondaryTransactionLimits({ serializedBytes: 0, accountCount: 1 }), false);
});
