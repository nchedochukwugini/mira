import type { Market } from "@/lib/panta/types";
import type { EventIntelligence, EventTimelineEntry, ResearchDiff, ResearchEvidence, ResearchType, ResearchWindow } from "./types";

export type PriorEvidence = Pick<ResearchEvidence, "url"> & Partial<Pick<ResearchEvidence, "id" | "claim" | "title" | "publishedAt" | "retrievedAt" | "summary">>;

const eventTerms = /\b(announcement|decision|ruling|election|earnings|approval|release|meeting|escalation|launch|strike|vote|rate cut|rate hike|cut rates?|verdict|resolution|developments?|match|game|beat|win|victory|qualify|advance|champion)\b/i;
const normalize = (value: string) => value.toLowerCase().replace(/https?:\/\/\S+/g, " ").replace(/[^a-z0-9]+/g, " ").replace(/\b(the|a|an|is|was|were|has|have|had|to|of|in|on|for|and|with)\b/g, " ").replace(/\s+/g, " ").trim();
const officialDomain = (domain: string) => /(^|\.)(gov|gov\.uk)$/.test(domain) || /(^|\.)(federalreserve\.gov|sec\.gov|cftc\.gov|ecb\.europa\.eu|who\.int|fifa\.com)$/.test(domain);

function contradictionPairs(evidence: ResearchEvidence[]) {
  const pairs: ResearchDiff["contradictions"] = [];
  const grouped = new Map<string, ResearchEvidence[]>();
  for (const item of evidence) grouped.set(normalize(item.claim), [...(grouped.get(normalize(item.claim)) ?? []), item]);
  const groups = [...grouped.values()];
  for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length; j++) {
    const groupA = groups[i]!; const groupB = groups[j]!;
    const pair = groupA.flatMap((a) => groupB.filter((b) => a.domain !== b.domain && a.reliability !== "low" && b.reliability !== "low").map((b) => [a, b] as const))[0];
    if (!pair) continue;
    const [a, b] = pair;
    const left = normalize(a.claim); const right = normalize(b.claim);
    const shared = left.split(" ").filter((word) => word.length > 3 && right.includes(word));
    const opposite = /\b(not|no|never|delayed|denied|rejected|held|unchanged|failed)\b/i.test(a.claim) !== /\b(not|no|never|delayed|denied|rejected|held|unchanged|failed)\b/i.test(b.claim)
      || /\b(approved|passed|announced|confirmed|cut|won|increased)\b/i.test(a.claim) && /\b(rejected|failed|delayed|denied|lost|decreased)\b/i.test(b.claim)
      || /\b(rejected|failed|delayed|denied|lost|decreased)\b/i.test(a.claim) && /\b(approved|passed|announced|confirmed|cut|won|increased)\b/i.test(b.claim);
    if (opposite && shared.length >= 2) pairs.push({ claimA: a.claim, claimB: b.claim, evidenceIds: [...new Set([...groupA, ...groupB].map((item) => item.id))] });
  }
  return pairs;
}

function researchWindow(query: string, now = new Date()): ResearchWindow {
  const to = now.toISOString();
  const localToday = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const todayStart = new Date(`${localToday}T00:00:00+01:00`).toISOString();
  if (/\btoday\b/i.test(query)) return { label: "today", from: todayStart, to };
  if (/\b(since yesterday|last 24 hours?|past 24 hours?|since yester(?:day)?|last day)\b/i.test(query)) return { label: "last-24-hours", from: new Date(now.getTime() - 86_400_000).toISOString(), to };
  if (/\b(this week|last 7 days?|past week|over the last week|since the start of the week)\b/i.test(query)) return { label: "last-7-days", from: new Date(now.getTime() - 7 * 86_400_000).toISOString(), to };
  if (/\bsince i last checked\b/i.test(query)) return { label: "since-previous-run", from: null, to };
  return { label: "unspecified", from: null, to };
}

