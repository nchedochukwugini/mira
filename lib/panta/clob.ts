import "server-only";
import { PublicKey } from "@solana/web3.js";
import type { Market, OrderActivity, OrderBookSnapshot } from "@/lib/panta/types";
import { getMarketProvider } from "@/lib/providers/market-provider";
import { applyDecodedPantaEvent } from "@/lib/panta/event-data";
import { getPantaClobSnapshotHistory, persistPantaClobSnapshot } from "@/lib/db";
import { assertSolanaMainnet, createSolanaMainnetConnection, SolanaRpcConfigurationError } from "@/lib/solana/rpc";
import {
  buildOutcomeBooks,
  classifyPantaInstruction,
  decodeOrderMatchedEvent,
  decodeOrderNode,
  decodePantaEvent,
  decodePriceLevel,
  makeEmptyOutcomeBook,
  PANTA_CLOB_PROGRAM_ID,
  PANTA_ORDER_MATCHED_DISCRIMINATOR,
} from "@/lib/panta/clob-layout";

const CACHE_MS = 5_000;
const MAX_LEVELS = 2_000;
const MAX_ORDER_NODES = 10_000;
const RECENT_SIGNATURES = 6;
const ACTIVITY_LIMIT = 6;
const cache = new Map<string, OrderBookSnapshot>();
const inFlight = new Map<string, Promise<OrderBookSnapshot>>();
const persistedAt = new Map<string, number>();
const activityCache = new Map<string, { expiresAt: number; items: OrderActivity[]; partial: boolean }>();
const historyCache = new Map<string, { expiresAt: number; history: NonNullable<OrderBookSnapshot["history"]>; status: OrderBookSnapshot["historyStatus"] }>();

function emptyBook(market: Market, observedAt: number, reason: string, message: string, status: "partial" | "unavailable" = "unavailable"): OrderBookSnapshot {
  const prices = market.quoteAssetResolution && ["resolved", "conflict"].includes(market.quoteAssetResolution.status) ? market.pantaPrices : null;
  return {
    marketId: market.id,
    marketQuestion: market.question,
    quoteAsset: market.quoteAsset ?? null,
    quoteAssetResolution: market.quoteAssetResolution,
    accountAddresses: { event: market.pantaEventPda ?? market.id, priceLevels: [], orderNodes: [], truncated: false },
    programId: market.pantaProgramId ?? null,
    source: "panta-solana",
    sourceLabel: "Panta · Solana",
    observedAt,
    retrievedAt: observedAt,
    slot: null,
    // Panta's observation timestamp is provider metadata. The snapshot's local
    // observedAt is separate and must not be substituted for a missing provider time.
    pantaReference: { yesPrice: prices?.yes ?? null, noPrice: prices?.no ?? null, observedAt: prices?.observedAt ?? null, kind: prices?.kind ?? "unknown", source: market.priceProvenance?.source ?? "panta" },
    dataStatus: status,
    freshness: "unavailable",
    yes: makeEmptyOutcomeBook("YES", market.quoteAsset ?? null),
    no: makeEmptyOutcomeBook("NO", market.quoteAsset ?? null),
    activity: [],
    activityStatus: "unavailable",
    history: [],
    historyStatus: "unavailable",
    reason,
    message,
  };
}

function freshness(observedAt: number, now: number): OrderBookSnapshot["freshness"] {
  const age = Math.max(0, now - observedAt);
  return age <= 5_000 ? "live" : age <= 30_000 ? "recent" : "stale";
}

function parseMatchedEvents(logs: string[], event: PublicKey): Array<{ outcome: "YES" | "NO"; price: number; size: number }> {
  const events: Array<{ outcome: "YES" | "NO"; price: number; size: number }> = [];
  const invokedPanta = logs.some((line) => line.startsWith(`Program ${PANTA_CLOB_PROGRAM_ID} invoke`));
  if (!invokedPanta) return events;
  for (const line of logs) {
    const marker = "Program data: ";
    const index = line.indexOf(marker);
    if (index < 0) continue;
    try {
      const bytes = Buffer.from(line.slice(index + marker.length).trim(), "base64");
      if (bytes.subarray(0, 8).equals(PANTA_ORDER_MATCHED_DISCRIMINATOR) && bytes.length >= 40 && new PublicKey(bytes.subarray(8, 40)).equals(event)) {
        const decoded = decodeOrderMatchedEvent(bytes);
        if (decoded) events.push(decoded);
      }
    } catch { /* Invalid/unrelated program log data is not activity evidence. */ }
  }
  return events;
}

