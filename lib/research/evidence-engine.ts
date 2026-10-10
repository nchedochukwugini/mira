import type { EventEvidenceRelevance, PlannedResearchQuery, ReadPageResult, ResearchEvidence, SearchResult } from "./types";
import { assessSource } from "./source-evaluator";

function firstSentence(content: string): string {
  const clean = content.replace(/[#*_`>\[\]()]/g, " ").replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim();
  const sentences = clean.split(/(?<=[.!?])\s+/).filter((item) => item.length > 35);
  return (sentences[0] ?? clean).slice(0, 420);
}
function evidenceKind(domain: string, content: string): ResearchEvidence["evidenceType"] {
  if (/\.gov(?:\.|$)|\.gov\.uk$|federalreserve\.gov|sec\.gov|cftc\.gov|ecb\.europa\.eu/.test(domain)) return "official";
  return /analysis|outlook|opinion|forecast|commentary/i.test(content) ? "analysis" : "reporting";
}
function determineDirection(content: string, side: PlannedResearchQuery["side"]): { direction: ResearchEvidence["direction"], reasoning?: string } {
  const text = content.toLowerCase();
  const positiveSignal = /\b(rises?|increases?|surges?|wins?|passes?|approved?|reaches?|hits?|exceeds?|beats?|leads?|qualifies?|inflows?|record high|strong demand|above target)\b/.test(text);
  const negativeSignal = /\b(falls?|drops?|declines?|loses?|fails?|rejects?|misses?|below target|outflows?|downside|bearish|risk|risks|resistance|injur(?:y|ies)|suspended|trails?)\b/.test(text);
  if (positiveSignal && negativeSignal) return { direction: "neutral", reasoning: "Retrieved text contains both positive and negative indicators; direction is treated as conflicting." };
  if (side === "yes" && positiveSignal) return { direction: "supports-yes", reasoning: "Text includes positive indicators relevant to a supporting-evidence search; this is a screening label, not causal proof." };
  if (side === "no" && negativeSignal) return { direction: "supports-no", reasoning: "Text includes risk or negative indicators relevant to an opposing-evidence search; this is a screening label, not causal proof." };
  if (side === "yes" && negativeSignal) return { direction: "supports-no", reasoning: "Text includes negative indicators in a supporting-evidence query; retained as counterevidence." };
  if (side === "no" && positiveSignal) return { direction: "supports-yes", reasoning: "Text includes positive indicators in an opposing-evidence query; retained as counterevidence." };
  return { direction: "neutral" };
}

const stopWords = new Set(["will", "would", "does", "the", "united", "city", "football", "club", "beat", "win", "match", "game", "versus", "against", "on", "at", "in", "by", "october", "november", "december", "january", "february", "march", "april", "may", "june", "july", "august", "september"]);
function eventTeams(question: string): [string[], string[]] | null {
  const match = question.match(/\b(?:will\s+)?(.+?)\s+(?:beat|play|face|versus|vs\.?|against)\s+(.+?)(?:\s+(?:on|in|at)\s+|[?.]|$)/i);
  if (!match?.[1] || !match[2]) return null;
  const tokens = (value: string) => value.toLowerCase().match(/[a-z0-9]+/g)?.filter((word) => word.length > 2 && !stopWords.has(word)) ?? [];
  const left = tokens(match[1]); const right = tokens(match[2]);
  return left.length && right.length ? [left, right] : null;
}
function targetDate(question: string): { month: string; day: string; year?: string } | null {
  const match = question.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?[,]?\s*(\d{4})?\b/i)
    ?? question.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december)[,]?\s*(\d{4})?\b/i);
  if (!match) return null;
  const month = (match[1]?.match(/[a-z]/i) ? match[1] : match[2])?.toLowerCase();
  const day = (match[1]?.match(/[a-z]/i) ? match[2] : match[1])?.replace(/^0/, "");
  const year = match[3];
  return month && day ? { month, day, ...(year ? { year } : {}) } : null;
}
function classifyEventRelevance(question: string, content: string, marketDescription = ""): EventEvidenceRelevance | undefined {
  const teams = eventTeams(question);
  if (!teams) return undefined;
  const text = content.toLowerCase();
  const hasTeam = (tokens: string[]) => tokens.some((token) => new RegExp(`\\b${token}\\b`, "i").test(text));
  const firstPresent = hasTeam(teams[0]); const secondPresent = hasTeam(teams[1]);
  if (!firstPresent && !secondPresent) return "unrelated";
  if (!(firstPresent && secondPresent)) return "contextual";

  const date = targetDate(question);
  const monthNumber = date ? String(["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"].indexOf(date.month) + 1) : "";
  const datePattern = date && new RegExp(`\\b(?:${date.month}|${date.month.slice(0, 3)})\\s+0?${date.day}(?:st|nd|rd|th)?(?:,?\\s*${date.year ?? "\\d{4}"})?\\b|\\b0?${date.day}\\s+(?:${date.month}|${date.month.slice(0, 3)})(?:,?\\s*${date.year ?? "\\d{4}"})?\\b|\\b0?${date.day}[/.\\-]0?${monthNumber}(?:[/.\\-]${date.year ?? "\\d{4}"})?\\b|\\b${date.year ?? "\\d{4}"}[/.\\-]0?${monthNumber}[/.\\-]0?${date.day}\\b`, "i");
  const explicitTargetDate = Boolean(datePattern?.test(text));
  const explicitConflictDate = Boolean(date && /\b(?:last season|previous meeting|previous match|last meeting|last match|replay|highlights|202[0-5])\b/i.test(text) && !explicitTargetDate);
  const priorFixture = /\b(?:last season|previous meeting|previous match|last meeting|last match|replay|highlights|won .* in \d{4}|\d{4}.*(?:beat|defeat|win))\b/i.test(text);
  const competition = `${question} ${marketDescription}`.match(/\b(premier league|champions league|fa cup|carabao cup|league cup|championship|euro(?:pa)? league)\b/i)?.[1];
  const competitionConflict = competition && /\b(premier league|champions league|fa cup|carabao cup|league cup|championship|euro(?:pa)? league)\b/i.test(text)
    && !new RegExp(`\\b${competition.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\b`, "i").test(text);
  const targetFixtureSentence = date && content.split(/[.!?\n]+/).some((sentence) => {
    const sentenceHasTeams = teams.every((team) => team.some((token) => new RegExp(`\\b${token}\\b`, "i").test(sentence)));
    return sentenceHasTeams && datePattern?.test(sentence) === true && /\b(?:beat|play|face|versus|vs\.?|against|host|clash|fixture|match|meet)\b/i.test(sentence);
  });
  if (!competitionConflict && explicitTargetDate && targetFixtureSentence) return "direct-fixture";
  if (priorFixture || explicitConflictDate || competitionConflict) return "contextual";
  // Names alone (even both names) do not identify which fixture is discussed.
  return "contextual";
}

