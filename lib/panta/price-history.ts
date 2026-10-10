import "server-only";
import { PublicKey, type Connection } from "@solana/web3.js";
import type { Market, MarketPoint, MarketPriceHistory, PriceHistoryRange } from "@/lib/panta/types";
import { assertSolanaMainnet, createSolanaMainnetConnection } from "@/lib/solana/rpc";
import { decodeOrderMatchedEvent, PANTA_CLOB_PROGRAM_ID, PANTA_ORDER_MATCHED_DISCRIMINATOR } from "@/lib/panta/clob-layout";
import { getPantaEventData } from "@/lib/panta/event-data";
import { getPool } from "@/lib/db";

export const PANTA_PRICE_HISTORY_RANGES: readonly PriceHistoryRange[] = ["1h", "6h", "1d", "7d", "all"];
const RANGE_MS: Record<PriceHistoryRange, number | null> = { "1h": 60 * 60_000, "6h": 6 * 60 * 60_000, "1d": 24 * 60 * 60_000, "7d": 7 * 24 * 60 * 60_000, all: null };
const SIGNATURE_LIMIT = 36; // Matches the bounded trade sample used by Panta's chart component.
const RPC_TIMEOUT_MS = 12_000;
const TOTAL_HISTORY_BUDGET_MS = 30_000;
const CACHE_MS = 5_000;
const historyCache = new Map<string, { expiresAt: number; value: MarketPriceHistory }>();

export function isPriceHistoryRange(value: string): value is PriceHistoryRange {
  return PANTA_PRICE_HISTORY_RANGES.some((range) => range === value);
}

export function filterAndNormalizeHistory(input: {
  marketId: string;
  eventPda: string;
  quoteAsset: "SOL" | "USDC";
  range: PriceHistoryRange;
  retrievedAt: string;
  fills: Array<{ signature: string; slot: number; blockTime: number | null; outcome: "YES" | "NO"; price: number }>;
  signaturesRead: number;
  transactionsRead: number;
  latestSignatureSlot?: number | null;
  latestSignatureBlockTime?: string | null;
  coverage?: MarketPriceHistory["coverage"];
  partial?: boolean;
  rejectedObservations?: number;
}): MarketPriceHistory {
  const windowMs = RANGE_MS[input.range];
  const since = windowMs === null ? null : Date.parse(input.retrievedAt) - windowMs;
  const observations: MarketPoint[] = [];
  let invalidCount = input.rejectedObservations ?? 0;
  for (const fill of input.fills) {
    const probability = fill.outcome === "YES" ? fill.price : 1 - fill.price;
    if (!Number.isFinite(fill.price) || fill.price <= 0 || fill.price > 1 || !Number.isFinite(probability) || probability < 0 || probability > 1 || !Number.isSafeInteger(fill.slot) || fill.slot < 0 || !Number.isFinite(fill.blockTime) || fill.blockTime === null || fill.blockTime <= 0 || fill.blockTime * 1000 > Date.parse(input.retrievedAt) + 60_000) {
      invalidCount += 1;
      continue;
    }
    const timestamp = fill.blockTime * 1000;
    if (since !== null && timestamp < since) continue;
    observations.push({ timestamp: new Date(timestamp).toISOString(), yesProbability: probability, signature: fill.signature, slot: fill.slot, outcome: fill.outcome, source: "panta-solana-order-matched" });
  }
  observations.sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp) || (left.signature ?? "").localeCompare(right.signature ?? ""));
  const status: MarketPriceHistory["status"] = observations.length ? "available" : invalidCount && input.fills.length > 0 ? "invalid" : "empty";
  return {
    marketId: input.marketId, eventPda: input.eventPda, range: input.range, status, observations,
    quoteAsset: input.quoteAsset, source: "panta-solana-order-matched", retrievedAt: input.retrievedAt,
    signaturesRead: input.signaturesRead, transactionsRead: input.transactionsRead, latestSignatureSlot: input.latestSignatureSlot ?? null, latestSignatureBlockTime: input.latestSignatureBlockTime ?? null, signatureLimit: SIGNATURE_LIMIT, coverage: input.coverage ?? "unknown",
    completeness: input.partial ? "partial" : "complete",
    ...(status === "empty" ? { reason: "no-matched-trades-in-range", message: "No verified matched trades were returned for this period." } : {}),
    ...(status === "invalid" ? { reason: "observations-failed-validation", message: "Matched-trade logs were returned, but none contained valid price and timestamp data." } : {}),
  };
}

