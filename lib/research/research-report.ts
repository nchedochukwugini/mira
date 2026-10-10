import "server-only";
import type { Market, MarketProvider } from "@/lib/panta/types";
import { semanticRelevance } from "@/lib/intelligence/core";
import { getSpotPrice } from "@/lib/markets/spot-price";
import { buildEvidence } from "./evidence-engine";
import { retrievePages } from "./page-reader";
import { createResearchPlan } from "./research-planner";
import { getCachedResearch, researchCacheKey, setCachedResearch } from "./research-cache";
import { getResearchSearchProvider, hasResearchSearchProvider } from "./web-search";
import { synthesizeResearch } from "./research-synthesizer";
import { synthesizeWithModelDetailed } from "./ai-synthesizer";
import { synthesizeEventExplanation } from "./event-synthesizer";
import { getAIConfig } from "@/lib/ai";
import { isResolvedMarket } from "./market-status";
import type { ResearchDepth, ResearchEvidence, ResearchReport } from "./types";
import { buildEventIntelligence, type PriorEvidence } from "./event-intelligence";

function targetFrom(question: string): number | null {
  const match = question.match(/\$\s*(\d[\d,.]*)(\s?[km])?/i);
  if (!match?.[1]) return null;
  const base = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(base)) return null;
  const suffix = match[2]?.trim().toLowerCase();
  return base * (suffix === "k" ? 1_000 : suffix === "m" ? 1_000_000 : 1);
}

async function chooseMarket(input: { query: string; marketId?: string; contextMarkets: Array<Pick<Market, "id" | "question">>; provider: MarketProvider; signal?: AbortSignal }): Promise<Market | null> {
  const topicTerms = (input.query.toLowerCase().match(/[a-z0-9]+/g) ?? [])
    .filter((term) => term.length > 2 && !["latest", "developments", "about", "what", "happening", "research", "market", "prediction"].includes(term));
  const wanted = input.marketId
    ? input.contextMarkets.find((item) => item.id === input.marketId)
    : input.contextMarkets
      .map((item) => {
        const marketText = item.question.toLowerCase();
        const matched = topicTerms.filter((term) => new RegExp(`\\b${term}\\b`).test(marketText)).length;
        return { item, score: topicTerms.length ? matched / topicTerms.length : 0 };
      })
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)[0]?.item;
  if (input.marketId && !wanted) {
    const exact = await input.provider.getMarket(input.marketId, input.signal).catch((error) => { if (input.signal?.aborted) throw error; return null; });
    if (exact) return exact;
  }
  if (wanted) {
    const full = await input.provider.getMarket(wanted.id, input.signal).catch((error) => { if (input.signal?.aborted) throw error; return null; });
    if (full) return full;
  }
  // A general topic question is not a request to attach whichever old
  // contract happens to share an asset/team name. Only contract-shaped
  // questions may discover a market without an explicit market selection.
  if (!/^\s*(?:will|whether|does|do|is|are)\b/i.test(input.query)) return null;
  const candidates = await input.provider.discoverMarkets(input.query, input.signal).catch((error) => { if (input.signal?.aborted) throw error; return []; });
  const ranked = candidates.map((candidate) => ({ candidate, score: semanticRelevance(input.query, candidate) }))
    .filter(({ score }) => score >= 0.35)
    .sort((a, b) => b.score - a.score);
  if (!ranked[0]) return null;
  return await input.provider.getMarket(ranked[0].candidate.id, input.signal).catch((error) => { if (input.signal?.aborted) throw error; return ranked[0].candidate; });
}

