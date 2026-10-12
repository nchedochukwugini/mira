import type {
  AnalysisIntentType,
  AnalysisRequest,
  AnalysisTimeframe,
  AnalysisResult,
  DataStatus,
  Market,
  MarketIntent,
  MarketMovement,
  MarketSnapshot,
  RelatedMarket,
  QuoteAsset,
} from "@/lib/panta/types";

const stopWords = new Set([
  "what", "which", "will", "would", "could", "should", "are", "is", "the", "a", "an", "and", "or", "for", "to", "of", "in", "on", "at", "by", "with", "from", "about", "into", "markets", "market", "title", "unavailable", "find", "show", "tell", "compare", "analyze", "analyse", "me", "most", "more", "least", "current", "currently", "today", "now", "next", "decision", "move", "moves", "moving", "movement", "sensitive", "sensitivity", "related", "nearby", "biggest", "largest", "highest", "volume", "liquidity", "liquid", "probability", "probabilities", "price", "prices", "trend", "trends", "impact", "event", "events", "react", "reacting", "change", "changes", "24h", "hour", "hours",
]);

const entityAliases: Record<string, string[]> = {
  "Federal Reserve": ["fed", "federal reserve", "fomc", "interest rates", "rate decision"],
  Bitcoin: ["bitcoin", "btc"],
  Ethereum: ["ethereum", "ether", "eth"],
  Inflation: ["inflation", "cpi", "core cpi"],
  "US election": ["election", "presidential election", "us election"],
  Sports: ["sports", "sport", "nfl", "nba", "mlb", "nhl", "soccer", "football", "basketball", "baseball", "tennis"],
  Crypto: ["crypto", "cryptocurrency"],
};

const normalizeWords = (value: string) => value.toLowerCase().replace(/\$/g, "").match(/[a-z0-9]+/g) ?? [];

export function extractMarketIntent(question: string): MarketIntent {
  const lower = question.toLowerCase();
  let intent: AnalysisIntentType = "market_discovery";
  if (/sensitiv|react|response to|exposure to/.test(lower)) intent = "market_sensitivity";
  else if (/impact|affect|effect of/.test(lower)) intent = "event_impact";
  else if (/biggest|largest|top.*mover|movers|most.*move/.test(lower)) intent = "biggest_movers";
  else if (/related|correlat|connected|linked|nearby/.test(lower)) intent = "related_markets";
  else if (/liquid|liquidity/.test(lower)) intent = "liquidity_analysis";
  else if (/volume|most traded|traded the most/.test(lower)) intent = "volume_analysis";
  else if (/clos(?:e|es|ing)\s+(?:soon|first|next)|ending soon/.test(lower)) intent = "closing_soon";
  else if (/trend|trending|momentum/.test(lower)) intent = "trend_analysis";
  else if (/compare|versus|\bvs\b|probabilit|odds/.test(lower)) intent = "probability_comparison";

  let timeframe: AnalysisTimeframe = "current";
  if (/\b1\s*h(?:our)?\b|last hour|past hour/.test(lower)) timeframe = "1h";
  else if (/\b7\s*d(?:ay)?s?\b|last week|past week|weekly/.test(lower)) timeframe = "7d";
  else if (/24\s*h|24-hour|daily|last day|past day/.test(lower)) timeframe = "24h";
  else if (["market_sensitivity", "biggest_movers", "trend_analysis"].includes(intent)) timeframe = "24h";

  const words = new Set(normalizeWords(question));
  const entities = Object.entries(entityAliases)
    .filter(([, aliases]) => aliases.some((alias) => {
      const normalizedAlias = normalizeWords(alias);
      return normalizedAlias.length > 1
        ? lower.includes(alias)
        : words.has(normalizedAlias[0] ?? "");
    }))
    .map(([entity]) => entity);
  const requestedAnalysis: AnalysisRequest[] = ["relevant_markets"];
  if (["probability_comparison", "market_sensitivity", "event_impact"].includes(intent)) requestedAnalysis.push("probability_comparison");
  if (["market_sensitivity", "biggest_movers", "trend_analysis", "event_impact"].includes(intent)) requestedAnalysis.push("probability_movement");
  if (["related_markets", "market_sensitivity", "event_impact"].includes(intent)) requestedAnalysis.push("related_markets");
  if (intent === "event_impact") requestedAnalysis.push("event_impact");
  if (intent === "trend_analysis") requestedAnalysis.push("trend");
  if (intent === "liquidity_analysis") requestedAnalysis.push("liquidity");
  if (intent === "volume_analysis") requestedAnalysis.push("volume");
  return { intent, entities, timeframe, requestedAnalysis: [...new Set(requestedAnalysis)] };
}

