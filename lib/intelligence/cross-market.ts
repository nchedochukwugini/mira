import type { Market, MarketPoint } from "@/lib/panta/types";

export type CrossMarketClassification = "equivalent" | "closely-related" | "partially-related" | "thematically-related" | "opposing" | "not-comparable";
export type CrossMarketMovement = {
  status: "aligned" | "divergent" | "mixed" | "insufficient";
  dataStatus: "sufficient" | "limited" | "insufficient";
  observations: Array<{ marketId: string; from: string; to: string; change: number }>;
  timingAlignment: { status: "synchronized" | "partially-overlapping" | "non-overlapping" | "insufficient"; closestGapMs: number | null };
};
export type CrossMarketMarketSummary = Pick<Market, "id" | "question" | "description" | "category" | "status" | "closeAt" | "yesProbability" | "noProbability" | "updatedAt" | "source"> & {
  yesDefinition: string | null;
  noDefinition: string | null;
  resolutionCriteria: string | null;
  entities: string[];
  firstObservation: string | null;
  lastObservation: string | null;
  observationCount: number;
  definitionCompleteness: "complete" | "partial";
};
export type CrossMarketReport = {
  primaryMarket: CrossMarketMarketSummary;
  relatedMarkets: Array<{
    market: CrossMarketMarketSummary;
    relationship: { type: CrossMarketClassification; confidence: "high" | "medium" | "low"; reasons: string[] };
    movement: CrossMarketMovement;
    uncertainty: string[];
  contradictions: string[];
  contradictionStrength: "none" | "potential" | "strong";
  }>;
  overall: { relationshipSummary: string; observedSignals: string[]; supportingEvidence: string[]; opposingEvidence: string[]; uncertainty: string[] };
};

export type EvidenceTiming = "before_move" | "during_move" | "after_move" | "undated" | "unknown";

export function classifyEvidenceTiming(publishedAt: string | null, movementStart: number | null, movementEnd: number | null): EvidenceTiming {
  const publicationTime = publishedAt ? Date.parse(publishedAt) : Number.NaN;
  if (!Number.isFinite(publicationTime)) return "undated";
  if (movementStart === null || movementEnd === null) return "unknown";
  return publicationTime < movementStart ? "before_move" : publicationTime <= movementEnd ? "during_move" : "after_move";
}

const words = (text: string) => new Set((text.toLowerCase().match(/[a-z0-9$]+/g) ?? []).filter((word) => word.length > 2 && !new Set(["will", "the", "and", "for", "from", "with", "before", "after", "above", "below", "this", "that", "market", "yes", "no"]).has(word)));
const overlap = (a: Set<string>, b: Set<string>) => {
  const common = [...a].filter((word) => b.has(word));
  return { common, ratio: common.length / Math.max(1, new Set([...a, ...b]).size) };
};
const validHistory = (market: Market): MarketPoint[] => market.history
  .filter((point) => Number.isFinite(Date.parse(point.timestamp)) && typeof point.yesProbability === "number" && Number.isFinite(point.yesProbability))
  .slice().sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));

export function mergeMarketHistory(market: Market, savedPoints: MarketPoint[]): Market {
  const points = [...market.history, ...savedPoints].filter((point) => Number.isFinite(Date.parse(point.timestamp)) && typeof point.yesProbability === "number" && Number.isFinite(point.yesProbability));
  return { ...market, history: [...new Map(points.map((point) => [point.timestamp, point])).values()].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp)) };
}

export function mergeSnapshotObservation(market: Market, snapshot: { pantaReference: { yesPrice: number | null; noPrice: number | null; observedAt: string | null } }): Market {
  const withQuote = {
    ...market,
    yesProbability: market.yesProbability ?? snapshot.pantaReference.yesPrice,
    noProbability: market.noProbability ?? snapshot.pantaReference.noPrice,
  };
  const timestamp = snapshot.pantaReference.observedAt;
  const yesProbability = snapshot.pantaReference.yesPrice;
  if (!timestamp || !Number.isFinite(Date.parse(timestamp)) || yesProbability === null || !Number.isFinite(yesProbability)) return withQuote;
  return mergeMarketHistory(withQuote, [{ timestamp, yesProbability }]);
}