function unavailableReport(input: { market: Market | null; depth: ResearchDepth; query: string; plan: ReturnType<typeof createResearchPlan> | null; message: string; status: "unavailable" | "limited"; refreshed: boolean }): ResearchReport {
  const now = new Date().toISOString();
  const report: ResearchReport = {
    market: input.market, relatedMarkets: [], depth: input.depth, researchedAt: now, refreshed: input.refreshed,
    conclusion: input.message, marketImpliedProbability: input.market?.source === "panta" && input.market.status !== "resolved" ? input.market.yesProbability : null,
    evidence: [], uncertainty: [input.message, "Panta market context is shown separately; no web evidence was generated."],
    queries: input.plan?.queries.map((item) => item.query) ?? [], plan: input.plan, keyFindings: [], whatChanged: [], whatCouldChange: [],
    assessment: { stance: "insufficient", explanation: input.message }, status: input.status,
    searchStatus: input.status === "unavailable" ? "missing-key" : "failed", searchMessage: input.message,
    synthesisMode: "deterministic", synthesisMessage: "No source-backed model synthesis was produced.",
    marketMetrics: { providerUpdatedAt: input.market?.updatedAt ?? null, observedAt: now, spotPriceUsd: null, spotRetrievedAt: null, targetPriceUsd: input.market ? targetFrom(input.market.question) : targetFrom(input.query), distanceToTargetPercent: null, timeRemainingMs: input.market?.closeAt ? Date.parse(input.market.closeAt) - Date.now() : null },
  };
  if (input.market) report.eventIntelligence = buildEventIntelligence({ query: input.query, market: input.market, evidence: [], researchedAt: now });
  return report;
}