export function normalizeProbability(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  const normalized = parsed > 1 && parsed <= 100 ? parsed / 100 : parsed;
  return normalized <= 1 ? normalized : null;
}

export function normalizePrimaryPoolLiquidityUsd(value: unknown, quoteAsset: unknown, usdPerQuote?: number | null): number | null {
  if (typeof quoteAsset !== "string" || quoteAsset.trim().toLowerCase() !== "usdc" || typeof usdPerQuote !== "number" || !Number.isFinite(usdPerQuote) || usdPerQuote <= 0) return null;
  let baseUnits: number;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    baseUnits = Number(value.trim());
  } else if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    baseUnits = value;
  } else {
    return null;
  }
  return Number.isSafeInteger(baseUnits) && baseUnits >= 0 ? (baseUnits / 1_000_000) * usdPerQuote : null;
}

export function normalizeQuoteAsset(value: unknown): QuoteAsset | null {
  if (typeof value !== "string") return null;
  const asset = value.trim().toUpperCase();
  return asset === "SOL" || asset === "USDC" ? asset : null;
}

export function normalizePrimaryPoolAmount(value: unknown, quoteAsset: QuoteAsset | null) {
  const rawBaseUnits = typeof value === "string" && /^\d+$/.test(value.trim())
    ? value.trim()
    : typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
  const baseUnitsPerUnit = quoteAsset === "SOL" ? 1_000_000_000 : quoteAsset === "USDC" ? 1_000_000 : null;
  const amount = rawBaseUnits !== null && baseUnitsPerUnit !== null && Number.isSafeInteger(Number(rawBaseUnits))
    ? Number(rawBaseUnits) / baseUnitsPerUnit : null;
  return { amount, asset: quoteAsset, source: rawBaseUnits === null ? null : "panta-market-detail-primary-pool", observedAt: null, rawBaseUnits, baseUnitsPerUnit, state: amount === null ? "unavailable" as const : "finalized_snapshot" as const };
}

export function dataStatusForMarket(market: Market, now = Date.now()): DataStatus {
  if (market.source === "demo") return "demo";
  const hasProbabilities = market.yesProbability !== null && market.noProbability !== null;
  const hasVolume = market.volumeUsd !== null;
  const knownStatus = market.status !== "unknown";
  const providerTime = market.updatedAt ? Date.parse(market.updatedAt) : Number.NaN;
  const hasProviderTime = Number.isFinite(providerTime) && providerTime <= now;
  const stale = Number.isFinite(providerTime) && now - providerTime > 24 * 60 * 60 * 1000;
  return hasProbabilities && hasVolume && knownStatus && hasProviderTime && !stale ? "live" : "partial";
}

