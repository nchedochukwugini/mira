import "server-only";
import { createHash } from "node:crypto";
import { PublicKey, SystemProgram, type VersionedTransactionResponse } from "@solana/web3.js";
import { assertSolanaMainnet, createSolanaMainnetConnection } from "@/lib/solana/rpc";
import { decodePantaEvent, PANTA_CLOB_PROGRAM_ID } from "@/lib/panta/clob-layout";
import { SOLANA_MAINNET_USDC_MINT } from "@/lib/panta/quote-asset";
import { isRawWalletInstruction, validateExactInstructionList, type ContractInstruction, type InstructionAccountMeta, type RawWalletInstruction } from "@/lib/panta/instruction-contract";

// Instruction discriminators, account order, flags, arguments, and PDA seeds
// below come from the later (57-instruction) v0.1.0 IDL embedded in Panta's
// first-party 5217-4e9bf78d0b5a7a4b.js bundle. The older 34-instruction IDL
// earlier in that bundle is incomplete. This is a frontend contract; the
// deployed ELF correspondence remains an audit limitation.
const PROGRAM_ID = PANTA_CLOB_PROGRAM_ID;
const MARKET_CONFIG_DISC = Buffer.from([119, 255, 200, 88, 252, 82, 128, 24]);
const PRIMARY_USDC_DISC = Buffer.from([46, 137, 68, 116, 49, 89, 13, 247]);
const CLAIM_WIN_USDC_DISC = Buffer.from([43, 160, 106, 51, 167, 76, 20, 31]);
const CLAIM_TOKENS_USDC_DISC = Buffer.from([59, 240, 239, 57, 94, 149, 99, 18]);
const CLAIM_REFUND_USDC_DISC = Buffer.from([118, 230, 150, 158, 65, 72, 132, 91]);
const CLAIM_CREATOR_FEES_USDC_DISC = Buffer.from([67, 147, 236, 151, 125, 181, 138, 0]);
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const ASSOCIATED_TOKEN_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const TOKEN_ACCOUNT_SIZE = 165;
const MARKET_CONFIG_SIZE = 356;

export type InstructionMeta = InstructionAccountMeta;
export type WalletInstruction = RawWalletInstruction;
export type PantaInstructionBuild = { instructions: WalletInstruction[]; recentBlockhash?: string; lastValidBlockHeight?: number | null };

export function isSolanaSignature(value: string): boolean {
  try { const decoded = decodeBase58(value); return decoded.length === 64 && base58Encode(decoded) === value; } catch { return false; }
}

export type PantaBuildContext = {
  event: PublicKey;
  creator: PublicKey;
  question: string;
  marketConfig: PublicKey;
  vaultAuthority: PublicKey;
  vaultTokenAccount: PublicKey;
  userPosition: (user: PublicKey) => PublicKey;
  usdcMint: PublicKey;
  treasury: PublicKey;
  treasuryTokenAccount: PublicKey;
  creatorFeeVault: PublicKey;
  creatorFeeVaultTokenAccount: PublicKey;
  ata: (owner: PublicKey) => PublicKey;
  eventState: NonNullable<ReturnType<typeof decodePantaEvent>>;
  slot: number;
  priceTickSize: bigint;
  maxTraversePerTx: number;
};

function u64(value: bigint): Buffer {
  if (value < BigInt(0) || value > BigInt("18446744073709551615")) throw new Error("Instruction amount is outside u64 range.");
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(value);
  return bytes;
}

function base64(bytes: Buffer): string { return bytes.toString("base64"); }

function pubkey(value: string): PublicKey {
  try { return new PublicKey(value); } catch { throw new Error("A wallet or market identifier is not a valid Solana public key."); }
}

function associatedTokenAddress(owner: PublicKey, mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([
    owner.toBuffer(), new PublicKey(TOKEN_PROGRAM).toBuffer(), mint.toBuffer(),
  ], new PublicKey(ASSOCIATED_TOKEN_PROGRAM))[0];
}

function derivePda(seeds: (Buffer | Uint8Array)[]): PublicKey {
  return PublicKey.findProgramAddressSync(seeds, new PublicKey(PROGRAM_ID))[0];
}

function pubkeyMeta(key: PublicKey, isSigner = false, isWritable = false): InstructionMeta {
  return { pubkey: key.toBase58(), isSigner, isWritable };
}

function sha256(value: string): Buffer { return createHash("sha256").update(value, "utf8").digest(); }