async function getPersistedHistory(market: Market, range: PriceHistoryRange): Promise<MarketPriceHistory | null> {
  const db = getPool();
  const state = await db.query(`SELECT m.id,s.initial_scan_complete,s.newest_slot,s.last_success_at,s.unresolved_count,
      (SELECT count(*) FROM panta_pending_transactions p WHERE p.market_id=m.id AND p.status IN ('discovered','unavailable')) AS unresolved,
      (SELECT count(*) FROM panta_matched_fills f WHERE f.market_id=m.id AND f.block_time IS NULL) AS missing_time
    FROM markets m JOIN panta_trade_scans s ON s.market_id=m.id WHERE m.provider='panta' AND m.provider_market_id=$1`, [market.id]);
  if (!state.rowCount) return null;
  const row = state.rows[0]!;
  const marketDbId = String(row.id);
  const windowMs = RANGE_MS[range];
  const since = windowMs === null ? null : Date.now() - windowMs;
  const fills = await db.query(`SELECT signature,slot,extract(epoch from block_time)::bigint AS block_time,outcome,price
    FROM panta_matched_fills WHERE market_id=$1 AND ($2::double precision IS NULL OR block_time>=to_timestamp($2/1000.0))
    ORDER BY block_time ASC NULLS LAST,slot ASC,event_index ASC LIMIT 2000`, [marketDbId, since]);
  const unresolved = Number(row.unresolved ?? 0);
  const complete = row.initial_scan_complete === true && unresolved === 0;
  const history = filterAndNormalizeHistory({
    marketId: market.id, eventPda: market.pantaEventPda ?? "", quoteAsset: market.quoteAsset!, range,
    retrievedAt: new Date().toISOString(),
    fills: fills.rows.filter((fill) => fill.block_time !== null).map((fill) => ({ signature: String(fill.signature), slot: Number(fill.slot), blockTime: Number(fill.block_time), outcome: fill.outcome as "YES" | "NO", price: Number(fill.price) })),
    signaturesRead: 0, transactionsRead: 0, latestSignatureSlot: row.newest_slot === null ? null : Number(row.newest_slot),
    latestSignatureBlockTime: row.last_success_at ? new Date(row.last_success_at as string | Date).toISOString() : null,
    coverage: complete ? "all-available" : "bounded-latest-sample", partial: !complete || Number(row.missing_time ?? 0) > 0,
  });
  history.source = "panta-solana-order-matched";
  if (history.completeness !== "partial" && history.status === "empty") history.message = "No verified matched fills are currently recorded for this period.";
  if (!complete && history.status === "empty") { history.status = "error"; history.reason = "partial-history-coverage"; history.message = "History is still being scanned or has unresolved transactions; retry after the worker has processed them."; }
  return history;
}

function result(market: Market, range: string, status: MarketPriceHistory["status"], reason: string, message: string): MarketPriceHistory {
  return { marketId: market.id, eventPda: market.pantaEventPda ?? null, range, status, observations: [], quoteAsset: market.quoteAsset ?? null, source: "none", retrievedAt: new Date().toISOString(), signaturesRead: 0, transactionsRead: 0, latestSignatureSlot: null, latestSignatureBlockTime: null, signatureLimit: SIGNATURE_LIMIT, coverage: "unknown", completeness: "unavailable", reason, message };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs = RPC_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error("Panta history RPC timed out.")), timeoutMs); })]);
  } finally { if (timer) clearTimeout(timer); }
}

