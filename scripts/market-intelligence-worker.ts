import { PublicKey } from "@solana/web3.js";
import { getPool, upsertMarket } from "@/lib/db";
import { getMarketProvider } from "@/lib/providers/market-provider";
import { getPantaEventData } from "@/lib/panta/event-data";
import { decodeOrderMatchedEventRaw, PANTA_CLOB_PROGRAM_ID, PANTA_ORDER_MATCHED_DISCRIMINATOR, PRICE_SCALE, SHARE_DECIMALS } from "@/lib/panta/clob-layout";
import { collectActiveSecondarySnapshots } from "@/lib/panta/snapshot-collector";
import { assertSolanaMainnet, createSolanaMainnetConnection } from "@/lib/solana/rpc";
import { readPantaBuildContext } from "@/lib/panta/transaction-security";
import { decimalNotionalFromRawUnits, identifyPantaFillQuoteMint, SOLANA_MAINNET_USDC_MINT } from "@/lib/panta/quote-asset";
const tradeInterval = Math.max(15_000, Number(process.env.TRADE_HISTORY_POLL_INTERVAL_MS) || 45_000);
const bookInterval = Math.max(5_000, Number(process.env.ORDERBOOK_POLL_INTERVAL_MS) || 10_000);
const maxMarkets = Math.max(1, Math.min(20, Number(process.env.MARKET_WORKER_MAX_MARKETS) || 10));
const maxSignaturesPerScan = 10_000;
const maxAttempts = 8;
let stopping = false;
let lastBookRun: string | null = null;
let lastTradeRun: string | null = null;
process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

function log(event: string, detail: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ at: new Date().toISOString(), service: "mira-market-intelligence", event, ...detail }));
}
function wait(ms: number) { return new Promise<void>((resolve) => setTimeout(resolve, ms)); }
const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function decodeBase58(value: string): Buffer {
  let number = BigInt(0);
  for (const char of value) { const digit = BASE58.indexOf(char); if (digit < 0) throw new Error("Malformed compiled instruction data."); number = number * BigInt(58) + BigInt(digit); }
  const body: number[] = [];
  while (number > BigInt(0)) { body.unshift(Number(number & BigInt(255))); number >>= BigInt(8); }
  let zeros = 0; while (value[zeros] === "1") zeros++;
  return Buffer.from([...new Array(zeros).fill(0), ...body]);
}
function transactionInstructions(transaction: NonNullable<Awaited<ReturnType<ReturnType<typeof createSolanaMainnetConnection>["getTransaction"]>>>) {
  const message = transaction.transaction.message as typeof transaction.transaction.message & { staticAccountKeys?: PublicKey[]; accountKeys?: PublicKey[]; compiledInstructions?: Array<Record<string, unknown>>; instructions?: Array<Record<string, unknown>> };
  const keys = [...(message.staticAccountKeys ?? message.accountKeys ?? [])];
  for (const key of transaction.meta?.loadedAddresses?.writable ?? []) keys.push(key);
  for (const key of transaction.meta?.loadedAddresses?.readonly ?? []) keys.push(key);
  const ixList: Array<Record<string, unknown>> = [...(message.compiledInstructions ?? message.instructions ?? []), ...(transaction.meta?.innerInstructions ?? []).flatMap((entry) => entry.instructions as Array<Record<string, unknown>> ?? [])];
  return ixList.flatMap((ix) => {
    const programIndex = typeof ix.programIdIndex === "number" ? ix.programIdIndex : -1;
    const programId = keys[programIndex]?.toBase58();
    const rawAccountIndexes = ix.accountKeyIndexes ?? ix.accounts;
    const accountIndexes = Array.isArray(rawAccountIndexes) || ArrayBuffer.isView(rawAccountIndexes)
      ? Array.from(rawAccountIndexes as ArrayLike<number>)
      : [];
    if (!programId) return [];
    let data: Uint8Array;
    if (typeof ix.data === "string") {
      try { data = decodeBase58(ix.data); } catch { return []; }
    } else if (Array.isArray(ix.data) || ArrayBuffer.isView(ix.data)) {
      data = Uint8Array.from(ix.data as ArrayLike<number>);
    } else return [];
    return [{ programId, accounts: accountIndexes.map((index) => typeof index === "number" ? keys[index]?.toBase58() ?? "" : ""), data }];
  });
}