export function normalizePantaMarket(value: unknown): Market | null {
  const row = asObject(value);
  const id = firstText(row.marketId, row.market_id, row.id, row.address, row.pda);
  const question = firstText(row.title, row.question, row.name, row.market_question) ?? "Market title unavailable";
  if (!id) return null;
  const phase = firstText(row.phase, row.tradingPhase, row.trading_phase)?.toLowerCase();
  const rawPriceSource = firstText(row.priceSource, row.price_source)?.toLowerCase();
  const priceKind = rawPriceSource === "secondary_last_trade" || rawPriceSource === "last_trade" ? "last_trade" as const : rawPriceSource === "best_bid" ? "best_bid" as const : rawPriceSource === "best_ask" ? "best_ask" as const : rawPriceSource === "spot" || rawPriceSource === "provider_spot" ? "provider_spot" as const : "unknown" as const;
  const yesProbability = firstProbability(
    row.yesPrice,
    row.yes_probability,
    phase === "secondary" && priceKind !== "unknown" ? row.secondaryYesPrice : phase === "primary" ? row.primaryYesPrice : null,
  );
  const noProbability = firstProbability(
    row.noPrice,
    row.no_probability,
    phase === "secondary" && priceKind !== "unknown" ? row.secondaryNoPrice : phase === "primary" ? row.primaryNoPrice : null,
  );
  const rawStatus = firstText(row.status)?.toLowerCase();
  const resolved = row.resolved === true || row.isResolved === true || row.is_resolved === true || phase === "resolved" || rawStatus === "resolved";
  const startAt = normalizeTimestamp(row.startTime ?? row.start_time ?? row.openTime ?? row.open_time ?? row.startsAt ?? row.starts_at);
  const closeAt = normalizeTimestamp(row.endTime ?? row.end_time ?? row.closeAt ?? row.close_at ?? row.resolutionTime ?? row.resolution_time);
  const closeMillis = closeAt ? Date.parse(closeAt) : Number.NaN;
  const explicitlyClosed = ["cancelled", "closed", "expired", "ended", "inactive"].includes(rawStatus ?? "") || phase === "cancelled";
  const isSecondaryInactive = phase === "secondary" && (row.isActive === false || row.secondaryActive === false);
  const explicitlyOpen = ["open", "active", "secondary_active"].includes(rawStatus ?? "")
    || rawStatus === "secondary" && phase === "secondary" && (row.isActive === true || row.secondaryActive === true);
  const unresolvedKnown = row.resolved === false || row.isResolved === false || row.is_resolved === false;
  const status = resolved ? "resolved" : explicitlyClosed || (Number.isFinite(closeMillis) && closeMillis <= Date.now()) || isSecondaryInactive ? "closed" : explicitlyOpen && unresolvedKnown && (phase === "primary" || phase === "secondary") ? "active" : "unknown";
  const related = Array.isArray(row.relatedMarketIds) ? row.relatedMarketIds : Array.isArray(row.related_markets) ? row.related_markets : [];
  const imageList = Array.isArray(row.images) ? row.images : [];
  const imageObject = asObject(row.image);
  const firstImage = asObject(imageList[0]);
  const imageUrl = firstText(
    typeof imageList[0] === "string" ? imageList[0] : null,
    typeof row.image === "string" ? row.image : null,
    firstImage.url, firstImage.src, firstImage.imageUrl, firstImage.image_url,
    row.imageUrl, row.image_url, row.imageUri, row.image_uri,
    row.coverImage, row.cover_image, row.thumbnailUrl, row.thumbnail_url,
    row.iconUrl, row.icon_url, imageObject.url, imageObject.src,
    imageObject.imageUrl, imageObject.image_url,
  );
  const historyRows = Array.isArray(row.priceHistory) ? row.priceHistory : Array.isArray(row.price_history) ? row.price_history : Array.isArray(row.history) ? row.history : [];
  const history = historyRows.map((item) => {
    const point = asObject(item);
    const timestamp = normalizeTimestamp(point.timestamp ?? point.blockTime ?? point.createdAt ?? point.created_at ?? point.time);
    const probability = firstProbability(point.yesPrice, point.yes_price, point.yesProbability, point.yes_probability, point.price);
    return timestamp && probability !== null ? { timestamp, yesProbability: probability } : null;
  }).filter((point): point is NonNullable<typeof point> => point !== null);
  const updatedAt = normalizeTimestamp(row.updatedAt ?? row.updated_at ?? row.lastTradeAt ?? row.last_trade_at);
  const priceChange = finiteNumber(row.priceChange24h ?? row.price_change_24h);
  const quoteAssetRaw = firstText(row.quoteAsset, row.quote_asset);
  const quoteAsset = normalizeQuoteAsset(quoteAssetRaw);
  const activeVolumeRaw = row.activeVolumeSol ?? row.active_volume_sol ?? row.activeVolumeUsdc ?? row.active_volume_usdc ?? row.volumeSol ?? row.volume_sol ?? row.volumeUsdc ?? row.volumeUSDC ?? row.volume_usdc ?? row.volumeUsd ?? row.volume_usd ?? null;
  const totalVolumeRaw = row.totalVolumeSol ?? row.total_volume_sol ?? row.totalVolumeUsdc ?? row.total_volume_usdc ?? row.totalVolumeUsd ?? row.total_volume_usd ?? null;
  const primaryPoolRaw = row.primaryPoolLamports ?? row.primary_pool_lamports;
  const rawYesPrice = row.yesPrice ?? row.yes_price ?? row.yes_probability ?? null;
  const rawNoPrice = row.noPrice ?? row.no_price ?? row.no_probability ?? null;
  return {
    id,
    question,
    category: firstText(row.category, row.categoryName, row.category_name),
    description: firstText(row.description, row.rules, row.resolutionCriteria, row.resolution_criteria),
    status,
    yesProbability,
    noProbability,
    // USD aliases are populated only for explicitly USD-denominated USDC data.
    // Generic volume / totalVolume fields are quote amounts, never USD by default.
    volumeUsd: null,
    totalVolumeUsd: null,
    // The documented Panta catalog does not currently expose liquidity; absence remains null.
    // The legacy provider's generic liquidity field has no verified metric/unit contract.
    liquidityUsd: null,
    primaryPoolLiquidityUsd: null,
    quoteAsset: null,
    quoteAssetRaw,
    quoteAssetResolution: { asset: null, status: quoteAssetRaw && !quoteAsset ? "unsupported" : "unresolved", source: "none", observedAt: null, rawAuthoritative: null, rawProvider: quoteAssetRaw },
    primaryPoolLiquidity: normalizePrimaryPoolAmount(primaryPoolRaw, null),
    activeVolume: { amount: null, asset: null, source: null, observedAt: null },
    totalVolume: { amount: null, asset: null, source: null, observedAt: null },
    volumeRaw: { active: typeof activeVolumeRaw === "string" || typeof activeVolumeRaw === "number" ? activeVolumeRaw : null, total: typeof totalVolumeRaw === "string" || typeof totalVolumeRaw === "number" ? totalVolumeRaw : null, activeSource: activeVolumeRaw === null ? null : (row.activeVolumeSol !== undefined || row.active_volume_sol !== undefined || row.volumeSol !== undefined || row.volume_sol !== undefined ? "sol" : row.volumeUsd !== undefined || row.volume_usd !== undefined ? "usd" : "usdc"), totalSource: totalVolumeRaw === null ? null : (row.totalVolumeSol !== undefined || row.total_volume_sol !== undefined ? "sol" : row.totalVolumeUsd !== undefined || row.total_volume_usd !== undefined ? "usd" : "usdc") },
    matchedTradeCount: finiteNumber(row.totalTrades ?? row.total_trades),
    priceProvenance: { kind: priceKind, source: firstText(row.priceSource, row.price_source) ?? "panta-market-detail", observedAt: updatedAt },
    pantaPrices: { yes: null, no: null, quoteAsset: null, kind: priceKind, observedAt: updatedAt },
    rawPantaPrices: { yes: typeof rawYesPrice === "string" || typeof rawYesPrice === "number" ? rawYesPrice : null, no: typeof rawNoPrice === "string" || typeof rawNoPrice === "number" ? rawNoPrice : null },
    priceChange24h: priceChange,
    startAt,
    closeAt,
    updatedAt,
    imageUrl,
    history,
    relatedMarketIds: related.map((item) => {
      if (typeof item === "string") return item;
      const rel = asObject(item);
      return firstText(rel.marketId, rel.market_id, rel.id) ?? "";
    }).filter(Boolean),
    source: "panta",
    phase: phase ?? null,
    pantaProgramId: firstText(row.programId, row.program_id, row.solanaProgramId, row.solana_program_id),
    pantaSecondaryActive: typeof row.isActive === "boolean" ? row.isActive : typeof row.secondaryActive === "boolean" ? row.secondaryActive : rawStatus === "secondary_active" ? true : null,
    pantaIsGraduated: typeof row.isGraduated === "boolean" ? row.isGraduated : typeof row.is_graduated === "boolean" ? row.is_graduated : null,
    pantaIsResolved: row.resolved === true || row.isResolved === true || row.is_resolved === true ? true : row.resolved === false || row.isResolved === false || row.is_resolved === false ? false : null,
  };
}

