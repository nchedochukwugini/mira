import "server-only";
import { explainEventIntelligenceJson } from "@/lib/ai";
import type { EventExplanation, EventIntelligence, ResearchEvidence } from "./types";

const schema = { type: "object", additionalProperties: false, properties: { summary: { type: "string" }, timelineExplanation: { type: "string" }, evidenceExplanation: { type: "string" }, marketRelevanceExplanation: { type: "string" }, uncertainty: { type: "array", items: { type: "string" } }, evidenceIds: { type: "array", minItems: 1, maxItems: 6, items: { type: "string", enum: ["E1", "E2", "E3", "E4", "E5", "E6"] } } }, required: ["summary", "timelineExplanation", "evidenceExplanation", "marketRelevanceExplanation", "uncertainty", "evidenceIds"] } as const;

export function deterministicEventExplanation(event: EventIntelligence): EventExplanation {
  const ids = Object.keys(event.evidenceReferences);
  const newest = event.event.timeline.filter((item) => item.timestamp).at(-1);
  return {
    summary: `${event.event.title} is ${event.event.status}; event confidence is ${event.event.confidence}.`,
    timelineExplanation: newest ? `The latest verifiably dated timeline entry is “${newest.title}” at ${newest.timestamp}.` : "No verifiable publication time is available for the current event evidence.",
    evidenceExplanation: ids.length ? `${ids.length} source-backed evidence items are included; ${event.sourceDiversity.independentReportingGroups} estimated independent reporting groups are represented.` : "No external evidence was available to support an event summary.",
    marketRelevanceExplanation: `Market relevance is ${event.marketRelevance}; this describes resolution relevance and does not predict market direction.`,
    uncertainty: [...new Set([event.diff.summary, ...(event.event.timeline.some((item) => !item.timestamp) ? ["The source did not provide a verifiable publication time, so its timing relative to the event cannot be established."] : []), ...(event.marketRelevance === "not-established" ? ["A relationship between this event and the market is not established by the available definition and evidence."] : [])])], evidenceIds: ids,
  };
}

export function validateEventExplanation(value: unknown, allowedIds: Set<string>, context: unknown, onReject?: (reason: string) => void): EventExplanation | null {
  const reject = (reason: string) => { onReject?.(reason); return null; };
  if (!value || typeof value !== "object") return reject("invalid object");
  const row = value as Record<string, unknown>;
  const fields = ["summary", "timelineExplanation", "evidenceExplanation", "marketRelevanceExplanation"] as const;
  if (fields.some((field) => typeof row[field] !== "string" || !(row[field] as string).trim() || (row[field] as string).length > 900)) return reject("invalid explanation fields");
  if (!Array.isArray(row.uncertainty) || row.uncertainty.length > 10 || row.uncertainty.some((item) => typeof item !== "string" || item.length > 500)) return reject("invalid uncertainty fields");
  if (!Array.isArray(row.evidenceIds) || row.evidenceIds.some((id) => typeof id !== "string" || !allowedIds.has(id))) return reject("unknown evidence ID");
  if (allowedIds.size > 0 && row.evidenceIds.length === 0) return reject("evidence omitted despite supplied context");
  const result = { summary: row.summary as string, timelineExplanation: row.timelineExplanation as string, evidenceExplanation: row.evidenceExplanation as string, marketRelevanceExplanation: row.marketRelevanceExplanation as string, uncertainty: row.uncertainty as string[], evidenceIds: row.evidenceIds as string[] };
  const allText = [...fields.map((field) => result[field]), ...result.uncertainty].join(" ");
  const serialized = JSON.stringify(context);
  const numericWords: Record<string, number> = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  const contextCounts = new Set<number>();
  const addCount = (value: unknown) => { if (typeof value === "number" && Number.isInteger(value) && value >= 0) contextCounts.add(value); };
  const intel = context as { evidence?: unknown[]; timeline?: Array<{ sourceCount?: number }>; sourceDiversity?: { uniqueSources?: number; independentReportingGroups?: number; primarySources?: number } };
  if (Array.isArray(intel.evidence)) contextCounts.add(intel.evidence.length);
  if (Array.isArray(intel.timeline)) {
    contextCounts.add(intel.timeline.length);
    intel.timeline.forEach((item) => addCount(item.sourceCount));
  }
  addCount(intel.sourceDiversity?.uniqueSources); addCount(intel.sourceDiversity?.independentReportingGroups); addCount(intel.sourceDiversity?.primarySources);
  for (const match of allText.matchAll(/\b(zero|one|two|three|four|five|six|seven|eight|nine|ten)\b/gi)) if (!contextCounts.has(numericWords[match[1]!.toLowerCase()]!)) return reject("unsupported numeric claim");
  for (const match of allText.matchAll(/\b\d+(?:\.\d+)?\b/g)) if (!serialized.includes(match[0])) return reject("unsupported numeric claim");
  for (const match of allText.matchAll(/\b(20\d{2}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?Z?)?|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:,?\s+20\d{2})?)\b/gi)) {
    const claimedDate = match[1]!.toLowerCase();
    if (serialized.toLowerCase().includes(claimedDate)) continue;
    const month = claimedDate.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/)?.[1];
    const numbers = claimedDate.match(/\d+/g) ?? [];
    const monthSupported = !month || serialized.toLowerCase().includes(month);
    const numbersSupported = numbers.every((number) => new RegExp(`(?<!\\d)${number}(?!\\d)`).test(serialized));
    if (!monthSupported || !numbersSupported) return reject("unsupported date claim");
  }
  if (/\b(caus(?:e|ed|es|ing)|led to|resulted in|because of|will rise|will fall|likely to rise|likely to fall|buy|sell|trade)\b/i.test(allText)) return reject("causal or predictive claim");
  const sources = Array.isArray((context as { evidence?: unknown[] })?.evidence) ? (context as { evidence: Array<{ source?: string; title?: string }> }).evidence : [];
  const knownSourceWords = new Set(sources.flatMap((item) => `${item.source ?? ""} ${item.title ?? ""}`.toLowerCase().match(/[a-z0-9]+/g) ?? []));
  const properNames = allText.match(/\b[A-Z][a-z]{3,}\b/g) ?? [];
  const commonSentenceWords = new Set(["the", "this", "that", "these", "those", "each", "latest", "based", "event", "evidence", "source", "market", "timeline", "material", "available", "official", "current", "supplied", "mira", "deterministic", "however", "although", "additionally", "moreover", "meanwhile", "overall", "nonetheless", "notably", "finally", "first", "second", ...Object.keys(numericWords)]);
  const unsupportedName = properNames.find((word) => !commonSentenceWords.has(word.toLowerCase()) && !knownSourceWords.has(word.toLowerCase()) && !serialized.toLowerCase().includes(word.toLowerCase()));
  if (unsupportedName) return reject(`unsupported named entity or source: ${unsupportedName}`);
  return result;
}

