import type { AnalysisResult, Insight, Market, MarketEvidence, MarketMovement, MarketProvider, MarketRanking, MarketSnapshot, RelatedMarket } from "@/lib/panta/types";
import { buildRelatedMarkets, calculateMovement, createEmptyAnalysisResult, createSnapshot, extractMarketIntent, rankMarkets, selectComparisonMarkets, semanticRelevance, summarizeProbabilityComparison, summarizeUnavailableComparison } from "@/lib/intelligence/core";
import { isTradeEligibleMarket } from "@/lib/panta/trade-safety";

const MAX_CANDIDATES = 12;
const MAX_DETAILS = 10;

export async function analyzeMarketQuestion(question: string, provider: MarketProvider, now = Date.now()): Promise<AnalysisResult> {
  const intent = extractMarketIntent(question);
  const catalogQuery = intent.entities.length === 0 && ["market_discovery", "biggest_movers", "liquidity_analysis", "trend_analysis", "volume_analysis", "closing_soon"].includes(intent.intent);
  const genericMetricQuery = catalogQuery && intent.intent !== "market_discovery";
  // Catalog requests have no subject to search for. Fetch the catalog once and
  // let deterministic ranking select from the real provider results.
  const discovered = await provider.discoverMarkets(catalogQuery ? undefined : question);
  const historicalRequest = /\b(yesterday|past|historical|history|previous|last week|last month|\d+ days? ago|resolved markets?)\b/i.test(question);
  const excludesResolvedForCurrentAnalysis = intent.timeframe === "current" && !historicalRequest;
  const resolvedMatches = excludesResolvedForCurrentAnalysis
    ? discovered.filter((market) => market.status === "resolved" && (genericMetricQuery || semanticRelevance(question, market, intent) > 0))
    : [];
  const currentMarkets = excludesResolvedForCurrentAnalysis
    ? discovered.filter((market) => {
      if (market.status !== "active") return false;
      if (market.source === "panta") return isTradeEligibleMarket(market, now);
      const startsAt = market.startAt ? Date.parse(market.startAt) : Number.NaN;
      const closesAt = market.closeAt ? Date.parse(market.closeAt) : Number.NaN;
      return Number.isFinite(startsAt) && Number.isFinite(closesAt) && startsAt <= now && closesAt > now;
    })
    : discovered;
  const initiallyRanked = rankMarkets(question, currentMarkets, [], intent, now);
  const relevantRanks = initiallyRanked.filter((rank) => rank.semanticRelevance > 0 || catalogQuery || intent.intent === "closing_soon");
  const rankedCandidates = relevantRanks.slice(0, MAX_CANDIDATES).map((rank) => currentMarkets.find((market) => market.id === rank.marketId)).filter((market): market is Market => Boolean(market));
  const comparisonMarkets = intent.intent === "probability_comparison" && intent.entities.length > 1
    ? selectComparisonMarkets(relevantRanks.map((rank) => currentMarkets.find((market) => market.id === rank.marketId)).filter((market): market is Market => Boolean(market)), intent.entities)
    : null;
  const candidates = comparisonMarkets ? [...comparisonMarkets.values()] : rankedCandidates;

  if (candidates.length === 0) {
    const empty = createEmptyAnalysisResult(question, intent, provider.source, now);
    if (comparisonMarkets) return { ...empty, providerEnvironment: provider.environment, answer: summarizeUnavailableComparison(intent.entities, resolvedMatches) };
    return resolvedMatches.length ? {
      ...empty,
      providerEnvironment: provider.environment,
      answer: "The matching Panta markets are resolved or outside their trading window, so they are not current listings. No verified active matching markets were found. Ask about past markets for their historical records.",
      insights: [{ kind: "insufficient", title: "No current market match", body: "Current discovery only includes markets with active provider status and an open time window. Ask about historical markets to inspect resolved records." }],
    } : { ...empty, providerEnvironment: provider.environment };
  }

  const detailedMarkets = await Promise.all(candidates.slice(0, MAX_DETAILS).map(async (market) => {
    try { return await provider.getMarket(market.id) ?? market; }
    catch { return market; }
  }));
  const detailsById = new Map(detailedMarkets.map((market) => [market.id, market]));
  const completeCandidates = candidates.map((market) => detailsById.get(market.id) ?? market);
  const detailedComparisonMarkets = comparisonMarkets
    ? new Map([...comparisonMarkets].map(([entity, market]) => [entity, detailsById.get(market.id) ?? market]))
    : null;
  const movements = intent.timeframe === "current" ? [] : completeCandidates
    .map((market) => calculateMovement(market, intent.timeframe as Exclude<typeof intent.timeframe, "current">, now))
    .filter((movement): movement is MarketMovement => movement !== null);

  const rankings: MarketRanking[] = rankMarkets(question, completeCandidates, movements, intent, now);
  const rankingById = new Map(rankings.map((ranking) => [ranking.marketId, ranking]));
  const markets = rankings
    .map((ranking) => completeCandidates.find((market) => market.id === ranking.marketId))
    .filter((market): market is Market => Boolean(market))
    .map((market) => {
      const movement = movements.find((item) => item.marketId === market.id);
      return movement ? { ...market, priceChange24h: movement.percentageChange } : market;
    });
  const nowIso = new Date(now).toISOString();
  const snapshots: MarketSnapshot[] = markets.map((market) => createSnapshot(market, nowIso));
  const relatedMarkets: RelatedMarket[] = buildRelatedMarkets(markets, intent);
  const evidence = buildEvidence(markets, snapshots, movements, rankingById);
  const dataStatus = aggregateDataStatus(provider.source, snapshots);
  const hasPriceEvidence = markets.some((market) => market.yesProbability !== null || market.noProbability !== null);
  const requiredMovementMissing = intent.requestedAnalysis.includes("probability_movement") && movements.length === 0;
  const requiredLiquidityMissing = intent.intent === "liquidity_analysis" && markets.every((market) => market.liquidityUsd === null);
  const requiredVolumeMissing = intent.intent === "volume_analysis" && markets.every((market) => market.volumeUsd === null);
  const requiredComparisonMissing = detailedComparisonMarkets !== null && (
    detailedComparisonMarkets.size !== intent.entities.length
    || [...detailedComparisonMarkets.values()].some((market) => market.yesProbability === null)
  );
  const confidence: AnalysisResult["confidence"] = !markets.length || !hasPriceEvidence || requiredMovementMissing || requiredLiquidityMissing || requiredVolumeMissing || requiredComparisonMissing
    ? "insufficient"
    : dataStatus === "live" && evidence.length >= 4 && markets.length >= 3 ? "medium" : "low";
  const insights = buildInsights(markets, movements, relatedMarkets, intent, provider.source);
  const answer = detailedComparisonMarkets
    ? summarizeProbabilityComparison(intent.entities, detailedComparisonMarkets)
    : intent.intent === "market_discovery"
      ? summarizeCatalog(markets, provider.source)
    : createSummary({ question, intent, markets, movements, relatedMarkets, dataStatus, requiredMovementMissing, requiredLiquidityMissing, requiredVolumeMissing });

  return {
    id: createId(),
    query: question,
    answer,
    insights,
    markets,
    relatedMarketIds: [...new Set(relatedMarkets.map((edge) => edge.relatedMarketId))],
    confidence,
    source: provider.source,
    providerEnvironment: provider.environment,
    createdAt: nowIso,
    intent,
    snapshots,
    movements,
    relatedMarkets,
    evidence,
    rankings,
    dataStatus,
    tradeIntent: null,
  };
}