export function calculateMovement(market: Market, timeframe: Exclude<AnalysisTimeframe, "current">, now = Date.now()): MarketMovement | null {
  if (market.yesProbability === null || !Number.isFinite(market.yesProbability)) return null;
  const duration = timeframe === "1h" ? 60 * 60_000 : timeframe === "7d" ? 7 * 24 * 60 * 60_000 : 24 * 60 * 60_000;
  const target = now - duration;
  const tolerance = duration * 0.35;
  const points = market.history.map((point) => ({ ...point, time: Date.parse(point.timestamp) }))
    .filter((point) => Number.isFinite(point.time) && Number.isFinite(point.yesProbability) && point.time <= now && Math.abs(point.time - target) <= tolerance)
    .sort((a, b) => Math.abs(a.time - target) - Math.abs(b.time - target));
  const previous = points[0];
  if (!previous || previous.yesProbability === null) return null;
  const absoluteChange = market.yesProbability - previous.yesProbability;
  const percentageChange = previous.yesProbability === 0 ? null : absoluteChange / previous.yesProbability;
  return {
    marketId: market.id,
    previousProbability: previous.yesProbability,
    currentProbability: market.yesProbability,
    absoluteChange,
    percentageChange,
    timeframe,
    previousTimestamp: previous.timestamp,
    observedAt: new Date(now).toISOString(),
  };
}

