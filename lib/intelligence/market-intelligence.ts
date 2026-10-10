import "server-only";
import { explainMarketIntelligenceJson } from "@/lib/ai";
import type { CrossMarketReport } from "./cross-market";
import type { MarketReasoningSummary } from "./market-reasoning";
import type { Market, OrderBookSnapshot } from "@/lib/panta/types";
import type { MicrostructureHistoryPoint, MicrostructureResult } from "@/lib/panta/microstructure";
import type { EventIntelligence, ResearchEvidence } from "@/lib/research/types";

export type IntelligenceEvidenceCategory = "supports-reported-fact" | "provides-context" | "indicates-change" | "contradicts-another-source" | "adds-uncertainty" | "describes-market-activity" | "describes-event";
export type MarketIntelligenceContext = {
  market: null | {
    id: string; question: string; category: string | null; status: Market["status"]; phase: string | null;
    startAt: null; closeAt: string | null; resolutionStatus: "unresolved" | "resolved" | "unknown";
    yesPrice: number | null; noPrice: number | null; volumeUsd: number | null; liquidityUsd: number | null;
    provider: "panta" | "demo"; providerLabel: string; providerUpdatedAt: string | null;
    dataCompleteness: "complete" | "partial" | "unavailable";
  };
  pricing: { observedAt: string | null; observations: Array<{ at: string; yesPrice: number | null; provenance: "Panta provider history" | "Panta current quote" }>; changes: MarketReasoningSummary["changes"]; historyStatus: "available" | "insufficient"; note: string };
  structure: null | {
    source: "Panta · Solana"; status: OrderBookSnapshot["dataStatus"]; freshness: OrderBookSnapshot["freshness"];
    observedAt: string | null; slot: number | null; yes: MicrostructureResult["yes"] | null; no: MicrostructureResult["no"] | null;
    liquidityTrend: MicrostructureResult["liquidityTrend"] | null; depthChange: MicrostructureResult["totalDepthChange"] | null;
    orderChanges: MicrostructureResult["orderChanges"] | null; historyStatus: MicrostructureResult["historyStatus"] | OrderBookSnapshot["historyStatus"];
  };
  activity: { status: string; placements: number; cancellations: number; verifiedMatchedTrades: number; unknown: number; events: Array<{ kind: string; instruction: string; outcome?: string; observedAt: string | null; price?: number; size?: number }>; note: string };
  reasoning: null | { dataStatus: MarketReasoningSummary["dataStatus"]; evidenceQuality: MarketReasoningSummary["evidenceQuality"]; observationCount: number; comparisonObservationCount: number; signals: Array<{ kind: string; observed: string; interpretation: string; provenance: string }>; uncertainty: string[] };
  events: null | { title: string; status: EventIntelligence["event"]["status"]; summary: string; freshness: EventIntelligence["freshness"]; lastUpdatedAt: string; timeline: EventIntelligence["event"]["timeline"]; diff: EventIntelligence["diff"]; uncertainty: string[] };
  research: { status: "available" | "not-run" | "unavailable"; researchedAt: string | null; evidence: Array<ResearchEvidence & { category: IntelligenceEvidenceCategory }>; uncertainty: string[] };
  crossMarket: null | { report: CrossMarketReport; status: "available"; uncertainty: string[] };
  evidenceReferences: Record<string, string>;
  changes: Array<{ category: "price" | "structure" | "activity" | "research" | "event" | "related-markets"; summary: string; observedAt: string | null }>;
  uncertainty: string[];
  dataQuality: { status: "complete" | "partial" | "unavailable"; sources: Array<{ name: string; status: "available" | "partial" | "unavailable"; observedAt: string | null }> };
  generatedAt: string;
};

export type MarketIntelligenceResult = { context: MarketIntelligenceContext; answer: string; explanationMode: "groq" | "deterministic"; evidenceReferences: Record<string, string> };

type BuildInput = {
  market: Market | null;
  providerLabel?: string;
  snapshot?: OrderBookSnapshot | null;
  microstructure?: MicrostructureResult | null;
  history?: MicrostructureHistoryPoint[];
  reasoning?: MarketReasoningSummary | null;
  events?: EventIntelligence | null;
  research?: ResearchEvidence[];
  researchStatus?: "available" | "not-run" | "unavailable";
  researchedAt?: string | null;
  crossMarket?: CrossMarketReport | null;
  generatedAt?: string;
};

