import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { Pool, type QueryResultRow } from "pg";
import type { Market, OrderBookSnapshot, OrderBookHistoryPoint } from "@/lib/panta/types";
import type { ResearchReport } from "@/lib/research/types";
import type { MicrostructureHistoryPoint } from "@/lib/panta/microstructure";

let pool: Pool | undefined;
export function getPool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not configured.");
  let parsed: URL;
  try { parsed = new URL(connectionString); } catch { throw new Error("DATABASE_URL must be a valid PostgreSQL connection URL."); }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") throw new Error("DATABASE_URL must use the PostgreSQL protocol.");
  pool ??= new Pool({ connectionString, max: 5, ssl: parsed.hostname.endsWith("neon.tech") ? { rejectUnauthorized: false } : undefined });
  return pool;
}

const secretKey = /(?:api[_-]?key|secret|private[_-]?key|seed|mnemonic|password|credential|signing|authorization|access[_-]?token)/i;
function safeJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.slice(0, 100).map(safeJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !secretKey.test(key)).map(([key, item]) => [key, safeJson(item)]));
}
export function safeText(value: string) {
  return value
    .replace(/\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9_-]{8,}\b/g, "[redacted credential]")
    .replace(/\b(?:seed phrase|mnemonic|private key|signing secret)\s*[:=]\s*[^\n]+/gi, "[redacted sensitive material]");
}

export async function createConversation(title?: string, id?: string) {
  const query = id
    ? "INSERT INTO conversations(id,title) VALUES($1,$2) ON CONFLICT(id) DO NOTHING RETURNING id,title,created_at,updated_at"
    : "INSERT INTO conversations(title) VALUES($1) RETURNING id,title,created_at,updated_at";
  const values = id ? [id, title ? safeText(title).slice(0, 200) : null] : [title ? safeText(title).slice(0, 200) : null];
  const { rows } = await getPool().query(query, values);
  if (!rows[0] && id) {
    const existing = await getPool().query("SELECT id,title,created_at,updated_at FROM conversations WHERE id=$1", [id]);
    if (!existing.rows[0]) throw new Error("Conversation could not be created.");
    return existing.rows[0];
  }
  return rows[0];
}
export async function listConversations() {
  const { rows } = await getPool().query("SELECT c.id,c.title,c.created_at,c.updated_at,(SELECT content FROM messages m WHERE m.conversation_id=c.id AND m.role='user' ORDER BY m.created_at DESC LIMIT 1) AS latest_message FROM conversations c ORDER BY c.updated_at DESC LIMIT 100");
  return rows;
}
export async function getConversation(id: string) {
  const db = getPool();
  const conversation = await db.query("SELECT id,title,created_at,updated_at FROM conversations WHERE id=$1", [id]);
  if (!conversation.rowCount) return null;
  const [messages, state] = await Promise.all([
    db.query("SELECT id,role,content,metadata,created_at FROM messages WHERE conversation_id=$1 ORDER BY created_at", [id]),
    db.query("SELECT state FROM conversation_state WHERE conversation_id=$1", [id]),
  ]);
  return { ...conversation.rows[0], messages: messages.rows, state: state.rows[0]?.state ?? {} };
}
export async function deleteConversation(id: string) {
  const result = await getPool().query("DELETE FROM conversations WHERE id=$1", [id]);
  return Boolean(result.rowCount);
}
export async function appendMessage(conversationId: string, role: "user" | "assistant" | "system" | "tool", content: string, messageId?: string) {
  const db = getPool();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const safeContent = safeText(content).slice(0, 12000);
    const { rows } = await client.query(messageId
      ? "INSERT INTO messages(id,conversation_id,role,content) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET id=messages.id WHERE messages.conversation_id=EXCLUDED.conversation_id AND messages.role=EXCLUDED.role AND messages.content=EXCLUDED.content RETURNING id,created_at"
      : "INSERT INTO messages(conversation_id,role,content) VALUES($1,$2,$3) RETURNING id,created_at",
    messageId ? [messageId, conversationId, role, safeContent] : [conversationId, role, safeContent]);
    if (!rows[0]) throw new Error("Message idempotency key is already used for different content.");
    await client.query("UPDATE conversations SET updated_at=now() WHERE id=$1", [conversationId]);
    await client.query("COMMIT");
    return rows[0];
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}
export async function saveAssistantTurn(conversationId: string, assistantMessage: string, state?: unknown, messageId?: string) {
  const db = getPool();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const safeContent = safeText(assistantMessage).slice(0, 12000);
    const inserted = await client.query(messageId
      ? "INSERT INTO messages(id,conversation_id,role,content) VALUES($1,$2,'assistant',$3) ON CONFLICT(id) DO UPDATE SET id=messages.id WHERE messages.conversation_id=EXCLUDED.conversation_id AND messages.role=EXCLUDED.role AND messages.content=EXCLUDED.content RETURNING id"
      : "INSERT INTO messages(conversation_id,role,content) VALUES($1,'assistant',$2) RETURNING id",
    messageId ? [messageId, conversationId, safeContent] : [conversationId, safeContent]);
    if (!inserted.rowCount) throw new Error("Message idempotency key is already used for different content.");
    if (state !== undefined) await client.query("INSERT INTO conversation_state(conversation_id,state) VALUES($1,$2::jsonb) ON CONFLICT(conversation_id) DO UPDATE SET state=EXCLUDED.state,updated_at=now()", [conversationId, JSON.stringify(safeJson(state))]);
    await client.query("UPDATE conversations SET updated_at=now() WHERE id=$1", [conversationId]);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}