export type MarketRank = { marketId: string; relevanceScore: number; semanticRelevance: number; signals: string[] };

export function semanticRelevance(question: string, market: Market, intent?: MarketIntent): number {
  const content: string[] = normalizeWords(`${market.question} ${market.category ?? ""} ${market.description ?? ""}`);
  const text = ` ${content.join(" ")} `;
  const terms = normalizeWords(question).filter((word) => word.length > 1 && !stopWords.has(word));
  const relevant = terms.filter((term) => content.includes(term));
  let score = terms.length ? relevant.length / new Set(terms).size : 0;
  const entities = intent?.entities ?? extractMarketIntent(question).entities;
  const matchedEntityCount = entities.filter((entity) => (entityAliases[entity] ?? [entity]).some((alias) => text.includes(alias))).length;
  if (entities.length) score = Math.max(score, matchedEntityCount / entities.length);
  return clamp01(score);
}

export function selectComparisonMarkets(markets: Market[], entities: string[]): Map<string, Market> {
  const selected = new Map<string, Market>();
  const usedMarketIds = new Set<string>();
  for (const entity of entities) {
    const aliases = entityAliases[entity] ?? [entity];
    const matches = markets.filter((market) => {
      const content = `${market.question} ${market.category ?? ""} ${market.description ?? ""}`.toLowerCase();
      return aliases.some((alias) => {
        const normalized = alias.toLowerCase();
        return normalized.length <= 3
          ? content.split(/[^a-z0-9]+/).includes(normalized)
          : content.includes(normalized);
      });
    }).filter((market) => !usedMarketIds.has(market.id));
    matches.sort((left, right) => {
      const completeness = (market: Market) => Number(market.yesProbability !== null) + Number(market.noProbability !== null);
      return completeness(right) - completeness(left)
        || (right.volumeUsd ?? -1) - (left.volumeUsd ?? -1)
        || left.question.localeCompare(right.question);
    });
    const match = matches[0];
    if (match) {
      selected.set(entity, match);
      usedMarketIds.add(match.id);
    }
  }
  return selected;
}

export function summarizeProbabilityComparison(entities: string[], marketsByEntity: Map<string, Market>): string {
  const missing = entities.filter((entity) => !marketsByEntity.has(entity));
  const available = [...marketsByEntity.entries()];
  if (missing.length) {
    const found = available.map(([entity, market]) => `${entity}: “${market.question}”`).join("; ");
    return `${found || "I couldn’t find a matching current market"}. I couldn’t find a separate current market for ${missing.join(" and ")}, so I can’t make the requested comparison.`;
  }
  const prices = available.map(([entity, market]) => ({ entity, market, yes: market.yesProbability, no: market.noProbability }));
  const rows = prices.map(({ entity, market, yes, no }) => `${entity} (“${market.question}”): YES ${formatProbability(yes)}, NO ${formatProbability(no)}`);
  const yesPrices = prices.filter((item) => item.yes !== null);
  const spread = yesPrices.length === prices.length && yesPrices.length === 2
    ? ` The YES prices differ by ${(Math.abs(yesPrices[0]!.yes! - yesPrices[1]!.yes!) * 100).toFixed(1)} percentage points.`
    : "";
  const unavailable = prices.some(({ yes }) => yes === null)
    ? " At least one YES price is unavailable, so I can’t compare both YES prices."
    : "";
  return `Current Panta prices: ${rows.join("; ")}.${spread}${unavailable} These are provider-reported market prices, not MIRA forecasts.`;
}

