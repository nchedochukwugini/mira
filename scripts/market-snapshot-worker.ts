import type { PoolClient } from "pg";
import { getPool } from "@/lib/db";
import { getMarketProvider } from "@/lib/providers/market-provider";
import { collectActiveSecondarySnapshots } from "@/lib/panta/snapshot-collector";
import { assertSolanaMainnet, createSolanaMainnetConnection } from "@/lib/solana/rpc";

const pollInterval = Math.max(5_000, Number(process.env.ORDERBOOK_POLL_INTERVAL_MS) || 10_000);
const maxMarkets = Math.max(1, Math.min(20, Number(process.env.MARKET_WORKER_MAX_MARKETS) || 10));
let stopping = false;
let lastSuccessfulPoll: string | null = null;
process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

function log(event: string, detail: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ at: new Date().toISOString(), service: "mira-market-snapshots", event, ...detail }));
}
function errorCode(error: unknown) {
  return error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : undefined;
}
function wait(ms: number) { return new Promise<void>((resolve) => setTimeout(resolve, ms)); }

async function run() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for the market snapshot worker.");
  const connection = createSolanaMainnetConnection();
  await assertSolanaMainnet(connection);
  let lock: PoolClient | undefined;
  try {
    lock = await getPool().connect();
    const result = await lock.query("SELECT pg_try_advisory_lock(hashtext('mira-market-snapshot-worker')) AS locked");
    if (result.rows[0]?.locked !== true) throw new Error("Another market snapshot worker already holds the deployment lock.");
    const provider = getMarketProvider();
    if (provider.source !== "panta") throw new Error("The market snapshot worker requires Panta mode.");
    log("snapshot_worker_started", { pollInterval, maxMarkets });
    let retryCount = 0;
    while (!stopping) {
      let delay = pollInterval;
      try {
        const result = await collectActiveSecondarySnapshots(maxMarkets);
        lastSuccessfulPoll = new Date().toISOString();
        retryCount = 0;
        const unavailable = result.observations.filter((item) => item.dataStatus === "unavailable").length;
        log("snapshot_poll_complete", { discovered: result.discoveredActiveSecondary, processed: result.processed, unavailable, observations: result.observations.map(({ marketId, observedAt, slot, dataStatus, reason }) => ({ marketId, observedAt, slot, dataStatus, reason })), lastSuccessfulPoll });
      } catch (error) {
        retryCount = Math.min(retryCount + 1, 7);
        delay = Math.min(pollInterval, 1_000 * 2 ** retryCount);
        log("snapshot_poll_error", { retry: retryCount, retryInMs: delay, code: errorCode(error), message: error instanceof Error ? error.message : "unknown" });
      }
      if (!stopping) await wait(delay);
    }
  } finally {
    log("snapshot_worker_stopping", { lastSuccessfulPoll });
    if (lock) {
      try { await lock.query("SELECT pg_advisory_unlock(hashtext('mira-market-snapshot-worker'))"); }
      catch (error) { log("snapshot_lock_release_error", { code: errorCode(error) }); }
      lock.release();
    }
    await getPool().end();
  }
}

run().catch((error) => {
  log("snapshot_worker_fatal", { code: errorCode(error), message: error instanceof Error ? error.message : "unknown" });
  process.exitCode = 1;
});