async function scanMarket(market: Awaited<ReturnType<ReturnType<typeof getMarketProvider>["discoverMarkets"]>>[number], connection: ReturnType<typeof createSolanaMainnetConnection>) {
  const eventAddress = market.pantaEventPda;
  if (!eventAddress || market.phase !== "secondary" || market.pantaSecondaryActive !== true || market.pantaIsGraduated !== true) return;
  let event: PublicKey;
  try { event = new PublicKey(eventAddress); } catch { return; }
  const verified = (await getPantaEventData([market])).get(market.id);
  if (!verified || verified.event.question.trim() !== market.question.trim()) {
    log("event_unverified", { marketId: market.id });
    return;
  }
  const marketDbId = await upsertMarket(market);
  const state = await getPool().query("SELECT newest_signature,backfill_signature,initial_scan_complete FROM panta_trade_scans WHERE market_id=$1", [marketDbId]);
  const checkpoint = state.rows[0]?.newest_signature as string | undefined;
  const initialComplete = state.rows[0]?.initial_scan_complete === true;
  let backfillCursor = state.rows[0]?.backfill_signature as string | null ?? null;
  let newest: { signature: string; slot: number } | undefined;
  let reachedCheckpoint = false;
  let headExhausted = false;
  let historyExhausted = initialComplete;
  let headFetched = 0;
  let olderFetched = 0;
  const discovered = new Map<string, { signature: string; slot: number; blockTime: number | null; err: unknown }>();
  const collectPages = async (startBefore: string | undefined, stopAt: string | undefined, backfill: boolean) => {
    let before = startBefore;
    let fetched = 0;
    let stopped = false;
    let exhausted = false;
    let cursor: string | null = startBefore ?? null;
    while (fetched < maxSignaturesPerScan && !stopped) {
      const limit = Math.min(1_000, maxSignaturesPerScan - fetched);
      const page = await connection.getSignaturesForAddress(event, { limit, ...(before ? { before } : {}) }, "confirmed");
      if (!page.length) { exhausted = true; break; }
      fetched += page.length;
      for (const item of page) {
        if (stopAt && item.signature === stopAt) { stopped = true; break; }
        discovered.set(item.signature, { signature: item.signature, slot: item.slot, blockTime: item.blockTime ?? null, err: item.err });
        if (!backfill && !newest) newest = { signature: item.signature, slot: item.slot };
      }
      cursor = page[page.length - 1]!.signature;
      before = cursor;
      if (page.length < limit) { exhausted = true; break; }
    }
    return { fetched, stopped, exhausted, cursor };
  };
  // Head reconciliation remains incremental while historical backfill advances.
  const head = await collectPages(undefined, checkpoint, false);
  headFetched = head.fetched;
  reachedCheckpoint = head.stopped;
  headExhausted = head.exhausted;
  if (!checkpoint && head.cursor) backfillCursor = head.cursor;
  if (!initialComplete && (checkpoint || headExhausted) && backfillCursor) {
    const older = await collectPages(backfillCursor, undefined, true);
    olderFetched = older.fetched;
    if (older.exhausted || older.fetched < maxSignaturesPerScan) { historyExhausted = true; backfillCursor = null; }
    else backfillCursor = older.cursor;
  } else if (!checkpoint && headExhausted) {
    historyExhausted = true;
    backfillCursor = null;
  }
  const db = getPool();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    for (const item of discovered.values()) {
      await client.query(`INSERT INTO panta_pending_transactions(signature,market_id,event_pda,slot,block_time,status,last_error)
        VALUES($1,$2,$3,$4,CASE WHEN $5::bigint IS NULL THEN NULL ELSE to_timestamp($5) END,$6,$7)
        ON CONFLICT(signature,market_id) DO NOTHING`, [item.signature, marketDbId, eventAddress, item.slot, item.blockTime, item.err ? "permanent_failure" : "discovered", item.err ? "Transaction execution failed on chain." : null]);
    }
    const scanComplete = historyExhausted || (!checkpoint && headExhausted);
    await client.query(`INSERT INTO panta_trade_scans(market_id,event_pda,newest_signature,newest_slot,backfill_signature,initial_scan_complete,last_success_at,last_error)
      VALUES($1,$2,$3,$4,$5,$6,now(),NULL) ON CONFLICT(market_id) DO UPDATE SET event_pda=EXCLUDED.event_pda,
      newest_signature=COALESCE(EXCLUDED.newest_signature,panta_trade_scans.newest_signature),newest_slot=COALESCE(EXCLUDED.newest_slot,panta_trade_scans.newest_slot),
      backfill_signature=CASE WHEN panta_trade_scans.initial_scan_complete THEN NULL ELSE EXCLUDED.backfill_signature END,
      initial_scan_complete=panta_trade_scans.initial_scan_complete OR EXCLUDED.initial_scan_complete,last_success_at=now(),last_error=NULL,updated_at=now()`, [marketDbId, eventAddress, newest?.signature ?? null, newest?.slot ?? null, backfillCursor, scanComplete]);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  const fetched = headFetched + olderFetched;
  if (!historyExhausted) log("history_scan_bounded", { marketId: market.id, fetched, checkpointReached: reachedCheckpoint, backfillCursorPresent: Boolean(backfillCursor) });
  return { marketId: market.id, fetched, queued: discovered.size, checkpointReached: reachedCheckpoint, historyComplete: historyExhausted };
}