const validTime = (value: string | null | undefined) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const compact = (value: string | null | undefined, max = 500) => typeof value === "string" ? value.trim().slice(0, max) : "";

function evidenceCategory(item: ResearchEvidence, event: EventIntelligence | null): IntelligenceEvidenceCategory {
  if (event?.diff.contradictions.some((pair) => pair.evidenceIds.includes(item.id))) return "contradicts-another-source";
  if (event?.diff.newEvidence.some((entry) => entry.id === item.id)) return "indicates-change";
  if (item.sourceTier === 1 || item.evidenceType === "official") return "supports-reported-fact";
  if (item.freshness === "undated" || item.reliability === "low") return "adds-uncertainty";
  if (event?.event.evidenceIds.includes(item.id)) return "describes-event";
  if (item.evidenceType === "market-data") return "describes-market-activity";
  return "provides-context";
}

function emptyContext(input: BuildInput): MarketIntelligenceContext {
  const generatedAt = validTime(input.generatedAt) ?? new Date().toISOString();
  const rawEvidence = input.research ?? [];
  const evidenceReferences = Object.fromEntries(rawEvidence.slice(0, 6).map((item, index) => [`E${index + 1}`, item.id]));
  const evidence = rawEvidence.slice(0, 6).map((item, index) => ({
    ...item,
    id: `E${index + 1}`,
    claim: compact(item.claim, 450),
    summary: compact(item.summary, 450),
    title: compact(item.title, 220),
    category: evidenceCategory(item, input.events ?? null),
  }));
  const event = input.events ?? null;
  const eventContext = event ? {
    title: compact(event.event.title, 220),
    status: event.event.status,
    summary: compact(event.event.summary, 500),
    freshness: event.freshness,
    lastUpdatedAt: event.event.lastUpdatedAt,
    timeline: event.event.timeline.slice(-8).map((entry) => ({
      ...entry,
      title: compact(entry.title, 220),
      description: compact(entry.description, 500),
      evidenceIds: entry.evidenceIds.flatMap((id) => {
        const match = rawEvidence.slice(0, 6).findIndex((item) => item.id === id);
        return match >= 0 ? [`E${match + 1}`] : [];
      }),
    })),
    diff: { ...event.diff, newEvidence: event.diff.newEvidence.slice(0, 6), changedClaims: event.diff.changedClaims.slice(0, 6), removedOrRetractedClaims: event.diff.removedOrRetractedClaims.slice(0, 6), contradictions: event.diff.contradictions.slice(0, 6) },
    uncertainty: [event.diff.summary],
  } : null;
  const researchStatus = input.researchStatus ?? "not-run";
  const researchUncertainty = rawEvidence.some((item) => !item.publishedAt)
    ? ["Some evidence has no verifiable publication time; retrieval time is shown separately."]
    : rawEvidence.length === 0
      ? [researchStatus === "unavailable" ? "Persisted research evidence is unavailable." : "No persisted research evidence is available."]
      : [];
  const uncertainty = ["Panta market details are unavailable, so current prices and market state cannot be established.", ...researchUncertainty];
  if (!eventContext) uncertainty.push("Event context is unavailable.");
  return {
    market: null,
    pricing: { observedAt: null, observations: [], changes: [], historyStatus: "insufficient", note: "No current provider price is available." },
    structure: null,
    activity: { status: "unavailable", placements: 0, cancellations: 0, verifiedMatchedTrades: 0, unknown: 0, events: [], note: "No verified activity observation is available." },
    reasoning: null, events: eventContext,
    research: { status: researchStatus, researchedAt: validTime(input.researchedAt), evidence, uncertainty: researchUncertainty },
    crossMarket: input.crossMarket ? { report: input.crossMarket, status: "available", uncertainty: input.crossMarket.overall.uncertainty.slice(0, 10) } : null,
    evidenceReferences, changes: [], uncertainty,
    dataQuality: { status: "unavailable", sources: [
      { name: "Panta", status: "unavailable", observedAt: null },
      { name: "Persisted research", status: researchStatus === "available" && evidence.length ? "available" : researchStatus === "unavailable" ? "unavailable" : "partial", observedAt: validTime(input.researchedAt) },
      { name: "Related markets", status: input.crossMarket ? "available" : "partial", observedAt: input.crossMarket ? generatedAt : null },
    ] }, generatedAt,
  };
}