function summarizeCatalog(markets: Market[], source: MarketProvider["source"]): string {
  if (!markets.length) return "The selected provider returned no markets in its catalog.";
  const names = markets.slice(0, 5).map((market) => `“${market.question}”`).join(", ");
  const omitted = markets.length > 5 ? ` The response includes ${markets.length - 5} more catalog entries.` : "";
  const provenance = source === "panta" ? "Panta" : "The selected demo provider";
  const historical = markets.filter((market) => market.status === "resolved").slice(0, 5).map((market) => {
    const close = market.closeAt ? `historical close time ${market.closeAt}` : "historical close time unavailable";
    const yes = market.yesProbability === null ? "final YES value unavailable" : `final YES value ${Math.round(market.yesProbability * 100)}¢`;
    const no = market.noProbability === null ? "final NO value unavailable" : `final NO value ${Math.round(market.noProbability * 100)}¢`;
    const volume = market.volumeUsd === null ? "historical volume unavailable" : `historical volume ${formatUsd(market.volumeUsd)} USDC`;
    return `“${market.question}” is resolved; ${close}; ${yes}, ${no}; ${volume}. These are historical outcome fields, not current probabilities or activity.`;
  });
  return `${provenance} returned ${markets.length} catalog entr${markets.length === 1 ? "y" : "ies"}. Here are the first ${Math.min(5, markets.length)}: ${names}.${omitted}${historical.length ? ` ${historical.join(" ")}` : ""} Missing prices or liquidity remain unavailable in the provider data.`;
}