export function classifyResearchTypes(query: string): ResearchType[] {
  const types: ResearchType[] = [];
  if (/\b(timeline|over the last week|what happened over)\b/i.test(query)) types.push("event-timeline");
  if (/\b(what changed|what's new|what is new|new developments|since yesterday|since i last checked|anything new)\b/i.test(query)) types.push("event-change", "latest-update");
  if (/\b(is that true|is that confirmed|confirm|verify|which sources|sources confirm)\b/i.test(query)) types.push("source-verification", "contradiction-check");
  if (/\b(why.*market move|markets? affected|affect.*market|market impact|relate to the market)\b/i.test(query)) types.push("event-change", "market-impact-context");
  if (!types.length && /\b(latest|what's happening|what is happening|what happened|what's going on)\b/i.test(query)) types.push("latest-update");
  if (!types.length) types.push("broad-background");
  return [...new Set(types)];
}

function reportingGroups(evidence: ResearchEvidence[]): number {
  const groups: Array<{ domain: string; tokens: Set<string>; title: string }> = [];
  for (const item of evidence) {
    const tokens = new Set(normalize(`${item.title} ${item.claim}`).split(" ").filter((word) => word.length > 3));
    const duplicate = groups.find((group) => {
      if (group.domain === item.domain) return true;
      if (normalize(item.title) === group.title) return true;
      const shared = [...tokens].filter((token) => group.tokens.has(token)).length;
      const union = new Set([...tokens, ...group.tokens]).size;
      return union > 0 && shared / union >= 0.78;
    });
    if (!duplicate) groups.push({ domain: item.domain, tokens, title: normalize(item.title) });
  }
  return groups.length;
}

export function buildEventIntelligence(input: { query: string; market: Market; evidence: ResearchEvidence[]; priorEvidence?: PriorEvidence[]; researchedAt: string }): EventIntelligence {
  const evidence = input.evidence.filter((item) => item.eventRelevance !== "unrelated");
  const hasEventScopedRecords = evidence.some((item) => item.eventRelevance !== undefined);
  const directEvidence = hasEventScopedRecords ? evidence.filter((item) => item.eventRelevance === "direct-fixture") : evidence;
  const contextualEvidence = hasEventScopedRecords ? evidence.filter((item) => item.eventRelevance === "contextual") : [];
  const assessmentEvidence = directEvidence.length ? directEvidence : hasEventScopedRecords ? [] : evidence;
  const prior = input.priorEvidence ?? [];
  const priorUrls = new Set(prior.map((item) => item.url));
  const newEvidence = evidence.filter((item) => !priorUrls.has(item.url));
  const contradictions = contradictionPairs(assessmentEvidence);
  const previousByClaim = new Map(prior.flatMap((item) => item.claim ? [[normalize(item.claim), item] as const] : []));
  const changedClaims: ResearchDiff["changedClaims"] = [];
  const changedEvidence = evidence.filter((item) => {
    const previous = prior.find((old) => old.url === item.url);
    return !previous || (Boolean(previous.claim) && normalize(previous.claim!) !== normalize(item.claim));
  });
  const priorClaims = prior.flatMap((item) => item.claim ? [{ ...item, id: item.id ?? item.url }] : []);
  for (const item of changedEvidence) {
    const normalized = normalize(item.claim);
    const previous = previousByClaim.get(normalized) ?? priorClaims.map((old) => {
      const oldTokens = new Set(normalize(old.claim!).split(" ").filter((word) => word.length > 2));
      const newTokens = new Set(normalized.split(" ").filter((word) => word.length > 2));
      const shared = [...oldTokens].filter((word) => newTokens.has(word)).length;
      return { old, shared, union: new Set([...oldTokens, ...newTokens]).size };
    }).filter((item) => item.shared >= 2).sort((a, b) => b.shared / b.union - a.shared / a.union)[0]?.old;
    if (previous?.claim && normalize(previous.claim) !== normalized) {
      const oldText = previous.claim.toLowerCase(); const newText = item.claim.toLowerCase();
      const priorNegative = /\b(no|not|never|delayed|denied|rejected|failed|unchanged)\b/.test(oldText);
      const currentNegative = /\b(no|not|never|delayed|denied|rejected|failed|unchanged)\b/.test(newText);
      const actionChanged = /\b(announc\w*|confirm\w*|approv\w*|resolv\w*|won|lost|delay\w*|reject\w*|decid\w*)\b/.test(oldText + newText);
      const opposite = priorNegative !== currentNegative || (/\b(approved|passed|announced|confirmed|cut|won|increased)\b/.test(oldText) && /\b(rejected|failed|delayed|denied|lost|decreased)\b/.test(newText)) || (/\b(rejected|failed|delayed|denied|lost|decreased)\b/.test(oldText) && /\b(approved|passed|announced|confirmed|cut|won|increased)\b/.test(newText));
      changedClaims.push({ previous: previous.claim, current: item.claim, type: opposite && actionChanged ? "status_change" : "updated_fact", evidenceIds: [item.id] });
    }
  }
  const diffStatus: ResearchDiff["status"] = !evidence.length ? "insufficient" : !prior.length ? "insufficient" : contradictions.length || changedClaims.length ? "material-change" : newEvidence.length ? "minor-change" : "no-change";
  const diff: ResearchDiff = { status: diffStatus, newEvidence, changedClaims, removedOrRetractedClaims: [], contradictions, summary: diffStatus === "insufficient" ? "There is not enough retained prior evidence to establish what materially changed." : diffStatus === "no-change" ? "No material change was found in the retained evidence." : diffStatus === "minor-change" ? `${newEvidence.length} new source${newEvidence.length === 1 ? " was" : "s were"} retrieved; no changed claim is established.` : contradictions.length ? "Retrieved evidence contains claims that may conflict; the disagreement remains explicit." : `${changedClaims.length} material claim change${changedClaims.length === 1 ? " was" : "s were"} identified from new evidence.` };
  const dated = assessmentEvidence.filter((item) => item.publishedAt && Number.isFinite(Date.parse(item.publishedAt))).sort((a, b) => Date.parse(a.publishedAt!) - Date.parse(b.publishedAt!));
  const timeline: EventTimelineEntry[] = [];
  for (const item of dated) {
    const tokens = new Set(normalize(`${item.title} ${item.claim}`).split(" ").filter((word) => word.length > 3));
    const duplicate = timeline.find((entry) => {
      if (!entry.timestamp || Math.abs(Date.parse(entry.timestamp) - Date.parse(item.publishedAt!)) > 86_400_000) return false;
      const previous = assessmentEvidence.filter((candidate) => entry.evidenceIds.includes(candidate.id));
      const previousTokens = new Set(previous.flatMap((candidate) => normalize(`${candidate.title} ${candidate.claim}`).split(" ").filter((word) => word.length > 3)));
      const shared = [...tokens].filter((word) => previousTokens.has(word)).length;
      return tokens.size + previousTokens.size - shared > 0 && shared / (tokens.size + previousTokens.size - shared) >= 0.72;
    });
    if (duplicate) {
      duplicate.evidenceIds.push(item.id);
      duplicate.sourceCount = new Set(assessmentEvidence.filter((candidate) => duplicate.evidenceIds.includes(candidate.id)).map((candidate) => candidate.domain)).size;
      if (Date.parse(item.publishedAt!) < Date.parse(duplicate.timestamp!)) duplicate.timestamp = item.publishedAt;
      if (item.publishedAtPrecision === "date") duplicate.timestampConfidence = "approximate";
    } else timeline.push({ timestamp: item.publishedAt, timestampConfidence: item.publishedAtPrecision === "date" ? "approximate" : "exact", title: item.title, description: item.claim, evidenceIds: [item.id], sourceCount: 1 });
  }
  timeline.sort((a, b) => Date.parse(a.timestamp!) - Date.parse(b.timestamp!));
  if (assessmentEvidence.some((item) => !item.publishedAt)) timeline.push({ timestamp: null, timestampConfidence: "unknown", title: "Date/time unavailable", description: "The source did not provide a verifiable publication time, so its timing relative to the event cannot be established.", evidenceIds: assessmentEvidence.filter((item) => !item.publishedAt).map((item) => item.id), sourceCount: new Set(assessmentEvidence.filter((item) => !item.publishedAt).map((item) => item.domain)).size });
  const topics = [input.market.category, ...input.market.question.match(/\b(?:Fed|Federal Reserve|FOMC|election|Bitcoin|Ethereum|CPI|inflation|earnings|court ruling|ETF|regulation)\b/gi) ?? []].filter((item): item is string => Boolean(item));
  const entities = [...new Set(input.market.question.match(/\b(?:Federal Reserve|FOMC|Bitcoin|Ethereum|SEC|Supreme Court|Congress|President|ETF)\b/gi) ?? [])];
  const marketDate = input.market.closeAt ? Date.parse(input.market.closeAt) : Number.NaN;
  const awaitingDecision = input.market.category === "sports" && input.market.status === "active" && Number.isFinite(marketDate) && marketDate > Date.parse(input.researchedAt);
  const supportedResolution = assessmentEvidence.some((item) => item.reliability === "high" && /\b(final result|was resolved|decision took effect|court ruled|official results|result was certified)\b/i.test(item.claim));
  const status = contradictions.length ? "disputed" : supportedResolution ? "resolved" : awaitingDecision ? "awaiting-decision" : assessmentEvidence.length && eventTerms.test(input.market.question) ? "developing" : assessmentEvidence.length ? "ongoing" : "unknown";
  const newest = dated.at(-1)?.publishedAt ?? null;
  const age = newest ? Date.now() - Date.parse(newest) : null;
  const freshness = age === null ? "unknown" : age <= 2 * 86_400_000 ? "fresh" : age <= 14 * 86_400_000 ? "recent" : "stale";
  const title = input.market.question.replace(/^(will|does|is|are)\s+/i, "").replace(/[?]$/, "").slice(0, 180);
  const direct = /\b(fed|federal reserve|fomc|election|court|earnings|approval|decision|resolution|rate|cpi|inflation)\b/i.test(input.market.question) || input.market.category === "sports" && /\b(beat|win|match|game|qualify|advance|champion)\b/i.test(input.market.question);
  const firstObserved = assessmentEvidence.map((item) => item.retrievedAt).filter((value) => Number.isFinite(Date.parse(value))).sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? null;
  const eventSummary = assessmentEvidence[0]
    ? `${assessmentEvidence[0].claim}${assessmentEvidence[0].pageRetrieved ? "" : " Search-result snippet only; the source page was not retrieved."}`
    : contextualEvidence.length ? "Retrieved sources offer contextual team or competition information but do not identify the exact target fixture." : "No source-backed event summary is available for the exact target fixture.";
  const event: EventIntelligence["event"] = { title, summary: eventSummary, entities, topics, status, firstObservedAt: firstObserved, lastUpdatedAt: input.researchedAt, confidence: assessmentEvidence.some((item) => item.reliability === "high" && item.relevance !== "low") ? "high" : assessmentEvidence.length ? "medium" : "low", evidenceIds: assessmentEvidence.map((item) => item.id), marketIds: [input.market.id], timeline };
  const marketRelevance = direct && assessmentEvidence.length ? "directly-relevant" : evidence.length ? "contextual" : "not-established";
  const evidenceReferences = Object.fromEntries(evidence.slice(0, 12).map((item, index) => [`E${index + 1}`, item.id]));
  const marketContext: EventIntelligence["marketContext"] = { marketId: input.market.id, question: input.market.question, definition: input.market.description, status: input.market.status, source: input.market.source, yesPrice: input.market.status === "resolved" ? null : input.market.yesProbability, noPrice: input.market.status === "resolved" ? null : input.market.noProbability, closeAt: input.market.closeAt, observedAt: input.researchedAt };
  return { event, marketContext, researchTypes: classifyResearchTypes(input.query), timeWindow: researchWindow(input.query, new Date(input.researchedAt)), freshness, sourceDiversity: { uniqueSources: new Set(evidence.map((item) => item.url)).size, independentReportingGroups: reportingGroups(evidence), primarySources: new Set(evidence.filter((item) => officialDomain(item.domain)).map((item) => item.domain)).size }, diff, marketRelevance,
    explanation: { summary: `${event.title} is ${event.status}; event confidence is ${event.confidence}.`, timelineExplanation: dated.length ? `The timeline includes ${dated.length} entries with verifiable publication times.` : "No verifiable publication time is available for direct target-event evidence.", evidenceExplanation: evidence.length ? `${directEvidence.length} direct-fixture and ${contextualEvidence.length} contextual evidence items are included.` : "No external evidence was available to support an event summary.", marketRelevanceExplanation: `Market relevance is ${marketRelevance}; contextual records do not establish facts about the exact target fixture and do not predict market direction.`, uncertainty: [diff.summary], evidenceIds: Object.keys(evidenceReferences) }, explanationMode: "deterministic", evidenceReferences };
}
