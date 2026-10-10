import type { ResearchEvidence, ResearchReport } from "./types";

function strength(item: ResearchEvidence): number {
  const source = item.reliability === "high" ? 3 : item.reliability === "medium" ? 2 : 1;
  const relevance = item.relevance === "high" ? 2 : item.relevance === "medium" ? 1 : 0;
  const freshness = item.freshness === "fresh" ? 2 : item.freshness === "recent" ? 1 : 0;
  return source + relevance + freshness;
}

export function synthesizeResearch(input: { market: ResearchReport["market"]; evidence: ResearchEvidence[]; priorEvidence?: Array<Pick<ResearchEvidence, "url">>; refreshed: boolean; marketImpliedProbability: number | null }): Pick<ResearchReport, "conclusion" | "assessment" | "keyFindings" | "whatChanged" | "whatCouldChange" | "uncertainty"> {
  const supporting = input.evidence.filter((item) => item.direction === "supports-yes");
  const opposing = input.evidence.filter((item) => item.direction === "supports-no");
  const usable = input.evidence.filter((item) => item.pageRetrieved && item.independenceStatus !== "duplicate-content" && item.reliability !== "low" && item.relevance !== "low" && item.eventRelevance !== "unrelated");
  const outcomeEvidence = usable.filter((item) => item.eventRelevance !== "contextual");
  const yesWeight = supporting.filter((item) => outcomeEvidence.includes(item)).reduce((sum, item) => sum + strength(item), 0);
  const noWeight = opposing.filter((item) => outcomeEvidence.includes(item)).reduce((sum, item) => sum + strength(item), 0);
  const dated = usable.filter((item) => item.publishedAt).sort((a, b) => Date.parse(b.publishedAt!) - Date.parse(a.publishedAt!));
  const stance: ResearchReport["assessment"]["stance"] = !usable.length || (!yesWeight && !noWeight) ? "insufficient" : yesWeight > noWeight * 1.25 ? "favorable-yes" : noWeight > yesWeight * 1.25 ? "favorable-no" : "mixed";
  const assessmentText = stance === "favorable-yes" ? "Retrieved evidence screened more favorably toward YES, though this is a qualitative synthesis and not a probability estimate." : stance === "favorable-no" ? "Retrieved evidence screened more favorably toward NO, though this is a qualitative synthesis and not a probability estimate." : stance === "mixed" ? "Evidence is mixed or too balanced to support a strong directional assessment." : "There is not enough retrieved evidence for a defensible assessment.";
  const priceContext = input.marketImpliedProbability === null
    ? input.market ? "Panta did not provide a usable YES quote." : "No relevant Panta market was identified, so no YES/NO market price is reported."
    : `Panta reports a normalized YES quote of $${input.marketImpliedProbability.toFixed(2)} per share; this is market data, not a MIRA forecast or proof of the event's likelihood.`;
  const conclusion = `${assessmentText} ${priceContext}`;
  const keyFindings = [...usable].sort((a, b) => strength(b) - strength(a)).slice(0, 4).map((item) => `${item.eventRelevance === "contextual" ? "Context only — " : ""}${item.title}: ${item.summary}`);
  const oldUrls = new Set((input.priorEvidence ?? []).map((item) => item.url));
  const newItems = dated.filter((item) => !oldUrls.has(item.url));
  const whatChanged = input.refreshed
    ? newItems.length ? newItems.slice(0, 5).map((item) => `New source since the prior report: ${item.title} (${new Date(item.publishedAt!).toLocaleDateString()}).`) : ["A fresh search ran, but it returned no source URLs that were new compared with the prior report."]
    : dated.slice(0, 4).map((item) => `Recently published source: ${item.title} — ${new Date(item.publishedAt!).toLocaleDateString()}.`);
  const oppositeEvidence = (stance === "favorable-yes" ? opposing : stance === "favorable-no" ? supporting : input.evidence.filter((item) => item.direction !== "neutral"))
    .filter((item) => outcomeEvidence.includes(item)).sort((a, b) => strength(b) - strength(a)).slice(0, 3);
  const whatCouldChange = oppositeEvidence.map((item) => `Monitor this counter-signal: ${item.title} (${item.domain}). It is a reported evidence item, not a forecast trigger.`);
  if (!whatCouldChange.length) whatCouldChange.push("No source-grounded event that would change the assessment was identified in the retrieved material. Fresh official data or a meaningful Panta price/history change could change the analysis.");
  const uncertainty = [
    ...(input.evidence.length < 3 ? ["Fewer than three distinct sources were retrieved; the evidence base is limited."] : []),
    ...(usable.length === 0 && input.evidence.length ? ["No full-page source met both the minimum relevance and reliability screening criteria; search-result text remains a lead, not verified evidence."] : []),
    ...(usable.length > 0 && !yesWeight && !noWeight ? ["The usable sources did not contain a sufficiently explicit directional signal; they remain neutral context rather than support for either outcome."] : []),
    ...(input.evidence.some((item) => !item.pageRetrieved) ? ["Some sources could not be opened. Those items use search-result text only and are marked accordingly."] : []),
    ...(input.evidence.some((item) => !item.publishedAt) ? ["Some sources have no publication timestamp and were not treated as current news."] : []),
    "Evidence direction and assessment use transparent keyword and source-ranking rules; this version has no calibrated forecasting model.",
    ...(supporting.length && opposing.length ? ["Retrieved sources contain indicators on both sides; source wording alone cannot establish causation or resolution."] : []),
  ];
  return { conclusion, assessment: { stance, explanation: assessmentText }, keyFindings, whatChanged, whatCouldChange, uncertainty };
}