export function buildEvidence(input: { marketQuestion: string; marketDescription?: string | null; marketCategory?: string | null; results: SearchResult[]; pages: ReadPageResult[]; plannedQueries: PlannedResearchQuery[] }): ResearchEvidence[] {
  const pageByUrl = new Map(input.pages.map((page) => [page.url, page]));
  const sideByQuery = new Map(input.plannedQueries.map((item) => [item.query, item.side]));
  const seen = new Set<string>();
  const contentKeys = new Set<string>();
  return input.results.flatMap((result) => {
    if (seen.has(result.url)) return [];
    seen.add(result.url);
    const page = pageByUrl.get(result.url);
    const inspectedContent = page?.retrieved ? page.content : result.content;
    const researchQuestion = `${input.marketQuestion} ${input.marketDescription ?? ""}`.trim();
    const assessment = assessSource({ ...result, content: inspectedContent }, researchQuestion, result.query);
    const eventRelevance = input.marketCategory?.toLowerCase() === "sports" || eventTeams(input.marketQuestion)
      ? classifyEventRelevance(input.marketQuestion, `${result.title} ${inspectedContent}`, input.marketDescription ?? "")
      : undefined;
    const side = sideByQuery.get(result.query) ?? "neutral";
    const signal = determineDirection(`${result.title} ${inspectedContent}`, side);
    if (eventRelevance !== undefined && eventRelevance !== "direct-fixture") signal.direction = "neutral";
    const timestamp = page?.retrievedAt ?? new Date().toISOString();
    const publishedAt = page?.publishedAt ?? result.publishedAt;
    const publishedAtPrecision = page?.publishedAt ? page.publishedAtPrecision : result.publishedAtPrecision;
    const publishedMs = publishedAt ? Date.parse(publishedAt) : NaN;
    const ageDays = Number.isFinite(publishedMs) ? Math.max(0, (Date.now() - publishedMs) / 86_400_000) : null;
    const summary = firstSentence(inspectedContent);
    const contentKey = `${result.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}|${summary.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}`;
    const duplicate = contentKeys.has(contentKey);
    contentKeys.add(contentKey);
    return [{
      id: `${assessment.domain}:${result.url}`,
      claim: summary,
      summary: page?.retrieved ? summary : `${summary} (Search result text only; source page retrieval failed.)`,
      title: result.title,
      source: assessment.domain,
      domain: assessment.domain,
      url: result.url,
      publishedAt,
      ...(publishedAtPrecision ? { publishedAtPrecision } : {}),
      retrievedAt: timestamp,
      direction: signal.direction,
      ...(eventRelevance ? { eventRelevance } : {}),
      relevance: assessment.relevance,
      reliability: assessment.reliability,
      sourceTier: assessment.tier,
      reliabilityReason: assessment.reason,
      sourceType: assessment.sourceType,
      independenceStatus: duplicate ? "duplicate-content" : "unknown",
      usageStatus: duplicate || eventRelevance === "unrelated" ? "excluded" : !page?.retrieved || assessment.reliability === "low" || assessment.relevance === "low" || eventRelevance === "contextual" ? "context-only" : "used",
      usageReason: duplicate ? "Matching title and extracted text were already represented; retained as a duplicate, not an independent source." : eventRelevance === "unrelated" ? "The source does not establish a relationship to the target fixture." : eventRelevance === "contextual" ? "The source may provide team or competition context but does not identify the exact target fixture." : !page?.retrieved ? "Only search-result text is available; retained as a lead, not full-page evidence." : assessment.reliability === "low" ? "Publisher provenance was not established strongly enough for synthesis." : assessment.relevance === "low" ? "The retrieved page did not directly address the research subject." : "Full-page content passed the current source reliability and relevance screening.",
      evidenceType: evidenceKind(assessment.domain, inspectedContent),
      ...(signal.reasoning ? { reasoning: signal.reasoning } : {}),
      pageRetrieved: Boolean(page?.retrieved),
      freshness: ageDays === null ? "undated" : ageDays <= 2 ? "fresh" : ageDays <= 14 ? "recent" : "stale",
    }];
  });
}
