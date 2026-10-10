import "server-only";
import type { CrossMarketReport } from "./cross-market";
import type { ResearchEvidence } from "@/lib/research/types";
import { explainCrossMarketJson } from "@/lib/ai";

export type CrossMarketExplanation = {
  summary: string;
  relationshipExplanation: string;
  movementExplanation: string;
  evidenceExplanation: string;
  uncertainty: string[];
  evidenceIds: string[];
};

const schema = {
  type: "object", additionalProperties: false,
  properties: {
    summary: { type: "string" }, relationshipExplanation: { type: "string" },
    movementExplanation: { type: "string" }, evidenceExplanation: { type: "string" },
    uncertainty: { type: "array", items: { type: "string" } }, evidenceIds: { type: "array", items: { type: "string" } },
  },
  required: ["summary", "relationshipExplanation", "movementExplanation", "evidenceExplanation", "uncertainty", "evidenceIds"],
} as const;

export function deterministicCrossMarketExplanation(report: CrossMarketReport, evidence: ResearchEvidence[] = []): CrossMarketExplanation {
  const first = report.relatedMarkets[0];
  const evidenceIds = evidence.slice(0, 3).map((_, index) => `E${index + 1}`);
  return {
    summary: first ? `Compared ${report.primaryMarket.question} with ${first.market.question}.` : "No related comparison market was available.",
    relationshipExplanation: first ? `${first.relationship.type} relationship · ${first.relationship.confidence} confidence. ${first.relationship.reasons.join(" ")}` : report.overall.relationshipSummary,
    movementExplanation: first ? first.movement.status === "insufficient" ? "There are not enough timestamp-aligned observations to establish movement." : `Observed movement is ${first.movement.status}; timing is ${first.movement.timingAlignment.status}.` : "No movement comparison was available.",
    evidenceExplanation: evidence.length
      ? `${evidence.length} supplied research sources are available; ${evidence.filter((item) => item.publishedAt).length} have a verifiable publication time and ${evidence.filter((item) => !item.publishedAt).length} are undated.`
      : "No external evidence was supplied for this comparison.",
    uncertainty: [...new Set(report.overall.uncertainty)], evidenceIds,
  };
}

export function validateCrossMarketExplanation(value: unknown, allowedEvidenceIds: Set<string>, report: CrossMarketReport, onReject?: (reason: string) => void): CrossMarketExplanation | null {
  const reject = (reason: string) => { onReject?.(reason); return null; };
  if (!value || typeof value !== "object") return reject("invalid object");
  const row = value as Record<string, unknown>;
  const fields = ["summary", "relationshipExplanation", "movementExplanation", "evidenceExplanation"] as const;
  if (fields.some((field) => typeof row[field] !== "string" || !(row[field] as string).trim() || (row[field] as string).length > 700)) return reject("invalid explanation fields");
  if (!Array.isArray(row.uncertainty) || row.uncertainty.length > 8 || row.uncertainty.some((item) => typeof item !== "string" || item.length > 500)) return reject("invalid uncertainty fields");
  if (!Array.isArray(row.evidenceIds) || row.evidenceIds.some((id) => typeof id !== "string" || !allowedEvidenceIds.has(id))) return reject("unknown evidence ID");
  if (allowedEvidenceIds.size > 0 && row.evidenceIds.length === 0) return reject("evidence omitted despite supplied context");
  const result: CrossMarketExplanation = {
    summary: row.summary as string, relationshipExplanation: row.relationshipExplanation as string,
    movementExplanation: row.movementExplanation as string, evidenceExplanation: row.evidenceExplanation as string,
    uncertainty: row.uncertainty as string[], evidenceIds: row.evidenceIds as string[],
  };
  const text = [...fields.map((field) => result[field]), ...result.uncertainty].join(" ");
  // Numeric claims must be values explicitly present in the deterministic report.
  const json = JSON.stringify(report);
  for (const match of text.matchAll(/(?<![A-Za-z])\d+(?:\.\d+)?(?![A-Za-z])/g)) if (!json.includes(match[0])) return reject("unsupported numeric claim");
  if (/\b(caus(?:e|ed|es|ing)|led to|resulted in|because of)\b/i.test(text)) return reject("causal claim");
  const reportedMovements = new Set(report.relatedMarkets.map((item) => item.movement.status));
  for (const match of text.matchAll(/\b(?:movement|markets?|they)\s+(?:is|are|was|were|remain|remains|moved|move|show|shows)\s+(?:clearly\s+)?(aligned|divergent|mixed|insufficient)\b/gi)) if (!reportedMovements.has(match[1]!.toLowerCase() as CrossMarketReport["relatedMarkets"][number]["movement"]["status"])) return reject("movement status mismatch");
  const reportedRelationships = new Set(report.relatedMarkets.map((item) => item.relationship.type.replaceAll("-", " ")));
  for (const label of ["equivalent", "closely related", "partially related", "thematically related", "opposing", "not comparable"]) {
    if (new RegExp(`\\b${label.replaceAll(" ", "\\s+")}\\b`, "i").test(text) && !reportedRelationships.has(label as CrossMarketReport["relatedMarkets"][number]["relationship"]["type"])) return reject("relationship mismatch");
  }
  if (/\b(?:moved|move|trended|went|changed)\s+(?:clearly\s+)?upward\b/i.test(text) && !report.relatedMarkets.some((item) => item.movement.observations.some((observation) => observation.change > 0))) return reject("unsupported upward movement");
  if (/\b(?:moved|move|trended|went|changed)\s+(?:clearly\s+)?downward\b/i.test(text) && !report.relatedMarkets.some((item) => item.movement.observations.some((observation) => observation.change < 0))) return reject("unsupported downward movement");
  return result;
}

