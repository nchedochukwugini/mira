import "server-only";
import type { Market, OrderBookSnapshot } from "@/lib/panta/types";
import { getPool, upsertMarket } from "@/lib/db";

type AlertInput = { condition: string; evidence: Record<string, unknown>; identity: string };
const numberSetting = (name: string): number | null => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : null;
};

/** Persists opt-in, objective alerts; no external delivery or trading action occurs. */
export async function recordMarketAlerts(market: Market, snapshot: OrderBookSnapshot): Promise<number> {
  const alerts: AlertInput[] = [];
  const now = Date.now();
  const cooldownMs = Math.max(60_000, numberSetting("MARKET_ALERT_COOLDOWN_MS") ?? 900_000);
  const bucket = Math.floor(now / cooldownMs);
  if (snapshot.dataStatus === "unavailable") alerts.push({ condition: "market_data_unavailable", identity: `unavailable:${bucket}`, evidence: { observedAt: snapshot.observedAt, reason: snapshot.reason ?? "unavailable", message: snapshot.message ?? null, source: snapshot.source } });
  else if (snapshot.freshness === "stale") alerts.push({ condition: "market_data_stale", identity: `stale:${bucket}`, evidence: { observedAt: snapshot.observedAt, slot: snapshot.slot, freshness: snapshot.freshness, source: snapshot.source } });
  const maxSpread = numberSetting("MARKET_ALERT_SPREAD_MAX");
  if (maxSpread !== null) {
    for (const book of [snapshot.yes, snapshot.no]) {
      if (book.spread !== null && book.spread >= maxSpread) alerts.push({
        condition: "spread_threshold_crossed", identity: `spread:${book.outcome}:${bucket}`,
        evidence: { outcome: book.outcome, spread: book.spread, threshold: maxSpread, quoteAsset: snapshot.quoteAsset, observedAt: snapshot.observedAt, slot: snapshot.slot, source: snapshot.source },
      });
    }
  }
  for (const [index, fill] of snapshot.activity.entries()) {
    if (fill.kind !== "order_matched" || fill.verificationStatus !== "matched-event-verified") continue;
    alerts.push({ condition: "verified_matched_fill", identity: `fill:${fill.signature}:${index}`, evidence: { signature: fill.signature, eventPda: snapshot.accountAddresses?.event ?? snapshot.marketId, outcome: fill.outcome, price: fill.price, shareQuantity: fill.size, slot: fill.slot, blockTime: fill.observedAt, decoderVersion: fill.decoderVersion, source: "solana-verified-order-matched" } });
  }
  if (snapshot.dataStatus !== "unavailable" && snapshot.slot !== null) {
    try {
      const marketId = await upsertMarket(market);
      const priorOutage = await getPool().query(`SELECT condition FROM panta_market_alerts WHERE market_id=$1
        AND condition IN ('market_data_unavailable','market_data_stale') ORDER BY observed_at DESC LIMIT 1`, [marketId]);
      if (priorOutage.rowCount && snapshot.freshness === "live" && snapshot.dataStatus === "complete") alerts.push({
        condition: "market_data_recovered", identity: `recovered:${bucket}`,
        evidence: { recoveredAt: snapshot.observedAt, slot: snapshot.slot, after: priorOutage.rows[0]!.condition, source: snapshot.source },
      });
      const previous = await getPool().query(`SELECT raw_data->'yes' AS yes,raw_data->'no' AS no
        FROM market_snapshots WHERE market_id=$1 AND data_source='mira_observed' AND solana_slot<$2
        ORDER BY solana_slot DESC LIMIT 1`, [marketId, snapshot.slot]);
      const depthChangeThreshold = numberSetting("MARKET_ALERT_DEPTH_CHANGE_PCT");
      if (previous.rowCount && depthChangeThreshold !== null) {
        const totalDepth = (yes: Record<string, unknown>, no: Record<string, unknown>) => [yes, no].reduce((sum, book) => sum + Number(book.bidDepthQuote ?? book.bidDepth ?? 0) + Number(book.askDepthQuote ?? book.askDepth ?? 0), 0);
        const oldDepth = totalDepth(previous.rows[0]!.yes as Record<string, unknown>, previous.rows[0]!.no as Record<string, unknown>);
        const newDepth = snapshot.yes.bidDepth + snapshot.yes.askDepth + snapshot.no.bidDepth + snapshot.no.askDepth;
        if (oldDepth > 0) {
          const changePct = Math.abs(newDepth - oldDepth) / oldDepth * 100;
          if (changePct >= depthChangeThreshold) alerts.push({ condition: "significant_depth_change", identity: `depth:${bucket}`, evidence: { oldDepth, newDepth, changePct, thresholdPct: depthChangeThreshold, quoteAsset: snapshot.quoteAsset, observedAt: snapshot.observedAt, slot: snapshot.slot, source: snapshot.source } });
        }
      }
      const inserted = await persistAlerts(marketId, alerts, snapshot.observedAt);
      return inserted;
    } catch { return 0; }
  }
  try {
    const marketId = await upsertMarket(market);
    return await persistAlerts(marketId, alerts, snapshot.observedAt);
  } catch { return 0; }
}

async function persistAlerts(marketId: string, alerts: AlertInput[], observedAt: number) {
  let count = 0;
  for (const alert of alerts) {
    const result = await getPool().query(`INSERT INTO panta_market_alerts(market_id,alert_key,condition,observed_at,evidence,source)
      VALUES($1,$2,$3,to_timestamp($4/1000.0),$5::jsonb,$6) ON CONFLICT(market_id,alert_key) DO NOTHING RETURNING id`,
      [marketId, alert.identity, alert.condition, observedAt, JSON.stringify(alert.evidence), "panta-solana"]);
    count += result.rowCount ?? 0;
  }
  return count;
}
