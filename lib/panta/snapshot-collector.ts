import "server-only";
import { PublicKey } from "@solana/web3.js";
import type { Market } from "@/lib/panta/types";
import { getMarketProvider } from "@/lib/providers/market-provider";
import { getPantaOrderBookSnapshot } from "@/lib/panta/clob";
import { PANTA_CLOB_PROGRAM_ID } from "@/lib/panta/clob-layout";
import { recordMarketAlerts } from "@/lib/panta/alerts";

export type SnapshotCandidateExclusion = { marketId: string; reason: string };

export function snapshotCandidateExclusion(market: Market): string | null {
  if (market.source !== "panta") return "unsupported_provider";
  if (market.phase !== "secondary") return "not_secondary";
  if (market.status === "closed" || market.status === "resolved" || market.pantaIsResolved === true
    || market.pantaSecondaryActive === false || market.pantaIsGraduated === false) return "inactive";
  if (market.status !== "active") return "status_unverified";
  if (market.pantaIsResolved !== false || market.pantaSecondaryActive !== true || market.pantaIsGraduated !== true) return "secondary_state_unverified";
  if (!market.pantaProgramId || market.pantaProgramId !== PANTA_CLOB_PROGRAM_ID) return "unsupported_account";
  if (!market.pantaEventPda) return "invalid_identity";
  try { new PublicKey(market.pantaEventPda); }
  catch { return "invalid_identity"; }
  if (!market.quoteAsset) return "unsupported_quote_asset";
  return null;
}

function unavailableSnapshotReason(reason: string | undefined): string {
  if (reason === "market_not_active_secondary" || reason === "resolved_market") return "inactive";
  if (reason === "market_account_not_found" || reason === "market_account_unrecognized" || reason === "invalid_market_identifier") return "invalid_identity";
  if (reason === "secondary_market_mapping_unavailable") return "unsupported_account";
  if (reason === "quote_asset_unresolved") return "unsupported_quote_asset";
  return `snapshot_unavailable${reason ? `:${reason}` : ""}`;
}

export async function collectActiveSecondarySnapshots(maxMarkets = 10) {
  const provider = getMarketProvider();
  if (provider.source !== "panta") throw new Error("Live market data is not configured.");
  const discovered = await provider.discoverMarkets();
  const candidates: typeof discovered = [];
  const exclusions: SnapshotCandidateExclusion[] = [];
  for (const market of discovered) {
    const reason = snapshotCandidateExclusion(market);
    if (reason) exclusions.push({ marketId: market.id, reason });
    else candidates.push(market);
  }
  const limit = Math.max(1, Math.min(20, Math.floor(maxMarkets)));
  const selected = candidates.slice(0, limit);
  for (const market of candidates.slice(limit)) exclusions.push({ marketId: market.id, reason: "cycle_limit" });
  const observations = [];
  for (const market of selected) {
    const snapshot = await getPantaOrderBookSnapshot(market.id);
    if (snapshot.dataStatus === "unavailable") exclusions.push({ marketId: market.id, reason: unavailableSnapshotReason(snapshot.reason) });
    const alertsCreated = await recordMarketAlerts(market, snapshot);
    const yesBidCount = snapshot.yes.bids.length;
    const yesAskCount = snapshot.yes.asks.length;
    const noBidCount = snapshot.no.bids.length;
    const noAskCount = snapshot.no.asks.length;
    const hasBid = yesBidCount + noBidCount > 0;
    const hasAsk = yesAskCount + noAskCount > 0;
    const bookShape = hasBid && hasAsk ? "two_sided" : hasBid || hasAsk ? "one_sided" : "empty";
    observations.push({ marketId: market.id, observedAt: snapshot.observedAt, slot: snapshot.slot, dataStatus: snapshot.dataStatus, reason: snapshot.reason, bookShape, yesBidCount, yesAskCount, noBidCount, noAskCount, alertsCreated });
  }
  return { discovered: discovered.length, eligible: candidates.length, processed: observations.length, exclusions, observations };
}