export async function runResearch(input: {
  question: string;
  contextMarkets: Array<Pick<Market, "id" | "question">>;
  provider: MarketProvider;
  marketId?: string;
  depth?: ResearchDepth;
  refresh?: boolean;
  priorEvidence?: PriorEvidence[];
  priorResearchAt?: string;
  signal?: AbortSignal;
}): Promise<ResearchReport> {
  const depth = input.depth ?? (/\bquick\b/i.test(input.question) ? "quick" : /\b(full|comprehensive|go deeper)\b/i.test(input.question) ? "full" : "deep");
  if (input.signal?.aborted) throw new DOMException("Research request was cancelled.", "AbortError");
  const market = await chooseMarket({ ...input, query: input.question });
  if (input.signal?.aborted) throw new DOMException("Research request was cancelled.", "AbortError");
  const resolvedMarket = market ? isResolvedMarket(market.status) : false;
  const cacheKey = researchCacheKey({ marketId: market?.id ?? "topic-research", depth, query: input.question });
  if (!input.refresh) {
    const cached = getCachedResearch(cacheKey);
    if (cached) return { ...cached, market, refreshed: false };
  }
  const basePlan = createResearchPlan({ query: input.question, market, depth });
  const last24Hours = /\b(last 24 hours?|past 24 hours?|last day)\b/i.test(input.question);
  let plan = last24Hours ? { ...basePlan, queries: basePlan.queries.map((item) => ({ ...item, recencyDays: 1 })) } : basePlan;
  if (plan.timeWindow?.label === "since-previous-run" && input.priorResearchAt && Number.isFinite(Date.parse(input.priorResearchAt))) {
    const elapsedDays = Math.max(1, Math.ceil((Date.now() - Date.parse(input.priorResearchAt)) / 86_400_000));
    const since = new Date(input.priorResearchAt).toISOString().slice(0, 10);
    plan = { ...plan, timeWindow: { ...plan.timeWindow, from: new Date(input.priorResearchAt).toISOString() }, queries: plan.queries.map((item) => ({ ...item, query: `${item.query} since ${since}`, recencyDays: Math.min(30, elapsedDays) })) };
  }
  const search = getResearchSearchProvider();
  if (!hasResearchSearchProvider()) return unavailableReport({ market, depth, query: input.question, plan, message: "Live web research is unavailable because TAVILY_API_KEY is not configured on the server. Panta market data remains separate.", status: "unavailable", refreshed: Boolean(input.refresh) });

  const responses = await Promise.all(plan.queries.map((item) => search.search({ query: item.query, depth, recencyDays: item.recencyDays, maxResults: depth === "quick" ? 3 : 4, signal: input.signal })));
  if (input.signal?.aborted) throw new DOMException("Research request was cancelled.", "AbortError");
  const results = responses.flatMap((response) => response.results);
  console.info("[MIRA research] search stage", JSON.stringify({ plannedQueries: plan.queries.length, responses: responses.length, results: results.length, successfulResponses: responses.filter((response) => response.status === "ok").length }));
  const searchFailed = responses.every((response) => response.status !== "ok");
  if (!results.length) {
    const message = responses.find((response) => response.message)?.message ?? `Tavily returned no matching external sources for ${market ? "this market" : "this topic"}.`;
    return unavailableReport({ market, depth, query: input.question, plan, message, status: searchFailed ? "limited" : "unavailable", refreshed: Boolean(input.refresh) });
  }

  const uniqueResults = [...new Map(results.map((result) => [result.url, result])).values()];
  const ordered = uniqueResults.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const limit = depth === "quick" ? 7 : depth === "full" ? 24 : 16;
  const selected = ordered.slice(0, limit);
  const researchSubject = market?.question ?? input.question;
  const pages = await retrievePages(selected, researchSubject, input.signal);
  if (input.signal?.aborted) throw new DOMException("Research request was cancelled.", "AbortError");
  let evidence = buildEvidence({ marketQuestion: researchSubject, marketDescription: market?.description, marketCategory: market?.category, results: selected, pages, plannedQueries: plan.queries });
  const logEvaluation = (stage: string, items: ResearchEvidence[], pageResults: typeof pages) => {
    const pageByUrl = new Map(pageResults.map((page) => [page.url, page]));
    console.info(`[MIRA research] ${stage} evaluation`, JSON.stringify({
      searched: items.length,
      pagesRetrieved: pageResults.filter((page) => page.retrieved).length,
      acceptedForSynthesis: items.filter((item) => item.independenceStatus !== "duplicate-content" && item.eventRelevance !== "unrelated" && item.reliability !== "low" && item.relevance !== "low").length,
      sources: items.map((item) => {
        const reasons = [
          ...(item.relevance === "low" ? ["relevance"] : []),
          ...(item.reliability === "low" ? ["reliability"] : []),
          ...(item.independenceStatus === "duplicate-content" ? ["duplicate"] : []),
          ...(item.eventRelevance === "unrelated" ? ["unrelated-to-target-event"] : []),
          ...(item.eventRelevance === "contextual" ? ["context-only-not-exact-fixture"] : []),
          ...(!pageByUrl.get(item.url)?.retrieved ? ["retrieval-failed:snippet-only"] : []),
        ];
        const rejected = item.independenceStatus === "duplicate-content" || item.eventRelevance === "unrelated" || item.reliability === "low" || item.relevance === "low";
        const contextOnly = !pageByUrl.get(item.url)?.retrieved || item.eventRelevance === "contextual";
        return { title: item.title, domain: item.domain, disposition: rejected ? "rejected" : contextOnly ? "context-only" : "accepted", reasons };
      }),
    }));
  };
  logEvaluation("initial", evidence, pages);
  // One bounded, application-controlled follow-up search can fill a missing
  // directional side when the first evidence pass supports only YES or NO.
  // It never repeats a tool call and all results go through the same evidence
  // and citation validation path as the initial searches.
  const supported = (side: "yes" | "no") => evidence.some((item) => item.direction === (side === "yes" ? "supports-yes" : "supports-no")
    && item.pageRetrieved && item.independenceStatus !== "duplicate-content" && item.reliability !== "low" && item.relevance !== "low");
  const missingSide = !resolvedMarket && market && supported("yes") !== supported("no")
    ? supported("yes") ? "no" as const : "yes" as const
    : null;
  if (missingSide) {
    const sideLabel = missingSide === "yes" ? "supporting YES" : "supporting NO";
    const query = `${researchSubject} ${sideLabel} evidence independent reporting`;
    const supplemental = await search.search({ query, depth, recencyDays: last24Hours ? 1 : 14, maxResults: depth === "quick" ? 3 : 4, signal: input.signal });
    if (input.signal?.aborted) throw new DOMException("Research request was cancelled.", "AbortError");
    responses.push(supplemental);
    const supplementalPlan = { query, dimension: `adaptive evidence gap: ${sideLabel}`, side: missingSide, recencyDays: last24Hours ? 1 : 14 };
    plan = { ...plan, queries: [...plan.queries, supplementalPlan] };
    const knownUrls = new Set(selected.map((item) => item.url));
    const supplementalResults = supplemental.results.filter((item) => !knownUrls.has(item.url)).slice(0, depth === "quick" ? 3 : 4);
    if (supplementalResults.length) {
      const supplementalPages = await retrievePages(supplementalResults, researchSubject, input.signal);
      if (input.signal?.aborted) throw new DOMException("Research request was cancelled.", "AbortError");
      const supplementalEvidence = buildEvidence({ marketQuestion: researchSubject, marketDescription: market?.description, marketCategory: market?.category, results: supplementalResults, pages: supplementalPages, plannedQueries: [supplementalPlan] });
      evidence = [...evidence, ...supplementalEvidence];
      selected.push(...supplementalResults);
      pages.push(...supplementalPages);
    }
  }
  const marketImpliedProbability = !resolvedMarket && market?.source === "panta" && market.yesProbability !== null && market.yesProbability >= 0 && market.yesProbability <= 1 ? market.yesProbability : null;
  const inputText = `${market?.question ?? input.question} ${market?.category ?? ""}`.toLowerCase();
  const spotAsset = /bitcoin|\bbtc\b/.test(inputText) ? "BTC" : /ethereum|\beth\b/.test(inputText) ? "ETH" : null;
  const [spotPriceUsd] = spotAsset && !resolvedMarket ? await Promise.all([getSpotPrice(spotAsset)]) : [null];
  const researchedAt = new Date().toISOString();
  const targetPriceUsd = targetFrom(market?.question ?? input.question);
  const deterministic = synthesizeResearch({ market, evidence, priorEvidence: input.priorEvidence, refreshed: Boolean(input.refresh), marketImpliedProbability });
  const eventResearch = (basePlan.researchTypes ?? []).some((type) => ["latest-update", "event-timeline", "event-change", "source-verification", "contradiction-check", "market-impact-context"].includes(type));
  // A useful Tavily snippet remains citable as a snippet when extraction
  // fails. Its retrieval limit is carried into the prompt and report.
  const synthesisEvidence = evidence.filter((item) => item.independenceStatus !== "duplicate-content" && item.eventRelevance !== "unrelated" && item.reliability !== "low" && item.relevance !== "low");
  const synthesisAttempt = !market || resolvedMarket || eventResearch ? null : await synthesizeWithModelDetailed({ market, evidence: synthesisEvidence, marketImpliedProbability, priorUrls: (input.priorEvidence ?? []).map((item) => item.url) });
  const modelSynthesis = synthesisAttempt?.synthesis ?? null;
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  // Model reviews may be displayed as explanation, but they cannot promote a
  // source past deterministic reliability, relevance, or fixture screening.
  logEvaluation("final", evidence, pages);
  for (const item of evidence) {
    item.usageStatus = item.independenceStatus === "duplicate-content" || item.eventRelevance === "unrelated" ? "excluded" : !item.pageRetrieved || item.reliability === "low" || item.relevance === "low" || item.eventRelevance === "contextual" ? "context-only" : "used";
    item.usageReason = item.independenceStatus === "duplicate-content" ? "Matching title and extracted text were already represented; retained as a duplicate, not an independent source." : item.eventRelevance === "unrelated" ? "The source does not establish a relationship to the target fixture." : item.eventRelevance === "contextual" ? "The source provides context but does not establish facts about the exact target fixture." : !item.pageRetrieved ? "Only search-result text is available; retained as a lead, not full-page evidence." : item.reliability === "low" ? "Publisher provenance was not established strongly enough for synthesis." : item.relevance === "low" ? "The retrieved page did not directly address the research subject." : "Full-page content passed the current source reliability and relevance screening.";
  }
  const cite = (ids: string[]) => ids.map((id) => evidenceById.get(id)).filter((item): item is ResearchEvidence => Boolean(item)).map((item) => item.title);
  const synthesis = modelSynthesis ? {
    ...deterministic,
    conclusion: `${modelSynthesis.summary}${cite(modelSynthesis.assessmentEvidenceIds).length ? ` [Evidence: ${cite(modelSynthesis.assessmentEvidenceIds).join("; ")}]` : ""} ${marketImpliedProbability === null ? "Panta did not provide a usable YES quote." : `Panta reports a normalized YES quote of $${marketImpliedProbability.toFixed(2)} per share; this is market data, not a MIRA forecast or proof of the event's likelihood.`}`,
    assessment: { stance: modelSynthesis.stance, explanation: modelSynthesis.summary },
    keyFindings: modelSynthesis.keyFindings.map((item) => `${item.text} [Evidence: ${cite(item.evidenceIds).join("; ")}]`),
    whatChanged: modelSynthesis.whatChanged.length ? modelSynthesis.whatChanged.map((item) => `${item.text} [Evidence: ${cite(item.evidenceIds).join("; ")}]`) : deterministic.whatChanged,
    whatCouldChange: modelSynthesis.whatCouldChange.length ? modelSynthesis.whatCouldChange.map((item) => `${item.text}${item.evidenceIds.length ? ` [Evidence: ${cite(item.evidenceIds).join("; ")}]` : ""}`) : deterministic.whatCouldChange,
    uncertainty: [...new Set([...deterministic.uncertainty, ...modelSynthesis.uncertainties.map((item) => `${item.text}${item.evidenceIds.length ? ` [Evidence: ${cite(item.evidenceIds).join("; ")}]` : ""}`)])],
  } : deterministic;
  const relatedMarkets = market ? await input.provider.discoverMarkets(market.question).then((items) => items.filter((item) => item.id !== market.id && semanticRelevance(market.question, item) >= 0.2).slice(0, 4)).catch(() => []) : [];
  const uncertainty = [
    ...synthesis.uncertainty,
    ...(input.provider.source === "demo" ? ["Market context is demo fixture data and does not represent a live Panta market quote."] : []),
    ...(market?.closeAt && Date.parse(market.closeAt) < Date.now() ? ["Panta returned a close time in the past; treat its current status and prices cautiously."] : []),
    ...(!market ? ["No matching Panta contract was selected; this report contains general topic research only."] : []),
  ];
  const historicalNotice = "This market is resolved. Retrieved sources provide historical context only; they do not establish a current probability or trading opportunity.";
  const report: ResearchReport = {
    market, providerEnvironment: input.provider.environment ?? "unknown", relatedMarkets, depth, researchedAt, refreshed: Boolean(input.refresh), conclusion: resolvedMarket ? `${historicalNotice} ${synthesis.conclusion}` : synthesis.conclusion,
    marketImpliedProbability, evidence, uncertainty: resolvedMarket ? [...uncertainty, "No current directional assessment or spot-price comparison is made for a resolved market."] : uncertainty, queries: plan.queries.map((item) => item.query), plan,
    keyFindings: synthesis.keyFindings, whatChanged: synthesis.whatChanged, whatCouldChange: resolvedMarket ? ["This contract has resolved; its final outcome cannot change through future market movement."] : synthesis.whatCouldChange, assessment: resolvedMarket ? { stance: "insufficient", explanation: historicalNotice } : synthesis.assessment,
    status: resolvedMarket ? "limited" : !market || responses.some((response) => response.status !== "ok") || evidence.some((item) => !item.pageRetrieved) ? "partial" : evidence.length >= 3 && evidence.some((item) => item.pageRetrieved && item.reliability !== "low" && item.relevance !== "low") && synthesis.assessment.stance !== "insufficient" ? "complete" : "limited",
    searchStatus: responses.some((response) => response.status !== "ok") ? results.length ? "partial" : "failed" : "available",
    searchMessage: responses.some((response) => response.status !== "ok") ? [...new Set(responses.flatMap((response) => response.message ? [response.message] : []))].join(" ") : undefined,
    synthesisMode: modelSynthesis ? "model" : "deterministic",
    synthesisMessage: resolvedMarket ? "Groq directional synthesis and current spot-price comparison are disabled for resolved markets." : !market ? "No matching Panta contract was found. This is general topic research, using deterministic evidence screening." : modelSynthesis ? undefined : eventResearch ? "Directional assessment is deterministic; the grounded event explanation is reported separately." : synthesisAttempt?.failureReason ? `Groq synthesis failed (${synthesisAttempt.failureReason}); this report uses deterministic evidence screening.` : getAIConfig().configured ? "Groq synthesis was not attempted; this report uses deterministic evidence screening." : "Conversational AI is in limited mode because GROQ_API_KEY is not configured. This report uses MIRA's deterministic evidence screening.",
    marketMetrics: { providerUpdatedAt: market?.updatedAt ?? null, observedAt: researchedAt, spotPriceUsd, spotRetrievedAt: spotPriceUsd === null ? null : researchedAt, targetPriceUsd, distanceToTargetPercent: targetPriceUsd && spotPriceUsd ? ((targetPriceUsd - spotPriceUsd) / spotPriceUsd) * 100 : null, timeRemainingMs: market?.closeAt ? Date.parse(market.closeAt) - Date.now() : null },
  };
  if (market) {
    const eventEvidence = evidence.filter((item) => item.usageStatus !== "excluded" && item.reliability !== "low" && item.relevance !== "low");
    const eventIntelligence = { ...buildEventIntelligence({ query: input.question, market, evidence: eventEvidence, priorEvidence: input.priorEvidence, researchedAt }), timeWindow: plan.timeWindow };
    const eventExplanation = await synthesizeEventExplanation({ event: eventIntelligence, evidence: eventEvidence });
    report.eventIntelligence = { ...eventIntelligence, explanation: eventExplanation.explanation, explanationMode: eventExplanation.mode, evidenceReferences: eventExplanation.evidenceReferences };
  }
  const mainCitations = modelSynthesis ? [
    ...modelSynthesis.assessmentEvidenceIds,
    ...modelSynthesis.keyFindings.flatMap((item) => item.evidenceIds),
    ...modelSynthesis.whatChanged.flatMap((item) => item.evidenceIds),
    ...modelSynthesis.whatCouldChange.flatMap((item) => item.evidenceIds),
    ...modelSynthesis.uncertainties.flatMap((item) => item.evidenceIds),
  ] : [];
  const eventCitations = report.eventIntelligence?.explanation.evidenceIds.flatMap((id) => {
    const evidenceId = report.eventIntelligence?.evidenceReferences[id];
    return evidenceId ? [evidenceId] : [];
  }) ?? [];
  const citedEvidenceIds = [...new Set([...mainCitations, ...eventCitations])];
  const rejected = evidence.filter((item) => item.independenceStatus === "duplicate-content" || item.eventRelevance === "unrelated" || item.reliability === "low" || item.relevance === "low");
  const rejectionReasons = {
    relevance: evidence.filter((item) => item.relevance === "low").length,
    reliability: evidence.filter((item) => item.reliability === "low").length,
    duplication: evidence.filter((item) => item.independenceStatus === "duplicate-content").length,
    unrelatedToFixture: evidence.filter((item) => item.eventRelevance === "unrelated").length,
  };
  const evidenceForAnalysis = evidence.filter((item) => item.independenceStatus !== "duplicate-content" && item.eventRelevance !== "unrelated" && item.reliability !== "low" && item.relevance !== "low");
  report.diagnostics = {
    searchResultsReturned: responses.reduce((total, response) => total + response.results.length, 0),
    uniqueSources: new Set(selected.map((item) => item.url)).size,
    pagesRetrieved: pages.filter((page) => page.retrieved).length,
    snippetOnlyRecords: evidence.filter((item) => !item.pageRetrieved).length,
    sourcesRejected: rejected.length,
    rejectionReasons,
    evidenceRecordsRetained: evidence.length,
    directFixtureEvidence: evidence.filter((item) => item.eventRelevance === "direct-fixture").length,
    contextualEvidence: evidence.filter((item) => item.eventRelevance === "contextual").length,
    supportingEvidence: evidenceForAnalysis.filter((item) => item.direction === "supports-yes").length,
    opposingEvidence: evidenceForAnalysis.filter((item) => item.direction === "supports-no").length,
    neutralEvidence: evidenceForAnalysis.filter((item) => item.direction === "neutral").length,
    sourcesSuppliedToSynthesis: synthesisEvidence.length,
    sourcesActuallyCited: citedEvidenceIds.length,
    citedEvidenceIds,
    groqStatus: modelSynthesis ? "validated" : synthesisAttempt?.failureReason ? "failed" : "not-attempted",
    ...(synthesisAttempt?.failureReason ? { groqFailureReason: synthesisAttempt.failureReason } : {}),
    fallbackUsed: Boolean(synthesisAttempt && !modelSynthesis),
  };
  console.info("[MIRA research] completion", JSON.stringify({ marketId: market?.id ?? null, ...report.diagnostics }));
  if (!input.refresh && report.status === "complete") setCachedResearch(cacheKey, report);
  return report;
}
