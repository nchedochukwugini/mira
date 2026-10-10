import "server-only";
import type { OrderBookSnapshot } from "@/lib/panta/types";
import { getPantaMicrostructureHistory } from "@/lib/db";
import { calculateMicrostructure, toMicrostructureHistory } from "@/lib/panta/microstructure";

const HISTORY_CACHE_MS = 30_000;
const DERIVED_CACHE_MS = 30_000;
const historyCache = new Map<string, { expiresAt: number; points: Awaited<ReturnType<typeof getPantaMicrostructureHistory>> }>();
const derivedCache = new Map<string, { expiresAt: number; fingerprint: string; result: NonNullable<ReturnType<typeof calculateMicrostructure>> }>();

export async function getSnapshotMicrostructure(snapshot: OrderBookSnapshot) {
  if (snapshot.dataStatus === "unavailable") return null;
  const current = toMicrostructureHistory(snapshot);
  const fingerprint = JSON.stringify({ status: current.dataStatus, yes: current.yes, no: current.no });
  const cached = derivedCache.get(snapshot.marketId);
  const now = Date.now();
  if (cached && cached.expiresAt > now && cached.fingerprint === fingerprint) return { ...cached.result, timestamp: current.observedAt };
  let history = historyCache.get(snapshot.marketId);
  if (!history || history.expiresAt <= now) {
    const points = await getPantaMicrostructureHistory(snapshot.marketId, { limit: 500 }).catch(() => []);
    history = { points, expiresAt: now + HISTORY_CACHE_MS };
    historyCache.set(snapshot.marketId, history);
  }
  const result = calculateMicrostructure([...history.points, current]);
  if (result) derivedCache.set(snapshot.marketId, { fingerprint, result, expiresAt: now + DERIVED_CACHE_MS });
  return result;
}
