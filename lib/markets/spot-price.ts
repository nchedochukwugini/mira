import "server-only";

const pairByAsset = { BTC: "XBTUSD", ETH: "ETHUSD" } as const;

export async function getSpotPrice(asset: keyof typeof pairByAsset): Promise<number | null> {
  const url = new URL("https://api.kraken.com/0/public/Ticker");
  url.searchParams.set("pair", pairByAsset[asset]);
  try {
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(7000), headers: { Accept: "application/json" } });
    if (!response.ok) return null;
    const payload = await response.json() as {
      error?: string[];
      result?: Record<string, { c?: [string, string] }>;
    };
    if (payload.error?.length) return null;
    const lastPrice = Object.values(payload.result ?? {})[0]?.c?.[0];
    const price = typeof lastPrice === "string" ? Number(lastPrice) : NaN;
    return Number.isFinite(price) && price > 0 ? price : null;
  } catch {
    return null;
  }
}
