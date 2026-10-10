export type PersistedVerifiedFill = {
  marketId: string; eventPda: string; signature: string; eventIndex: number; slot: number;
  blockTime: string | null; outcome: "YES" | "NO"; price: number; shareQuantity: number;
  decoderVersion: string;
  quoteAsset?: { status: "verified" | "unknown" | "unsupported"; mint: string | null; symbol: string | null; decimals: number | null; network: string; source: string; reason: string | null };
  priceUnits?: string | null; shareQuantityUnits?: string | null; priceScale?: string | null; shareQuantityScale?: string | null;
  quoteNotional?: string | null; quoteNotionalStatus?: "calculated" | "unavailable" | "unverified";
  /** Accepted only to prove legacy values are ignored. */ legacyUsdcValue?: number | null;
};
export type PersistedFillEvidence = {
  source: "persisted-verified-fills"; marketId: string; eventPda: string | null;
  status: "available" | "partial" | "empty" | "unavailable";
  lastScanAt: string | null; freshnessStatus: "fresh" | "stale" | "unavailable";
  observedFrom: string | null; observedTo: string | null; lastFillAt: string | null;
  verifiedFillCount: number | null;
  metrics: { totalShares: number | null; yesFillCount: number; noFillCount: number; quoteAssetGroups: Array<{
    status: "verified" | "unknown" | "unsupported"; mint: string | null; symbol: string | null; decimals: number | null; network: string; source: string;
    fillCount: number; shareQuantity: number; priceRange: { min: number; max: number } | null; latestPrice: number | null; firstToLastPriceChange: number | null; priceObservationFrom: string | null; priceObservationTo: string | null;
    quoteNotional: string | null; notionalStatus: "calculated" | "unavailable" | "unverified"; reason: string | null;
  }> } | null;
  coverageStatus: "complete" | "partial" | "unavailable"; limitations: string[];
  transactions: Array<{ signature: string; eventIndex: number; slot: number; blockTime: string | null; outcome: "YES" | "NO"; price: number; shareQuantity: number; quoteMint: string | null; quoteSymbol: string | null; quoteStatus: "verified" | "unknown" | "unsupported" }>;
};

function addDecimals(values: string[]): string | null {
  if (!values.length || values.some((value) => !/^\d+(?:\.\d+)?$/.test(value))) return null;
  const places = Math.max(...values.map((value) => value.split(".")[1]?.length ?? 0));
  const scale = BigInt(10) ** BigInt(places);
  const total = values.reduce((sum, value) => { const [whole, fraction = ""] = value.split("."); return sum + BigInt(whole!) * scale + BigInt(fraction.padEnd(places, "0")); }, BigInt(0));
  const whole = total / scale; const remainder = total % scale;
  return remainder ? `${whole}.${remainder.toString().padStart(places, "0").replace(/0+$/, "")}` : whole.toString();
}