export async function synthesizeEventExplanation(input: { event: EventIntelligence; evidence: ResearchEvidence[]; generate?: typeof explainEventIntelligenceJson }) {
  // Keep Groq's event context compact while supporting the E1–E6 citations
  // exposed by the event explanation contract.
  const evidence = input.evidence.slice(0, 6);
  const evidenceReferences = Object.fromEntries(evidence.map((item, index) => [`E${index + 1}`, item.id]));
  const compactEvidenceId = new Map(evidence.map((item, index) => [item.id, `E${index + 1}`]));
  const event = { title: input.event.event.title.slice(0, 180), summary: input.event.event.summary.slice(0, 250), entities: input.event.event.entities.slice(0, 6), topics: input.event.event.topics.slice(0, 6), status: input.event.event.status, firstObservedAt: input.event.event.firstObservedAt, lastUpdatedAt: input.event.event.lastUpdatedAt, confidence: input.event.event.confidence, evidenceIds: input.event.event.evidenceIds.slice(0, 6).flatMap((id) => compactEvidenceId.has(id) ? [compactEvidenceId.get(id)] : []), marketIds: input.event.event.marketIds };
  const timeline = input.event.event.timeline.slice(0, 5).map((entry) => ({ timestamp: entry.timestamp, timestampConfidence: entry.timestampConfidence, title: entry.title.slice(0, 140), description: entry.description.slice(0, 180), evidenceIds: entry.evidenceIds.flatMap((id) => compactEvidenceId.has(id) ? [compactEvidenceId.get(id)] : []), sourceCount: entry.sourceCount }));
const context = { event, timeline, researchTypes: input.event.researchTypes, timeWindow: input.event.timeWindow, freshness: input.event.freshness, sourceDiversity: input.event.sourceDiversity, diff: { status: input.event.diff.status, newEvidenceIds: input.event.diff.newEvidence.slice(0, 6).flatMap((item) => compactEvidenceId.has(item.id) ? [compactEvidenceId.get(item.id)] : []), changedClaims: input.event.diff.changedClaims.slice(0, 3).map(({ previous, current, type, evidenceIds }) => ({ previous: previous.slice(0, 180), current: current.slice(0, 180), type, evidenceIds: evidenceIds.flatMap((id) => compactEvidenceId.has(id) ? [compactEvidenceId.get(id)] : []) })), contradictions: input.event.diff.contradictions.slice(0, 2).map(({ claimA, claimB, evidenceIds }) => ({ claimA: claimA.slice(0, 180), claimB: claimB.slice(0, 180), evidenceIds: evidenceIds.flatMap((id) => compactEvidenceId.has(id) ? [compactEvidenceId.get(id)] : []) })) }, marketContext: { ...input.event.marketContext, definition: input.event.marketContext.definition?.slice(0, 350) ?? null, relevance: input.event.marketRelevance }, evidence: evidence.map((item, index) => ({ id: `E${index + 1}`, title: item.title.slice(0, 140), source: item.source, domain: item.domain, sourceTier: item.sourceTier, reliability: item.reliability, eventRelevance: item.eventRelevance ?? "not-applicable", publishedAt: item.publishedAt, publishedAtPrecision: item.publishedAtPrecision ?? "unknown", retrievedAt: item.retrievedAt, claim: item.claim.slice(0, 220) })) };
  const allowed = new Set(evidence.map((_, index) => `E${index + 1}`));
  const fallback = deterministicEventExplanation({ ...input.event, evidenceReferences });
  if (!evidence.length) return { explanation: fallback, mode: "deterministic" as const, evidenceReferences };
  let rejectionReason: string | null = null;
  const model = await (input.generate ?? explainEventIntelligenceJson)({ data: context, schema, validate: (value) => validateEventExplanation(value, allowed, context, (reason) => { rejectionReason = reason; }) }).catch(() => null);
  if (!model || model.evidenceIds.some((id) => !evidenceReferences[id])) {
    if (rejectionReason) console.warn(`[MIRA AI] Grounded event explanation rejected (${rejectionReason}).`);
    return { explanation: fallback, mode: "deterministic" as const, evidenceReferences };
  }
  return { explanation: model, mode: "groq" as const, evidenceReferences };
}