function decodeConfig(data: Buffer): { treasury: PublicKey; usdcMint: PublicKey; priceTickSize: bigint; maxTraversePerTx: number } {
  if (data.length !== MARKET_CONFIG_SIZE || !data.subarray(0, 8).equals(MARKET_CONFIG_DISC)) {
    throw new Error("Panta MarketConfig does not match the complete 356-byte frontend IDL layout.");
  }
  return {
    treasury: new PublicKey(data.subarray(136, 168)),
    usdcMint: new PublicKey(data.subarray(244, 276)),
    // Later 57-instruction frontend IDL field order: max_traverse_per_tx at 224,
    // price_tick_size_usdc at 300. Keep this secondary-specific; primary is unchanged.
    maxTraversePerTx: data.readUInt32LE(224),
    priceTickSize: data.readBigUInt64LE(300),
  };
}

/** Read the event and MarketConfig from the configured mainnet RPC. */
export async function readPantaBuildContext(eventAddress: string, rpc = createSolanaMainnetConnection()): Promise<PantaBuildContext> {
  const event = pubkey(eventAddress);
  const program = new PublicKey(PROGRAM_ID);
  const marketConfig = derivePda([Buffer.from("market_config")]);
  const connection = rpc;
  await assertSolanaMainnet(connection);
  const response = await connection.getMultipleAccountsInfoAndContext([event, marketConfig], { commitment: "confirmed" });
  const [eventInfo, configInfo] = response.value;
  if (!eventInfo || !eventInfo.owner.equals(program)) throw new Error("The market address is not a Panta-owned Event account.");
  if (!configInfo || !configInfo.owner.equals(program)) throw new Error("The Panta MarketConfig account is missing or has an unexpected owner.");
  const eventState = decodePantaEvent(eventInfo.data);
  if (!eventState) throw new Error("The Panta Event account does not match the published frontend layout.");
  const config = decodeConfig(configInfo.data);
  const mintInfo = await connection.getAccountInfoAndContext(config.usdcMint, { commitment: "confirmed", minContextSlot: response.context.slot });
  if (!config.usdcMint.equals(new PublicKey(SOLANA_MAINNET_USDC_MINT)) || !mintInfo.value || !mintInfo.value.owner.equals(new PublicKey(TOKEN_PROGRAM)) || mintInfo.value.data.length !== 82
    || mintInfo.value.data[44] !== 6 || mintInfo.value.data[45] !== 1) {
    throw new Error("MarketConfig does not reference an initialized six-decimal SPL USDC mint.");
  }
  const vaultAuthority = derivePda([Buffer.from("vault_usdc"), eventState.creatorBytes, sha256(eventState.question)]);
  const vaultTokenAccount = associatedTokenAddress(vaultAuthority, config.usdcMint);
  const creatorFeeVault = derivePda([Buffer.from("creator_fee_vault_usdc"), event.toBuffer()]);
  const creatorFeeVaultTokenAccount = associatedTokenAddress(creatorFeeVault, config.usdcMint);
  return {
    event, creator: new PublicKey(eventState.creator), question: eventState.question, marketConfig,
    vaultAuthority, vaultTokenAccount,
    userPosition: (user) => derivePda([Buffer.from("position"), event.toBuffer(), user.toBuffer()]),
    usdcMint: config.usdcMint,
    treasury: config.treasury,
    treasuryTokenAccount: associatedTokenAddress(config.treasury, config.usdcMint),
    creatorFeeVault, creatorFeeVaultTokenAccount,
    ata: (owner) => associatedTokenAddress(owner, config.usdcMint), eventState, slot: response.context.slot,
    priceTickSize: config.priceTickSize, maxTraversePerTx: config.maxTraversePerTx,
  };
}

async function requireFreshBlockhash(blockhash: unknown, lastValidBlockHeight: unknown): Promise<string> {
  if (typeof blockhash !== "string" || !Number.isInteger(lastValidBlockHeight)) throw new Error("Panta omitted the blockhash or last valid block height; the build cannot be freshness-checked.");
  const blockhashKey = pubkey(blockhash);
  const connection = createSolanaMainnetConnection();
  await assertSolanaMainnet(connection);
  const [valid, height] = await Promise.all([
    connection.isBlockhashValid(blockhashKey.toBase58(), { commitment: "confirmed" }),
    connection.getBlockHeight("confirmed"),
  ]);
  if (!valid.value || height > (lastValidBlockHeight as number)) throw new Error("Panta returned a stale or expired blockhash.");
  return blockhashKey.toBase58();
}

function parseInstructions(value: unknown): WalletInstruction[] {
  if (!Array.isArray(value) || value.length === 0 || !value.every(isWalletInstruction)) {
    throw new Error("Panta returned malformed or missing instructions; no transaction was returned.");
  }
  return value;
}

