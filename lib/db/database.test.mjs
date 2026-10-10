import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createRequire } from "node:module";
import { isDatabaseTemporarilyUnavailable } from "./api-error.ts";

createRequire(import.meta.url)("@next/env").loadEnvConfig(process.cwd());
const db = await import("./index.ts");

test("only transient database outages enable session-only chat fallback", () => {
  assert.equal(isDatabaseTemporarilyUnavailable({ status: 503 }, { code: "database_unavailable" }), true);
  assert.equal(isDatabaseTemporarilyUnavailable({ status: 503 }, { code: "database_schema" }), false);
  assert.equal(isDatabaseTemporarilyUnavailable({ status: 500 }, { code: "database_unavailable" }), false);
});

test("Neon database persistence and safety integration", async (t) => {
  if (!process.env.DATABASE_URL) return t.skip("DATABASE_URL is not configured.");
  const pool = db.getPool();
  const tables = await pool.query("SELECT to_regclass('public.conversations') AS conversations, to_regclass('public.messages') AS messages, to_regclass('public.market_snapshots') AS snapshots, to_regclass('public.secondary_operations') AS secondary_operations");
  assert.ok(tables.rows[0].conversations && tables.rows[0].messages && tables.rows[0].snapshots && tables.rows[0].secondary_operations, "migrations created expected tables");

  const original = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  assert.throws(() => db.getPool(), /DATABASE_URL/);
  process.env.DATABASE_URL = original;

  const conversation = await db.createConversation("Database persistence check");
  const uuid = randomUUID();
  const sourceUrl = `https://example.com/${uuid}`;
  const secondaryId = randomUUID();
  const expiredSecondaryId = randomUUID();
  const researchRunIds = [];
  let completed = false;
  const market = { id: `db-test-${uuid}`, question: "Database test market", category: "test", description: null, status: "active", yesProbability: 0.61, noProbability: 0.39, volumeUsd: 42, liquidityUsd: null, priceChange24h: null, closeAt: null, updatedAt: new Date().toISOString(), imageUrl: null, history: [], relatedMarketIds: [], source: "panta" };
  try {
    const userMessageId = randomUUID();
    await db.appendMessage(conversation.id, "user", "Hi", userMessageId);
    await db.appendMessage(conversation.id, "user", "Hi", userMessageId);
    await db.saveAssistantTurn(conversation.id, "Hi! I’m MIRA. What would you like to explore?", {
      activeMarketId: market.id,
      markets: [{ id: market.id, question: market.question }],
      tradeChoices: [{ ...market, id: "eligible-choice", question: "Will Bitcoin exceed $100k?" }],
      pendingTrade: { marketQuery: "Bitcoin", outcome: "YES", amountUsdc: 5 },
      researchMarketId: market.id,
      researchSummary: "Saved test research context.",
      researchEvidence: [
        { title: "YES source", source: "Example YES", url: `https://example.com/${uuid}/yes`, publishedAt: null, summary: "Supports YES.", direction: "supports-yes" },
        { title: "NO source", source: "Example NO", url: `https://example.com/${uuid}/no`, publishedAt: null, summary: "Supports NO.", direction: "supports-no" },
      ],
      groq_api_key: "must-not-persist",
    });
    const id = conversation.id;
    const loaded = await db.getConversation(id);
    assert.equal(loaded.messages.length, 2, "retrying a user message with the same ID does not duplicate it");
    assert.equal(loaded.messages[0].content, "Hi", "greeting user message persists");
    assert.match(loaded.messages[1].content, /^Hi! I’m MIRA/, "deterministic greeting response persists");
    assert.equal(loaded.state.activeMarketId, market.id, "conversation state persists");
    assert.equal(loaded.state.tradeChoices[0].id, "eligible-choice", "market-selection choices persist for conversation recovery");
    assert.deepEqual(loaded.state.pendingTrade, { marketQuery: "Bitcoin", outcome: "YES", amountUsdc: 5 }, "unfinished trade intent persists without a quote or transaction");
    assert.equal(loaded.state.researchMarketId, market.id, "research stays linked to its market");
    assert.deepEqual(loaded.state.researchEvidence.map((item) => item.direction), ["supports-yes", "supports-no"], "YES and NO evidence directions survive Neon recovery");
    assert.equal("groq_api_key" in loaded.state, false, "secret-shaped state fields are removed");

    await db.persistMarketObservation(market);
    const marketRow = await pool.query("SELECT id FROM markets WHERE provider='panta' AND provider_market_id=$1", [market.id]);
    assert.ok(marketRow.rowCount, "market upsert persists provider metadata");
    const eventPda = `historical-test-event-${uuid}`;
    await pool.query("INSERT INTO panta_trade_scans(market_id,event_pda,initial_scan_complete,last_success_at,unresolved_count) VALUES($1,$2,false,now(),1)", [marketRow.rows[0].id, eventPda]);
    const fillValues = [marketRow.rows[0].id, eventPda, `historical-test-signature-${uuid}`, 0, 777, new Date("2026-09-15T00:00:00.000Z"), "YES", 0.4, 5, 2];
    const storedFill = await pool.query(`INSERT INTO panta_matched_fills(market_id,event_pda,signature,event_index,slot,block_time,outcome,price,share_quantity,usdc_value,decoder_version,verification_status)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'historical-test-fixture','matched-event-verified') ON CONFLICT(market_id,signature,event_index) DO NOTHING`, fillValues);
    assert.equal(storedFill.rowCount, 1, "historical test fixture is persisted once");
    assert.equal((await pool.query(`INSERT INTO panta_matched_fills(market_id,event_pda,signature,event_index,slot,block_time,outcome,price,share_quantity,usdc_value,decoder_version,verification_status)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'historical-test-fixture','matched-event-verified') ON CONFLICT(market_id,signature,event_index) DO NOTHING`, fillValues)).rowCount, 0, "database unique key deduplicates a repeated fill");
    await assert.rejects(pool.query(`INSERT INTO panta_matched_fills(market_id,event_pda,signature,event_index,slot,outcome,price,share_quantity,decoder_version,verification_status)
      VALUES($1,$2,$3,2,779,'YES',0.5,1,'historical-test-fixture','unverified')`, [marketRow.rows[0].id, eventPda, `unverified-test-signature-${uuid}`]), /check constraint/i, "database verification constraint rejects unverified fills");
    await pool.query(`INSERT INTO panta_matched_fills(market_id,event_pda,signature,event_index,slot,block_time,outcome,price,share_quantity,usdc_value,decoder_version,verification_status)
      VALUES($1,$2,$3,1,778,$4,'NO',0.6,2,1.2,'historical-test-fixture','matched-event-verified')`, [marketRow.rows[0].id, `other-event-${uuid}`, `wrong-event-signature-${uuid}`, new Date("2026-09-15T00:01:00.000Z")]);
    const persistedFills = await db.getPersistedVerifiedFills(market.id);
    assert.equal(persistedFills.fills.length, 1, "query scopes fills to the selected market and its scanned Event PDA");
    assert.equal(persistedFills.fills[0].signature, fillValues[2], "transaction identity and slot survive retrieval");
    assert.equal(persistedFills.fills[0].quoteAsset.status, "unknown", "historical quote identity defaults to unknown after the safe additive migration");
    assert.equal(persistedFills.fills[0].quoteNotional, null, "legacy usdc_value is not trusted as verified quote notional");
    assert.equal(persistedFills.initialScanComplete, false, "incomplete historical scan metadata survives retrieval");
    assert.equal((await pool.query("SELECT id FROM market_snapshots WHERE market_id=$1", [marketRow.rows[0].id])).rowCount, 1, "market observation is timestamped");
    const emptyBook = (outcome) => ({ outcome, bids: [], asks: [], bestBid: null, bestAsk: null, midpoint: null, spread: null, bidDepth: 0, askDepth: 0 });
    const clobSnapshot = { marketId: market.id, marketQuestion: market.question, source: "panta-solana", sourceLabel: "Panta · Solana", observedAt: Date.now(), slot: 123, pantaReference: { yesPrice: 0.61, noPrice: 0.39, observedAt: market.updatedAt }, dataStatus: "complete", freshness: "live", yes: { ...emptyBook("YES"), bids: [{ price: 0.6, size: 2, side: "bid" }], bestBid: 0.6, bidDepth: 1.2 }, no: emptyBook("NO"), activity: [], activityStatus: "complete", historyStatus: "not_collected" };
    assert.equal(await db.persistPantaClobSnapshot({ market, snapshot: clobSnapshot }), true, "first changed CLOB state persists");
    assert.equal(await db.persistPantaClobSnapshot({ market, snapshot: { ...clobSnapshot, observedAt: clobSnapshot.observedAt + 1000, slot: 124 } }), false, "identical normalized book state is deduplicated");
    const quoteChangedSnapshot = { ...clobSnapshot, observedAt: clobSnapshot.observedAt + 1500, slot: 125, pantaReference: { yesPrice: 0.62, noPrice: 0.38, observedAt: new Date(clobSnapshot.observedAt + 1500).toISOString() } };
    assert.equal(await db.persistPantaClobSnapshot({ market, snapshot: quoteChangedSnapshot }), true, "a changed timestamped Panta quote persists even when the book is unchanged");
    const changedSnapshot = { ...clobSnapshot, observedAt: clobSnapshot.observedAt + 2000, slot: 126, yes: { ...clobSnapshot.yes, bids: [{ price: 0.6, size: 3, side: "bid" }], bidDepth: 1.8 } };
    assert.equal(await db.persistPantaClobSnapshot({ market, snapshot: changedSnapshot }), true, "changed visible size persists as a distinct observation");
    const clobHistory = await db.getPantaMicrostructureHistory(market.id);
    assert.equal(clobHistory.length, 3, "history returns only distinct quote or book observations");
    assert.equal(clobHistory[0].source, "panta-solana", "CLOB provenance survives Neon persistence");
    assert.equal(clobHistory[0].provenance, "MIRA-observed", "persisted snapshots remain distinct from current live data");
    assert.equal(clobHistory[0].observedAt, clobSnapshot.observedAt, "observation timestamp survives Neon persistence");

    const report = { market, plan: { marketQuestion: market.question }, status: "complete", researchedAt: new Date().toISOString(), evidence: [{ id: "evidence-test", url: sourceUrl, title: `Test source ${uuid}`, source: "Example", domain: "example.com", publishedAt: null, retrievedAt: new Date().toISOString(), claim: "A sourced test claim", summary: `A short excerpt ${uuid}.`, direction: "supports-yes", relevance: "high", reliability: "medium", sourceTier: 4, freshness: "fresh", evidenceType: "reporting" }], assessment: { stance: "mixed", explanation: "Test assessment." }, synthesisMode: "deterministic", searchStatus: "available", depth: "quick", refreshed: true };
    const runId = await db.persistResearch(report, id);
    researchRunIds.push(runId);
    const sourceRows = await pool.query("SELECT id FROM sources WHERE url=$1", [report.evidence[0].url]);
    assert.equal((await pool.query("SELECT id FROM evidence WHERE research_run_id=$1", [runId])).rowCount, 1, "evidence is linked to the research run");
    assert.equal(sourceRows.rowCount, 1, "source metadata is stored once");
    researchRunIds.push(await db.persistResearch(report, id));
    assert.equal((await pool.query("SELECT id FROM sources WHERE url=$1", [report.evidence[0].url])).rowCount, 1, "repeated URL does not duplicate sources");

    const quoteId = `quote-${uuid}`;
    const orderId = `order-${uuid}`;
    const signature = `public-transaction-${uuid}`;
    await db.persistTradePreparation({ market, side: "YES", amountUsdc: 5, quote: { id: quoteId, shares: 8, averagePrice: 0.62, feeUsd: 0.1, expiresAt: new Date(Date.now() + 60_000).toISOString() } });
    const preparedId = await db.updateTradeTicket(quoteId, "prepared", orderId, "PublicWalletAddress", { instructions: [], recentBlockhash: "blockhash", lastValidBlockHeight: 999, fingerprint: "a".repeat(64), contextSlot: 1, expiresAt: null, validatedAt: new Date().toISOString() });
    assert.ok(preparedId, "only an unexpired quoted ticket can become prepared");
    assert.equal(await db.claimTradeTicketForSubmission({ orderId, wallet: "PublicWalletAddress", signature }), true, "validated ticket is atomically reserved once");
    assert.equal(await db.claimTradeTicketForSubmission({ orderId, wallet: "PublicWalletAddress", signature }), false, "duplicate submission cannot reserve the same ticket twice");
    assert.equal(await db.markTradeTicketSubmitted(orderId, signature), true, "a reserved submission advances to submitted");
    await db.persistTransaction({ orderId, signature, walletAddress: "PublicWalletAddress", status: "submitted" });
    await db.persistTransaction({ orderId, signature, walletAddress: "PublicWalletAddress", status: "confirmed", confirmed: true });
    const trade = await pool.query("SELECT metadata FROM trade_tickets WHERE metadata->>'quoteId'=$1", [`quote-${uuid}`]);
    assert.equal(trade.rowCount, 1, "safe trade ticket metadata persists");
    const transaction = await pool.query("SELECT status,provider_transaction_id,trade_ticket_id,metadata FROM transactions WHERE provider_transaction_id=$1", [signature]);
    assert.equal(transaction.rows[0].status, "confirmed", "transaction lifecycle status persists");
    assert.ok(transaction.rows[0].trade_ticket_id, "transaction links to the prepared ticket");
    assert.equal("signature" in transaction.rows[0].metadata, false, "transaction metadata does not duplicate signing material");

    const operationBase = { id: secondaryId, operationType: "placement", marketId: market.id, wallet: "SecondaryWallet", cluster: "mainnet-beta", side: "YES", priceUnits: "500000000", shareUnits: "1000000", buy: true, recentBlockhash: "recent-blockhash", lastValidBlockHeight: 100, expectedMessageBase64: "bWVzc2FnZQ==", expectedInstructions: [{ programId: "program", data: "AA==", accounts: [] }], makerAccounts: [{ pubkey: "maker", role: "maker_order" }], snapshotSlot: 100, expiresAt: new Date(Date.now() + 60_000).toISOString() };
    assert.equal(await db.createSecondaryOperation(operationBase), true, "exact secondary build is persisted before signing");
    const claims = await Promise.all([1, 2].map(() => db.claimSecondaryOperation({ id: secondaryId, wallet: "SecondaryWallet", signature: `secondary-${uuid}` })));
    assert.deepEqual(claims.sort(), ["claimed", "retry"], "concurrent same-signature requests atomically converge on one operation");
    assert.equal(await db.claimSecondaryOperation({ id: secondaryId, wallet: "SecondaryWallet", signature: `different-${uuid}` }), "conflict", "a different signature cannot replace the claimed transaction");
    assert.equal(await db.recordSecondaryExecution({ id: secondaryId, signature: `secondary-${uuid}`, status: "confirmed", result: { slot: 100, err: null } }), true, "confirmed result persists before notification or reconciliation");
    assert.equal(await db.recordSecondaryReconciliation({ id: secondaryId, status: "reconciled", order: { status: "open", remainingShares: "1000000" } }), true, "order reconciliation is persisted separately from confirmation");
    assert.equal(await db.claimSecondaryOperation({ id: secondaryId, wallet: "SecondaryWallet", signature: `secondary-${uuid}` }), "confirmed", "retry of confirmed signature recovers the existing result");
    assert.equal(await db.claimSecondaryNotification({ id: secondaryId, signature: `secondary-${uuid}` }), true, "notification outbox claim is atomic");
    assert.equal(await db.finishSecondaryNotification({ id: secondaryId, signature: `secondary-${uuid}`, delivered: false }), true, "notification failures remain retryable");
    assert.equal(await db.claimSecondaryNotification({ id: secondaryId, signature: `secondary-${uuid}` }), true, "failed notification retries with the same signature");
    assert.equal(await db.finishSecondaryNotification({ id: secondaryId, signature: `secondary-${uuid}`, delivered: true }), true, "notification delivery is persisted");
    assert.equal((await db.getSecondaryOperation(secondaryId)).notification_status, "delivered");
    assert.equal(await db.createSecondaryOperation({ ...operationBase, id: expiredSecondaryId, expiresAt: new Date(Date.now() - 1_000).toISOString() }), true);
    assert.equal(await db.claimSecondaryOperation({ id: expiredSecondaryId, wallet: "SecondaryWallet", signature: `expired-${uuid}` }), "conflict", "expired unsigned build cannot be claimed");
    await db.appendMessage(id, "user", "PRIVATE KEY: do-not-store-this");
    const redacted = await pool.query("SELECT content FROM messages WHERE conversation_id=$1 ORDER BY created_at DESC LIMIT 1", [id]);
    assert.doesNotMatch(redacted.rows[0].content, /do-not-store-this/);
    completed = true;
  } finally {
    await pool.query("DELETE FROM secondary_operations WHERE id=$1", [secondaryId]);
    await pool.query("DELETE FROM secondary_operations WHERE id=$1", [expiredSecondaryId]);
    await db.deleteConversation(conversation.id);
    const cascade = await pool.query("SELECT count(*)::int AS count FROM messages WHERE conversation_id=$1", [conversation.id]);
    assert.equal(cascade.rows[0].count, 0, "conversation deletion cascades to messages");
    const orphanedResearch = await pool.query("SELECT count(*)::int AS count FROM research_runs WHERE id=ANY($1::uuid[]) AND conversation_id IS NULL", [researchRunIds]);
    if (completed) assert.equal(orphanedResearch.rows[0].count, 2, "research records survive conversation deletion without a dangling foreign key");
    await pool.query("DELETE FROM research_runs WHERE market_id IN (SELECT id FROM markets WHERE provider_market_id=$1)", [market.id]);
    await pool.query("DELETE FROM sources WHERE url=$1", [sourceUrl]);
    await pool.query("DELETE FROM transactions WHERE provider_transaction_id=$1", [`public-transaction-${uuid}`]);
    await pool.query("DELETE FROM trade_intents WHERE market_id IN (SELECT id FROM markets WHERE provider_market_id=$1)", [market.id]);
    await pool.query("DELETE FROM markets WHERE provider_market_id=$1", [market.id]);
    await pool.end();
  }
});
