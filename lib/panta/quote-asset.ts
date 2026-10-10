import { PublicKey } from "@solana/web3.js";
import { PANTA_CLOB_PROGRAM_ID } from "./clob-layout";
import { SECONDARY_LIMIT_ORDER_USDC_DISCRIMINATOR } from "./secondary-instructions";

export type SolanaNetwork = "mainnet-beta" | "devnet" | "unknown";
export type QuoteTokenIdentity = {
  status: "verified" | "unknown" | "unsupported";
  network: SolanaNetwork;
  mint: string | null;
  symbol: string | null;
  decimals: number | null;
  source: "on-chain-market-config" | "on-chain-instruction" | "none";
  reason: string | null;
};

export const SOLANA_MAINNET_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const SOLANA_MAINNET_USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
export const SOLANA_MAINNET_WRAPPED_SOL_MINT = "So11111111111111111111111111111111111111112";
export const SPL_TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022_PROGRAM_ID = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

const trustedMainnetMints = new Map<string, { symbol: string; decimals: number }>([
  [SOLANA_MAINNET_USDC_MINT, { symbol: "USDC", decimals: 6 }],
  [SOLANA_MAINNET_USDT_MINT, { symbol: "USDT", decimals: 6 }],
  [SOLANA_MAINNET_WRAPPED_SOL_MINT, { symbol: "SOL", decimals: 9 }],
]);

export function identifyQuoteMint(input: { network: SolanaNetwork; mint: string | null; owner: string | null; data: Uint8Array | null; source?: "on-chain-market-config" | "on-chain-instruction" }): QuoteTokenIdentity {
  const source = input.source ?? "on-chain-instruction";
  const unresolved = (status: "unknown" | "unsupported", reason: string, mint = input.mint) => ({ status, network: input.network, mint, symbol: null, decimals: null, source: "none" as const, reason });
  if (input.network !== "mainnet-beta") return unresolved("unsupported", "Quote-mint verification is configured for Solana mainnet only.");
  if (!input.mint) return unresolved("unknown", "No quote-token mint was identified from the market or trade instruction.", null);
  try { if (new PublicKey(input.mint).toBase58() !== input.mint) return unresolved("unsupported", "The quote-token mint is not a canonical Solana public key."); }
  catch { return unresolved("unsupported", "The quote-token mint is not a valid Solana public key."); }
  if (input.owner !== SPL_TOKEN_PROGRAM_ID && input.owner !== TOKEN_2022_PROGRAM_ID) return unresolved("unsupported", "The quote-token mint account is not owned by a supported Solana token program.");
  if (!input.data || input.data.length < 82 || input.data[45] !== 1) return unresolved("unsupported", "The quote-token mint account is missing, malformed, or not initialized.");
  const decimals = input.data[44]!;
  const known = trustedMainnetMints.get(input.mint);
  if (known && (known.decimals !== decimals || input.owner !== SPL_TOKEN_PROGRAM_ID)) return unresolved("unsupported", "The known mainnet token mint does not match its expected token program or decimals.");
  return { status: "verified", network: input.network, mint: input.mint, symbol: known?.symbol ?? null, decimals, source, reason: null };
}

export function identifyPantaFillQuoteMint(instructions: Array<{ programId: string; accounts: string[]; data: Uint8Array }>, eventPda: string): { mint: string | null; status: "identified" | "unknown" | "unsupported"; reason: string | null } {
  const candidates = instructions.filter((instruction) => instruction.programId === PANTA_CLOB_PROGRAM_ID
    && instruction.data.length >= 8 && Buffer.from(instruction.data.slice(0, 8)).equals(SECONDARY_LIMIT_ORDER_USDC_DISCRIMINATOR)
    && instruction.accounts[2] === eventPda);
  if (candidates.length === 0) return { mint: null, status: "unknown", reason: "The successful transaction contains no recognized USDC secondary-order instruction for this Event PDA." };
  if (candidates.some((instruction) => instruction.accounts.length <= 12)) return { mint: null, status: "unsupported", reason: "A matching secondary-order instruction is missing its quote-mint account." };
  const mints = new Set(candidates.map((instruction) => instruction.accounts[12]!));
  if (mints.size !== 1) return { mint: null, status: "unsupported", reason: "Matching fill instructions reference conflicting quote mints." };
  return { mint: [...mints][0]!, status: "identified", reason: null };
}

export function decimalNotionalFromRawUnits(priceUnits: bigint, shareQuantityUnits: bigint): string | null {
  if (priceUnits <= BigInt(0) || shareQuantityUnits <= BigInt(0)) return null;
  // Panta encodes quote tokens/share at 1e9 and shares at 1e6. BigInt keeps
  // price × quantity exact and produces at most 15 decimal quote-token places.
  const denominator = BigInt("1000000000000000");
  const product = priceUnits * shareQuantityUnits;
  const whole = product / denominator;
  const remainder = product % denominator;
  if (remainder === BigInt(0)) return whole.toString();
  return `${whole}.${remainder.toString().padStart(15, "0").replace(/0+$/, "")}`;
}
