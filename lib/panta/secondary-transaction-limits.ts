/** Conservative v0 transaction limits used by MIRA's unsigned secondary builder. */
export const MAX_SECONDARY_TRANSACTION_BYTES = 1_232;
export const MAX_SECONDARY_TRANSACTION_ACCOUNTS = 64;

export function fitsSecondaryTransactionLimits(input: { serializedBytes: number; accountCount: number }): boolean {
  return Number.isSafeInteger(input.serializedBytes) && input.serializedBytes > 0
    && input.serializedBytes <= MAX_SECONDARY_TRANSACTION_BYTES
    && Number.isSafeInteger(input.accountCount) && input.accountCount > 0
    && input.accountCount <= MAX_SECONDARY_TRANSACTION_ACCOUNTS;
}