export function isWalletInstruction(value: unknown): value is WalletInstruction {
  return isRawWalletInstruction(value);
}

function decodeData(ix: WalletInstruction): Buffer {
  const bytes = Buffer.from(ix.data, "base64");
  if (!bytes.length || bytes.toString("base64") !== ix.data) throw new Error("Panta returned malformed instruction data.");
  return bytes;
}

function requireExactInstruction(actual: WalletInstruction, programId: string, data: Buffer, accounts: InstructionMeta[], label: string): void {
  const expected: ContractInstruction = { programId, dataBase64: base64(data), accounts };
  const result = validateExactInstructionList([actual], [expected]);
  if (!result.valid) throw new Error(`${label}: ${result.reason.replaceAll("_", " ")}.`);
}

function fingerprint(instructions: readonly WalletInstruction[], binding: unknown): string {
  return createHash("sha256").update(JSON.stringify({ instructions, binding })).digest("hex");
}

function usdcBaseUnits(value: string | number): bigint {
  const text = String(value);
  if (!/^\d+(?:\.\d{1,6})?$/.test(text)) throw new Error("Quoted USDC amount cannot be represented exactly in token base units.");
  const [whole, fraction = ""] = text.split(".");
  return BigInt(whole) * BigInt(1_000_000) + BigInt(fraction.padEnd(6, "0"));
}

export async function validatePrimaryBuild(input: {
  raw: unknown; wallet: string; eventAddress: string; side: "YES" | "NO"; amountUsdc: string | number; quoteId: string;
}): Promise<{ instructions: WalletInstruction[]; fingerprint: string; contextSlot: number }> {
  const row = input.raw && typeof input.raw === "object" && !Array.isArray(input.raw) ? input.raw as Record<string, unknown> : {};
  const instructions = parseInstructions(row.instructions);
  const context = await readPantaBuildContext(input.eventAddress);
  const recentBlockhash = await requireFreshBlockhash(row.recentBlockhash, row.lastValidBlockHeight);
  if (!context.eventState.isActive || context.eventState.isGraduated || context.eventState.isResolved || context.eventState.isCancelled) {
    throw new Error("The on-chain Event is not in the primary trading state.");
  }
  const user = pubkey(input.wallet);
  const side = input.side === "YES" ? 0 : 1;
  const data = Buffer.concat([PRIMARY_USDC_DISC, Buffer.from([side]), u64(usdcBaseUnits(input.amountUsdc))]);
  const expectedAccounts = [
    pubkeyMeta(user, true, true), pubkeyMeta(context.event, false, true), pubkeyMeta(context.marketConfig),
    pubkeyMeta(context.vaultAuthority), pubkeyMeta(context.vaultTokenAccount, false, true),
    pubkeyMeta(context.userPosition(user), false, true), pubkeyMeta(context.usdcMint),
    pubkeyMeta(context.ata(user), false, true), pubkeyMeta(context.treasuryTokenAccount, false, true),
    pubkeyMeta(new PublicKey(TOKEN_PROGRAM)), pubkeyMeta(new PublicKey(ASSOCIATED_TOKEN_PROGRAM)), pubkeyMeta(SystemProgram.programId),
  ];
  if (instructions.length !== 1) throw new Error("Primary build contains an unexpected extra instruction or token operation.");
  requireExactInstruction(instructions[0], PROGRAM_ID, data, expectedAccounts, "Primary USDC order");
  let returnedAmountMatches = false;
  try { returnedAmountMatches = usdcBaseUnits(String(row.amountUsdc)) === usdcBaseUnits(input.amountUsdc); } catch { /* rejected below */ }
  if (row.quoteId !== input.quoteId || row.wallet !== user.toBase58() || row.marketId !== context.event.toBase58()
    || row.side !== input.side.toLowerCase() || !returnedAmountMatches) {
    throw new Error("Panta build fields do not match the quoted wallet, market, side, amount, and quote.");
  }
  return {
    instructions,
    fingerprint: fingerprint(instructions, { wallet: user.toBase58(), event: context.event.toBase58(), quoteId: input.quoteId, side: input.side, amountBaseUnits: usdcBaseUnits(input.amountUsdc).toString(), recentBlockhash }),
    contextSlot: context.slot,
  };
}

function pubkeyArg(data: Buffer, offset = 8): string {
  if (data.length !== offset + 32) throw new Error("Claim instruction has unexpected argument bytes.");
  return new PublicKey(data.subarray(offset, offset + 32)).toBase58();
}