export function buildMarketIntelligenceContext(input: BuildInput): MarketIntelligenceContext {
  if (!input.market) return emptyContext(input);
  const { market, snapshot = null, microstructure = null, reasoning = null } = input;
  const generatedAt = validTime(input.generatedAt) ?? new Date().toISOString();
  const pantaObservationAt = validTime(market.updatedAt);
  const snapshotTime = snapshot ? new Date(snapshot.observedAt).getTime() : Number.NaN;
  const observedBookAt = Number.isFinite(snapshotTime) ? new Date(snapshotTime).toISOString() : null;
  const history = (input.history ?? []).filter((point) => point.dataStatus === "complete" && Number.isFinite(point.observedAt) && point.observedAt > 0).slice(-8);
  const priceObservations: MarketIntelligenceContext["pricing"]["observations"] = history.flatMap((point) => point.pantaReference.yesPrice === null ? [] : [{ at: new Date(point.observedAt).toISOString(), yesPrice: point.pantaReference.yesPrice, provenance: "Panta provider history" as const }]);
  if (market.yesProbability !== null && pantaObservationAt && !priceObservations.some((point) => point.at === pantaObservationAt)) priceObservations.push({ at: pantaObservationAt, yesPrice: market.yesProbability, provenance: "Panta current quote" });
  const changes = [...(reasoning?.changes ?? [])].map((item) => ({ ...item }));
  if (priceObservations.length >= 2) {
    const first = priceObservations[0]!; const last = priceObservations.at(-1)!;
    if (first.yesPrice !== null && last.yesPrice !== null && first.yesPrice !== last.yesPrice && !changes.some((item) => item.type === "price" && item.previousObservedAt === first.at && item.observedAt === last.at)) {
      changes.push({ type: "price", outcome: "YES", previousValue: first.yesPrice, currentValue: last.yesPrice, delta: last.yesPrice - first.yesPrice, previousObservedAt: first.at, observedAt: last.at, confidence: priceObservations.length >= 3 ? "high" : "moderate" });
    }
  }
  const rawEvidence = input.research ?? [];
  const evidenceReferences = new Map(rawEvidence.slice(0, 6).map((item, index) => [item.id, `E${index + 1}`]));
  const compactEvidenceReferences = Object.fromEntries([...evidenceReferences].map(([sourceId, compactId]) => [compactId, sourceId]));
  const event = input.events ?? null;
  const evidence = rawEvidence.slice(0, 6).map((item) => ({
    ...item, id: evidenceReferences.get(item.id) ?? item.id, claim: compact(item.claim, 450), summary: compact(item.summary, 450), title: compact(item.title, 220),
    category: evidenceCategory(item, event),
  }));
  const evidenceUncertainty = rawEvidence.some((item) => !item.publishedAt) ? ["Some evidence has no verifiable publication time; retrieval time is shown separately."] : [];
  const timeline = event ? event.event.timeline.slice(-8).map((entry) => ({ ...entry, title: compact(entry.title, 220), description: compact(entry.description, 500), evidenceIds: entry.evidenceIds.flatMap((id) => evidenceReferences.has(id) ? [evidenceReferences.get(id)!] : []) })) : null;
  const compactEvent = event ? { title: compact(event.event.title, 220), status: event.event.status, summary: compact(event.event.summary, 500), freshness: event.freshness, lastUpdatedAt: event.event.lastUpdatedAt, timeline: timeline ?? [], diff: { ...event.diff, newEvidence: event.diff.newEvidence.slice(0, 6).map((item) => ({ ...item, id: evidenceReferences.get(item.id) ?? item.id })), changedClaims: event.diff.changedClaims.slice(0, 6), removedOrRetractedClaims: event.diff.removedOrRetractedClaims.slice(0, 6), contradictions: event.diff.contradictions.slice(0, 6) }, uncertainty: [...new Set([event.diff.summary, ...(event.event.timeline.some((entry) => !entry.timestamp) ? ["Some sources have no verifiable publication time; their event timing cannot be established."] : [])])] } : null;
  const uncertainties = new Set<string>(reasoning?.uncertainty ?? []);
  if (market.status === "resolved") uncertainties.add("This market is resolved; all price and structure values are historical context.");
  if (market.status === "unknown") uncertainties.add("Panta has not confirmed whether this market is active.");
  if (market.yesProbability === null || market.noProbability === null) uncertainties.add("One or both Panta market prices are unavailable.");
  if (!snapshot || snapshot.dataStatus === "unavailable") uncertainties.add(snapshot?.message ?? "The verified on-chain order book is unavailable.");
  else if (snapshot.dataStatus === "partial") uncertainties.add("The latest on-chain order-book snapshot is partial.");
  if (!snapshot || snapshot.dataStatus === "unavailable") uncertainties.add("No verified order activity is available from the current book snapshot.");
  else if (!snapshot.activity.some((item) => item.kind === "order_matched")) uncertainties.add("No matched trade could be verified from the available activity.");
  if (history.length < 2) uncertainties.add("There is not enough observed history to establish a meaningful structural change.");
  if (!event) uncertainties.add("Event context is unavailable because no persisted research evidence was available.");
  if (event && event.diff.status === "insufficient") uncertainties.add("There is not enough retained prior evidence to determine what changed since the earlier research run.");
  if (input.researchStatus === "unavailable") uncertainties.add("Persisted research could not be loaded.");
  else if (input.researchStatus === "not-run" || rawEvidence.length === 0) uncertainties.add("No persisted research evidence is available.");
  if (!input.crossMarket) uncertainties.add("No provider-linked or selected related market was available for comparison.");
  for (const item of input.crossMarket?.relatedMarkets ?? []) for (const note of item.uncertainty) uncertainties.add(note);
  for (const item of evidenceUncertainty) uncertainties.add(item);
  const activityItems = snapshot?.activity ?? [];
  const activity = {
    status: snapshot?.activityStatus ?? "unavailable",
    placements: activityItems.filter((item) => item.kind === "order_placed").length,
    cancellations: activityItems.filter((item) => item.kind === "order_cancelled").length,
    verifiedMatchedTrades: activityItems.filter((item) => item.kind === "order_matched").length,
    unknown: activityItems.filter((item) => item.kind === "unknown").length,
    events: activityItems.slice(0, 6).map((item) => ({ kind: item.kind, instruction: item.instruction, outcome: item.outcome, observedAt: item.observedAt ? new Date(item.observedAt).toISOString() : null, price: item.price, size: item.size })),
    note: activityItems.some((item) => item.kind === "order_matched") ? "Only decoded OrderMatched records are counted as verified fills." : "Order placement and cancellation records are not matched trades; no matched fill was verified.",
  };
  const priceHistoryStatus = priceObservations.length >= 2 ? "available" as const : "insufficient" as const;
  const providerDataComplete = market.question.trim().length > 0 && market.category !== null && market.yesProbability !== null && market.noProbability !== null && market.volumeUsd !== null && market.closeAt !== null && market.status !== "unknown";
  const dataQuality: MarketIntelligenceContext["dataQuality"] = {
    status: !providerDataComplete || !snapshot || snapshot.dataStatus !== "complete" || input.researchStatus === "unavailable" ? "partial" : "complete",
    sources: [
      { name: market.source === "panta" ? "Panta" : "Demo provider", status: market.source === "panta" ? "available" : "partial", observedAt: pantaObservationAt },
      { name: "Panta · Solana CLOB", status: !snapshot || snapshot.dataStatus === "unavailable" ? "unavailable" : snapshot.dataStatus === "partial" ? "partial" : "available", observedAt: observedBookAt },
      { name: "Persisted research", status: input.researchStatus === "available" && rawEvidence.length ? "available" : input.researchStatus === "unavailable" ? "unavailable" : "partial", observedAt: validTime(input.researchedAt) },
      { name: "Related markets", status: input.crossMarket ? "available" : "partial", observedAt: input.crossMarket ? generatedAt : null },
    ],
  };
  const marketChanges = changes.map((change) => ({ category: change.type === "price" ? "price" as const : "structure" as const, summary: `${change.outcome} ${change.type} changed from ${change.previousValue} to ${change.currentValue} across observed timestamps.`, observedAt: change.observedAt }));
  const structureChanges = microstructure?.totalDepthChange && microstructure.totalDepthChange.change !== 0 ? [{ category: "structure" as const, summary: `Visible book depth changed by ${microstructure.totalDepthChange.change} USDC across persisted observations.`, observedAt: observedBookAt }] : [];
  const hasPriorBaseline = event?.diff.status === "material-change" || event?.diff.status === "minor-change" || event?.diff.status === "no-change";
  const researchChanges = event && hasPriorBaseline && event.diff.newEvidence.length ? [{ category: "research" as const, summary: `${event.diff.newEvidence.length} new evidence items are recorded relative to the retained prior sources.`, observedAt: validTime(input.researchedAt) }] : [];
  const eventChanges = event && hasPriorBaseline && event.diff.changedClaims.length ? [{ category: "event" as const, summary: `${event.diff.changedClaims.length} evidence-backed claims changed relative to prior research.`, observedAt: event.event.lastUpdatedAt }] : [];
  const relatedChanges = input.crossMarket?.relatedMarkets.flatMap((item) => item.movement.observations.length ? [{ category: "related-markets" as const, summary: `${item.market.question} has observed movement ${item.movement.status} within ${item.movement.timingAlignment.status} timing alignment.`, observedAt: item.movement.observations.at(-1)?.to ?? null }] : []) ?? [];
  const context: MarketIntelligenceContext = {
    market: { id: market.id, question: compact(market.question, 500), category: market.category, status: market.status, phase: market.phase ?? null, startAt: null, closeAt: validTime(market.closeAt), resolutionStatus: market.status === "resolved" ? "resolved" : market.status === "active" || market.status === "closed" ? "unresolved" : "unknown", yesPrice: market.yesProbability, noPrice: market.noProbability, volumeUsd: market.volumeUsd, liquidityUsd: market.liquidityUsd, provider: market.source, providerLabel: input.providerLabel ?? (market.source === "panta" ? "Connected market data" : "Demo data"), providerUpdatedAt: pantaObservationAt, dataCompleteness: providerDataComplete ? "complete" : "partial" },
    pricing: { observedAt: pantaObservationAt, observations: priceObservations, changes, historyStatus: priceHistoryStatus, note: "Prices are venue-reported market prices, not MIRA outcome probabilities or forecasts." },
    structure: snapshot ? { source: "Panta · Solana", status: snapshot.dataStatus, freshness: snapshot.freshness, observedAt: observedBookAt, slot: snapshot.slot, yes: microstructure?.yes ?? null, no: microstructure?.no ?? null, liquidityTrend: microstructure?.liquidityTrend ?? null, depthChange: microstructure?.totalDepthChange ?? null, orderChanges: microstructure?.orderChanges ?? null, historyStatus: microstructure?.historyStatus ?? snapshot.historyStatus } : null,
    activity,
    reasoning: reasoning ? { dataStatus: reasoning.dataStatus, evidenceQuality: reasoning.evidenceQuality, observationCount: reasoning.observationCount, comparisonObservationCount: reasoning.comparisonObservationCount, signals: reasoning.signals.slice(0, 12).map(({ kind, observed, interpretation, provenance }) => ({ kind, observed: compact(observed), interpretation: compact(interpretation), provenance })), uncertainty: reasoning.uncertainty.slice(0, 12) } : null,
    events: compactEvent,
    research: { status: input.researchStatus ?? "not-run", researchedAt: validTime(input.researchedAt), evidence, uncertainty: evidenceUncertainty },
    crossMarket: input.crossMarket ? { report: input.crossMarket, status: "available", uncertainty: input.crossMarket.overall.uncertainty.slice(0, 10) } : null,
    evidenceReferences: compactEvidenceReferences,
    changes: [...marketChanges, ...structureChanges, ...researchChanges, ...eventChanges, ...relatedChanges].slice(0, 20),
    uncertainty: [...uncertainties].slice(0, 24), dataQuality, generatedAt,
  };
  return context;
}

