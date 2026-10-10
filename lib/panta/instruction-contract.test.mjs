import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("./instruction-contract.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const contract = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`);

const program = "6gM5afTQBq5VZCfgpGqcsqzfWd5maLSCKWtGjbEobZMp";
const key = (digit) => String(digit).repeat(32);
const user = "11111111111111111111111111111111";
const token = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const associated = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const accounts = [
  { pubkey: user, isSigner: true, isWritable: true },
  { pubkey: key("2"), isSigner: false, isWritable: true },
  { pubkey: key("3"), isSigner: false, isWritable: false },
  { pubkey: key("4"), isSigner: false, isWritable: false },
  { pubkey: key("5"), isSigner: false, isWritable: true },
  { pubkey: key("6"), isSigner: false, isWritable: true },
  { pubkey: key("7"), isSigner: false, isWritable: false },
  { pubkey: key("8"), isSigner: false, isWritable: true },
  { pubkey: key("9"), isSigner: false, isWritable: true },
  { pubkey: token, isSigner: false, isWritable: false },
  { pubkey: associated, isSigner: false, isWritable: false },
  { pubkey: "11111111111111111111111111111111", isSigner: false, isWritable: false },
];
const data = Buffer.alloc(17);
Buffer.from([46, 137, 68, 116, 49, 89, 13, 247]).copy(data, 0); // primary_order_usdc discriminator from later first-party IDL
data[8] = 0; // OrderSide::Yes
data.writeBigUInt64LE(1_000_000n, 9); // 1 USDC in six-decimal base units
const encoded = data.toString("base64");
const expected = [{ programId: program, dataBase64: encoded, accounts }];
const good = [{ programId: program, data: encoded, accounts }];

test("accepts an exact primary_order_usdc IDL fixture with expected account order and USDC amount", () => {
  const result = contract.validateExactInstructionList(good, expected);
  assert.equal(result.valid, true);
  assert.match(result.fingerprint, /^[a-f0-9]{64}$/);
});

test("rejects wrong Panta program IDs", () => {
  assert.equal(contract.validateExactInstructionList([{ ...good[0], programId: key("a") }], expected).reason, "unexpected_program_id");
});

test("rejects unknown discriminators and altered encoded arguments", () => {
  const unknown = Buffer.from(data); unknown[0] ^= 1;
  assert.equal(contract.validateExactInstructionList([{ ...good[0], data: unknown.toString("base64") }], expected).reason, "unexpected_discriminator_or_arguments");
  const altered = Buffer.from(data); altered.writeBigUInt64LE(2_000_000n, 9);
  assert.equal(contract.validateExactInstructionList([{ ...good[0], data: altered.toString("base64") }], expected).reason, "unexpected_discriminator_or_arguments");
});

test("rejects wrong account order, signer/writable escalation, and additional accounts", () => {
  const swapped = [...accounts]; [swapped[1], swapped[2]] = [swapped[2], swapped[1]];
  assert.equal(contract.validateExactInstructionList([{ ...good[0], accounts: swapped }], expected).reason, "unexpected_account_or_account_meta");
  const escalated = accounts.map((entry, index) => index === 6 ? { ...entry, isWritable: true } : entry);
  assert.equal(contract.validateExactInstructionList([{ ...good[0], accounts: escalated }], expected).reason, "unexpected_account_or_account_meta");
  assert.equal(contract.validateExactInstructionList([{ ...good[0], accounts: [...accounts, accounts[0]] }], expected).reason, "unexpected_account_count");
});

test("rejects unexpected extra instructions, including unapproved token operations", () => {
  assert.equal(contract.validateExactInstructionList([...good, good[0]], expected).reason, "unexpected_instruction_count");
});

test("rejects malformed and unknown instruction shapes", () => {
  assert.equal(contract.validateExactInstructionList([{ programId: program, data: "!", accounts: [] }], expected).reason, "malformed_instruction_data");
  assert.equal(contract.validateExactInstructionList([{ programId: program, data: encoded, accounts: [{ pubkey: user, isSigner: "yes", isWritable: true }] }], expected).reason, "malformed_instruction");
});
