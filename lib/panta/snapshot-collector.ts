import "server-only";
import { getMarketProvider } from "@/lib/providers/market-provider";
import { getPantaOrderBookSnapshot } from "@/lib/panta/clob";

export async function collectActiveSecondarySnapshots(maxMarkets = 10) {
  const provider = getMarketProvider();
  if (provider.source !== "panta") throw new Error("Live market data is not configured.");
  const discovered = await provider.discoverMarkets();
  const active = discovered.filter((market) => market.source === "panta" && market.status === "active" && market.phase === "secondary" && market.pantaSecondaryActive === true && market.pantaIsGraduated === true && market.pantaIsResolved !== true);
  const limit = Math.max(1, Math.min(20, Math.floor(maxMarkets)));
  const observations = [];
  for (const market of active.slice(0, limit)) {
    const snapshot = await getPantaOrderBookSnapshot(market.id);
    observations.push({ marketId: market.id, observedAt: snapshot.observedAt, slot: snapshot.slot, dataStatus: snapshot.dataStatus });
  }
  return { discoveredActiveSecondary: active.length, processed: observations.length, observations };
}
