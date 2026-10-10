import "server-only";
import type { Market } from "@/lib/panta/types";
import type { ResearchEvidence, ResearchReport } from "./types";
import { synthesizeResearchJson } from "@/lib/ai";

export type ModelResearchSynthesis = {
  summary: string;
  stance: ResearchReport["assessment"]["stance"];
  assessmentEvidenceIds: string[];
  evidenceReviews: Array<{ evidenceId: string; direction: ResearchEvidence["direction"]; relevance: ResearchEvidence["relevance"]; reasoning: string }>;
  keyFindings: Array<{ text: string; evidenceIds: string[] }>;
  whatChanged: Array<{ text: string; evidenceIds: string[] }>;
  whatCouldChange: Array<{ text: string; evidenceIds: string[] }>;
  uncertainties: Array<{ text: string; evidenceIds: string[] }>;
};

const schema = {
  type: "object", additionalProperties: false,
  properties: {
    summary: { type: "string" },
    stance: { type: "string", enum: ["favorable-yes", "mixed", "favorable-no", "insufficient"] },
    assessmentEvidenceIds: { type: "array", maxItems: 8, items: { type: "string" } },
    evidenceReviews: { type: "array", maxItems: 8, items: { type: "object", additionalProperties: false, properties: {
      evidenceId: { type: "string" }, direction: { type: "string", enum: ["supports-yes", "supports-no", "neutral"] },
      relevance: { type: "string", enum: ["high", "medium", "low"] }, reasoning: { type: "string" },
    }, required: ["evidenceId", "direction", "relevance", "reasoning"] } },
    keyFindings: { type: "array", maxItems: 8, items: { type: "object", additionalProperties: false, properties: { text: { type: "string" }, evidenceIds: { type: "array", maxItems: 8, items: { type: "string" } } }, required: ["text", "evidenceIds"] } },
    whatChanged: { type: "array", maxItems: 8, items: { type: "object", additionalProperties: false, properties: { text: { type: "string" }, evidenceIds: { type: "array", maxItems: 8, items: { type: "string" } } }, required: ["text", "evidenceIds"] } },
    whatCouldChange: { type: "array", maxItems: 8, items: { type: "object", additionalProperties: false, properties: { text: { type: "string" }, evidenceIds: { type: "array", maxItems: 8, items: { type: "string" } } }, required: ["text", "evidenceIds"] } },
    uncertainties: { type: "array", maxItems: 8, items: { type: "object", additionalProperties: false, properties: { text: { type: "string" }, evidenceIds: { type: "array", maxItems: 8, items: { type: "string" } } }, required: ["text", "evidenceIds"] } },
  },
  required: ["summary", "stance", "assessmentEvidenceIds", "evidenceReviews", "keyFindings", "whatChanged", "whatCouldChange", "uncertainties"],
} as const;