export function buildDeterministicMarketIntelligence(context: MarketIntelligenceContext, asksForRecommendation = false): string {
  const lines: string[] = [];
  if (asksForRecommendation) lines.push("I can’t recommend an outcome or trade. Here is what the available market data and evidence show.");
  if (!context.market) {
    lines.push("Panta market data is unavailable, so MIRA cannot establish the current market state. No price or order-book state has been inferred.");
    if (context.events) lines.push(`Event context: ${context.events.title} is ${context.events.status}. ${context.events.summary}`);
    if (context.research.evidence.length) lines.push(`Available research: ${context.research.evidence.map((item) => `${item.id} — ${item.title} (${item.category}; ${item.reliability} reliability${item.publishedAt ? `; published ${item.publishedAt}` : "; publication time unavailable"})`).join(" ")}`);
    else lines.push(context.research.status === "unavailable" ? "Persisted research is unavailable." : "No persisted research evidence is available.");
    if (context.crossMarket?.report.relatedMarkets.length) lines.push(`Related markets: ${context.crossMarket.report.relatedMarkets.slice(0, 3).map((item) => `${item.market.question} (${item.relationship.type}; movement ${item.movement.status})`).join("; ")}. Similar movement does not establish causation.`);
    lines.push(`What remains uncertain: ${context.uncertainty.join(" ")}`);
    return lines.join("\n\n");
  }
  const market = context.market;
  lines.push(`${market.question} · ${market.status}${market.resolutionStatus === "resolved" ? " (historical context)" : ""}. Source: ${market.providerLabel}; data completeness: ${market.dataCompleteness}.`);
  const formatPrice = (value: number | null) => value === null ? "unavailable" : `${(value * 100).toFixed(1)}¢`;
  if (market.yesPrice !== null || market.noPrice !== null) lines.push(`Panta reports YES at ${formatPrice(market.yesPrice)} and NO at ${formatPrice(market.noPrice)}. These are market prices, not MIRA forecasts.`);
  else lines.push("Panta returned no current YES or NO price.");
  if (context.structure) {
    const side = (name: "YES" | "NO", value: typeof context.structure.yes) => {
      if (!value) return `${name} structure metrics are unavailable.`;
      const quote = `bid ${value.bestBid === null ? "unavailable" : `${(value.bestBid * 100).toFixed(1)}¢`}, ask ${value.bestAsk === null ? "unavailable" : `${(value.bestAsk * 100).toFixed(1)}¢`}`;
      return `${name} book is ${value.bookState} (${quote}); visible depth is ${value.totalDepth.toFixed(2)} USDC${value.midpoint === null ? "" : `, calculated midpoint ${(value.midpoint * 100).toFixed(1)}¢`}.`;
    };
    lines.push(`Order book observed ${context.structure.observedAt}; status ${context.structure.status}, freshness ${context.structure.freshness}. ${side("YES", context.structure.yes)} ${side("NO", context.structure.no)} A midpoint is a quote calculation, not a matched price or probability.`);
  } else lines.push("The verified on-chain CLOB snapshot is unavailable; no order-book state is inferred.");
  if (context.activity.verifiedMatchedTrades) lines.push(`${context.activity.verifiedMatchedTrades} verified matched trade event${context.activity.verifiedMatchedTrades === 1 ? "" : "s"} appear in the bounded activity sample.`);
  else lines.push("No matched trade could be verified from the available activity.");
  lines.push(context.changes.length ? `Observed changes: ${context.changes.slice(0, 6).map((item) => item.summary).join(" ")}` : "There is not enough observed history to establish a meaningful change.");
  if (context.events) {
    lines.push(`Event context: ${context.events.title} is ${context.events.status}; freshness ${context.events.freshness}. ${context.events.diff.summary}`);
    const latest = context.events.timeline.filter((item) => item.timestamp).at(-1);
    if (latest) lines.push(`Latest publication-time entry: ${latest.title} (${latest.timestampConfidence} timestamp).`);
  } else lines.push("Event context is unavailable because no persisted research evidence was available.");
  if (context.research.evidence.length) lines.push(`Research retains ${context.research.evidence.length} bounded source items. ${context.research.evidence.map((item) => `${item.id} — ${item.title} (${item.category}; ${item.reliability} reliability; ${item.publishedAt ? `published ${item.publishedAt}` : "publication time unavailable"}; retrieved ${item.retrievedAt})`).join(" ")}`);
  else lines.push(context.research.status === "unavailable" ? "Persisted research is unavailable." : "No persisted research evidence is available.");
  if (context.crossMarket?.report.relatedMarkets.length) lines.push(`Related markets: ${context.crossMarket.report.relatedMarkets.slice(0, 3).map((item) => `${item.market.question} (${item.relationship.type}; movement ${item.movement.status}; timing ${item.movement.timingAlignment.status})`).join("; ")}. Similar timing does not establish causation.`);
  else lines.push("No provider-linked or selected related market was available for comparison.");
  lines.push(`What remains uncertain: ${context.uncertainty.length ? context.uncertainty.join(" ") : "No additional limitation was identified in the available inputs."}`);
  return lines.join("\n\n");
}