export async function saveTurn(input: { conversationId?: string; userMessage: string; assistantMessage: string; state?: unknown }) {
  const db = getPool();
  const client = await db.connect();
  const id = input.conversationId || randomUUID();
  try {
    await client.query("BEGIN");
    await client.query("INSERT INTO conversations(id,title) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET updated_at=now()", [id, safeText(input.userMessage).slice(0, 120)]);
    await client.query("INSERT INTO messages(conversation_id,role,content) VALUES($1,'user',$2),($1,'assistant',$3)", [id, safeText(input.userMessage).slice(0, 5000), safeText(input.assistantMessage).slice(0, 12000)]);
    if (input.state !== undefined) await client.query("INSERT INTO conversation_state(conversation_id,state) VALUES($1,$2::jsonb) ON CONFLICT(conversation_id) DO UPDATE SET state=EXCLUDED.state,updated_at=now()", [id, JSON.stringify(safeJson(input.state))]);
    await client.query("UPDATE conversations SET updated_at=now() WHERE id=$1", [id]);
    await client.query("COMMIT");
    return id;
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

export async function upsertMarket(market: Market) {
  const provider = market.source;
  const endsAt = market.closeAt;
  const { rows } = await getPool().query(`INSERT INTO markets(provider,provider_market_id,title,description,status,categories,end_time,latest_yes_probability,latest_no_probability,latest_volume_usdc,raw_metadata)
    VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11::jsonb)
    ON CONFLICT(provider,provider_market_id) DO UPDATE SET title=EXCLUDED.title,description=EXCLUDED.description,status=EXCLUDED.status,categories=EXCLUDED.categories,end_time=EXCLUDED.end_time,latest_yes_probability=EXCLUDED.latest_yes_probability,latest_no_probability=EXCLUDED.latest_no_probability,latest_volume_usdc=EXCLUDED.latest_volume_usdc,raw_metadata=EXCLUDED.raw_metadata,last_seen_at=now(),updated_at=now()
    RETURNING id`, [provider, market.id, safeText(market.question), market.description ? safeText(market.description) : null, market.status, JSON.stringify(market.category ? [market.category] : []), endsAt, market.yesProbability, market.noProbability, market.volumeUsd, JSON.stringify(safeJson({ source: provider, providerUpdatedAt: market.updatedAt }))]);
  return rows[0].id as string;
}
export async function persistMarketObservation(market: Market) {
  const id = await upsertMarket(market);
  await getPool().query("INSERT INTO market_snapshots(market_id,captured_at,yes_probability,no_probability,volume_usdc,status,raw_data) VALUES($1,now(),$2,$3,$4,$5,$6::jsonb)", [id, market.yesProbability, market.noProbability, market.volumeUsd, market.status, JSON.stringify({ source: market.source, providerUpdatedAt: market.updatedAt })]);
}

export async function persistPantaClobSnapshot(input: { market: Market; snapshot: OrderBookSnapshot }) {
  const { market, snapshot } = input;
  if (snapshot.slot === null || snapshot.dataStatus === "unavailable") return false;
  const marketId = await upsertMarket(market);
  const yes = snapshot.yes;
  const no = snapshot.no;
  const latest = await getPool().query(`SELECT raw_data->'yes' AS yes,raw_data->'no' AS no,raw_data->'pantaReference' AS panta_reference FROM market_snapshots
    WHERE market_id=$1 AND data_source='mira_observed' ORDER BY captured_at DESC LIMIT 1`, [marketId]);
  const comparableBook = (book: Pick<typeof yes, "bestBid" | "bestAsk" | "bidDepth" | "askDepth" | "bids" | "asks">) => ({
    bestBid: book.bestBid, bestAsk: book.bestAsk, bidDepth: book.bidDepth, askDepth: book.askDepth,
    bids: book.bids.map(({ price, size }) => ({ price, size })), asks: book.asks.map(({ price, size }) => ({ price, size })),
  });
  if (latest.rowCount) {
    const priorYes = latest.rows[0]!.yes as typeof yes | null;
    const priorNo = latest.rows[0]!.no as typeof no | null;
    const priorReference = latest.rows[0]!.panta_reference as typeof snapshot.pantaReference | null;
    const sameReference = priorReference?.yesPrice === snapshot.pantaReference.yesPrice && priorReference?.noPrice === snapshot.pantaReference.noPrice;
    if (priorYes && priorNo && sameReference && JSON.stringify(comparableBook(priorYes)) === JSON.stringify(comparableBook(yes)) && JSON.stringify(comparableBook(priorNo)) === JSON.stringify(comparableBook(no))) return false;
  }
  const result = await getPool().query(`INSERT INTO market_snapshots(
      market_id,captured_at,yes_probability,no_probability,status,raw_data,data_source,solana_slot,order_book_status,
      yes_best_bid,yes_best_ask,no_best_bid,no_best_ask,yes_bid_depth_usdc,yes_ask_depth_usdc,no_bid_depth_usdc,no_ask_depth_usdc
    ) VALUES($1,to_timestamp($2 / 1000.0),$3,$4,$5,$6::jsonb,'mira_observed',$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
    ON CONFLICT (market_id,solana_slot) WHERE data_source='mira_observed' AND solana_slot IS NOT NULL DO NOTHING`, [
    marketId, snapshot.observedAt, market.yesProbability, market.noProbability, market.status,
    JSON.stringify({ source: snapshot.source, sourceLabel: snapshot.sourceLabel, observedAt: snapshot.observedAt, freshness: snapshot.freshness, yes, no, activity: snapshot.activity, activityStatus: snapshot.activityStatus, pantaReference: snapshot.pantaReference }),
    snapshot.slot, snapshot.dataStatus, yes.bestBid, yes.bestAsk, no.bestBid, no.bestAsk, yes.bidDepth, yes.askDepth, no.bidDepth, no.askDepth,
  ]);
  return Boolean(result.rowCount);
}

export async function getPantaClobSnapshotHistory(providerMarketId: string, limit = 100): Promise<OrderBookHistoryPoint[]> {
  const { rows } = await getPool().query(`SELECT captured_at,solana_slot,yes_best_bid,yes_best_ask,no_best_bid,no_best_ask
    FROM market_snapshots s JOIN markets m ON m.id=s.market_id
    WHERE m.provider='panta' AND m.provider_market_id=$1 AND s.data_source='mira_observed' AND s.solana_slot IS NOT NULL
    ORDER BY s.captured_at DESC LIMIT $2`, [providerMarketId, Math.max(1, Math.min(500, limit))]);
  return rows.map((row) => ({ observedAt: new Date(row.captured_at as string | Date).getTime(), slot: Number(row.solana_slot), yesBestBid: row.yes_best_bid === null ? null : Number(row.yes_best_bid), yesBestAsk: row.yes_best_ask === null ? null : Number(row.yes_best_ask), noBestBid: row.no_best_bid === null ? null : Number(row.no_best_bid), noBestAsk: row.no_best_ask === null ? null : Number(row.no_best_ask) }));
}

export async function getPantaMicrostructureHistory(providerMarketId: string, options: { start?: number; end?: number; limit?: number } = {}): Promise<MicrostructureHistoryPoint[]> {
  const limit = Math.max(1, Math.min(500, Math.floor(options.limit ?? 200)));
  const { rows } = await getPool().query(`SELECT s.captured_at,s.solana_slot,s.order_book_status,s.raw_data
    FROM market_snapshots s JOIN markets m ON m.id=s.market_id
    WHERE m.provider='panta' AND m.provider_market_id=$1 AND s.data_source='mira_observed' AND s.solana_slot IS NOT NULL
      AND ($2::double precision IS NULL OR extract(epoch from s.captured_at)*1000 >= $2)
      AND ($3::double precision IS NULL OR extract(epoch from s.captured_at)*1000 <= $3)
    ORDER BY s.captured_at DESC LIMIT $4`, [providerMarketId, options.start ?? null, options.end ?? null, limit]);
  return rows.map((row) => {
    const raw = row.raw_data as Record<string, unknown>;
    const activityState: MicrostructureHistoryPoint["activityStatus"] = raw.activityStatus === "complete" || raw.activityStatus === "partial" ? raw.activityStatus : "unavailable";
    return {
      marketId: providerMarketId,
      observedAt: new Date(row.captured_at as string | Date).getTime(),
      slot: row.solana_slot === null ? null : Number(row.solana_slot),
      source: "panta-solana" as const,
      provenance: "MIRA-observed" as const,
      dataStatus: row.order_book_status === "partial" ? "partial" as const : "complete" as const,
      yes: raw.yes as MicrostructureHistoryPoint["yes"],
      no: raw.no as MicrostructureHistoryPoint["no"],
      pantaReference: raw.pantaReference as MicrostructureHistoryPoint["pantaReference"],
      activity: Array.isArray(raw.activity) ? raw.activity as MicrostructureHistoryPoint["activity"] : [],
      activityStatus: activityState,
    };
  }).reverse();
}

export async function getLatestMarketResearch(providerMarketId: string): Promise<{ status: "available" | "not-run"; evidence: import("@/lib/research/types").ResearchEvidence[]; researchedAt?: string | null }> {
  const { rows } = await getPool().query(`SELECT e.id,e.claim,e.excerpt,e.direction,e.relevance,e.reliability,e.published_at,e.retrieved_at,e.metadata,
      s.title,s.publisher,s.domain,s.url,s.metadata AS source_metadata,r.completed_at
    FROM research_runs r JOIN markets m ON m.id=r.market_id
    LEFT JOIN evidence e ON e.research_run_id=r.id LEFT JOIN sources s ON s.id=e.source_id
    WHERE m.provider='panta' AND m.provider_market_id=$1
      AND r.id=(SELECT rr.id FROM research_runs rr WHERE rr.market_id=m.id ORDER BY rr.started_at DESC LIMIT 1)
    ORDER BY e.relevance DESC,e.reliability DESC,e.retrieved_at DESC LIMIT 30`, [providerMarketId]);
  if (!rows.length) return { status: "not-run", evidence: [], researchedAt: null };
  const evidence = rows.flatMap((row) => {
    if (typeof row.id !== "string" || typeof row.url !== "string" || typeof row.claim !== "string") return [];
    const direction: import("@/lib/research/types").ResearchDirection = row.direction === "supports_yes" ? "supports-yes" : row.direction === "supports_no" ? "supports-no" : "neutral";
    const enumValue = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T => typeof value === "string" && allowed.includes(value as T) ? value as T : fallback;
    const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata as Record<string, unknown> : {};
    const sourceMetadata = row.source_metadata && typeof row.source_metadata === "object" ? row.source_metadata as Record<string, unknown> : {};
    const sourceTier: import("@/lib/research/types").ResearchEvidence["sourceTier"] = sourceMetadata.sourceTier === 1 ? 1 : sourceMetadata.sourceTier === 2 ? 2 : sourceMetadata.sourceTier === 3 ? 3 : 4;
    return [{
      id: row.id, claim: row.claim, summary: typeof row.excerpt === "string" ? row.excerpt : row.claim,
      title: typeof row.title === "string" ? row.title : "Untitled source", source: typeof row.publisher === "string" ? row.publisher : typeof row.domain === "string" ? row.domain : "Source unavailable",
      domain: typeof row.domain === "string" ? row.domain : "", url: row.url,
      publishedAt: row.published_at ? new Date(row.published_at as string | Date).toISOString() : null,
      ...(typeof sourceMetadata.publishedAtPrecision === "string" ? { publishedAtPrecision: sourceMetadata.publishedAtPrecision as "date" | "timestamp" } : {}),
      retrievedAt: row.retrieved_at ? new Date(row.retrieved_at as string | Date).toISOString() : new Date(row.completed_at as string | Date).toISOString(),
      direction, relevance: enumValue(row.relevance, ["high", "medium", "low"] as const, "low"), reliability: enumValue(row.reliability, ["high", "medium", "low"] as const, "low"),
      sourceTier,
      reliabilityReason: "As recorded by MIRA's research evidence engine.",
      sourceType: enumValue(sourceMetadata.sourceType, ["primary-official", "independent-reporting", "specialist-data-provider", "expert-analysis", "social-user-generated", "aggregator-syndicated", "unknown"] as const, "unknown"),
      independenceStatus: enumValue(sourceMetadata.independenceStatus, ["unknown", "duplicate-content"] as const, "unknown"),
      usageStatus: enumValue(sourceMetadata.usageStatus, ["used", "context-only", "excluded"] as const, "context-only"),
      usageReason: typeof sourceMetadata.usageReason === "string" ? sourceMetadata.usageReason : "Historical source usage classification is unavailable.",
      evidenceType: enumValue(sourceMetadata.evidenceType, ["fact", "market-data", "official", "reporting", "analysis", "inference"] as const, "inference"),
      reasoning: typeof metadata.reasoning === "string" ? metadata.reasoning : undefined, pageRetrieved: true,
      freshness: enumValue(sourceMetadata.freshness, ["fresh", "recent", "stale", "undated"] as const, row.published_at ? "recent" : "undated"),
    }];
  });
  const completedAt = rows[0]?.completed_at;
  return { status: "available", evidence, researchedAt: completedAt ? new Date(completedAt as string | Date).toISOString() : null };
}

export async function persistResearch(report: ResearchReport, conversationId?: string) {
  const db = getPool();
  const marketId = report.market ? await upsertMarket(report.market) : null;
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const run = await client.query(`INSERT INTO research_runs(conversation_id,market_id,question,status,started_at,completed_at,freshness,source_count,evidence_count,assessment,model,metadata)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12::jsonb) RETURNING id`, [conversationId ?? null, marketId, safeText(report.market?.question ?? report.plan?.marketQuestion ?? "Research"), report.status, report.researchedAt, report.researchedAt, report.evidence.some((e) => e.freshness === "fresh") ? "fresh" : "unknown", new Set(report.evidence.map((e) => e.url)).size, report.evidence.length, JSON.stringify(report.assessment), report.synthesisMode === "model" ? process.env.GROQ_MODEL ?? "groq" : "deterministic", JSON.stringify(safeJson({ searchStatus: report.searchStatus, depth: report.depth, refreshed: report.refreshed }))]);
    const runId = run.rows[0].id as string;
    for (const item of report.evidence) {
      const contentHash = createHash("sha256").update(`${item.title}\n${item.summary}`).digest("hex");
      const insertedSource = await client.query(`INSERT INTO sources(url,title,publisher,domain,published_at,retrieved_at,content_hash,metadata)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb) ON CONFLICT DO NOTHING RETURNING id`, [item.url, safeText(item.title), safeText(item.source), item.domain, item.publishedAt, item.retrievedAt, contentHash, JSON.stringify(safeJson({ freshness: item.freshness, evidenceType: item.evidenceType, sourceTier: item.sourceTier, sourceType: item.sourceType, independenceStatus: item.independenceStatus, usageStatus: item.usageStatus, usageReason: item.usageReason, publishedAtPrecision: item.publishedAtPrecision }))]);
      const source = insertedSource.rowCount ? insertedSource : await client.query("SELECT id FROM sources WHERE url=$1 OR content_hash=$2 ORDER BY (url=$1) DESC LIMIT 1", [item.url, contentHash]);
      const direction = item.direction === "supports-yes" ? "supports_yes" : item.direction === "supports-no" ? "supports_no" : item.direction;
      const key = createHash("sha256").update(`${item.url}\n${item.claim}`).digest("hex");
      await client.query(`INSERT INTO evidence(research_run_id,source_id,evidence_key,claim,direction,relevance,reliability,published_at,retrieved_at,excerpt,metadata)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb) ON CONFLICT(research_run_id,evidence_key) DO NOTHING`, [runId, source.rows[0].id, key, safeText(item.claim), direction, item.relevance, item.reliability, item.publishedAt, item.retrievedAt, safeText(item.summary).slice(0, 1200), JSON.stringify(safeJson({ reasoning: item.reasoning }))]);
    }
    await client.query("COMMIT");
    return runId;
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

export async function persistTradePreparation(input: { market: Market; side: "YES" | "NO"; amountUsdc: number; quote: { id: string; shares: number | null; averagePrice: number | null; feeUsd: number | null; expiresAt: string | null } }) {
  const db = getPool();
  const marketId = await upsertMarket(input.market);
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const intent = await client.query("INSERT INTO trade_intents(market_id,side,amount_usdc,status,metadata) VALUES($1,$2,$3,'quoted',$4::jsonb) RETURNING id", [marketId, input.side, input.amountUsdc, JSON.stringify({ provider: input.market.source })]);
    await client.query(`INSERT INTO trade_tickets(trade_intent_id,market_id,side,amount_usdc,estimated_shares,average_price,fee_usdc,expires_at,status,metadata)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,'quoted',$9::jsonb)`, [intent.rows[0].id, marketId, input.side, input.amountUsdc, input.quote.shares, input.quote.averagePrice, input.quote.feeUsd, input.quote.expiresAt, JSON.stringify({ provider: input.market.source, quoteId: input.quote.id })]);
    await client.query("COMMIT");
    return intent.rows[0].id as string;
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

export async function getTradeTicketByQuoteId(quoteId: string) {
  const result = await getPool().query(`SELECT t.id,t.side,t.amount_usdc,t.expires_at,t.status,t.metadata->>'orderId' AS order_id,t.metadata->>'wallet' AS wallet,m.provider_market_id AS market_id
    FROM trade_tickets t JOIN markets m ON m.id=t.market_id WHERE t.metadata->>'quoteId'=$1 LIMIT 1`, [quoteId]);
  return result.rows[0] ?? null;
}

export async function getTradeTicketByOrderId(orderId: string) {
  const result = await getPool().query(`SELECT t.id,t.side,t.amount_usdc,t.expires_at,t.status,t.metadata,t.metadata->>'quoteId' AS quote_id,t.metadata->>'wallet' AS wallet,m.provider_market_id AS market_id
    FROM trade_tickets t JOIN markets m ON m.id=t.market_id WHERE t.metadata->>'orderId'=$1 LIMIT 1`, [orderId]);
  return result.rows[0] ?? null;
}

export async function updateTradeTicket(quoteId: string, status: string, orderId?: string, wallet?: string, validation?: {
  instructions: unknown; recentBlockhash: string; lastValidBlockHeight: number | null; fingerprint: string; contextSlot: number; expiresAt: string | null; validatedAt: string;
}) {
  const metadata = {
    ...(orderId ? { orderId } : {}), ...(wallet ? { wallet } : {}),
    ...(validation ? { buildValidation: validation } : {}),
  };
  const result = await getPool().query("UPDATE trade_tickets SET status=$2,metadata=metadata || $3::jsonb WHERE metadata->>'quoteId'=$1 AND status='quoted' AND expires_at IS NOT NULL AND expires_at>now() RETURNING id", [quoteId, status, JSON.stringify(metadata)]);
  return result.rows[0]?.id as string | undefined;
}

/** Atomic one-time reservation so concurrent requests cannot submit one ticket twice. */
export async function claimTradeTicketForSubmission(input: { orderId: string; wallet: string; signature: string }) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [input.signature]);
    const prior = await client.query("SELECT 1 FROM transactions WHERE provider='panta' AND provider_transaction_id=$1 LIMIT 1", [input.signature]);
    if (prior.rowCount) { await client.query("ROLLBACK"); return false; }
    const result = await client.query(`UPDATE trade_tickets SET status='submitting',metadata=metadata || $3::jsonb
      WHERE metadata->>'orderId'=$1 AND metadata->>'wallet'=$2 AND metadata->'buildValidation' IS NOT NULL
      AND metadata->'buildValidation'->>'fingerprint' IS NOT NULL AND status='prepared'
      AND expires_at IS NOT NULL AND expires_at>now() RETURNING id`, [input.orderId, input.wallet, JSON.stringify({ submissionSignature: input.signature, submissionClaimedAt: new Date().toISOString() })]);
    await client.query("COMMIT");
    return Boolean(result.rowCount);
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

export async function markTradeTicketSubmitted(orderId: string, signature: string) {
  const result = await getPool().query(`UPDATE trade_tickets SET status='submitted' WHERE metadata->>'orderId'=$1
    AND status='submitting' AND metadata->>'submissionSignature'=$2 RETURNING id`, [orderId, signature]);
  return Boolean(result.rowCount);
}

export async function persistTransaction(input: { orderId: string; signature: string; walletAddress: string; status: string; confirmed?: boolean }) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const current = await client.query("UPDATE transactions SET status=$2,confirmed_at=CASE WHEN $3 THEN now() ELSE confirmed_at END WHERE provider='panta' AND provider_transaction_id=$1 RETURNING id", [input.signature, safeText(input.status).slice(0, 80), input.confirmed === true]);
    if (!current.rowCount) {
      await client.query(`INSERT INTO transactions(trade_ticket_id,provider,provider_transaction_id,wallet_address,status,submitted_at,confirmed_at,metadata)
        VALUES((SELECT id FROM trade_tickets WHERE metadata->>'orderId'=$1 LIMIT 1),'panta',$2,$3,$4,now(),CASE WHEN $5 THEN now() ELSE NULL END,$6::jsonb)`, [input.orderId, input.signature, input.walletAddress, safeText(input.status).slice(0, 80), input.confirmed === true, JSON.stringify({ orderId: input.orderId })]);
    }
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

export type SecondaryOperationRecord = {
  id: string; operation_type: "placement" | "cancellation"; market_id: string; wallet_address: string; cluster: string;
  side: string | null; price_units: string | null; share_units: string | null; buy: boolean | null; target_order: string | null;
  recent_blockhash: string; last_valid_block_height: string; expected_message_base64: string;
  expected_instructions: unknown[]; maker_accounts: unknown[]; snapshot_slot: string; expires_at: Date;
  status: string; signature: string | null; chain_result: unknown; notification_status: string;
  reconciliation_status: string; reconciled_order: unknown;
};

export async function createSecondaryOperation(input: {
  id: string; operationType: "placement" | "cancellation"; marketId: string; wallet: string; cluster: string;
  side?: string; priceUnits?: string; shareUnits?: string; buy?: boolean; targetOrder?: string;
  recentBlockhash: string; lastValidBlockHeight: number; expectedMessageBase64: string;
  expectedInstructions: unknown[]; makerAccounts: unknown[]; snapshotSlot: number; expiresAt: string;
}) {
  const result = await getPool().query(`INSERT INTO secondary_operations
    (id,operation_type,market_id,wallet_address,cluster,side,price_units,share_units,buy,target_order,recent_blockhash,last_valid_block_height,expected_message_base64,expected_instructions,maker_accounts,snapshot_slot,expires_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb,$16,$17)
    ON CONFLICT(id) DO NOTHING RETURNING id`, [input.id,input.operationType,input.marketId,input.wallet,input.cluster,input.side ?? null,input.priceUnits ?? null,input.shareUnits ?? null,input.buy ?? null,input.targetOrder ?? null,input.recentBlockhash,input.lastValidBlockHeight,input.expectedMessageBase64,JSON.stringify(input.expectedInstructions),JSON.stringify(input.makerAccounts),input.snapshotSlot,input.expiresAt]);
  return Boolean(result.rowCount);
}

export async function getSecondaryOperation(id: string): Promise<SecondaryOperationRecord | null> {
  const result = await getPool().query("SELECT * FROM secondary_operations WHERE id=$1", [id]);
  return (result.rows[0] as SecondaryOperationRecord | undefined) ?? null;
}

/** Same-signature retries can resume verification; a different signature cannot claim the operation. */
export async function claimSecondaryOperation(input: { id: string; wallet: string; signature: string; verifiedOnChain?: boolean }) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`secondary:${input.id}`]);
    const row = await client.query("SELECT wallet_address,status,signature,expires_at FROM secondary_operations WHERE id=$1 FOR UPDATE", [input.id]);
    if (!row.rowCount || row.rows[0].wallet_address !== input.wallet) { await client.query("ROLLBACK"); return "conflict" as const; }
    const current = row.rows[0];
    if (current.signature && current.signature !== input.signature) { await client.query("ROLLBACK"); return "conflict" as const; }
    if (current.status === "confirmed" || current.status === "failed") { await client.query("COMMIT"); return current.status as "confirmed" | "failed"; }
    if (current.status === "built") {
      const updated = await client.query(`UPDATE secondary_operations SET status='submission_initiated',signature=$2,updated_at=now()
        WHERE id=$1 AND wallet_address=$3 AND status='built' AND (expires_at>now() OR $4::boolean) RETURNING id`, [input.id,input.signature,input.wallet,input.verifiedOnChain === true]);
      if (!updated.rowCount) { await client.query("ROLLBACK"); return "conflict" as const; }
      await client.query("COMMIT"); return "claimed" as const;
    }
    if (current.status === "submission_initiated" && current.signature === input.signature) { await client.query("COMMIT"); return "retry" as const; }
    await client.query("ROLLBACK"); return "conflict" as const;
  } catch (error) { await client.query("ROLLBACK"); if (error && typeof error === "object" && "code" in error && error.code === "23505") return "conflict" as const; throw error; } finally { client.release(); }
}

