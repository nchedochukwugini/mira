import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error(JSON.stringify({ event: "unavailable_market_audit_failed", reason: "missing_database_url" }));
  process.exit(1);
}

let databaseUrl;
try { databaseUrl = new URL(connectionString); } catch {
  console.error(JSON.stringify({ event: "unavailable_market_audit_failed", reason: "invalid_database_target" }));
  process.exit(1);
}
const databaseName = decodeURIComponent(databaseUrl.pathname.replace(/^\//, ""));
if (!databaseUrl.hostname.endsWith(".neon.tech") || databaseName.toLowerCase() !== "mira" || databaseUrl.hostname.includes("-pooler")) {
  console.error(JSON.stringify({ event: "unavailable_market_audit_failed", reason: "database_target_must_be_direct_neon_mira" }));
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
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const result = await client.query(`
      SELECT DISTINCT ON (m.provider_market_id)
        m.provider_market_id AS "marketId",
        m.title,
        m.status,
        m.phase,
        a.observed_at AS "observedAt",
        a.evidence->>'reason' AS reason,
        a.evidence->>'message' AS message
      FROM panta_market_alerts a
      JOIN markets m ON m.id=a.market_id
      WHERE m.provider='panta'
        AND m.status='active'
        AND a.condition='market_data_unavailable'
        AND a.observed_at >= now() - interval '7 days'
      ORDER BY m.provider_market_id, a.observed_at DESC
      LIMIT 50
    `);
    await client.query("COMMIT");
    console.log(JSON.stringify({
      event: "unavailable_market_alert_audit",
      database: "Neon MIRA",
      windowDays: 7,
      activeMarketsWithRecentUnavailableAlerts: result.rowCount,
      markets: result.rows,
    }));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
} catch (error) {
  const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : "unknown";
  console.error(JSON.stringify({ event: "unavailable_market_audit_failed", code, message: "Read-only production alert query failed." }));
  process.exitCode = 1;
} finally {
  await pool.end();
}
