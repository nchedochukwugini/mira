import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;
const startedAt = process.env.MIRA_WORKER_STARTED_AT;
if (!connectionString || !startedAt || Number.isNaN(Date.parse(startedAt))) {
  console.error(JSON.stringify({ event: "worker_data_verification_skipped", reason: "missing_database_target_or_start_time" }));
  process.exit(1);
}

let databaseUrl;
try { databaseUrl = new URL(connectionString); } catch {
  console.error(JSON.stringify({ event: "worker_data_verification_failed", reason: "invalid_database_target" }));
  process.exit(1);
}
const databaseName = decodeURIComponent(databaseUrl.pathname.replace(/^\//, ""));
if (!databaseUrl.hostname.endsWith(".neon.tech") || databaseName.toLowerCase() !== "mira") {
  console.error(JSON.stringify({ event: "worker_data_verification_failed", reason: "database_target_must_be_neon_mira" }));
  process.exit(1);
}

const pool = new Pool({
  connectionString,
  max: 1,
  connectionTimeoutMillis: 10_000,
  query_timeout: 30_000,
  ssl: { rejectUnauthorized: false },
});
try {
  const [snapshots, fills, scans, pending] = await Promise.all([
    pool.query("SELECT count(*)::int AS count FROM market_snapshots WHERE data_source='mira_observed' AND captured_at >= $1", [startedAt]),
    pool.query("SELECT count(*)::int AS count FROM panta_matched_fills WHERE verification_status='matched-event-verified' AND created_at >= $1", [startedAt]),
    pool.query("SELECT count(*)::int AS count FROM panta_trade_scans WHERE last_success_at >= $1", [startedAt]),
    pool.query("SELECT status,count(*)::int AS count FROM panta_pending_transactions WHERE updated_at >= $1 GROUP BY status ORDER BY status", [startedAt]),
  ]);
  console.log(JSON.stringify({
    event: "worker_data_verification",
    database: "Neon MIRA",
    since: new Date(startedAt).toISOString(),
    newMiraObservedSnapshots: snapshots.rows[0].count,
    newMatchedEventVerifiedFills: fills.rows[0].count,
    tradeMarketsScanned: scans.rows[0].count,
    pendingTransactionsByStatus: Object.fromEntries(pending.rows.map((row) => [row.status, row.count])),
  }));
} catch (error) {
  const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : "unknown";
  console.error(JSON.stringify({ event: "worker_data_verification_failed", code, message: "Read-only production verification query failed." }));
  process.exitCode = 1;
} finally {
  await pool.end();
}