export async function recordSecondarySubmissionInitiated(input: { id: string; wallet: string; signature: string; seenOnChain: boolean }) {
  try {
    const result = await getPool().query(`UPDATE secondary_operations SET status='submission_initiated',signature=$3,updated_at=now()
      WHERE id=$1 AND wallet_address=$2 AND ((status='built' AND (expires_at>now() OR $4::boolean)) OR (status='submission_initiated' AND signature=$3)) RETURNING id`,
    [input.id,input.wallet,input.signature,input.seenOnChain]);
    return Boolean(result.rowCount);
  } catch (error) { if (error && typeof error === "object" && "code" in error && error.code === "23505") return false; throw error; }
}

export async function recordSecondaryExecution(input: { id: string; signature: string; status: "confirmed" | "failed"; result: unknown }) {
  const result = await getPool().query(`UPDATE secondary_operations SET status=$3,chain_result=$4::jsonb,
    notification_status=CASE WHEN $3='confirmed' THEN CASE WHEN notification_status='delivered' THEN 'delivered' ELSE 'pending' END ELSE 'not_applicable' END,updated_at=now()
    WHERE id=$1 AND signature=$2 AND status IN ('submission_initiated',$3) RETURNING id`, [input.id,input.signature,input.status,JSON.stringify(safeJson(input.result))]);
  return Boolean(result.rowCount);
}