function safeLine(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim().slice(0, 700) : null; }
const groundingStopWords = new Set(["this", "that", "these", "those", "there", "their", "which", "where", "when", "while", "with", "from", "into", "about", "because", "after", "before", "over", "under", "they", "them", "have", "has", "had", "were", "was", "are", "will", "would", "could", "should", "does", "did", "not", "only", "also", "than", "then", "more", "less", "some", "most", "both", "each", "many", "much", "such", "very", "really", "still", "case", "evidence", "source", "sources", "record", "records", "report", "reports", "suggest", "suggests", "indicate", "indicates", "available", "supplied", "relevant", "enough", "establish", "established", "support", "supports", "supporting", "against", "either", "outcome", "result", "results", "assessment", "finding", "findings", "uncertain", "uncertainty", "insufficient", "cannot", "doesnt", "doesn", "prove", "proves"]);
function factualTokens(value: string): string[] { return [...new Set((value.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((word) => word.length > 2 && !groundingStopWords.has(word)))]; }
function tokenForms(word: string): string[] {
  const forms = new Set([word]);
  for (const suffix of ["ing", "ed", "es", "s"]) if (word.length > suffix.length + 3 && word.endsWith(suffix)) {
    let stem = word.slice(0, -suffix.length);
    if (/(.)\1$/.test(stem)) stem = stem.slice(0, -1);
    forms.add(stem);
    if (stem.endsWith("e")) forms.add(stem.slice(0, -1));
    else forms.add(`${stem}e`);
  }
  return [...forms];
}
function explicitNoEvidence(value: string): boolean { return /\b(?:no|zero|none|without)\b.{0,45}\b(?:relevant\s+)?(?:evidence|sources?|records?)\b/i.test(value) || /\bno relevant (?:evidence|sources?|records?)\b/i.test(value); }
function claimSupportFailure(text: string, evidenceIds: string[], evidence: ResearchEvidence[], allowEmptyAssessment = false): string | null {
  if (!evidenceIds.length) return allowEmptyAssessment ? null : "claim had no evidence citations";
  const cited = evidence.filter((item) => evidenceIds.includes(item.id));
  const fixtureOutcomeClaim = /\b(?:beat|beats|beating|win|wins|winning|winner|victory|defeat|defeated|result|score|scores|fixture|match)\b/i.test(text);
  const namedTeams = text.match(/\b[A-Z][a-z]{2,}\b/g)?.filter((name) => !["The", "This", "That", "No", "Evidence", "Mira"].includes(name)) ?? [];
  if (fixtureOutcomeClaim && namedTeams.length >= 2 && cited.some((item) => item.eventRelevance !== undefined) && !cited.some((item) => item.eventRelevance === "direct-fixture")) return "target-fixture claim cites contextual evidence only";
  const sourceText = cited.map((item) => `${item.title} ${item.claim ?? ""} ${item.summary ?? ""}`).join(" ").toLowerCase();
  const numbers = text.match(/\b\d+(?:[.,]\d+)?%?\b/g) ?? [];
  if (numbers.some((number) => !sourceText.includes(number.toLowerCase()))) return "claim contains a number or date absent from its cited evidence";
  const properNames = text.match(/\b[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})*/g) ?? [];
  const ignoredNames = new Set(["The", "This", "That", "These", "Those", "There", "Retrieved", "Available", "Based", "Evidence", "No", "A", "An", "In", "On", "As", "Mira"]);
  if (properNames.some((name) => {
    const entity = name.split(/\s+/).filter((part) => !ignoredNames.has(part)).join(" ");
    return Boolean(entity) && !sourceText.includes(entity.toLowerCase());
  })) return "claim contains a named entity absent from its cited evidence";
  const words = factualTokens(text);
  const sourceWords = new Set(factualTokens(sourceText).flatMap(tokenForms));
  const unsupportedWords = words.filter((word) => !tokenForms(word).some((form) => sourceWords.has(form)));
  const abstractLimit = /\b(?:insufficient|not enough|does not establish|do not establish|cannot determine|unclear|unknown|no relevant evidence)\b/i.test(text);
  if (unsupportedWords.length && !abstractLimit) return "claim contains factual terms absent from its cited evidence text";
  return null;
}

export function validateModelSynthesis(value: unknown, evidence: ResearchEvidence[]): ModelResearchSynthesis | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (modelSynthesisValidationFailure(value, evidence)) return null;
  const stances = ["favorable-yes", "mixed", "favorable-no", "insufficient"];
  if (typeof raw.stance !== "string" || !stances.includes(raw.stance)) return null;
  const ids = new Set(evidence.map((item) => item.id));
  const cleanIds = (input: unknown) => {
    if (!Array.isArray(input) || input.some((id) => typeof id !== "string" || !ids.has(id))) return null;
    return input.slice(0, 8) as string[];
  };
  const rows = (input: unknown) => Array.isArray(input) ? input.slice(0, 8) : [];
  const evidenceReviews = rows(raw.evidenceReviews).map((entry) => {
    if (!entry || typeof entry !== "object") return null;
    const row = entry as Record<string, unknown>;
    if (typeof row.evidenceId !== "string" || !ids.has(row.evidenceId)) return null;
    if (!["supports-yes", "supports-no", "neutral"].includes(String(row.direction)) || !["high", "medium", "low"].includes(String(row.relevance))) return null;
    const reasoning = safeLine(row.reasoning);
    return reasoning ? { evidenceId: row.evidenceId, direction: row.direction as ResearchEvidence["direction"], relevance: row.relevance as ResearchEvidence["relevance"], reasoning } : null;
  });
  const findingRows = (input: unknown) => rows(input).map((entry) => {
    if (!entry || typeof entry !== "object") return null;
    const row = entry as Record<string, unknown>;
    const text = safeLine(row.text); const evidenceIds = cleanIds(row.evidenceIds);
    if (!text || !evidenceIds?.length) return null;
    return { text, evidenceIds };
  });
  const summary = safeLine(raw.summary);
  const assessmentEvidenceIds = cleanIds(raw.assessmentEvidenceIds);
  const keyFindings = findingRows(raw.keyFindings);
  const whatChanged = findingRows(raw.whatChanged);
  const whatCouldChange = findingRows(raw.whatCouldChange);
  const uncertainties = findingRows(raw.uncertainties);
  if (!summary || !assessmentEvidenceIds) return null;
  return { summary, stance: raw.stance as ModelResearchSynthesis["stance"], assessmentEvidenceIds: assessmentEvidenceIds ?? [], evidenceReviews: evidenceReviews as ModelResearchSynthesis["evidenceReviews"], keyFindings: keyFindings as ModelResearchSynthesis["keyFindings"], whatChanged: whatChanged as ModelResearchSynthesis["whatChanged"], whatCouldChange: whatCouldChange as ModelResearchSynthesis["whatCouldChange"], uncertainties: uncertainties as ModelResearchSynthesis["uncertainties"] };
}