export function validateMarketIntelligenceExplanation(value: unknown, context: MarketIntelligenceContext): { answer: string; evidenceIds: string[] } | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.answer !== "string" || row.answer.trim().length < 60 || row.answer.length > 2400) return null;
  if (!Array.isArray(row.evidenceIds) || row.evidenceIds.length > 6 || row.evidenceIds.some((id) => typeof id !== "string" || !context.research.evidence.some((evidence) => evidence.id === id))) return null;
  if (context.research.evidence.length && row.evidenceIds.length === 0) return null;
  const answer = row.answer.trim();
  if (/\b(?:will win|will lose|guaranteed|certain to|likely to win|almost certain|should buy|recommend(?:s|ed)? buying|buy yes|buy no|sell yes|sell no|enter this trade)\b/i.test(answer)) return null;
  if (/\b(?:caused|causes|because of|led to|resulted in|therefore .* will|means .* will)\b/i.test(answer)) return null;
  if (/\b\d+(?:\.\d+)?\b|\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten)\b|\b20\d{2}-\d{2}-\d{2}\b/i.test(answer)) return null;
  const normalizedAnswer = answer.toLowerCase();
  if (/\b(?:moved|movement|increased|decreased|rose|fell|changed|change)\b/.test(normalizedAnswer) && context.changes.length === 0 && context.events?.diff.status !== "material-change" && context.events?.diff.status !== "minor-change") return null;
  if (/\b(?:matched trade|matched fill|trade was verified)\b/i.test(answer) && context.activity.verifiedMatchedTrades === 0) return null;
  if (/\b(?:related market|related markets|compared market|other market)\b/i.test(answer) && !context.crossMarket?.report.relatedMarkets.length) return null;
  if (/\b(?:contradict|disagree|conflict)\w*\b/i.test(answer) && !context.events?.diff.contradictions.length) return null;
  const serialized = JSON.stringify(context).toLowerCase();
  const common = new Set(["The", "This", "These", "Those", "What", "Where", "When", "While", "Although", "However", "Overall", "Panta", "MIRA", "Market", "Visible", "Current", "Available", "Evidence", "Research", "Related", "Order", "Book", "No", "One", "Two", "First", "Second", "If", "Because", "There", "It", "Only", "Some", "Prices", "Sources", "Event", "Freshness", "Uncertainty", "Recent", "Latest", "From"]);
  const unknownName = (answer.match(/\b[A-Z][a-z]{3,}\b/g) ?? []).find((name) => !common.has(name) && !serialized.includes(name.toLowerCase()));
  if (unknownName) return null;
  const evidenceIds = row.evidenceIds as string[];
  return { answer, evidenceIds };
}