export async function claimSecondaryNotification(input: { id: string; signature: string }) {
  const result = await getPool().query(`UPDATE secondary_operations SET notification_status='delivering',notification_attempted_at=now(),updated_at=now()
    WHERE id=$1 AND signature=$2 AND status='confirmed'
    AND (notification_status IN ('pending','failed') OR (notification_status='delivering' AND notification_attempted_at<now()-interval '30 seconds'))
    RETURNING id`, [input.id,input.signature]);
  return Boolean(result.rowCount);
}

export async function finishSecondaryNotification(input: { id: string; signature: string; delivered: boolean }) {
  const result = await getPool().query(`UPDATE secondary_operations SET notification_status=$3,updated_at=now()
    WHERE id=$1 AND signature=$2 AND status='confirmed' AND notification_status='delivering' RETURNING id`, [input.id,input.signature,input.delivered ? "delivered" : "failed"]);
  return Boolean(result.rowCount);
}

export async function recordSecondaryReconciliation(input: { id: string; status: string; order: unknown }) {
  const result = await getPool().query(`UPDATE secondary_operations SET reconciliation_status=$2,reconciled_order=$3::jsonb,updated_at=now()
    WHERE id=$1 AND status='confirmed' RETURNING id`, [input.id,input.status,JSON.stringify(safeJson(input.order))]);
  return Boolean(result.rowCount);
}

export type DbRow = QueryResultRow;