export function modelSynthesisValidationFailure(value: unknown, evidence: ResearchEvidence[]): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "response was not a JSON object";
  const raw = value as Record<string, unknown>;
  const required = ["summary", "stance", "assessmentEvidenceIds", "evidenceReviews", "keyFindings", "whatChanged", "whatCouldChange", "uncertainties"];
  const exactKeys = (row: Record<string, unknown>, keys: string[]) => Object.keys(row).length === keys.length && keys.every((key) => key in row);
  const missing = required.filter((key) => !(key in raw));
  if (missing.length) return `missing required field${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}`;
  if (!exactKeys(raw, required)) return "response contained unexpected fields or a wrapper";
  if (typeof raw.stance !== "string" || !["favorable-yes", "mixed", "favorable-no", "insufficient"].includes(raw.stance)) return "stance used an unsupported value";
  const validIds = new Set(evidence.map((item) => item.id));
  const isEventEvidence = evidence.some((item) => item.eventRelevance !== undefined);
  if (raw.stance !== "insufficient" && isEventEvidence && !evidence.some((item) => item.eventRelevance === "direct-fixture")) return "assessment uses context-only sources to make a target-event assessment";
  if (!Array.isArray(raw.assessmentEvidenceIds)) return "assessmentEvidenceIds was not an array";
  if (raw.assessmentEvidenceIds.length > 8) return "assessmentEvidenceIds exceeded the supported citation limit";
  if (raw.assessmentEvidenceIds.some((id) => typeof id !== "string" || !validIds.has(id))) return "assessment cited an evidence ID that was not supplied";
  const assessmentIds = raw.assessmentEvidenceIds as string[];
  const emptyAssessmentIsLegitimate = raw.stance === "insufficient" && explicitNoEvidence(String(raw.summary)) && !evidence.length;
  if (!assessmentIds.length && raw.stance !== "insufficient") return "assessment had no evidence citations";
  if (!assessmentIds.length && raw.stance === "insufficient" && evidence.length && !explicitNoEvidence(String(raw.summary))) return "assessment had no evidence citations for its claim";
  const assessmentGroundingFailure = claimSupportFailure(String(raw.summary ?? ""), assessmentIds, evidence, emptyAssessmentIsLegitimate || (raw.stance === "insufficient" && explicitNoEvidence(String(raw.summary))));
  if (assessmentGroundingFailure) return `assessment ${assessmentGroundingFailure}`;
  for (const key of ["keyFindings", "whatChanged", "whatCouldChange", "uncertainties"]) {
    if (!Array.isArray(raw[key])) return `${key} was not an array`;
    if ((raw[key] as unknown[]).length > 8) return `${key} exceeded the supported item limit`;
    for (const entry of raw[key] as unknown[]) {
      if (!entry || typeof entry !== "object") return `${key} contained a malformed row`;
      const row = entry as Record<string, unknown>;
      if (!exactKeys(row, ["text", "evidenceIds"])) return `${key} contained unexpected or missing row fields`;
      if (!safeLine(row.text)) return `${key} contained an empty or invalid text field`;
      if (!Array.isArray(row.evidenceIds)) return `${key} contained malformed evidence IDs`;
      if (row.evidenceIds.length > 8) return `${key} exceeded the supported citation limit`;
      if (row.evidenceIds.some((id) => typeof id !== "string" || !validIds.has(id))) return `${key} cited an evidence ID that was not supplied`;
      if (row.evidenceIds.length === 0) return `${key} contained a claim without evidence citations`;
      const groundingFailure = claimSupportFailure(String(row.text), row.evidenceIds as string[], evidence);
      if (groundingFailure) return `${key} ${groundingFailure}`;
    }
  }
  if (typeof raw.summary !== "string" || !raw.summary.trim()) return "summary was empty or not a string";
  if (!Array.isArray(raw.evidenceReviews)) return "evidenceReviews was not an array";
  if (raw.evidenceReviews.length > 8) return "evidenceReviews exceeded the supported item limit";
  for (const entry of raw.evidenceReviews) {
    if (!entry || typeof entry !== "object") return "evidenceReviews contained a malformed row";
    const row = entry as Record<string, unknown>;
    if (!exactKeys(row, ["evidenceId", "direction", "relevance", "reasoning"])) return "evidenceReviews contained unexpected or missing row fields";
    if (typeof row.evidenceId !== "string" || !validIds.has(row.evidenceId)) return "evidenceReviews cited an evidence ID that was not supplied";
    if (!safeLine(row.reasoning) || !["supports-yes", "supports-no", "neutral"].includes(String(row.direction)) || !["high", "medium", "low"].includes(String(row.relevance))) return "evidenceReviews contained invalid direction, relevance, or reasoning";
    const sourceRelevance = evidence.find((item) => item.id === row.evidenceId)?.relevance;
    const relevanceRank = { low: 0, medium: 1, high: 2 };
    if (sourceRelevance && relevanceRank[row.relevance as keyof typeof relevanceRank] > relevanceRank[sourceRelevance]) return "evidenceReviews attempted to upgrade source relevance";
  }
  return null;
}