export async function getPantaPriceHistory(market: Market, requestedRange: string, options: { connection?: Connection; verifiedEvent?: { event: { question: string } } } = {}): Promise<MarketPriceHistory> {
  if (!isPriceHistoryRange(requestedRange)) return { ...result(market, requestedRange, "unsupported", "unsupported-range", "Panta supports 1H, 6H, 1D, 7D, and All history ranges."), range: requestedRange };
  const range = requestedRange;
  const eventAddress = market.pantaEventPda;
  if (market.source !== "panta" || !eventAddress) return result(market, range, "error", "event-identity-unavailable", "Panta Event identity is unavailable for historical data.");
  if (market.quoteAssetResolution?.status !== "resolved" || !market.quoteAsset) return result(market, range, "invalid", "quote-asset-unresolved", "Historical prices are withheld because the market quote asset is unresolved or conflicting.");
  let eventKey: PublicKey;
  try { eventKey = new PublicKey(eventAddress); } catch { return result(market, range, "invalid", "invalid-event-address", "Panta returned an invalid Event address."); }
  const cacheKey = `${market.id}:${eventAddress}:${market.quoteAsset}:${range}`;
  const cached = historyCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  try {
    const persisted = await getPersistedHistory(market, range);
    if (persisted) {
      historyCache.set(cacheKey, { value: persisted, expiresAt: Date.now() + CACHE_MS });
      return persisted;
    }
  } catch { /* Database is optional for request-time market reads; keep the bounded RPC fallback. */ }
  const retrievedAt = new Date().toISOString();
  try {
    const connection = options.connection ?? createSolanaMainnetConnection();
    if (!options.connection) await withTimeout(assertSolanaMainnet(connection));
    const eventAccount = options.verifiedEvent ?? (await withTimeout(getPantaEventData([market]))).get(market.id);
    if (!eventAccount || eventAccount.event.question.trim() !== market.question.trim()) {
      const unavailable = result(market, range, "invalid", "event-account-unverified", "The on-chain Event account could not be verified against this market.");
      historyCache.set(cacheKey, { value: unavailable, expiresAt: Date.now() + CACHE_MS });
      return unavailable;
    }
    const signatures = await withTimeout(connection.getSignaturesForAddress(eventKey, { limit: SIGNATURE_LIMIT }, "confirmed"));
    const fills: Array<{ signature: string; slot: number; blockTime: number | null; outcome: "YES" | "NO"; price: number }> = [];
    let transactionsRead = 0;
    const startedAt = Date.now();
    let partial = signatures.some((signature) => signature.err !== null);
    let rejectedObservations = 0;
    const candidates = signatures.filter((signature) => signature.err === null);
    for (let offset = 0; offset < candidates.length; offset += 4) {
      if (Date.now() - startedAt >= TOTAL_HISTORY_BUDGET_MS) { partial = true; break; }
      const batch = candidates.slice(offset, offset + 4);
      const batchTimeout = Math.min(RPC_TIMEOUT_MS, TOTAL_HISTORY_BUDGET_MS - (Date.now() - startedAt));
      const transactions = await Promise.all(batch.map(async (signature) => {
        try {
          const transaction = await withTimeout(connection.getTransaction(signature.signature, { commitment: "confirmed", maxSupportedTransactionVersion: 1 }), batchTimeout);
          return { signature, transaction, failed: false };
        } catch { return { signature, transaction: null, failed: true }; }
      }));
      for (const { signature, transaction, failed } of transactions) {
        transactionsRead += 1;
        if (failed || !transaction || transaction.meta?.err) { partial = true; continue; }
        const logs = transaction.meta?.logMessages ?? [];
        const pantaProgramInvoked = logs.some((line) => line.startsWith(`Program ${PANTA_CLOB_PROGRAM_ID} invoke`));
        if (!pantaProgramInvoked) continue;
        for (const line of logs) {
          const match = line.match(/^Program data:\s*([A-Za-z0-9+/=]+)$/);
          if (!match) continue;
          let bytes: Buffer;
          try { bytes = Buffer.from(match[1]!, "base64"); } catch { continue; }
          if (!bytes.subarray(0, 8).equals(PANTA_ORDER_MATCHED_DISCRIMINATOR) || bytes.length < 40 || !new PublicKey(bytes.subarray(8, 40)).equals(eventKey)) continue;
          const fill = decodeOrderMatchedEvent(bytes);
          if (!fill) { rejectedObservations += 1; continue; }
          fills.push({ signature: signature.signature, slot: signature.slot, blockTime: signature.blockTime ?? null, outcome: fill.outcome, price: fill.price });
        }
      }
    }
    const value = filterAndNormalizeHistory({ marketId: market.id, eventPda: eventAddress, quoteAsset: market.quoteAsset, range, retrievedAt, fills, signaturesRead: signatures.length, transactionsRead, latestSignatureSlot: signatures[0]?.slot ?? null, latestSignatureBlockTime: signatures[0]?.blockTime ? new Date(signatures[0].blockTime * 1000).toISOString() : null, coverage: signatures.length === SIGNATURE_LIMIT ? "bounded-latest-sample" : "all-available", partial, rejectedObservations });
    if (partial && value.status === "empty") {
      value.status = "error";
      value.reason = "partial-rpc-snapshot";
      value.message = "Panta returned an incomplete transaction snapshot. Retry to load history.";
    }
    historyCache.set(cacheKey, { value, expiresAt: Date.now() + CACHE_MS });
    return value;
  } catch (error) {
    const failed = result(market, range, "error", "history-rpc-unavailable", error instanceof Error && error.message.includes("timed out") ? "Panta history request timed out. Retry to load history." : "Panta history could not be retrieved. Retry to load history.");
    historyCache.set(cacheKey, { value: failed, expiresAt: Date.now() + CACHE_MS });
    return failed;
  }
}

export function clearPantaPriceHistoryCacheForTests() { historyCache.clear(); }