const explanationSchema = { type: "object", additionalProperties: false, properties: { answer: { type: "string" }, evidenceIds: { type: "array", maxItems: 6, items: { type: "string", enum: ["E1", "E2", "E3", "E4", "E5", "E6"] } } }, required: ["answer", "evidenceIds"] } as const;

export async function synthesizeMarketIntelligence(context: MarketIntelligenceContext, asksForRecommendation = false, generate: typeof explainMarketIntelligenceJson = explainMarketIntelligenceJson): Promise<MarketIntelligenceResult> {
  const evidenceReferences = context.evidenceReferences;
  const fallback = buildDeterministicMarketIntelligence(context, asksForRecommendation);
  if (!context.market || context.market.status === "resolved") return { context, answer: fallback, explanationMode: "deterministic", evidenceReferences };
  const bounded = {
    market: context.market,
    pricing: { ...context.pricing, observations: context.pricing.observations.slice(-8), changes: context.pricing.changes.slice(-8) },
    structure: context.structure,
    activity: { ...context.activity, events: context.activity.events.slice(0, 6) },
    reasoning: context.reasoning ? { ...context.reasoning, signals: context.reasoning.signals.slice(0, 8), uncertainty: context.reasoning.uncertainty.slice(0, 8) } : null,
    events: context.events ? { ...context.events, timeline: context.events.timeline.slice(-8), diff: { ...context.events.diff, newEvidence: context.events.diff.newEvidence.slice(0, 6), changedClaims: context.events.diff.changedClaims.slice(0, 6), removedOrRetractedClaims: context.events.diff.removedOrRetractedClaims.slice(0, 6), contradictions: context.events.diff.contradictions.slice(0, 6) } } : null,
    research: { status: context.research.status, researchedAt: context.research.researchedAt, evidence: context.research.evidence.slice(0, 6) },
    crossMarket: context.crossMarket ? { status: context.crossMarket.status, report: {
      primaryMarket: { id: context.crossMarket.report.primaryMarket.id, question: context.crossMarket.report.primaryMarket.question, status: context.crossMarket.report.primaryMarket.status, observationCount: context.crossMarket.report.primaryMarket.observationCount },
      relatedMarkets: context.crossMarket.report.relatedMarkets.slice(0, 4).map((related) => ({
        market: { id: related.market.id, question: related.market.question, status: related.market.status, observationCount: related.market.observationCount },
        relationship: { type: related.relationship.type, confidence: related.relationship.confidence, reasons: related.relationship.reasons.slice(0, 2) },
        movement: { status: related.movement.status, dataStatus: related.movement.dataStatus, timingAlignment: related.movement.timingAlignment.status, observations: related.movement.observations.slice(0, 2) },
        uncertainty: related.uncertainty.slice(0, 3), contradictions: related.contradictions.slice(0, 2), contradictionStrength: related.contradictionStrength,
      })),
      overall: { relationshipSummary: context.crossMarket.report.overall.relationshipSummary, observedSignals: context.crossMarket.report.overall.observedSignals.slice(0, 4), supportingEvidence: context.crossMarket.report.overall.supportingEvidence.slice(0, 4), opposingEvidence: context.crossMarket.report.overall.opposingEvidence.slice(0, 4), uncertainty: context.crossMarket.report.overall.uncertainty.slice(0, 6) },
    } } : null,
    changes: context.changes.slice(0, 12), uncertainty: context.uncertainty.slice(0, 16), dataQuality: context.dataQuality, generatedAt: context.generatedAt,
  };
  const ids = new Set(context.research.evidence.slice(0, 6).map((item) => item.id));
  const result = await generate({ data: bounded, schema: explanationSchema, validate: (candidate) => validateMarketIntelligenceExplanation(candidate, { ...context, research: { ...context.research, evidence: context.research.evidence.filter((item) => ids.has(item.id)) } }) }).catch(() => null);
  return result ? { context, answer: `${asksForRecommendation ? "I can’t recommend an outcome or trade. Here is what the available market data and evidence show.\n\n" : ""}${result.answer}`, explanationMode: "groq", evidenceReferences } : { context, answer: fallback, explanationMode: "deterministic", evidenceReferences };
}

export function asksForMarketIntelligence(message: string): boolean {
  return /\b(?:what do you see|give me (?:the )?full picture|full picture|summari[sz]e everything|what is happening\??|what's happening\??|what do you think|what don't we know|what do we know|what does the order ?book show|what does the research say|what are the conflicting reports|how are the related markets behaving|what's happening in this market|what is happening in this market|what is happening with this market|should i buy\s+(?:yes|no)|what(?:'s| has) changed|has anything changed|what happened since i last checked|what happened today|what(?:'s| is) the latest update|what is the latest|what happened\??|what changed\??)\b/i.test(message);
}