async function processPending(connection: ReturnType<typeof createSolanaMainnetConnection>) {
  const result = await getPool().query(`SELECT p.signature,p.market_id,p.event_pda,p.slot,p.block_time,p.attempts,m.provider_market_id
    FROM panta_pending_transactions p JOIN markets m ON m.id=p.market_id
    WHERE p.status IN ('discovered','unavailable') AND p.next_attempt_at<=now() AND p.attempts<$1
    ORDER BY p.discovered_at LIMIT 30`, [maxAttempts]);
  let processed = 0;
  const marketContexts = new Map<string, ReturnType<typeof readPantaBuildContext>>();
  for (const row of result.rows) {
    if (stopping) break;
    const marketDbId = String(row.market_id);
    const signature = String(row.signature);
    const eventAddress = String(row.event_pda);
    const attempts = Number(row.attempts) + 1;
    let status = "unavailable";
    let errorText: string | null = null;
    try {
      const transaction = await connection.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 1 });
      if (!transaction || !transaction.meta) throw new Error("Transaction detail is temporarily unavailable.");
      if (transaction.meta.err !== null) status = "permanent_failure";
      else {
        const logs = transaction.meta.logMessages ?? [];
        const invokesProgram = logs.some((line) => line.startsWith(`Program ${PANTA_CLOB_PROGRAM_ID} invoke`));
        let eventIndex = 0;
        const quoteInstruction = identifyPantaFillQuoteMint(transactionInstructions(transaction), eventAddress);
        let quoteIdentity = { status: "unknown" as "verified" | "unknown" | "unsupported", mint: null as string | null, symbol: null as string | null, decimals: null as number | null, network: "mainnet-beta", source: "none", reason: quoteInstruction.reason };
        if (quoteInstruction.status === "identified" && quoteInstruction.mint === SOLANA_MAINNET_USDC_MINT) {
          try {
            let contextPromise = marketContexts.get(eventAddress);
            if (!contextPromise) { contextPromise = readPantaBuildContext(eventAddress, connection); marketContexts.set(eventAddress, contextPromise); }
            const context = await contextPromise;
            if (context.usdcMint.toBase58() === quoteInstruction.mint) quoteIdentity = { status: "verified", mint: quoteInstruction.mint, symbol: "USDC", decimals: 6, network: "mainnet-beta", source: "on-chain-market-config", reason: null };
            else quoteIdentity = { ...quoteIdentity, status: "unsupported", mint: quoteInstruction.mint, reason: "The order instruction quote mint does not match the verified MarketConfig mint." };
          } catch (error) {
            quoteIdentity = { ...quoteIdentity, status: "unknown", mint: quoteInstruction.mint, source: "on-chain-instruction", reason: error instanceof Error ? error.message : "MarketConfig quote mint could not be verified." };
          }
        } else if (quoteInstruction.status === "identified") quoteIdentity = { ...quoteIdentity, status: "unsupported", mint: quoteInstruction.mint, source: "on-chain-instruction", reason: "The instruction exposes a quote-mint account, but it does not match the configured canonical mainnet USDC mint for Panta's USDC order instruction." };
        else if (quoteInstruction.status === "unsupported") quoteIdentity = { ...quoteIdentity, status: "unsupported", reason: quoteInstruction.reason };
        if (invokesProgram) {
          for (const line of logs) {
            const marker = "Program data: ";
            const at = line.indexOf(marker);
            if (at < 0) continue;
            let bytes: Buffer;
            try { bytes = Buffer.from(line.slice(at + marker.length).trim(), "base64"); } catch { continue; }
            if (!bytes.subarray(0, 8).equals(PANTA_ORDER_MATCHED_DISCRIMINATOR) || bytes.length < 40) continue;
            const decodedEvent = new PublicKey(bytes.subarray(8, 40));
            if (decodedEvent.toBase58() !== eventAddress) continue;
            const fill = decodeOrderMatchedEventRaw(bytes);
            if (!fill) continue;
            const price = Number(fill.priceUnits) / PRICE_SCALE;
            const shareQuantity = Number(fill.shareQuantityUnits) / 10 ** SHARE_DECIMALS;
            const notional = quoteIdentity.status === "verified" ? decimalNotionalFromRawUnits(fill.priceUnits, fill.shareQuantityUnits) : null;
            await getPool().query(`INSERT INTO panta_matched_fills(market_id,event_pda,signature,event_index,slot,block_time,outcome,price,share_quantity,usdc_value,decoder_version,verification_status,
                quote_asset_status,quote_mint,quote_symbol,quote_decimals,quote_network,quote_source,quote_asset_reason,price_units,share_quantity_units,price_scale,share_quantity_scale,quote_notional,quote_notional_mint,quote_notional_status)
              VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,NULL,'panta-clob-log-v1','matched-event-verified',$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
              ON CONFLICT(market_id,signature,event_index) DO NOTHING`,
              [marketDbId,eventAddress,signature,eventIndex,transaction.slot,transaction.blockTime ? new Date(transaction.blockTime * 1000) : null,fill.outcome,price,shareQuantity,quoteIdentity.status,quoteIdentity.mint,quoteIdentity.symbol,quoteIdentity.decimals,quoteIdentity.network,quoteIdentity.source,quoteIdentity.reason,fill.priceUnits.toString(),fill.shareQuantityUnits.toString(),PRICE_SCALE,10 ** SHARE_DECIMALS,notional,notional ? quoteIdentity.mint : null,notional ? "calculated" : "unavailable"]);
            eventIndex++;
          }
        }
        status = eventIndex ? "matched" : invokesProgram ? "no_match" : "no_match";
      }
    } catch (error) {
      errorText = error instanceof Error ? error.message.slice(0, 500) : "Transaction processing failed.";
    }
    const retryDelaySeconds = Math.min(3_600, 15 * 2 ** Math.min(attempts - 1, 8));
    await getPool().query(`UPDATE panta_pending_transactions SET status=$3,attempts=$4,last_error=$5,
      next_attempt_at=now()+($6::text || ' seconds')::interval,updated_at=now() WHERE signature=$1 AND market_id=$2`,
      [signature,marketDbId,status,attempts,errorText,retryDelaySeconds]);
    if (status === "matched") log("matched_fill_verified", { marketId: row.provider_market_id, signature });
    processed++;
  }
  await getPool().query(`UPDATE panta_trade_scans s SET unresolved_count=(SELECT count(*) FROM panta_pending_transactions p WHERE p.market_id=s.market_id AND p.status IN ('discovered','unavailable')),updated_at=now()`);
  return processed;
}