export function summarizePersistedFills(input: { marketId: string; eventPda?: string | null; lastScanAt?: string | null; now?: string; fills: PersistedVerifiedFill[]; initialScanComplete: boolean; unresolvedCount: number; truncated?: boolean; unavailable?: boolean }): PersistedFillEvidence {
  const fills = input.fills.filter((fill) => fill.marketId === input.marketId && (!input.eventPda || fill.eventPda === input.eventPda) && fill.signature && Number.isInteger(fill.eventIndex) && fill.slot >= 0 && (fill.outcome === "YES" || fill.outcome === "NO") && Number.isFinite(fill.price) && fill.price > 0 && fill.price <= 1 && Number.isFinite(fill.shareQuantity) && fill.shareQuantity > 0)
    .filter((fill, index, all) => all.findIndex((other) => other.marketId === fill.marketId && other.eventPda === fill.eventPda && other.signature === fill.signature && other.eventIndex === fill.eventIndex) === index)
    .sort((a,b) => { const at = a.blockTime ? Date.parse(a.blockTime) : NaN; const bt = b.blockTime ? Date.parse(b.blockTime) : NaN; return Number.isFinite(at) && Number.isFinite(bt) && at !== bt ? at-bt : a.slot-b.slot || a.signature.localeCompare(b.signature) || a.eventIndex-b.eventIndex; });
  const partial = !input.initialScanComplete || input.unresolvedCount > 0 || input.truncated === true;
  const limitations: string[] = [];
  if (!input.initialScanComplete) limitations.push("Historical backfill has not completed; metrics summarize the observed sample.");
  if (input.unresolvedCount > 0) limitations.push(`${input.unresolvedCount} discovered transaction(s) remain unresolved or unavailable.`);
  if (input.truncated) limitations.push("The bounded fill query reached its limit; older records may be omitted.");
  limitations.push("The database query is bounded to the most recent 90 days; metrics describe this recorded window.");
  if (fills.some((fill) => !fill.blockTime)) limitations.push("Some verified fills lack block timestamps; slot order is retained and time-based intervals are omitted.");
  if (fills.some((fill) => fill.quoteAsset?.status !== "verified")) limitations.push("One or more fills have unknown or unsupported quote-token denomination; legacy usdc_value is not treated as verified USDC.");
  if (input.unavailable) limitations.push("Persisted verified-fill storage could not be queried; this is distinct from no observed fills.");
  const status = input.unavailable ? "unavailable" : fills.length ? partial ? "partial" : "available" : partial ? "partial" : "empty";
  const age = input.lastScanAt && Number.isFinite(Date.parse(input.lastScanAt)) ? Date.parse(input.now ?? new Date().toISOString()) - Date.parse(input.lastScanAt) : Infinity;
  const freshnessStatus = input.unavailable || !Number.isFinite(age) ? "unavailable" : age <= 300_000 ? "fresh" : "stale";
  const timestamps = fills.flatMap((fill) => fill.blockTime && Number.isFinite(Date.parse(fill.blockTime)) ? [new Date(fill.blockTime).toISOString()] : []).sort((a,b) => Date.parse(a)-Date.parse(b));
  const groupMap = new Map<string, PersistedVerifiedFill[]>();
  for (const fill of fills) {
    const identity = fill.quoteAsset ?? { status: "unknown" as const, mint: null, symbol: null, decimals: null, network: "unknown", source: "none", reason: "Persisted quote-asset identity is unavailable." };
    const key = identity.mint ? `mint:${identity.mint}:${identity.status}` : `unknown:${identity.status}:${identity.network}`;
    groupMap.set(key, [...(groupMap.get(key) ?? []), fill]);
  }
  const quoteAssetGroups = [...groupMap.values()].map((group) => {
    const identity = group[0]!.quoteAsset ?? { status: "unknown" as const, mint: null, symbol: null, decimals: null, network: "unknown", source: "none", reason: "Persisted quote-asset identity is unavailable." };
    const values = group.filter((fill) => fill.quoteAsset?.status === "verified" && fill.quoteNotional && fill.quoteNotionalStatus === "calculated" && fill.quoteAsset.mint === identity.mint).map((fill) => fill.quoteNotional!);
    const completeNotional = identity.status === "verified" && values.length === group.length;
    const dated = group.filter((fill) => fill.blockTime && Number.isFinite(Date.parse(fill.blockTime))).sort((a, b) => Date.parse(a.blockTime!) - Date.parse(b.blockTime!));
    const priceStart = dated[0]; const priceEnd = dated.at(-1);
    return { status: identity.status, mint: identity.mint, symbol: identity.symbol, decimals: identity.decimals, network: identity.network, source: identity.source,
      fillCount: group.length, shareQuantity: group.reduce((sum, fill) => sum + fill.shareQuantity, 0), priceRange: { min: Math.min(...group.map((fill) => fill.price)), max: Math.max(...group.map((fill) => fill.price)) },
      latestPrice: [...group].reverse().find((fill) => fill.blockTime)?.price ?? group.at(-1)?.price ?? null,
      firstToLastPriceChange: priceStart && priceEnd && priceStart !== priceEnd ? priceEnd.price - priceStart.price : null,
      priceObservationFrom: priceStart?.blockTime ?? null, priceObservationTo: priceEnd?.blockTime ?? null,
      quoteNotional: completeNotional ? addDecimals(values) : null, notionalStatus: completeNotional ? "calculated" as const : group.some((fill) => fill.quoteNotionalStatus === "unverified") ? "unverified" as const : "unavailable" as const,
      reason: identity.reason ?? (completeNotional ? null : "Quote notional is unavailable because verified denomination and raw units are incomplete.") };
  });
  if (!fills.length) limitations.push("No verified fills were observed in the selected recorded window.");
  const transactions = fills.slice(-20).map((fill) => ({ signature: fill.signature,eventIndex: fill.eventIndex,slot: fill.slot,blockTime: fill.blockTime,outcome: fill.outcome,price: fill.price,shareQuantity: fill.shareQuantity,quoteMint: fill.quoteAsset?.mint ?? null,quoteSymbol: fill.quoteAsset?.symbol ?? null,quoteStatus: fill.quoteAsset?.status ?? "unknown" as const }));
  return { source: "persisted-verified-fills", marketId: input.marketId, eventPda: input.eventPda ?? fills[0]?.eventPda ?? null, status, lastScanAt: input.lastScanAt ?? null, freshnessStatus,
    observedFrom: timestamps[0] ?? null, observedTo: timestamps.at(-1) ?? null, lastFillAt: timestamps.at(-1) ?? null, verifiedFillCount: input.unavailable ? null : fills.length,
    metrics: fills.length ? { totalShares: fills.reduce((sum, fill) => sum + fill.shareQuantity, 0), yesFillCount: fills.filter((fill) => fill.outcome === "YES").length, noFillCount: fills.filter((fill) => fill.outcome === "NO").length, quoteAssetGroups } : input.unavailable ? null : { totalShares: 0, yesFillCount: 0, noFillCount: 0, quoteAssetGroups: [] },
    coverageStatus: input.unavailable ? "unavailable" : partial ? "partial" : "complete", limitations, transactions };
}
