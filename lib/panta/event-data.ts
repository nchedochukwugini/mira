import "server-only";
import { PublicKey } from "@solana/web3.js";
import type { Market, QuoteAmount } from "@/lib/panta/types";
import { assertSolanaMainnet, createSolanaMainnetConnection } from "@/lib/solana/rpc";
import { decodePantaEvent, PANTA_CLOB_PROGRAM_ID, type DecodedPantaEvent } from "@/lib/panta/clob-layout";

const CACHE_MS = 5_000;
const cache = new Map<string, { expiresAt: number; event: DecodedPantaEvent | null; observedAt: string; slot: number | null }>();

function baseUnitsPerUnit(market: Market): number | null {
  return market.quoteAsset === "SOL" ? 1_000_000_000 : market.quoteAsset === "USDC" ? 1_000_000 : null;
}

function amount(raw: bigint, asset: Market["quoteAsset"], factor: number | null, source: string, observedAt: string, slot: number | null): QuoteAmount {
  const parsed = factor && raw <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(raw) / factor : null;
  return { amount: parsed, asset: parsed === null ? null : asset ?? null, source: parsed === null ? null : source, observedAt: parsed === null ? null : observedAt, slot: parsed === null ? null : slot };
}

export function applyDecodedPantaEvent(market: Market, event: DecodedPantaEvent, observedAt: string, slot: number | null = null): Market {
  const factor = baseUnitsPerUnit(market);
  const poolAmount = amount(event.primaryPoolBaseUnits, market.quoteAsset, factor, "panta-event-account", observedAt, slot);
  const rawProviderPool = market.primaryPoolLiquidity?.rawBaseUnits;
  const poolConflict = rawProviderPool !== null && rawProviderPool !== undefined && rawProviderPool !== event.primaryPoolBaseUnits.toString();
  const primaryPoolLiquidity = {
    ...poolAmount,
    rawBaseUnits: event.primaryPoolBaseUnits.toString(),
    baseUnitsPerUnit: factor,
    state: poolAmount.amount === null ? "unavailable" as const : "finalized_snapshot" as const,
  };
  const active = amount(event.activeVolumeBaseUnits, market.quoteAsset, factor, "panta-event-account-active-volume", observedAt, slot);
  const total = amount(event.totalVolumeBaseUnits, market.quoteAsset, factor, "panta-event-account-total-volume", observedAt, slot);
  const fx = market.usdConversion;
  const fxAt = fx ? Date.parse(fx.observedAt) : Number.NaN;
  const fxValid = Boolean(fx && fx.source.trim() && Number.isFinite(fxAt) && fxAt <= Date.now() && Date.now() - fxAt <= 5 * 60_000 && Number.isFinite(fx.usdPerQuote) && fx.usdPerQuote > 0);
  const convert = (quoteAmount: QuoteAmount) => fxValid && quoteAmount.amount !== null ? quoteAmount.amount * fx!.usdPerQuote : null;
  return {
    ...market,
    // A verified Event account is the identity-bound source for the market
    // title too. Recover missing provider titles so history validation does
    // not reject valid fills solely because the detail endpoint omitted it.
    question: market.question === "Market title unavailable" && event.question.trim() ? event.question : market.question,
    primaryPoolLiquidity,
    primaryPoolLiquidityUsd: market.quoteAsset === "USDC" ? convert(poolAmount) : null,
    primaryPoolLiquidityStatus: factor === null ? "unavailable" : poolConflict ? "conflict" : "verified",
    activeVolume: active,
    totalVolume: total,
    volumeUsd: market.volumeRaw?.activeSource === "usd" && market.volumeUsd !== null ? market.volumeUsd : convert(active),
    totalVolumeUsd: market.volumeRaw?.totalSource === "usd" && market.totalVolumeUsd !== null ? market.totalVolumeUsd : convert(total),
    matchedTradeCount: market.matchedTradeCount ?? null,
  };
}

export async function getPantaEventData(markets: Market[]): Promise<Map<string, { event: DecodedPantaEvent; observedAt: string; slot: number }>> {
  const result = new Map<string, { event: DecodedPantaEvent; observedAt: string; slot: number }>();
  const uncached: Array<{ marketId: string; cacheKey: string; key: PublicKey }> = [];
  for (const market of markets.slice(0, 16)) {
    const address = market.pantaEventPda ?? market.id;
    const cacheKey = `${market.id}:${address}`;
    const existing = cache.get(cacheKey);
    if (existing && existing.expiresAt > Date.now()) {
      if (existing.event && existing.slot !== null) result.set(market.id, { event: existing.event, observedAt: existing.observedAt, slot: existing.slot });
      continue;
    }
    try { uncached.push({ marketId: market.id, cacheKey, key: new PublicKey(address) }); }
    catch { cache.set(cacheKey, { event: null, observedAt: new Date().toISOString(), slot: null, expiresAt: Date.now() + CACHE_MS }); }
  }
  if (!uncached.length) return result;
  try {
    const connection = createSolanaMainnetConnection();
    await assertSolanaMainnet(connection);
    const accounts = await connection.getMultipleAccountsInfoAndContext(uncached.map(({ key }) => key), { commitment: "confirmed" });
    const observedAt = new Date().toISOString();
    const owner = new PublicKey(PANTA_CLOB_PROGRAM_ID);
    accounts.value.forEach((account, index) => {
      const { marketId, cacheKey } = uncached[index]!;
      const event = account && account.owner.equals(owner) ? decodePantaEvent(account.data) : null;
      cache.set(cacheKey, { event, observedAt, slot: accounts.context.slot, expiresAt: Date.now() + CACHE_MS });
      if (event) result.set(marketId, { event, observedAt, slot: accounts.context.slot });
    });
  } catch {
    const observedAt = new Date().toISOString();
    for (const { marketId, cacheKey } of uncached) { void marketId; cache.set(cacheKey, { event: null, observedAt, slot: null, expiresAt: Date.now() + CACHE_MS }); }
  }
  return result;
}

export function clearPantaEventDataCacheForTests() { cache.clear(); }