function buildEvidence(markets: Market[], snapshots: MarketSnapshot[], movements: MarketMovement[], rankings: Map<string, MarketRanking>): MarketEvidence[] {
  const snapshotById = new Map(snapshots.map((snapshot) => [snapshot.marketId, snapshot]));
  const movementById = new Map(movements.map((movement) => [movement.marketId, movement]));
  const result: MarketEvidence[] = [];
  for (const market of markets) {
    const snapshot = snapshotById.get(market.id);
    if (!snapshot) continue;
    const significance = (rankings.get(market.id)?.relevanceScore ?? 0) >= 0.65 ? "high" : (rankings.get(market.id)?.relevanceScore ?? 0) >= 0.35 ? "medium" : "low";
    const timestamp = market.updatedAt ?? snapshot.observedAt;
    const timestampType = market.updatedAt ? "provider" : "retrieved";
    if (market.yesProbability !== null || market.noProbability !== null) {
      const yes = market.yesProbability === null ? "unavailable" : `${(market.yesProbability * 100).toFixed(1)}%`;
      const no = market.noProbability === null ? "unavailable" : `${(market.noProbability * 100).toFixed(1)}%`;
      result.push({ marketId: market.id, observation: `Provider-reported prices: YES ${yes}, NO ${no}.`, significance, timestamp, timestampType, source: market.source, dataStatus: snapshot.dataStatus });
    }
    if (market.volumeUsd !== null) result.push({ marketId: market.id, observation: `Provider-reported volume: ${market.volumeUsd} USDC.`, significance, timestamp, timestampType, source: market.source, dataStatus: snapshot.dataStatus });
    if (market.liquidityUsd !== null) result.push({ marketId: market.id, observation: `Provider-reported liquidity: ${market.liquidityUsd} USDC.`, significance, timestamp, timestampType, source: market.source, dataStatus: snapshot.dataStatus });
    const movement = movementById.get(market.id);
    if (movement) result.push({ marketId: market.id, observation: `${movement.timeframe} YES-price movement: ${(movement.absoluteChange * 100).toFixed(2)} percentage points${movement.percentageChange === null ? "" : ` (${(movement.percentageChange * 100).toFixed(2)}% relative)`}.`, significance, timestamp: movement.observedAt, timestampType: "retrieved", source: market.source, dataStatus: snapshot.dataStatus });
  }
  return result;
}