async function recentActivity(connection: ReturnType<typeof createSolanaMainnetConnection>, event: PublicKey): Promise<{ items: OrderActivity[]; partial: boolean }> {
  const key = event.toBase58();
  const cached = activityCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return { items: cached.items, partial: cached.partial };
  try {
    const signatures = await connection.getSignaturesForAddress(event, { limit: RECENT_SIGNATURES }, "confirmed");
    const transactions: Array<{ item: (typeof signatures)[number]; logs: string[] } | null> = [];
    // Keep recent activity read-only and low-volume; public RPCs commonly rate-limit
    // a burst of transaction-detail requests for the same market.
    for (const item of signatures.filter((candidate) => !candidate.err)) {
      try {
        const transaction = await connection.getTransaction(item.signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
        transactions.push(transaction?.meta && transaction.meta.err === null ? { item, logs: transaction.meta.logMessages ?? [] } : null);
      } catch { transactions.push(null); }
    }
    const result: OrderActivity[] = [];
    const partial = transactions.some((transaction) => transaction === null);
    for (const transaction of transactions) {
      if (!transaction) continue;
      const { item, logs } = transaction;
      const invokedPanta = logs.some((line) => line.startsWith(`Program ${PANTA_CLOB_PROGRAM_ID} invoke`));
      if (!invokedPanta) continue;
      const matched = parseMatchedEvents(logs, event);
      if (matched.length) {
        for (const fill of matched) result.push({ signature: item.signature, marketId: key, programId: PANTA_CLOB_PROGRAM_ID, slot: item.slot, observedAt: item.blockTime ? item.blockTime * 1000 : null, kind: "order_matched", instruction: "OrderMatched", decoderVersion: "panta-clob-log-v1", verificationStatus: "matched-event-verified", classificationReason: "A successful transaction emitted the verified OrderMatched discriminator for this market event.", ...fill });
        continue;
      }
      const joined = logs.join("\n");
      const instruction = joined.match(/Instruction: ([A-Za-z0-9_]+)/)?.[1] ?? "Unclassified Panta program activity";
      const kind = classifyPantaInstruction(instruction);
      result.push({ signature: item.signature, marketId: key, programId: PANTA_CLOB_PROGRAM_ID, slot: item.slot, observedAt: item.blockTime ? item.blockTime * 1000 : null, kind: kind ?? "unknown", instruction, decoderVersion: "panta-clob-log-v1", verificationStatus: kind ? "instruction-observed" : "unknown", classificationReason: kind === "order_placed" ? "A successful Panta CLOB transaction logged the recognized secondary limit-order instruction; this is not a fill." : kind === "order_cancelled" ? "A successful Panta CLOB transaction logged the recognized cancellation instruction; this is not a sale or fill." : "The Panta CLOB program was invoked, but the event or instruction does not match a verified classification." });
      if (result.length >= ACTIVITY_LIMIT) break;
    }
    const response = { items: result.slice(0, ACTIVITY_LIMIT), partial };
    activityCache.set(key, { ...response, expiresAt: Date.now() + 60_000 });
    return response;
  } catch {
    const response = { items: [], partial: true };
    activityCache.set(key, { ...response, expiresAt: Date.now() + 15_000 });
    return response;
  }
}

async function readOrderBook(market: Market, now: number): Promise<OrderBookSnapshot> {
  if (market.source !== "panta") return emptyBook(market, now, "live_panta_unavailable", "Live Panta market data is not configured.");
  if (market.status === "resolved" || market.pantaIsResolved === true) return emptyBook(market, now, "resolved_market", "This market is resolved. Historical order-book values are not presented as live.");
  if (market.status !== "active" || market.phase !== "secondary" || market.pantaSecondaryActive === false || market.pantaIsGraduated === false) {
    return emptyBook(market, now, "secondary_market_mapping_unavailable", "Panta has not confirmed this as an active secondary market.");
  }
  if (!market.pantaProgramId || market.pantaProgramId !== PANTA_CLOB_PROGRAM_ID) {
    return emptyBook(market, now, "secondary_market_mapping_unavailable", "Panta did not provide the verified CLOB program mapping for this market.");
  }
  if (!market.quoteAsset || !market.quoteAssetResolution || !["resolved", "conflict"].includes(market.quoteAssetResolution.status) || market.quoteAssetResolution.source !== "panta-event-registry") {
    return emptyBook(market, now, "quote_asset_unresolved", "Panta’s authoritative event metadata did not resolve a supported quote asset for this market.");
  }

  let event: PublicKey;
  try { event = new PublicKey(market.pantaEventPda ?? market.id); }
  catch { return emptyBook(market, now, "invalid_market_identifier", "Panta returned a market identifier that is not a Solana public key."); }

  let connection: ReturnType<typeof createSolanaMainnetConnection>;
  try { connection = createSolanaMainnetConnection(); }
  catch (error) {
    const reason = error instanceof SolanaRpcConfigurationError ? error.reason : "solana_rpc_not_configured";
    return emptyBook(market, now, reason, error instanceof Error ? error.message : "Mainnet Solana RPC configuration is unavailable.");
  }

  try {
    await assertSolanaMainnet(connection);
    const program = new PublicKey(PANTA_CLOB_PROGRAM_ID);
    const levelResponse = await connection.getProgramAccounts(program, { commitment: "confirmed", withContext: true, filters: [{ dataSize: 218 }, { memcmp: { offset: 9, bytes: event.toBase58() } }] });
    const orderResponse = await connection.getProgramAccounts(program, { commitment: "confirmed", withContext: true, minContextSlot: levelResponse.context.slot, filters: [{ dataSize: 269 }, { memcmp: { offset: 41, bytes: event.toBase58() } }] });
    const eventResponse = await connection.getAccountInfoAndContext(event, { commitment: "confirmed", minContextSlot: orderResponse.context.slot });
    const eventInfo = eventResponse.value;
    const levelAccounts = levelResponse.value;
    const orderAccounts = orderResponse.value;
    const slot = eventResponse.context.slot;
    if (!eventInfo || !eventInfo.owner.equals(program)) return emptyBook(market, now, "market_account_not_found", "MIRA found the Panta market, but its verified on-chain Event account is unavailable.");
    const onchainEvent = decodePantaEvent(eventInfo.data);
    if (!onchainEvent) return emptyBook(market, now, "market_account_unrecognized", "The on-chain market account does not match the verified Panta Event account layout.");
    if (!onchainEvent.isActive || !onchainEvent.isGraduated || onchainEvent.isResolved || onchainEvent.isCancelled) {
      return emptyBook(market, now, "market_not_active_secondary", "Panta’s on-chain Event flags do not confirm an open secondary market.");
    }
    const eventObservedAt = new Date().toISOString();
    const eventMarket = applyDecodedPantaEvent(market, onchainEvent, eventObservedAt, eventResponse.context.slot);
    const question = market.question === "Market title unavailable" ? onchainEvent.question : market.question;
    const levels = [];
    let partial = false;
    if (levelAccounts.length > MAX_LEVELS) partial = true;
    for (const account of levelAccounts.slice(0, MAX_LEVELS)) {
      if (!account.account.owner.equals(program)) { partial = true; continue; }
      const decoded = decodePriceLevel(account.pubkey.toBase58(), account.account.data);
      if (!decoded || decoded.event !== event.toBase58()) { partial = true; continue; }
      levels.push(decoded);
    }
    if (orderAccounts.length > MAX_ORDER_NODES) partial = true;
    const nodes = new Map();
    for (const account of orderAccounts.slice(0, MAX_ORDER_NODES)) {
      if (!account.account.owner.equals(program)) { partial = true; continue; }
      const decoded = decodeOrderNode(account.pubkey.toBase58(), account.account.data);
      if (!decoded || decoded.event !== event.toBase58()) { partial = true; continue; }
      nodes.set(decoded.address, decoded);
    }
    const books = buildOutcomeBooks({ levels, nodes, maxNodesPerSide: 500, quoteAsset: market.quoteAsset });
    partial ||= books.partial;
    const observedAt = Date.now();
    const activity = await recentActivity(connection, event);
    return {
      marketId: market.id,
      marketQuestion: question,
      quoteAsset: market.quoteAsset,
      quoteAssetResolution: market.quoteAssetResolution,
      accountAddresses: { event: event.toBase58(), priceLevels: levels.slice(0, 32).map((level) => level.address), orderNodes: [...nodes.keys()].slice(0, 64), truncated: levels.length > 32 || nodes.size > 64 },
      programId: PANTA_CLOB_PROGRAM_ID,
      primaryPoolLiquidity: eventMarket.primaryPoolLiquidity,
      primaryPoolLiquidityUsd: eventMarket.primaryPoolLiquidityUsd,
      primaryPoolLiquidityStatus: eventMarket.primaryPoolLiquidityStatus,
      activeVolume: eventMarket.activeVolume,
      totalVolume: eventMarket.totalVolume,
      matchedTradeCount: eventMarket.matchedTradeCount ?? null,
      accountReadSlots: { priceLevels: levelResponse.context.slot, orderNodes: orderResponse.context.slot, event: eventResponse.context.slot },
      source: "panta-solana",
      sourceLabel: "Panta · Solana",
      observedAt,
      retrievedAt: observedAt,
      slot,
      pantaReference: { yesPrice: market.pantaPrices?.yes ?? null, noPrice: market.pantaPrices?.no ?? null, observedAt: market.pantaPrices?.observedAt ?? null, kind: market.pantaPrices?.kind ?? "unknown", source: market.priceProvenance?.source ?? "panta" },
      dataStatus: partial ? "partial" : "complete",
      freshness: freshness(observedAt, now),
      yes: books.yes,
      no: books.no,
      activity: activity.items,
      activityStatus: activity.partial ? activity.items.length ? "partial" : "unavailable" : "complete",
      history: [],
      historyStatus: "not_collected",
      ...(partial ? { reason: "partial_order_book_snapshot", message: "Some on-chain accounts or activity could not be fully decoded. Visible levels are only the decoded portion of the book." } : {}),
    };
  } catch (error) {
    const reason = error instanceof SolanaRpcConfigurationError ? error.reason : "solana_rpc_unavailable";
    return emptyBook(market, now, reason, error instanceof SolanaRpcConfigurationError ? error.message : "MIRA couldn’t reach the Solana market-data source. Check SOLANA_RPC_URL and try again.");
  }
}

export async function getPantaOrderBookSnapshot(marketId: string, now = Date.now()): Promise<OrderBookSnapshot> {
  const cached = cache.get(marketId);
  if (cached && now - cached.observedAt < CACHE_MS) return { ...cached, freshness: freshness(cached.observedAt, now) };
  const pending = inFlight.get(marketId);
  if (pending) return pending;
  const task = (async () => {
    const provider = getMarketProvider();
    if (provider.source !== "panta") {
      const unavailable = emptyBook({ id: marketId, question: "Market title unavailable", source: "demo", status: "unknown" } as Market, now, "live_panta_unavailable", "Live Panta market data is not configured.");
      cache.set(marketId, unavailable);
      return unavailable;
    }
    let market: Market | null;
    try { market = await provider.getMarket(marketId); }
    catch (error) {
      const unavailable = emptyBook({ id: marketId, question: "Market title unavailable", source: "panta", status: "unknown" } as Market, now, "panta_market_lookup_failed", error instanceof Error ? error.message : "Panta market lookup failed.");
      cache.set(marketId, unavailable);
      return unavailable;
    }
    if (!market) {
      const unavailable = emptyBook({ id: marketId, question: "Market title unavailable", source: "panta", status: "unknown" } as Market, now, "panta_market_not_found", "Panta did not return this market.");
      cache.set(marketId, unavailable);
      return unavailable;
    }
    const snapshot = await readOrderBook(market, now);
    cache.set(marketId, snapshot);
    if (snapshot.dataStatus !== "unavailable" && snapshot.slot !== null && now - (persistedAt.get(marketId) ?? 0) >= 30_000) {
      try { await persistPantaClobSnapshot({ market, snapshot }); }
      catch { /* Snapshot persistence failure does not hide the verified live RPC response. */ }
      finally { persistedAt.set(marketId, now); }
    }
    if (snapshot.dataStatus !== "unavailable") {
      const cachedHistory = historyCache.get(marketId);
      if (cachedHistory && cachedHistory.expiresAt > now) {
        snapshot.history = cachedHistory.history;
        snapshot.historyStatus = cachedHistory.status;
      } else {
        try {
          snapshot.history = await getPantaClobSnapshotHistory(marketId, 120);
          snapshot.historyStatus = snapshot.history.length ? "available" : "not_collected";
        } catch {
          snapshot.history = [];
          snapshot.historyStatus = "unavailable";
        }
        historyCache.set(marketId, { history: snapshot.history, status: snapshot.historyStatus, expiresAt: now + 30_000 });
      }
    }
    return snapshot;
  })();
  inFlight.set(marketId, task);
  try { return await task; }
  finally { inFlight.delete(marketId); }
}

export function clearPantaOrderBookCacheForTests() { cache.clear(); inFlight.clear(); persistedAt.clear(); activityCache.clear(); historyCache.clear(); }
