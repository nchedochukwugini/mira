import { PublicKey } from "@solana/web3.js";
import { Pool } from "pg";
import { createSolanaMainnetConnection, assertSolanaMainnet } from "../lib/solana/rpc.ts";
import { PANTA_CLOB_PROGRAM_ID, PANTA_ORDER_MATCHED_DISCRIMINATOR } from "../lib/panta/clob-layout.ts";

const connectionString = process.env.DATABASE_URL;
const startedAt = process.env.MIRA_WORKER_STARTED_AT;
if (!connectionString || !startedAt || Number.isNaN(Date.parse(startedAt))) {
  console.error(JSON.stringify({ event: "pending_transaction_audit_skipped", reason: "missing_database_target_or_start_time" }));
  process.exit(1);
}

let databaseUrl;
try { databaseUrl = new URL(connectionString); } catch {
  console.error(JSON.stringify({ event: "pending_transaction_audit_failed", reason: "invalid_database_target" }));
  process.exit(1);
}
if (!databaseUrl.hostname.endsWith(".neon.tech") || decodeURIComponent(databaseUrl.pathname.replace(/^\//, "")).toLowerCase() !== "mira") {
  console.error(JSON.stringify({ event: "pending_transaction_audit_failed", reason: "database_target_must_be_neon_mira" }));
  process.exit(1);
}

const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 10_000, query_timeout: 30_000, ssl: { rejectUnauthorized: false } });
const connection = createSolanaMainnetConnection();

function matchedEventsForRecordedEvent(logMessages, eventAddress) {
  let count = 0;
  for (const line of logMessages) {
    const marker = "Program data: ";
    const offset = line.indexOf(marker);
    if (offset < 0) continue;
    try {
      const bytes = Buffer.from(line.slice(offset + marker.length).trim(), "base64");
      if (bytes.subarray(0, 8).equals(PANTA_ORDER_MATCHED_DISCRIMINATOR) && bytes.length >= 40 && new PublicKey(bytes.subarray(8, 40)).toBase58() === eventAddress) count++;
    } catch { /* Malformed or unrelated logs are not evidence. */ }
  }
  return count;
}

async function inspect(row, auditGroup) {
  let transaction = null;
  let fetchError = null;
  try { transaction = await connection.getTransaction(String(row.signature), { commitment: "confirmed", maxSupportedTransactionVersion: 1 }); }
  catch (error) { fetchError = error instanceof Error ? error.name : "unknown"; }
  const logs = transaction?.meta?.logMessages ?? [];
  return {
    auditGroup,
    marketId: row.provider_market_id,
    eventAddress: row.event_pda,
    slot: Number(row.slot),
    status: row.status,
    attempts: Number(row.attempts),
    discoveredAt: new Date(row.discovered_at).toISOString(),
    discoveredDuringCurrentRun: new Date(row.discovered_at).getTime() >= Date.parse(startedAt),
    transactionAvailable: Boolean(transaction?.meta),
    transactionFailed: transaction?.meta ? transaction.meta.err !== null : null,
    clobProgramInvoked: logs.some((line) => line.startsWith(`Program ${PANTA_CLOB_PROGRAM_ID} invoke`)),
    matchedEventsForRecordedEvent: matchedEventsForRecordedEvent(logs, String(row.event_pda)),
    fetchError,
  };
}

try {
  await assertSolanaMainnet(connection);
  const [current, priorNoMatch] = await Promise.all([
    pool.query(`SELECT p.signature,m.provider_market_id,p.event_pda,p.slot,p.status,p.attempts,p.discovered_at
    FROM panta_pending_transactions p JOIN markets m ON m.id=p.market_id
    WHERE p.updated_at >= $1 AND p.attempts > 0
    ORDER BY p.updated_at DESC
    LIMIT 10`, [startedAt]),
    pool.query(`SELECT p.signature,m.provider_market_id,p.event_pda,p.slot,p.status,p.attempts,p.discovered_at
    FROM panta_pending_transactions p JOIN markets m ON m.id=p.market_id
    WHERE p.status='no_match' AND p.updated_at < $1
    ORDER BY p.updated_at DESC
    LIMIT 10`, [startedAt]),
  ]);
  const inspectGroup = async (source, group) => {
    const rows = [];
    for (let offset = 0; offset < source.length; offset += 3) rows.push(...await Promise.all(source.slice(offset, offset + 3).map((row) => inspect(row, group))));
    return rows;
  };
  const [currentRows, priorRows] = await Promise.all([inspectGroup(current.rows, "current_run_attempt"), inspectGroup(priorNoMatch.rows, "latest_prior_no_match")]);
  console.log(JSON.stringify({ event: "pending_transaction_audit", database: "Neon MIRA", since: new Date(startedAt).toISOString(), currentRunAttemptCount: currentRows.length, priorNoMatchCount: priorRows.length, currentRunAttempts: currentRows, latestPriorNoMatch: priorRows }));
} catch (error) {
  const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : "unknown";
  console.error(JSON.stringify({ event: "pending_transaction_audit_failed", code, message: "Read-only pending transaction inspection failed." }));
  process.exitCode = 1;
} finally {
  await pool.end();
}