function buildInsights(markets: Market[], movements: MarketMovement[], relationships: RelatedMarket[], intent: AnalysisResult["intent"], source: AnalysisResult["source"]): Insight[] {
  const insights: Insight[] = [];
  const priced = markets.filter((market) => market.yesProbability !== null || market.noProbability !== null);
  if (priced.length) insights.push({
    kind: "evidence", title: "Current provider prices",
    body: `${priced.length} of ${markets.length} matched markets returned at least one current outcome price. Prices are observations, not MIRA forecasts.`,
    marketIds: priced.map((market) => market.id),
  });
  if (movements.length) {
    const top = [...movements].sort((a, b) => Math.abs(b.percentageChange ?? b.absoluteChange) - Math.abs(a.percentageChange ?? a.absoluteChange))[0];
    const selected = top ? markets.find((market) => market.id === top.marketId) : null;
    if (top && selected) insights.push({ kind: "evidence", title: `Largest observed ${top.timeframe} move`, body: `${selected.question} changed ${(top.absoluteChange * 100).toFixed(2)} percentage points in the available price history. Co-movement does not establish causation.`, marketIds: [selected.id] });
  } else if (intent.requestedAnalysis.includes("probability_movement")) {
    insights.push({ kind: "insufficient", title: "Price movement unavailable", body: "The provider did not return enough timestamped price history to calculate the requested movement. No change estimate was inferred from volume or current prices.", marketIds: markets.map((market) => market.id) });
  }
  if (intent.intent === "liquidity_analysis" && markets.every((market) => market.liquidityUsd === null)) {
    insights.push({ kind: "insufficient", title: "Liquidity unavailable", body: source === "panta" ? "The documented Panta market catalog does not provide liquidity for these rows. MIRA cannot rank their liquidity." : "The selected demo fixtures do not provide liquidity for these matches." });
  } else if (intent.intent === "liquidity_analysis") {
    const liquid = markets.filter((market) => market.liquidityUsd !== null).sort((a, b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0));
    if (liquid[0]) insights.push({ kind: "evidence", title: "Reported liquidity", body: `${liquid[0].question} has the highest reported liquidity among these matches at ${liquid[0].liquidityUsd} USDC.`, marketIds: [liquid[0].id] });
  }
  if (intent.intent === "volume_analysis") {
    const highest = markets.find((market) => market.volumeUsd !== null);
    if (!highest) insights.push({ kind: "insufficient", title: "Volume unavailable", body: "The provider did not return volume for these markets, so MIRA cannot rank them by volume." });
    else insights.push({ kind: "evidence", title: "Highest reported volume", body: `${highest.question} has the highest reported volume among these matches at ${highest.volumeUsd} USDC.`, marketIds: [highest.id] });
  }
  if (relationships.length) {
    insights.push({ kind: "context", title: "Related market context", body: `${relationships.length} market relationship${relationships.length === 1 ? " was" : "s were"} found using provider links or clearly labeled topic overlap. Similarity does not prove that one market caused another to move.`, marketIds: [...new Set(relationships.flatMap((edge) => [edge.marketId, edge.relatedMarketId]))] });
  } else if (intent.requestedAnalysis.includes("related_markets")) {
    insights.push({ kind: "insufficient", title: "Related-market links unavailable", body: "The provider did not return direct links and the discovered results do not share a clear entity or category match." });
  }
  const noPrices = markets.length > 0 && priced.length === 0;
  if (noPrices) insights.push({ kind: "insufficient", title: "Probabilities unavailable", body: "The provider returned market descriptions but no current YES/NO prices. MIRA will not estimate them." });
  return insights;
}