export async function synthesizeWithModelDetailed(input: { market: Market; evidence: ResearchEvidence[]; marketImpliedProbability: number | null; priorUrls: string[] }): Promise<{ synthesis: ModelResearchSynthesis | null; failureReason: string | null }> {
  if (!input.evidence.length) return { synthesis: null, failureReason: "No evidence passed synthesis screening" };
  const evidenceIdMap = new Map(input.evidence.map((item, index) => [`E${index + 1}`, item.id]));
  const modelEvidence = input.evidence.map((item, index) => ({ ...item, id: `E${index + 1}` }));
  const sourceFacts = modelEvidence.map(({ id, title, domain, url, publishedAt, retrievedAt, summary, reliability, relevance, pageRetrieved, direction, sourceType, reliabilityReason, eventRelevance }) => ({ id, title, domain, url, publishedAt, retrievedAt, summary, reliability, reliabilityReason, relevance, direction, sourceType, eventRelevance, retrievalStatus: pageRetrieved ? "page-retrieved" : "search-result-snippet-only", pageRetrieved }));
  const inputData = {
    market: { question: input.market.question, definition: input.market.description, category: input.market.category, status: input.market.status, yesQuoteUsdPerShare: input.marketImpliedProbability, noQuoteUsdPerShare: input.market.noProbability, volumeUsd: input.market.volumeUsd, closeAt: input.market.closeAt, source: input.market.source },
    previousSourceUrls: input.priorUrls,
    retrievedSources: sourceFacts,
  };
  let failureReason: string | null = null;
  const synthesis = await synthesizeResearchJson({ data: inputData, schema, validationFailure: (value) => modelSynthesisValidationFailure(value, modelEvidence), onFailure: (reason) => { failureReason = reason; }, validate: (value) => {
    const synthesis = validateModelSynthesis(value, modelEvidence);
    if (!synthesis) return null;
    const toStoredIds = (ids: string[]) => ids.map((id) => evidenceIdMap.get(id)).filter((id): id is string => Boolean(id));
    return {
      ...synthesis,
      assessmentEvidenceIds: toStoredIds(synthesis.assessmentEvidenceIds),
      evidenceReviews: synthesis.evidenceReviews.flatMap((item) => { const evidenceId = evidenceIdMap.get(item.evidenceId); return evidenceId ? [{ ...item, evidenceId }] : []; }),
      keyFindings: synthesis.keyFindings.map((item) => ({ ...item, evidenceIds: toStoredIds(item.evidenceIds) })),
      whatChanged: synthesis.whatChanged.map((item) => ({ ...item, evidenceIds: toStoredIds(item.evidenceIds) })),
      whatCouldChange: synthesis.whatCouldChange.map((item) => ({ ...item, evidenceIds: toStoredIds(item.evidenceIds) })),
      uncertainties: synthesis.uncertainties.map((item) => ({ ...item, evidenceIds: toStoredIds(item.evidenceIds) })),
    };
  } });
  return { synthesis, failureReason };
}
