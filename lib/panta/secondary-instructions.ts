import { createHash } from "node:crypto";
import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { PANTA_CLOB_PROGRAM_ID, type DecodedOrderNode } from "@/lib/panta/clob-layout";

/** Exact USDC secondary instruction contract from the later 57-instruction frontend IDL. */
export const SECONDARY_LIMIT_ORDER_USDC_DISCRIMINATOR = Buffer.from([110, 71, 240, 5, 180, 192, 163, 177]);
export const CANCEL_SECONDARY_ORDER_USDC_DISCRIMINATOR = Buffer.from([5, 36, 88, 69, 68, 29, 186, 30]);
export const SECONDARY_PRICE_SCALE = BigInt("1000000000");
export const SECONDARY_SHARE_SCALE = BigInt("1000000");

const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const PROGRAM = new PublicKey(PANTA_CLOB_PROGRAM_ID);

export type SecondaryBuildAccounts = {
  event: PublicKey;
  creator: PublicKey;
  question: string;
  treasury: PublicKey;
  usdcMint: PublicKey;
  /** Read from MarketConfig and checked as a nonzero tick before building. */
  priceTickSize: bigint;
  /** Decoded account state for the target level. Required for cancellation. */
};

export type InstructionAccount = { pubkey: PublicKey; isSigner: boolean; isWritable: boolean };

function u64(value: bigint): Buffer {
  if (value < BigInt(0) || value > BigInt("18446744073709551615")) throw new Error("Secondary instruction u64 argument is out of range.");
  const bytes = Buffer.alloc(8); bytes.writeBigUInt64LE(value); return bytes;
}

function pda(seeds: Buffer[]): PublicKey { return PublicKey.findProgramAddressSync(seeds, PROGRAM)[0]; }
function ata(owner: PublicKey, mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([owner.toBuffer(), TOKEN_PROGRAM.toBuffer(), mint.toBuffer()], ASSOCIATED_TOKEN_PROGRAM)[0];
}
function meta(pubkey: PublicKey, isSigner = false, isWritable = false) { return { pubkey, isSigner, isWritable }; }
function eventVault(context: SecondaryBuildAccounts): PublicKey {
  return pda([Buffer.from("vault_usdc"), context.creator.toBuffer(), createHash("sha256").update(context.question, "utf8").digest()]);
}
function creatorFeeVault(event: PublicKey): PublicKey { return pda([Buffer.from("creator_fee_vault_usdc"), event.toBuffer()]); }

export function secondaryPriceUnits(value: string): bigint {
  if (!/^\d+(?:\.\d{1,9})?$/.test(value)) throw new Error("Price must be an exact decimal with at most nine places.");
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * SECONDARY_PRICE_SCALE + BigInt(fraction.padEnd(9, "0"));
}

export function secondaryShareUnits(value: string): bigint {
  if (!/^\d+(?:\.\d{1,6})?$/.test(value)) throw new Error("Share amount must be an exact decimal with at most six places.");
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * SECONDARY_SHARE_SCALE + BigInt(fraction.padEnd(6, "0"));
}

function assertCanonicalContext(context: SecondaryBuildAccounts) {
  if (!context.usdcMint.equals(USDC_MINT)) throw new Error("MarketConfig does not reference the verified mainnet USDC mint.");
  if (context.priceTickSize <= BigInt(0)) throw new Error("MarketConfig has no valid secondary price tick.");
}

