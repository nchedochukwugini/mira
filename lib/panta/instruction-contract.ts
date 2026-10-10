import { createHash } from "node:crypto";

export type InstructionAccountMeta = { pubkey: string; isSigner: boolean; isWritable: boolean };
export type RawWalletInstruction = { programId: string; data: string; accounts: InstructionAccountMeta[] };
export type ContractInstruction = { programId: string; dataBase64: string; accounts: InstructionAccountMeta[] };

export function isRawWalletInstruction(value: unknown): value is RawWalletInstruction {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return typeof item.programId === "string" && item.programId.length > 0
    && typeof item.data === "string" && item.data.length > 0
    && Array.isArray(item.accounts)
    && item.accounts.every((account) => {
      if (!account || typeof account !== "object" || Array.isArray(account)) return false;
      const meta = account as Record<string, unknown>;
      return typeof meta.pubkey === "string" && meta.pubkey.length > 0
        && typeof meta.isSigner === "boolean" && typeof meta.isWritable === "boolean";
    });
}

/** Exact contract check, including full data bytes and ordered account privileges. */
export function validateExactInstructionList(actual: unknown, expected: readonly ContractInstruction[]): { valid: true; fingerprint: string } | { valid: false; reason: string } {
  if (!Array.isArray(actual) || actual.length !== expected.length) return { valid: false, reason: "unexpected_instruction_count" };
  const normalized: ContractInstruction[] = [];
  for (let index = 0; index < expected.length; index += 1) {
    const candidate = actual[index]; const contract = expected[index];
    if (!isRawWalletInstruction(candidate)) return { valid: false, reason: "malformed_instruction" };
    if (candidate.programId !== contract.programId) return { valid: false, reason: "unexpected_program_id" };
    let decoded: Buffer;
    try {
      decoded = Buffer.from(candidate.data, "base64");
      if (!decoded.length || decoded.toString("base64") !== candidate.data) return { valid: false, reason: "malformed_instruction_data" };
    } catch { return { valid: false, reason: "malformed_instruction_data" }; }
    if (candidate.data !== contract.dataBase64) return { valid: false, reason: "unexpected_discriminator_or_arguments" };
    if (candidate.accounts.length !== contract.accounts.length) return { valid: false, reason: "unexpected_account_count" };
    for (let accountIndex = 0; accountIndex < contract.accounts.length; accountIndex += 1) {
      const got = candidate.accounts[accountIndex]; const want = contract.accounts[accountIndex];
      if (got.pubkey !== want.pubkey || got.isSigner !== want.isSigner || got.isWritable !== want.isWritable) {
        return { valid: false, reason: "unexpected_account_or_account_meta" };
      }
    }
    normalized.push({ programId: candidate.programId, dataBase64: candidate.data, accounts: candidate.accounts });
  }
  return { valid: true, fingerprint: createHash("sha256").update(JSON.stringify(normalized)).digest("hex") };
}