export function summarizeUnavailableComparison(entities: string[], resolvedMarkets: Market[]): string {
  const resolved = selectComparisonMarkets(resolvedMarkets, entities);
  const names = [...resolved.keys()];
  if (names.length) {
    return `Panta returned ${names.join(" and ")} market matches, but they are resolved. I excluded their final prices because you asked for current probabilities. Panta has no open matching markets available for this comparison right now.`;
  }
  return `Panta has no open matching markets available for a current ${entities.join(" and ")} probability comparison right now.`;
}

function formatProbability(value: number | null): string {
  return value === null ? "unavailable" : `${(value * 100).toFixed(1)}%`;
}

export function rankMarkets(question: string, markets: Market[], movements: MarketMovement[], intent = extractMarketIntent(question), now = Date.now()): MarketRank[] {
  const marketById = new Map(markets.map((market) => [market.id, market]));
  const movementById = new Map(movements.map((item) => [item.marketId, item]));
  const maxVolume = Math.max(0, ...markets.map((item) => item.volumeUsd ?? 0));
  const maxLiquidity = Math.max(0, ...markets.map((item) => item.liquidityUsd ?? 0));
  const maxMovement = Math.max(0, ...movements.map((item) => Math.abs(item.percentageChange ?? item.absoluteChange)));
  return markets.map((market) => {
    const semantic = semanticRelevance(question, market, intent);
    const movement = movementById.get(market.id);
    const updated = market.updatedAt ? Date.parse(market.updatedAt) : Number.NaN;
    const recency = Number.isFinite(updated) ? clamp01(1 - Math.max(0, now - updated) / (7 * 24 * 60 * 60_000)) : null;
    const signals: string[] = [];
    if (semantic > 0) signals.push("semantic match");
    if (movement) signals.push(`${movement.timeframe} movement available`);
    if (market.volumeUsd !== null) signals.push("provider volume available");
    if (market.liquidityUsd !== null) signals.push("provider liquidity available");
    if (market.relatedMarketIds.length) signals.push("provider relationship available");
    const candidates: { weight: number; value: number }[] = [{ weight: 0.55, value: semantic }];
    if (movement && maxMovement > 0) candidates.push({ weight: 0.18, value: clamp01(Math.abs(movement.percentageChange ?? movement.absoluteChange) / maxMovement) });
    if (market.volumeUsd !== null && maxVolume > 0) candidates.push({ weight: 0.1, value: clamp01(Math.log1p(market.volumeUsd) / Math.log1p(maxVolume)) });
    if (market.liquidityUsd !== null && maxLiquidity > 0) candidates.push({ weight: 0.1, value: clamp01(Math.log1p(market.liquidityUsd) / Math.log1p(maxLiquidity)) });
    if (recency !== null) candidates.push({ weight: 0.04, value: recency });
    if (market.relatedMarketIds.length) candidates.push({ weight: 0.03, value: clamp01(market.relatedMarketIds.length / 3) });
    const weight = candidates.reduce((sum, item) => sum + item.weight, 0);
    const relevanceScore = weight ? candidates.reduce((sum, item) => sum + item.weight * item.value, 0) / weight : 0;
    return { marketId: market.id, relevanceScore: Math.round(relevanceScore * 1000) / 1000, semanticRelevance: Math.round(semantic * 1000) / 1000, signals };
  }).sort((a, b) => {
    const aMarket = marketById.get(a.marketId);
    const bMarket = marketById.get(b.marketId);
    const aResolved = aMarket?.status === "resolved";
    const bResolved = bMarket?.status === "resolved";
    if (aResolved !== bResolved) return aResolved ? 1 : -1;
    if (intent.intent === "closing_soon") {
      const aClose = aMarket?.closeAt ? Date.parse(aMarket.closeAt) : Number.NaN;
      const bClose = bMarket?.closeAt ? Date.parse(bMarket.closeAt) : Number.NaN;
      const aFuture = Number.isFinite(aClose) && aClose > now;
      const bFuture = Number.isFinite(bClose) && bClose > now;
      if (aFuture !== bFuture) return aFuture ? -1 : 1;
      if (aFuture && bFuture && aClose !== bClose) return aClose - bClose;
      return b.semanticRelevance - a.semanticRelevance || a.marketId.localeCompare(b.marketId);
    }
    if (intent.intent === "biggest_movers") {
      const am = movementById.get(a.marketId); const bm = movementById.get(b.marketId);
      if (am && bm) return Math.abs(bm.percentageChange ?? bm.absoluteChange) - Math.abs(am.percentageChange ?? am.absoluteChange);
      if (bm) return 1;
      if (am) return -1;
      return b.semanticRelevance - a.semanticRelevance || a.marketId.localeCompare(b.marketId);
    }
    if (intent.intent === "liquidity_analysis") {
      const am = marketById.get(a.marketId)?.liquidityUsd;
      const bm = marketById.get(b.marketId)?.liquidityUsd;
      if (am !== null && am !== undefined && bm !== null && bm !== undefined) return bm - am;
      if (bm !== null && bm !== undefined) return 1;
      if (am !== null && am !== undefined) return -1;
      return b.semanticRelevance - a.semanticRelevance || a.marketId.localeCompare(b.marketId);
    }
    if (intent.intent === "volume_analysis") {
      const am = marketById.get(a.marketId)?.volumeUsd;
      const bm = marketById.get(b.marketId)?.volumeUsd;
      if (am !== null && am !== undefined && bm !== null && bm !== undefined) return bm - am;
      if (bm !== null && bm !== undefined) return 1;
      if (am !== null && am !== undefined) return -1;
      return b.semanticRelevance - a.semanticRelevance || a.marketId.localeCompare(b.marketId);
    }
    return b.semanticRelevance - a.semanticRelevance || a.marketId.localeCompare(b.marketId);
  });
}