async function run() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for the market intelligence worker.");
  const connection = createSolanaMainnetConnection();
  await assertSolanaMainnet(connection);
  const lock = await getPool().connect();
  const lockResult = await lock.query("SELECT pg_try_advisory_lock(hashtext('mira-market-intelligence-worker')) AS locked");
  if (lockResult.rows[0]?.locked !== true) throw new Error("Another market intelligence worker already holds the deployment lock.");
  const provider = getMarketProvider();
  if (provider.source !== "panta") throw new Error("The market intelligence worker requires Panta mode.");
  log("worker_started", { tradeInterval, bookInterval, maxMarkets });
  let nextTrade = 0;
  let nextBook = 0;
  while (!stopping) {
    const now = Date.now();
    if (now >= nextTrade) {
      try {
        const markets = await provider.discoverMarkets();
        const candidates = markets.filter((m) => m.source === "panta" && m.phase === "secondary" && m.pantaSecondaryActive === true && m.pantaIsGraduated === true && Boolean(m.pantaEventPda));
        const tracked = await Promise.all(candidates.map(async (market) => {
          const id = await upsertMarket(market);
          const saved = await getPool().query("SELECT last_success_at FROM panta_trade_scans WHERE market_id=$1", [id]);
          return { market, lastScanned: saved.rows[0]?.last_success_at ? new Date(saved.rows[0].last_success_at as string | Date).getTime() : 0 };
        }));
        tracked.sort((a, b) => Number(b.market.status === "active") - Number(a.market.status === "active") || a.lastScanned - b.lastScanned);
        const eligible = tracked.slice(0, maxMarkets).map((item) => item.market);
        for (const market of eligible) await scanMarket(market, connection);
        const processed = await processPending(connection);
        lastTradeRun = new Date().toISOString();
        log("trade_poll_complete", { markets: eligible.length, processed, lastTradeRun });
      } catch (error) { log("trade_poll_error", { message: error instanceof Error ? error.message : "unknown" }); }
      nextTrade = Date.now() + tradeInterval;
    }
    if (now >= nextBook) {
      try {
        const result = await collectActiveSecondarySnapshots(maxMarkets);
        lastBookRun = new Date().toISOString();
        log("orderbook_poll_complete", { processed: result.processed, lastBookRun });
      } catch (error) { log("orderbook_poll_error", { message: error instanceof Error ? error.message : "unknown" }); }
      nextBook = Date.now() + bookInterval;
    }
    await wait(Math.min(1_000, Math.max(100, Math.min(nextTrade, nextBook) - Date.now())));
  }
  log("worker_stopping", { lastBookRun, lastTradeRun });
  await lock.query("SELECT pg_advisory_unlock(hashtext('mira-market-intelligence-worker'))");
  lock.release();
  await getPool().end();
}
run().catch((error) => { log("worker_fatal", { message: error instanceof Error ? error.message : "unknown" }); process.exitCode = 1; });
