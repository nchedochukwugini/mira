import type { PoolClient } from "pg";
import { getPool } from "@/lib/db";
import { getMarketProvider } from "@/lib/providers/market-provider";
import { collectActiveSecondarySnapshots } from "@/lib/panta/snapshot-collector";
import { assertSolanaMainnet, createSolanaMainnetConnection } from "@/lib/solana/rpc";
import { acquireAdvisoryLock, runWorkerCycles, safeErrorMessage, summarizeSnapshotObservations } from "./worker-runtime";

const pollInterval = Math.max(5_000, Number(process.env.ORDERBOOK_POLL_INTERVAL_MS) || 10_000);
const maxMarkets = Math.max(1, Math.min(20, Number(process.env.MARKET_WORKER_MAX_MARKETS) || 10));
const oneShot = process.argv.includes("--once");
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
    if (!(await acquireAdvisoryLock(lock, "mira-market-snapshot-worker"))) throw new Error("Another market snapshot worker already holds the deployment lock.");
    const provider = getMarketProvider();
    if (provider.source !== "panta") throw new Error("The market snapshot worker requires Panta mode.");
    log("snapshot_worker_started", { mode: oneShot ? "once" : "continuous", pollInterval, maxMarkets });
    await runWorkerCycles({ once: oneShot, cycle: async () => {
        const result = await collectActiveSecondarySnapshots(maxMarkets);
        const summary = summarizeSnapshotObservations(result.observations);
        log("snapshot_candidate_report", { discovered: result.discovered, eligible: result.eligible, exclusions: result.exclusions, observations: result.observations.map(({ marketId, dataStatus, reason, bookShape, yesBidCount, yesAskCount, noBidCount, noAskCount }) => ({ marketId, dataStatus, reason, bookShape, yesBidCount, yesAskCount, noBidCount, noAskCount })) });
        if (result.processed > 0 && summary.unavailable === result.processed) {
          throw Object.assign(new Error("Every selected market snapshot was unavailable; no complete collection was recorded."), { code: "SNAPSHOT_ALL_UNAVAILABLE" });
        }
        if (result.processed > summary.unavailable) lastSuccessfulPoll = new Date().toISOString();
        return { discovered: result.discovered, eligible: result.eligible, marketsObserved: result.processed, ...summary, exclusions: result.exclusions, observations: result.observations.map(({ marketId, observedAt, slot, dataStatus, reason, bookShape, yesBidCount, yesAskCount, noBidCount, noAskCount }) => ({ marketId, observedAt, slot, dataStatus, reason, bookShape, yesBidCount, yesAskCount, noBidCount, noAskCount })), lastSuccessfulPoll };
      }, wait, intervalMs: pollInterval, shouldStop: () => stopping, log: (event, detail) => log(event === "cycle_complete" ? "snapshot_poll_complete" : "snapshot_poll_error", detail) });
  } finally {
    log("snapshot_worker_stopping", { lastSuccessfulPoll });
    if (lock) {
      try { await lock.query("SELECT pg_advisory_unlock(hashtext('mira-market-snapshot-worker'))"); }
      catch (error) { log("snapshot_lock_release_error", { code: errorCode(error), message: safeErrorMessage(error) }); }
      lock.release();
    }
    await getPool().end();
  }
}

run().catch((error) => {
  log("snapshot_worker_fatal", { code: error && typeof error === "object" && "code" in error ? error.code : undefined, message: safeErrorMessage(error) });
  process.exitCode = 1;
});