export function buildRelatedMarkets(markets: Market[], intent: MarketIntent): RelatedMarket[] {
  const edges: RelatedMarket[] = [];
  for (let i = 0; i < markets.length; i += 1) {
    const left = markets[i];
    if (!left) continue;
    for (let j = i + 1; j < markets.length; j += 1) {
      const right = markets[j];
      if (!right) continue;
      const providerLinked = left.relatedMarketIds.includes(right.id) || right.relatedMarketIds.includes(left.id);
      const leftWords = new Set(normalizeWords(`${left.question} ${left.description ?? ""}`).filter((word) => word.length > 2 && !stopWords.has(word)));
      const sharedWords = normalizeWords(`${right.question} ${right.description ?? ""}`).filter((word) => leftWords.has(word));
      const overlap = [...new Set(sharedWords)];
      const sameCategory = Boolean(left.category && right.category && left.category.toLowerCase() === right.category.toLowerCase());
      const entityShared = intent.entities.some((entity) => {
        const aliases = entityAliases[entity] ?? [entity];
        return aliases.some((alias) => `${left.question} ${left.description ?? ""}`.toLowerCase().includes(alias) && `${right.question} ${right.description ?? ""}`.toLowerCase().includes(alias));
      });
      const relationship = providerLinked ? "provider_link" : entityShared || overlap.length ? "shared_entity" : sameCategory ? "category_overlap" : null;
      if (!relationship) continue;
      const relevanceScore = providerLinked ? 0.98 : relationship === "shared_entity" ? Math.min(0.88, 0.62 + Math.min(overlap.length, 3) * 0.06 + (entityShared ? 0.12 : 0)) : 0.35;
      const explanation = providerLinked
        ? "Panta explicitly linked these catalog markets; the link does not establish causation."
        : entityShared
          ? `Both market descriptions refer to ${intent.entities.find((entity) => (entityAliases[entity] ?? [entity]).some((alias) => `${left.question} ${left.description ?? ""} ${right.question} ${right.description ?? ""}`.toLowerCase().includes(alias))) ?? "the same topic"}; this is a topic relationship, not evidence of causation.`
          : overlap.length
            ? `These markets share the catalog terms ${overlap.slice(0, 3).join(", ")}; this is a text similarity, not evidence of causation.`
            : `Both markets are categorized as ${left.category}; category overlap alone does not imply they move together.`;
      const supportingEvidence = providerLinked ? ["Provider-supplied related market id"] : entityShared ? [`Shared entity: ${intent.entities.join(", ")}`] : overlap.length ? [`Shared terms: ${overlap.slice(0, 5).join(", ")}`] : [`Shared category: ${left.category}`];
      const dataStatus: DataStatus = left.source === "demo" && right.source === "demo" ? "demo" : providerLinked ? "live" : "partial";
      edges.push({ marketId: left.id, relatedMarketId: right.id, relationship, relevanceScore, explanation, supportingEvidence, dataStatus });
    }
  }
  return edges.sort((a, b) => b.relevanceScore - a.relevanceScore || a.marketId.localeCompare(b.marketId));
}