export function buildCrossMarketGroundingContext(report: CrossMarketReport, evidence: ResearchEvidence[], marketState: unknown = []) {
  const evidenceIdMap = new Map(evidence.slice(0, 12).map((item, index) => [`E${index + 1}`, item]));
  return {
    report,
    verifiedMarketState: marketState,
    evidence: [...evidenceIdMap].map(([id, item]) => ({ id, title: item.title, source: item.source, url: item.url, publishedAt: item.publishedAt, retrievedAt: item.retrievedAt, summary: item.summary })),
    allowedEvidenceIds: [...evidenceIdMap.keys()],
    limits: ["Use only supplied facts.", "Do not infer causation or make predictions.", "If publication date is null, describe timing as undated.", "Distinguish relationship, observation, evidence, interpretation, and uncertainty."],
  };
}

export async function createCrossMarketExplanation(input: { report: CrossMarketReport; evidence?: ResearchEvidence[]; marketState?: unknown; generate?: typeof explainCrossMarketJson }) {
  const { report } = input;
  const evidence = input.evidence ?? [];
  const context = buildCrossMarketGroundingContext(report, evidence, input.marketState ?? []);
  const evidenceIdMap = new Map(context.evidence.map((item) => [item.id, item.id]));
  let rejectionReason: string | null = null;
  const model = await (input.generate ?? explainCrossMarketJson)({ data: context, schema, validate: (value) => validateCrossMarketExplanation(value, new Set(context.allowedEvidenceIds), report, (reason) => { rejectionReason = reason; }) }).catch(() => null);
  // Second validation boundary: no model supplied citation reaches the response unless mapped.
  if (!model || model.evidenceIds.some((id) => !evidenceIdMap.has(id))) {
    if (rejectionReason) console.warn(`[MIRA AI] Grounded cross-market explanation rejected (${rejectionReason}).`);
    return { explanation: deterministicCrossMarketExplanation(report, evidence), mode: "deterministic" as const };
  }
  return { explanation: model, mode: "groq" as const };
}

export async function explainCrossMarket(report: CrossMarketReport, evidence: ResearchEvidence[] = [], marketState: unknown = []) {
  return createCrossMarketExplanation({ report, evidence, marketState });
}