function createSummary(input: {
  question: string;
  intent: AnalysisResult["intent"];
  markets: Market[];
  movements: MarketMovement[];
  relatedMarkets: RelatedMarket[];
  dataStatus: AnalysisResult["dataStatus"];
  requiredMovementMissing: boolean;
  requiredLiquidityMissing: boolean;
  requiredVolumeMissing: boolean;
}): string {
  const { intent, markets, movements, relatedMarkets, requiredMovementMissing, requiredLiquidityMissing, requiredVolumeMissing } = input;
  if (!markets.length) return "I couldn’t find matching markets in the selected provider catalog, so there isn’t enough verified data to analyze this question.";
  const matched = `${markets.length} market${markets.length === 1 ? "" : "s"}`;
  const entity = intent.entities.length ? ` connected by topic to ${intent.entities.join(" and ")}` : "";
  if (requiredLiquidityMissing) return `I found ${matched}${entity}, but Panta did not return liquidity values. I can’t rank liquidity without those values.`;
  if (requiredVolumeMissing) return `I found ${matched}${entity}, but the provider did not return volume values. I can’t rank these markets by volume without them.`;
  if (requiredMovementMissing) return `I found ${matched}${entity}, but not enough timestamped price history was returned to measure ${intent.timeframe} sensitivity or movement. The related-market links show topic context only, not causation.`;
  if (intent.intent === "volume_analysis") {
    const leader = [...markets].filter((market) => market.volumeUsd !== null).sort((a, b) => (b.volumeUsd ?? -1) - (a.volumeUsd ?? -1))[0];
    return leader ? `Among ${matched}${entity}, “${leader.question}” has the highest Panta-reported volume at ${formatUsd(leader.volumeUsd!)}. Prices and volume are provider observations, not forecasts.` : `I found ${matched}${entity}, but Panta did not provide volume values, so I can’t rank them by volume.`;
  }
  if (intent.intent === "closing_soon") {
    const next = markets.find((market) => market.closeAt !== null);
    return next ? `I found ${matched}${entity}. The nearest reported close is “${next.question}” at ${new Date(next.closeAt!).toLocaleString()}. Panta did not provide a close time for every market.` : `I found ${matched}${entity}, but none has a future close time in the returned Panta data.`;
  }
  const first = markets[0]!;
  const resolved = first.status === "resolved";
  const yes = first.yesProbability === null ? "unavailable" : `${Math.round(first.yesProbability * 100)}¢`;
  const no = first.noProbability === null ? "unavailable" : `${Math.round(first.noProbability * 100)}¢`;
  const volume = first.volumeUsd === null ? "volume unavailable" : `${formatUsd(first.volumeUsd)} ${resolved ? "historical volume" : "reported volume"}`;
  const close = first.closeAt ? `; ${resolved ? "historical close time" : "closes"} ${new Date(first.closeAt).toLocaleString()}` : "; close time unavailable";
  const status = first.status === "unknown" ? "status unavailable" : first.status;
  const history = resolved
    ? first.history.length ? `Panta returned ${first.history.length} historical outcome observations; they are not current price history.` : "No current price history is available for this resolved market."
    : first.history.length ? `Panta returned ${first.history.length} historical price observations.` : "There isn’t enough historical price data to measure short-term movement.";
  const completeness = markets.every((market) => market.yesProbability !== null && market.noProbability !== null && market.volumeUsd !== null && market.closeAt !== null && market.status !== "unknown") ? "The returned key fields are complete." : "Some market fields are missing, so this is a partial-data summary.";
  const movementNote = !resolved && movements.length ? ` Panta history supports a measured move for ${movements.length} match${movements.length === 1 ? "" : "es"}.` : "";
  const relatedNote = relatedMarkets.length ? ` ${relatedMarkets.length} topic or provider-linked relationship${relatedMarkets.length === 1 ? "" : "s"} are available in the related-market view.` : "";
  const values = resolved ? `final YES value ${yes}, final NO value ${no}` : `YES ${yes}, NO ${no}`;
  const qualifier = resolved ? "These are historical outcome fields, not current probabilities or activity and not a trading opportunity." : "Figures are Panta-reported market data, not MIRA forecasts.";
  return `I found ${matched}${entity}. The top match asks: “${first.question}” ${values}; ${volume}; ${status}${close}. ${history}${movementNote}${relatedNote} ${completeness} ${qualifier}`;
}

function formatUsd(value: number): string { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: value >= 1_000 ? "compact" : "standard", maximumFractionDigits: value >= 1_000 ? 2 : 0 }).format(value); }

function aggregateDataStatus(source: AnalysisResult["source"], snapshots: MarketSnapshot[]): AnalysisResult["dataStatus"] {
  if (!snapshots.length) return "unavailable";
  if (source === "demo") return "demo";
  return snapshots.every((snapshot) => snapshot.dataStatus === "live") ? "live" : "partial";
}

function createId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `analysis-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