export function createSnapshot(market: Market, observedAt = new Date().toISOString()): MarketSnapshot {
  const observedTime = Date.parse(observedAt);
  const warnings: string[] = [];
  if (market.yesProbability === null || market.noProbability === null) warnings.push("One or more outcome prices are unavailable.");
  if (market.volumeUsd === null) warnings.push("Provider volume was not returned.");
  if (market.liquidityUsd === null) warnings.push("Provider liquidity was not returned.");
  if (market.updatedAt && Date.parse(market.updatedAt) < observedTime - 24 * 60 * 60_000) warnings.push("Provider update timestamp is older than 24 hours.");
  if (market.yesProbability !== null && market.noProbability !== null && Math.abs(market.yesProbability + market.noProbability - 1) > 0.1) warnings.push("YES and NO prices do not sum close to 100%.");
  const dataStatus = dataStatusForMarket(market, observedTime);
  const criticalWarning = warnings.some((warning) => warning.startsWith("One or more") || warning.startsWith("Provider volume") || warning.startsWith("Provider update") || warning.startsWith("YES and NO"));
  const snapshot = {
    marketId: market.id,
    yesProbability: market.yesProbability,
    noProbability: market.noProbability,
    volumeUsd: market.volumeUsd,
    totalVolumeUsd: market.totalVolumeUsd,
    liquidityUsd: market.liquidityUsd,
    primaryPoolLiquidityUsd: market.primaryPoolLiquidityUsd,
    quoteAsset: market.quoteAsset ?? null,
    quoteAssetResolution: market.quoteAssetResolution,
    activeVolume: market.activeVolume,
    totalVolume: market.totalVolume,
    primaryPoolLiquidity: market.primaryPoolLiquidity,
    matchedTradeCount: market.matchedTradeCount ?? null,
    pantaPrices: market.pantaPrices,
    priceProvenance: market.priceProvenance,
    status: market.status,
    observedAt,
    providerUpdatedAt: market.updatedAt,
    source: market.source,
    dataStatus: criticalWarning && dataStatus === "live" ? "partial" : dataStatus,
  };
  return Object.assign(snapshot, { warnings });
}

export function createEmptyAnalysisResult(question: string, intent: MarketIntent, source: Market["source"], now = Date.now()): AnalysisResult {
  const timestamp = new Date(now).toISOString();
  return {
    id: `analysis-${now}-${Math.random().toString(36).slice(2, 8)}`,
    query: question,
    answer: "I couldn’t find matching markets in the selected provider catalog, so there isn’t enough verified data to analyze this question.",
    insights: [{ kind: "insufficient", title: "No matching provider markets", body: "The selected provider returned no markets that match the question. MIRA did not invent a market or infer a price." }],
    markets: [], relatedMarketIds: [], confidence: "insufficient", source, createdAt: timestamp,
    intent, snapshots: [], movements: [], relatedMarkets: [], evidence: [], rankings: [], dataStatus: "unavailable", tradeIntent: null,
  };
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function firstText(...values: unknown[]): string | null {
  const found = values.find((value) => typeof value === "string" && value.trim());
  return typeof found === "string" ? found.trim() : null;
}
function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}
function firstProbability(...values: unknown[]): number | null {
  for (const value of values) {
    const normalized = normalizeProbability(value);
    if (normalized !== null) return normalized;
  }
  return null;
}
function normalizeTimestamp(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const numberValue = typeof value === "number" || /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : Number.NaN;
  const date = Number.isFinite(numberValue) ? new Date(numberValue < 100_000_000_000 ? numberValue * 1000 : numberValue) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
function clamp01(value: number): number { return Math.max(0, Math.min(1, value)); }