export async function validateClaimBuild(input: { raw: unknown; wallet: string; eventAddress: string }): Promise<{ instructions: WalletInstruction[]; fingerprint: string; contextSlot: number; claim: string }> {
  const row = input.raw && typeof input.raw === "object" && !Array.isArray(input.raw) ? input.raw as Record<string, unknown> : {};
  const instructions = parseInstructions(row.instructions);
  const context = await readPantaBuildContext(input.eventAddress);
  await requireFreshBlockhash(row.recentBlockhash, row.lastValidBlockHeight);
  const user = pubkey(input.wallet);
  if (instructions.length !== 1) throw new Error("Claim build contains an unexpected extra instruction or token operation.");
  const ix = instructions[0];
  if (ix.programId !== PROGRAM_ID) throw new Error("Claim build targets an unexpected program ID.");
  const data = decodeData(ix);
  const signer = pubkeyMeta(user, true, true);
  const ro = (key: PublicKey) => pubkeyMeta(key);
  const rw = (key: PublicKey) => pubkeyMeta(key, false, true);
  const token = new PublicKey(TOKEN_PROGRAM); const associated = new PublicKey(ASSOCIATED_TOKEN_PROGRAM);
  let claim: string; let expectedData: Buffer; let accounts: InstructionMeta[];
  if (data.subarray(0, 8).equals(CLAIM_WIN_USDC_DISC)) {
    if (pubkeyArg(data) !== user.toBase58()) throw new Error("Win claim user argument must match the connected wallet.");
    claim = "claim_win_usdc"; expectedData = Buffer.concat([CLAIM_WIN_USDC_DISC, user.toBuffer()]);
    accounts = [signer, ro(context.marketConfig), ro(context.event), ro(context.vaultAuthority), rw(context.vaultTokenAccount), ro(context.userPosition(user)), rw(derivePda([Buffer.from("win_claim"), context.event.toBuffer(), user.toBuffer()])), rw(context.ata(user)), ro(context.usdcMint), ro(token), ro(associated), ro(SystemProgram.programId)];
  } else if (data.subarray(0, 8).equals(CLAIM_TOKENS_USDC_DISC)) {
    if (data.length !== 41 || data[40] !== 0 || pubkeyArg(data) !== user.toBase58()) throw new Error("Token claim must be an owner claim for the full available amount.");
    claim = "claim_tokens_usdc"; expectedData = Buffer.concat([CLAIM_TOKENS_USDC_DISC, user.toBuffer(), Buffer.from([0])]);
    accounts = [signer, ro(context.marketConfig), ro(context.event), ro(context.vaultAuthority), rw(context.vaultTokenAccount), rw(context.userPosition(user)), rw(context.ata(user)), ro(context.usdcMint), ro(token), ro(associated), ro(SystemProgram.programId)];
  } else if (data.subarray(0, 8).equals(CLAIM_REFUND_USDC_DISC)) {
    if (pubkeyArg(data) !== user.toBase58()) throw new Error("Refund claim user argument must match the connected wallet.");
    claim = "claim_primary_refund_usdc"; expectedData = Buffer.concat([CLAIM_REFUND_USDC_DISC, user.toBuffer()]);
    accounts = [signer, ro(context.marketConfig), rw(context.event), ro(context.vaultAuthority), rw(context.vaultTokenAccount), rw(context.userPosition(user)), rw(context.ata(user)), ro(context.usdcMint), ro(token), ro(associated), ro(SystemProgram.programId)];
  } else if (data.equals(CLAIM_CREATOR_FEES_USDC_DISC)) {
    if (!context.creator.equals(user)) throw new Error("Creator fee claims require the event creator's wallet signer.");
    claim = "claim_creator_fees_usdc"; expectedData = CLAIM_CREATOR_FEES_USDC_DISC;
    accounts = [signer, ro(context.marketConfig), ro(context.event), rw(context.creatorFeeVault), rw(context.creatorFeeVaultTokenAccount), rw(context.ata(user)), ro(context.usdcMint), ro(token), ro(associated), ro(SystemProgram.programId)];
  } else {
    throw new Error("Panta claim instruction is not one of the owner-authorized USDC claim operations in the first-party IDL.");
  }
  requireExactInstruction(ix, PROGRAM_ID, expectedData, accounts, `Claim ${claim}`);
  const recipientAta = claim === "claim_creator_fees_usdc" ? context.ata(user) : context.ata(user);
  const rpc = createSolanaMainnetConnection();
  const ataInfo = await rpc.getAccountInfoAndContext(recipientAta, { commitment: "confirmed", minContextSlot: context.slot });
  if (!ataInfo.value || !ataInfo.value.owner.equals(token) || ataInfo.value.data.length !== TOKEN_ACCOUNT_SIZE
    || !new PublicKey(ataInfo.value.data.subarray(0, 32)).equals(context.usdcMint)
    || !new PublicKey(ataInfo.value.data.subarray(32, 64)).equals(user)) {
    throw new Error("The claim recipient USDC token account is missing or does not belong to the signing wallet.");
  }
  return { instructions, fingerprint: fingerprint(instructions, { wallet: user.toBase58(), event: context.event.toBase58(), claim }), contextSlot: context.slot, claim };
}