/** Build the fixed accounts and arguments exactly as the first-party USDC frontend does. */
export function buildSecondaryPlacementInstruction(input: {
  context: SecondaryBuildAccounts;
  user: PublicKey;
  side: "YES" | "NO";
  price: string;
  shares: string;
  buy: boolean;
  clientNonce: bigint;
  remainingAccounts?: InstructionAccount[];
}): TransactionInstruction {
  const { context, user } = input;
  assertCanonicalContext(context);
  const price = secondaryPriceUnits(input.price);
  const shares = secondaryShareUnits(input.shares);
  // The frontend accepts any positive integer price. A live matched transaction
  // executed at 520,520,999 while MarketConfig reported a 1,000,000 tick, so the
  // deployed tick-enforcement rule is not established and must not be invented.
  if (price <= BigInt(0)) throw new Error("Price must be positive.");
  if (shares <= BigInt(0)) throw new Error("Share amount must be positive.");
  if (input.clientNonce < BigInt(0) || input.clientNonce > BigInt("9007199254740991")) throw new Error("Client nonce is outside the frontend's safe integer range.");
  const marketConfig = pda([Buffer.from("market_config")]);
  const userPosition = pda([Buffer.from("position"), context.event.toBuffer(), user.toBuffer()]);
  const priceLevel = pda([Buffer.from("level_usdc"), context.event.toBuffer(), u64(price)]);
  const orderNode = pda([Buffer.from("order_usdc"), priceLevel.toBuffer(), user.toBuffer(), u64(input.clientNonce)]);
  const vaultAuthority = eventVault(context);
  const feeVault = creatorFeeVault(context.event);
  const accounts = [
    meta(user, true, true), meta(marketConfig), meta(context.event, false, true), meta(userPosition, false, true),
    meta(priceLevel, false, true), meta(orderNode, false, true), meta(vaultAuthority), meta(ata(vaultAuthority, context.usdcMint), false, true),
    meta(feeVault, false, true), meta(ata(feeVault, context.usdcMint), false, true), meta(ata(context.treasury, context.usdcMint), false, true),
    meta(ata(user, context.usdcMint), false, true), meta(context.usdcMint), meta(TOKEN_PROGRAM), meta(ASSOCIATED_TOKEN_PROGRAM), meta(SystemProgram.programId),
    ...(input.remainingAccounts ?? []),
  ];
  const args = Buffer.concat([
    SECONDARY_LIMIT_ORDER_USDC_DISCRIMINATOR,
    Buffer.from([input.side === "YES" ? 0 : 1]), u64(price), u64(shares), Buffer.from([input.buy ? 1 : 0]), u64(input.clientNonce), priceLevel.toBuffer(),
  ]);
  return new TransactionInstruction({ programId: PROGRAM, keys: accounts, data: args });
}

/** Build cancellation only for a caller-supplied, freshly fetched node owned by this wallet and market. */
export function buildSecondaryCancellationInstruction(input: {
  context: SecondaryBuildAccounts;
  user: PublicKey;
  target: DecodedOrderNode;
  previous: DecodedOrderNode | null;
  next: DecodedOrderNode | null;
}): TransactionInstruction {
  const { context, user, target, previous, next } = input;
  assertCanonicalContext(context);
  if (target.owner !== user.toBase58() || target.event !== context.event.toBase58()) throw new Error("Cancellation target owner or market does not match the signer and selected market.");
  if (target.amount <= BigInt(0) || target.originalAmount < target.amount) throw new Error("Cancellation target is not an open, internally consistent order node.");
  if (target.priceLamports <= BigInt(0) || target.priceLamports > BigInt("18446744073709551615")) throw new Error("Cancellation target has an invalid stored price.");
  const derivedLevel = pda([Buffer.from("level_usdc"), context.event.toBuffer(), u64(target.priceLamports)]);
  if (derivedLevel.toBase58() !== target.priceLevel) throw new Error("Cancellation target price level is not the USDC level PDA for this market and price.");
  const system = SystemProgram.programId.toBase58();
  if ((target.previous === system) !== (previous === null) || (target.next === system) !== (next === null)) throw new Error("Cancellation neighbor accounts do not match the target node links.");
  if (previous && (previous.event !== target.event || previous.priceLevel !== target.priceLevel || previous.next !== target.address)) throw new Error("Previous cancellation neighbor does not link to the target order.");
  if (next && (next.event !== target.event || next.priceLevel !== target.priceLevel || next.previous !== target.address)) throw new Error("Next cancellation neighbor does not link to the target order.");
  const level = new PublicKey(target.priceLevel);
  const marketConfig = pda([Buffer.from("market_config")]);
  const userPosition = pda([Buffer.from("position"), context.event.toBuffer(), user.toBuffer()]);
  const vaultAuthority = eventVault(context);
  const nullOptional = meta(SystemProgram.programId, false, true);
  const accounts = [
    meta(user, true, true), meta(marketConfig), meta(context.event), meta(userPosition, false, true), meta(vaultAuthority),
    meta(ata(vaultAuthority, context.usdcMint), false, true), meta(ata(user, context.usdcMint), false, true),
    meta(level, false, true), meta(new PublicKey(target.address), false, true),
    previous ? meta(new PublicKey(previous.address), false, true) : nullOptional,
    next ? meta(new PublicKey(next.address), false, true) : nullOptional,
    meta(context.usdcMint), meta(TOKEN_PROGRAM), meta(ASSOCIATED_TOKEN_PROGRAM), meta(SystemProgram.programId),
  ];
  return new TransactionInstruction({ programId: PROGRAM, keys: accounts, data: CANCEL_SECONDARY_ORDER_USDC_DISCRIMINATOR });
}

export function instructionToWalletFormat(ix: TransactionInstruction) {
  return { programId: ix.programId.toBase58(), data: ix.data.toString("base64"), accounts: ix.keys.map((key) => ({ pubkey: key.pubkey.toBase58(), isSigner: key.isSigner, isWritable: key.isWritable })) };
}