function summary(market: Market): CrossMarketMarketSummary {
  const history = validHistory(market);
  const description = market.description?.trim() || null;
  const entities = [...new Set(`${market.question} ${description ?? ""}`.match(/\b(?:[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*|BTC|ETH|CPI|ETF|GDP)\b/g) ?? [])];
  return {
    id: market.id, question: market.question, description, category: market.category, status: market.status,
    closeAt: market.closeAt, yesProbability: market.yesProbability, noProbability: market.noProbability,
    updatedAt: market.updatedAt, source: market.source,
    yesDefinition: null, noDefinition: null,
    resolutionCriteria: description, definitionCompleteness: description ? "partial" : "partial", entities, firstObservation: history[0]?.timestamp ?? null,
    lastObservation: history.at(-1)?.timestamp ?? null, observationCount: history.length,
  };
}

function relationship(primary: Market, related: Market): CrossMarketReport["relatedMarkets"][number]["relationship"] {
  const reasons: string[] = [];
  const direct = primary.relatedMarketIds.includes(related.id) || related.relatedMarketIds.includes(primary.id);
  const category = Boolean(primary.category && related.category && primary.category.toLowerCase() === related.category.toLowerCase());
  const a = words(`${primary.question} ${primary.description ?? ""}`);
  const b = words(`${related.question} ${related.description ?? ""}`);
  const shared = overlap(a, b);
  if (direct) reasons.push("The provider explicitly links these markets.");
  if (category) reasons.push(`Both markets are in the ${primary.category} category.`);
  if (shared.common.length) reasons.push(`Shared definition terms: ${shared.common.slice(0, 6).join(", ")}.`);
  const sameQuestion = primary.question.trim().toLowerCase() === related.question.trim().toLowerCase();
  const sameDefinitions = Boolean(primary.description?.trim() && related.description?.trim() && primary.description.trim() === related.description.trim());
  const opposing = /\b(cut|lower|decrease|fall|drop)\b/i.test(primary.question) && /\b(hold|unchanged|increase|raise|hike)\b/i.test(related.question)
    || /\b(cut|lower|decrease|fall|drop)\b/i.test(related.question) && /\b(hold|unchanged|increase|raise|hike)\b/i.test(primary.question);
  const endMismatch = primary.closeAt && related.closeAt && Date.parse(primary.closeAt) !== Date.parse(related.closeAt);
  let type: CrossMarketClassification = "not-comparable";
  let confidence: "high" | "medium" | "low" = "low";
  if (sameQuestion && sameDefinitions) { type = "equivalent"; confidence = "high"; reasons.push("The questions and provider resolution definitions match."); }
  else if (sameQuestion) { type = "closely-related"; confidence = "medium"; reasons.push("The questions match, but provider resolution definitions are missing or differ, so equivalence is not established."); }
  else if (opposing) { type = "opposing"; confidence = direct || shared.ratio >= 0.2 ? "high" : "medium"; reasons.push("The questions describe opposing outcomes."); }
  else if (direct && shared.ratio >= 0.2) { type = "closely-related"; confidence = "high"; }
  else if (shared.ratio >= 0.35) { type = "closely-related"; confidence = "medium"; }
  else if (direct || shared.ratio >= 0.15) { type = "partially-related"; confidence = direct ? "high" : "medium"; }
  else if (category || shared.common.length > 0) { type = "thematically-related"; confidence = "low"; }
  if (endMismatch) reasons.push("Resolution dates differ, so prices are not directly comparable.");
  if (primary.description !== related.description) reasons.push("Resolution definitions may differ; the provider supplies no separate YES/NO criteria for full equivalence checking.");
  return { type, confidence, reasons };
}

function movement(primary: Market, related: Market, syncWindowMs: number): CrossMarketMovement {
  const histories = [primary, related].map(validHistory);
  const points = histories.map((history, index) => history.slice(1).map((point, i) => ({
    marketId: index ? related.id : primary.id, from: history[i]!.timestamp, to: point.timestamp,
    change: point.yesProbability! - history[i]!.yesProbability!,
  })).filter((item) => item.change !== 0));
  const observations = points.flat();
  const common: Array<{ a: CrossMarketMovement["observations"][number]; b: CrossMarketMovement["observations"][number] }> = [];
  let closestGapMs: number | null = null;
  for (const a of points[0]!) {
    const nearest = points[1]!.map((b) => ({ b, gap: Math.abs(Date.parse(a.to) - Date.parse(b.to)) })).sort((x, y) => x.gap - y.gap)[0];
    if (nearest && (closestGapMs === null || nearest.gap < closestGapMs)) closestGapMs = nearest.gap;
    if (nearest && nearest.gap <= syncWindowMs) common.push({ a, b: nearest.b });
  }
  const alignedWindows = common.length >= 1;
  const pairDirections = common.map(({ a, b }) => Math.sign(a.change) === Math.sign(b.change));
  const status = !alignedWindows ? "insufficient" : pairDirections.every(Boolean) ? "aligned" : pairDirections.every((same) => !same) ? "divergent" : "mixed";
  const minCount = Math.min(histories[0]!.length, histories[1]!.length);
  const dataStatus = minCount >= 3 && alignedWindows ? "sufficient" : observations.length >= 2 ? "limited" : "insufficient";
  const comparableObservations = common.flatMap(({ a, b }) => [a, b]);
  const timingAlignment = closestGapMs === null || !observations.length
    ? "insufficient"
    : closestGapMs <= syncWindowMs ? "synchronized"
      : histories[0]!.length && histories[1]!.length && Date.parse(histories[0]!.at(-1)!.timestamp) >= Date.parse(histories[1]![0]!.timestamp) && Date.parse(histories[1]!.at(-1)!.timestamp) >= Date.parse(histories[0]![0]!.timestamp) ? "partially-overlapping" : "non-overlapping";
  return { status, dataStatus, observations: comparableObservations.length ? comparableObservations : observations, timingAlignment: { status: timingAlignment, closestGapMs } };
}

function contradictions(primary: Market, related: Market): { reasons: string[]; strength: "none" | "potential" | "strong" } {
  const result: string[] = [];
  let strength: "none" | "potential" | "strong" = "none";
  const opposite = (q: string) => /\b(?:will|does|do|is|are)\b.*\bnot\b|\bwill not\b|\bwon't\b/i.test(q);
  const explicitOpposites = opposite(primary.question) !== opposite(related.question)
    && words(primary.question).size > 0 && overlap(words(primary.question), words(related.question)).ratio >= 0.45;
  const sameWindow = Boolean(primary.closeAt && related.closeAt && Date.parse(primary.closeAt) === Date.parse(related.closeAt));
  const sameDefinition = Boolean(primary.description?.trim() && related.description?.trim() && primary.description.trim() === related.description.trim());
  if (explicitOpposites && sameWindow && sameDefinition) {
    strength = "strong";
    result.push("These markets describe mutually exclusive outcomes for the same event and resolution window; their prices can be compared directly.");
  } else if (explicitOpposites) {
    strength = "potential";
    result.push("The wording suggests opposite outcomes, but matching event definitions and resolution windows are not verified, so the price difference is not necessarily contradictory.");
  }
  if (primary.closeAt && related.closeAt && Date.parse(primary.closeAt) !== Date.parse(related.closeAt)) result.push("The markets have different resolution dates.");
  if (primary.description !== related.description) result.push("The provider definitions differ or are incomplete; the available metadata does not expose separate YES/NO resolution criteria.");
  return { reasons: result, strength };
}

export function buildCrossMarketReport(input: { primaryMarket: Market; relatedMarkets: Market[]; syncWindowMs?: number }): CrossMarketReport {
  const primary = input.primaryMarket;
  const relatedMarkets = input.relatedMarkets.filter((market) => market.id !== primary.id).slice(0, 20).map((market) => {
    const relation = relationship(primary, market);
    const motion = movement(primary, market, input.syncWindowMs ?? 10 * 60_000);
    const uncertainty: string[] = [];
    if (primary.status === "resolved" || market.status === "resolved") uncertainty.push("At least one market is resolved; its prices and movement are historical context only.");
    if (motion.dataStatus !== "sufficient") uncertainty.push("Movement comparison is limited because the available timestamped history is sparse.");
    if (primary.source === "panta" || market.source === "panta") uncertainty.push(primary.description && market.description
      ? "The available Panta metadata does not expose separate YES/NO resolution criteria, so this comparison is based on the published market definition."
      : "The available Panta metadata does not expose separate YES/NO resolution criteria or a full definition, so this comparison is based on the published market wording.");
    if (!primary.description || !market.description) uncertainty.push("Detailed resolution criteria are unavailable for at least one market.");
    else if (primary.description.trim() !== market.description.trim()) uncertainty.push("The provider resolution definitions differ; outcomes and prices may not be directly comparable.");
    if (motion.status === "insufficient") uncertainty.push("There are not enough timestamp-aligned observations to establish synchronized movement.");
    const contradiction = contradictions(primary, market);
    return { market: summary(market), relationship: relation, movement: motion, uncertainty, contradictions: contradiction.reasons, contradictionStrength: contradiction.strength };
  });
  const observedSignals = relatedMarkets.flatMap((entry) => entry.movement.observations.map((item) => `${item.marketId} YES changed ${(item.change * 100).toFixed(2)} percentage points from ${item.from} to ${item.to}.`));
  const supportingEvidence = relatedMarkets.flatMap((entry) => entry.relationship.reasons);
  const uncertainty = [...new Set(relatedMarkets.flatMap((entry) => entry.uncertainty))];
  return { primaryMarket: summary(primary), relatedMarkets, overall: {
    relationshipSummary: relatedMarkets.length ? `${relatedMarkets.length} market comparison${relatedMarkets.length === 1 ? "" : "s"} evaluated using provider metadata and timestamped observations.` : "No comparison markets were supplied.",
    observedSignals, supportingEvidence, opposingEvidence: relatedMarkets.flatMap((entry) => entry.contradictions), uncertainty,
  } };
}