/** Return a normalized view of a confirmed transaction for exact submit-time comparison. */
export function validateObservedTransaction(input: {
  transaction: VersionedTransactionResponse; signature: string; wallet: string; recentBlockhash: string; instructions: readonly WalletInstruction[];
}): boolean {
  const tx = input.transaction;
  if (!tx?.meta || tx.meta.err !== null || !tx.transaction?.signatures || !tx.transaction.signatures.length || !tx.transaction.message) return false;
  const message = tx.transaction.message as unknown as {
    addressTableLookups?: readonly unknown[];
    staticAccountKeys?: PublicKey[];
    accountKeys?: PublicKey[];
    recentBlockhash: string;
    header?: { numRequiredSignatures: number };
    compiledInstructions?: Array<{ programIdIndex: number; accountKeyIndexes?: number[]; accounts?: number[]; data?: string }>;
    isAccountSigner(index: number): boolean;
    isAccountWritable(index: number): boolean;
  };
  if (message.addressTableLookups?.length) return false;
  const keys: PublicKey[] = message.staticAccountKeys ?? message.accountKeys ?? [];
  if (!keys.length || !keys[0].equals(pubkey(input.wallet)) || message.recentBlockhash !== input.recentBlockhash) return false;
  if (message.header?.numRequiredSignatures !== 1) return false;
  const expectedKeys = new Set<string>([input.wallet]);
  for (const instruction of input.instructions) {
    expectedKeys.add(instruction.programId);
    instruction.accounts.forEach((account) => expectedKeys.add(account.pubkey));
  }
  if (keys.length !== expectedKeys.size || keys.some((key) => !expectedKeys.has(key.toBase58()))) return false;
  const sigValue = tx.transaction.signatures[0];
  const sig58 = typeof sigValue === "string" ? sigValue : base58Encode(Buffer.from(sigValue));
  if (sig58 !== input.signature) return false;
  const actual = message.compiledInstructions;
  if (!actual || actual.length !== input.instructions.length) return false;
  for (let i = 0; i < actual.length; i += 1) {
    const got = actual[i]; const expected = input.instructions[i];
    const program = keys[got.programIdIndex]?.toBase58();
    if (program !== expected.programId) return false;
    const indexes = got.accountKeyIndexes ?? got.accounts;
    if (!Array.isArray(indexes) || indexes.some((index) => !Number.isInteger(index) || index < 0 || index >= keys.length)) return false;
    const accounts = indexes.map((index) => {
      const key = keys[index];
      return key ? { pubkey: key.toBase58(), isSigner: message.isAccountSigner(index), isWritable: message.isAccountWritable(index) } : null;
    });
    if (accounts.length !== expected.accounts.length || accounts.some((account, j) => !account
      || account.pubkey !== expected.accounts[j].pubkey || account.isSigner !== expected.accounts[j].isSigner || account.isWritable !== expected.accounts[j].isWritable)) return false;
    if (typeof got.data !== "string" || !decodeBase58(got.data).equals(Buffer.from(expected.data, "base64"))) return false;
  }
  return true;
}

function base58Encode(bytes: Buffer): string {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let zeroes = 0; while (zeroes < bytes.length && bytes[zeroes] === 0) zeroes += 1;
  let value = BigInt(`0x${bytes.toString("hex") || "0"}`); let result = "";
  while (value > BigInt(0)) { const remainder = Number(value % BigInt(58)); result = alphabet[remainder] + result; value /= BigInt(58); }
  return "1".repeat(zeroes) + result;
}

function decodeBase58(text: string): Buffer {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let value = BigInt(0);
  for (const character of text) {
    const digit = alphabet.indexOf(character);
    if (digit < 0) throw new Error("Malformed base58 data.");
    value = value * BigInt(58) + BigInt(digit);
  }
  const body = value === BigInt(0) ? Buffer.alloc(0) : Buffer.from(value.toString(16).padStart(value.toString(16).length + value.toString(16).length % 2, "0"), "hex");
  let zeroes = 0; while (zeroes < text.length && text[zeroes] === "1") zeroes += 1;
  return Buffer.concat([Buffer.alloc(zeroes), body]);
}
