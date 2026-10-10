import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function loadTs(path, replacements = {}) {
  let source = await readFile(new URL(path, import.meta.url), "utf8");
  for (const [from, to] of Object.entries(replacements)) source = source.replaceAll(from, to);
  const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`);
}

const conversation = await loadTs("../intelligence/conversation.ts");
const eventIntelSource = await readFile(new URL("./event-intelligence.ts", import.meta.url), "utf8");
const eventIntelJavascript = ts.transpileModule(eventIntelSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const eventIntelUrl = `data:text/javascript;base64,${Buffer.from(eventIntelJavascript).toString("base64")}`;
const eventIntel = await import(eventIntelUrl);
const planner = await loadTs("./research-planner.ts", { 'from "./event-intelligence"': `from "${eventIntelUrl}"` });
const eventSynthesizer = await loadTs("./event-synthesizer.ts", { 'import "server-only";': "", 'from "@/lib/ai"': 'const explainEventIntelligenceJson = async () => null;' });
const sourceEvaluator = await loadTs("./source-evaluator.ts");
const sourceEvaluatorSource = await readFile(new URL("./source-evaluator.ts", import.meta.url), "utf8");
const sourceEvaluatorJavascript = ts.transpileModule(sourceEvaluatorSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const sourceEvaluatorUrl = `data:text/javascript;base64,${Buffer.from(sourceEvaluatorJavascript).toString("base64")}`;
const evidenceEngine = await loadTs("./evidence-engine.ts", { 'from "./source-evaluator"': `from "${sourceEvaluatorUrl}"` });
const synthesizer = await loadTs("./research-synthesizer.ts");
const modelSynthMockUrl = `data:text/javascript;base64,${Buffer.from('export const synthesizeWithModelDetailed=async()=>{const s=globalThis.__miraHistoricalResearchTest;s.modelSynthesisCalls=(s.modelSynthesisCalls??0)+1;return s.modelSynthesisResult??{synthesis:null,failureReason:"test provider failure"}};').toString("base64")}`;
const marketStatus = await loadTs("./market-status.ts");
const pageReader = await loadTs("./page-reader.ts", { 'import "server-only";': "" });
const eventSynthMockUrl = `data:text/javascript;base64,${Buffer.from('export const synthesizeEventExplanation=async({event})=>({explanation:event.explanation,mode:"deterministic",evidenceReferences:event.evidenceReferences});').toString("base64")}`;
const historicalState = globalThis.__miraHistoricalResearchTest = {};
const historical = await loadTs("./research-report.ts", {
  'import "server-only";': "",
  'from "@/lib/intelligence/core"': 'from "data:text/javascript,export%20const%20semanticRelevance%3D()%3D%3E0"',
  'from "@/lib/markets/spot-price"': 'from "data:text/javascript,export%20async%20function%20getSpotPrice()%7BglobalThis.__miraHistoricalResearchTest.spotCalls%2B%2B%3Breturn%20123%7D"',
  'from "./evidence-engine"': 'from "data:text/javascript,export%20const%20buildEvidence%3D(input)%3D%3EglobalThis.__miraHistoricalResearchTest.evidenceBuilder%3FglobalThis.__miraHistoricalResearchTest.evidenceBuilder(input)%3AglobalThis.__miraHistoricalResearchTest.evidence"',
  'from "./page-reader"': 'from "data:text/javascript,export%20const%20retrievePages%3Dasync()%3D%3E%5B%5D"',
  'from "./research-planner"': 'from "data:text/javascript,export%20const%20createResearchPlan%3D()%3D%3E(%7BmarketQuestion%3A%22resolved%22%2Ccategory%3A%22crypto%22%2Cdepth%3A%22deep%22%2Cdimensions%3A%5B%22yes%22%2C%22no%22%5D%2Cqueries%3A%5B%7Bquery%3A%22yes%22%2Cdimension%3A%22yes%22%2Cside%3A%22yes%22%7D%2C%7Bquery%3A%22no%22%2Cdimension%3A%22no%22%2Cside%3A%22no%22%7D%5D%7D)"',
  'from "./research-cache"': 'from "data:text/javascript,export%20const%20researchCacheKey%3D()%3D%3E%22key%22%3Bexport%20const%20getCachedResearch%3D()%3D%3Enull%3Bexport%20const%20setCachedResearch%3D()%3D%3E%7B%7D"',
  'from "./web-search"': 'from "data:text/javascript,export%20const%20getResearchSearchProvider%3D()%3D%3EglobalThis.__miraHistoricalResearchTest.search%3Bexport%20const%20hasResearchSearchProvider%3D()%3D%3Etrue"',
  'from "./research-synthesizer"': 'from "data:text/javascript,export%20const%20synthesizeResearch%3D()%3D%3E(%7Bconclusion%3A%22Directional%20YES%20summary%22%2Cassessment%3A%7Bstance%3A%22favorable-yes%22%2Cexplanation%3A%22leans%20YES%22%7D%2CkeyFindings%3A%5B%5D%2CwhatChanged%3A%5B%5D%2CwhatCouldChange%3A%5B%5D%2Cuncertainty%3A%5B%5D%7D)"',
  'from "./ai-synthesizer"': `from "${modelSynthMockUrl}"`,
  'from "@/lib/ai"': 'from "data:text/javascript,export%20const%20getAIConfig%3D()%3D%3E(%7Bconfigured%3Atrue%7D)"',
  'from "./market-status"': 'from "data:text/javascript,export%20const%20isResolvedMarket%3D(status)%3D%3Estatus%3D%3D%3D%22resolved%22"',
  'from "./event-intelligence"': `from "${eventIntelUrl}"`,
  'from "./event-synthesizer"': `from "${eventSynthMockUrl}"`,
});

const market = (question, category = "crypto") => ({ id: "m-1", question, category, description: null, status: "active", yesProbability: 0.62, noProbability: 0.38, volumeUsd: 5000, liquidityUsd: null, priceChange24h: null, closeAt: "2026-10-08T00:00:00.000Z", updatedAt: "2026-10-06T10:00:00.000Z", imageUrl: null, history: [], relatedMarketIds: [], source: "panta" });

test("natural research and refresh phrases stay in MIRA's research intent", () => {
  const active = market("Will Bitcoin hit $85,000 by October 8?");
  const context = { markets: [{ id: active.id, question: active.question }], activeMarketId: active.id, researchMarketId: active.id, researchSummary: "Prior research", researchQuestion: active.question };
  for (const question of ["Research this market", "What's the latest news?", "Find evidence for YES", "Find evidence against YES", "Why is this market moving?", "Go deeper", "What would invalidate this?"]) {
    assert.equal(conversation.classifyConversationMessage(question, context).intent, "research", question);
  }
  for (const question of ["What changed?", "Has anything changed?", "Update the research", "Refresh this", "What's new?"]) {
    assert.equal(conversation.classifyConversationMessage(question, context).intent, "research", question);
  }
  assert.equal(conversation.classifyConversationMessage("Buy $20 YES on this market", context).intent, "trade_request");
});

test("planner adapts dimensions and queries for crypto, sports, politics, and economics", () => {
  const crypto = planner.createResearchPlan({ query: "deep research", market: market("Will Bitcoin hit $85,000 by October 8?") });
  const sports = planner.createResearchPlan({ query: "deep research", market: market("Will the Lakers beat the Celtics?", "sports") });
  const politics = planner.createResearchPlan({ query: "deep research", market: market("Will candidate win the election?", "politics") });
  const economy = planner.createResearchPlan({ query: "deep research", market: market("Will CPI inflation fall?", "economics") });
  assert.ok(crypto.dimensions.includes("ETF and institutional flows"));
  assert.ok(crypto.queries.some((item) => item.side === "no"));
  assert.ok(sports.dimensions.includes("injuries and suspensions"));
  assert.ok(politics.dimensions.includes("polling and polling changes"));
  assert.ok(economy.dimensions.includes("official economic releases"));
  assert.notDeepEqual(crypto.dimensions, sports.dimensions);
});

test("event planner recognizes timeline, change, verification, market relevance, and time windows", () => {
  const fed = market("Will the Fed cut rates at the October meeting?", "economics");
  const changed = planner.createResearchPlan({ query: "What changed since yesterday?", market: fed });
  const timeline = planner.createResearchPlan({ query: "Give me the timeline over the last week", market: fed });
  const verified = planner.createResearchPlan({ query: "Is that confirmed?", market: fed });
  assert.ok(changed.researchTypes.includes("event-change"));
  assert.equal(changed.timeWindow.label, "last-24-hours");
  assert.ok(timeline.researchTypes.includes("event-timeline"));
  assert.equal(timeline.timeWindow.label, "last-7-days");
  assert.ok(verified.researchTypes.includes("source-verification"));
});

test("event intelligence builds evidence-backed timeline, handles undated evidence, and detects disagreements", () => {
  const fed = market("Will the Fed cut rates at the October meeting?", "economics");
  const evidence = [
    { id: "E1", claim: "Federal Reserve announced a rate cut at the October meeting.", summary: "Official announcement.", title: "Fed announces October rate cut", source: "Federal Reserve", domain: "federalreserve.gov", url: "https://federalreserve.gov/a", publishedAt: "2026-10-05T18:00:00Z", retrievedAt: "2026-10-07T12:00:00Z", direction: "neutral", relevance: "high", reliability: "high", reliabilityReason: "official", evidenceType: "official", pageRetrieved: true, freshness: "recent" },
    { id: "E3", claim: "Federal Reserve announced a rate cut at the October meeting.", summary: "Same announcement reported.", title: "Federal Reserve announces October rate cut", source: "Reuters", domain: "reuters.com", url: "https://reuters.com/a", publishedAt: "2026-10-05T18:30:00Z", retrievedAt: "2026-10-07T12:00:00Z", direction: "neutral", relevance: "high", reliability: "medium", reliabilityReason: "reporting", evidenceType: "reporting", pageRetrieved: true, freshness: "recent" },
    { id: "E2", claim: "Federal Reserve did not announce a rate cut at the October meeting.", summary: "Conflicting report.", title: "Fed October rate decision delayed", source: "Reuters", domain: "reuters.com", url: "https://reuters.com/b", publishedAt: null, retrievedAt: "2026-10-07T12:00:00Z", direction: "neutral", relevance: "high", reliability: "medium", reliabilityReason: "reporting", evidenceType: "reporting", pageRetrieved: true, freshness: "undated" },
  ];
  const result = eventIntel.buildEventIntelligence({ query: "What changed since I last checked?", market: fed, evidence, priorEvidence: [{ url: "https://old.example/a", claim: "The October rate decision is pending." }], researchedAt: "2026-10-07T12:00:00.000Z" });
  assert.equal(result.event.status, "disputed");
  assert.equal(result.event.timeline[0].timestamp, "2026-10-05T18:00:00Z");
  assert.equal(result.event.timeline[0].sourceCount, 2, "same announcement is one timeline event with two reporting sources");
  assert.equal(result.event.timeline.at(-1).timestamp, null);
  assert.equal(result.event.timeline.at(-1).timestampConfidence, "unknown");
  assert.equal(result.diff.status, "material-change");
  assert.equal(result.diff.contradictions.length, 1);
  assert.equal(result.sourceDiversity.uniqueSources, 3);
  assert.equal(result.sourceDiversity.independentReportingGroups, 2);
  assert.equal(result.marketRelevance, "directly-relevant");
});

test("event diff distinguishes insufficient history from no material change and does not use retrieval time as publication time", () => {
  const fed = market("Will the Fed cut rates at the October meeting?", "economics");
  const source = { id: "E1", claim: "The meeting remains scheduled.", summary: "Scheduled.", title: "Meeting schedule", source: "Example", domain: "example.com", url: "https://example.com/schedule", publishedAt: null, retrievedAt: "2026-10-07T18:00:00Z", direction: "neutral", relevance: "medium", reliability: "medium", reliabilityReason: "test", evidenceType: "reporting", pageRetrieved: true, freshness: "undated" };
  const noHistory = eventIntel.buildEventIntelligence({ query: "What's happening?", market: fed, evidence: [source], researchedAt: "2026-10-07T18:00:00Z" });
  const unchanged = eventIntel.buildEventIntelligence({ query: "What changed?", market: fed, evidence: [source], priorEvidence: [{ url: source.url, claim: source.claim }], researchedAt: "2026-10-07T18:00:00Z" });
  assert.equal(noHistory.diff.status, "insufficient");
  assert.equal(unchanged.diff.status, "no-change");
  assert.equal(noHistory.event.timeline[0].timestamp, null);
  assert.equal(noHistory.freshness, "unknown");
});

test("event diff detects a status change within an updated source URL", () => {
  const fed = market("Will the Fed cut rates at the October meeting?", "economics");
  const current = { id: "E7", claim: "The Federal Reserve announced the October rate decision.", summary: "Official decision announced.", title: "Fed October decision", source: "Federal Reserve", domain: "federalreserve.gov", url: "https://federalreserve.gov/decision", publishedAt: "2026-10-07T18:00:00Z", retrievedAt: "2026-10-07T19:00:00Z", direction: "neutral", relevance: "high", reliability: "high", reliabilityReason: "official", evidenceType: "official", pageRetrieved: true, freshness: "fresh" };
  const result = eventIntel.buildEventIntelligence({ query: "What changed?", market: fed, evidence: [current], priorEvidence: [{ url: current.url, claim: "The Federal Reserve has not announced the October rate decision." }], researchedAt: "2026-10-07T19:00:00Z" });
  assert.equal(result.diff.status, "material-change");
  assert.equal(result.diff.changedClaims[0].type, "status_change");
  assert.deepEqual(result.diff.newEvidence, [], "updated source is not mislabeled as a new URL");
});

test("event Groq output is mapped to verified evidence and falls back for invalid IDs, claims, or provider failure", async () => {
  const fed = market("Will the Fed cut rates at the October meeting?", "economics");
  const evidence = [{ id: "source-a", claim: "The Federal Reserve published a rate decision.", summary: "Decision published.", title: "Federal Reserve decision", source: "Federal Reserve", domain: "federalreserve.gov", url: "https://federalreserve.gov/decision", publishedAt: "2026-10-05T18:00:00Z", retrievedAt: "2026-10-07T12:00:00Z", direction: "neutral", relevance: "high", reliability: "high", reliabilityReason: "official", evidenceType: "official", pageRetrieved: true, freshness: "recent" }];
  const event = eventIntel.buildEventIntelligence({ query: "Give me the timeline", market: fed, evidence, researchedAt: "2026-10-07T12:00:00Z" });
  const valid = { summary: "The event may remain ongoing based on the supplied report.", timelineExplanation: "The Federal Reserve decision was published on 2026-10-05.", evidenceExplanation: "The official source reports the decision. E1", marketRelevanceExplanation: "This decision is directly relevant to the market definition.", uncertainty: ["However, the evidence does not establish causation."], evidenceIds: ["E1"] };
  let groundingContext;
  const generated = await eventSynthesizer.synthesizeEventExplanation({ event, evidence, generate: async ({ data, validate }) => { groundingContext = data; return validate(valid); } });
  assert.equal(generated.mode, "groq");
  assert.equal(generated.evidenceReferences.E1, "source-a");
  assert.equal(groundingContext.evidence.length, 1);
  assert.equal(groundingContext.marketContext.status, "active");
  assert.equal(groundingContext.marketContext.yesPrice, 0.62);
  assert.deepEqual(groundingContext.event.evidenceIds, ["E1"]);
  assert.deepEqual(groundingContext.timeline[0].evidenceIds, ["E1"]);
  assert.doesNotMatch(JSON.stringify(groundingContext), /source-a/, "model sees only compact server-mapped citations");
  const sixEvidence = Array.from({ length: 6 }, (_, index) => ({ ...evidence[0], id: `source-${index + 1}`, url: `https://federalreserve.gov/decision-${index + 1}` }));
  const sixEvent = eventIntel.buildEventIntelligence({ query: "Give me the timeline", market: fed, evidence: sixEvidence, researchedAt: "2026-10-07T12:00:00Z" });
  const six = await eventSynthesizer.synthesizeEventExplanation({ event: sixEvent, evidence: sixEvidence, generate: async ({ data, validate }) => {
    assert.deepEqual(data.evidence.map((item) => item.id), ["E1", "E2", "E3", "E4", "E5", "E6"]);
    return validate({ ...valid, evidenceIds: ["E1", "E2", "E3", "E4", "E5", "E6"] });
  } });
  assert.equal(six.mode, "groq");
  assert.deepEqual(Object.values(six.evidenceReferences), sixEvidence.map((item) => item.id));
  const unsupportedCount = await eventSynthesizer.synthesizeEventExplanation({ event, evidence, generate: async ({ validate }) => validate({ ...valid, evidenceExplanation: "Three independent sources confirm the report. E1" }) });
  assert.equal(unsupportedCount.mode, "deterministic", "unsubstantiated written-out counts are rejected");
  const badCitation = await eventSynthesizer.synthesizeEventExplanation({ event, evidence, generate: async ({ validate }) => validate({ ...valid, evidenceIds: ["E99"] }) });
  assert.equal(badCitation.mode, "deterministic");
  const hallucinatedDate = await eventSynthesizer.synthesizeEventExplanation({ event, evidence, generate: async ({ validate }) => validate({ ...valid, timelineExplanation: "The decision was published on 2030-01-01." }) });
  assert.equal(hallucinatedDate.mode, "deterministic");
  const failed = await eventSynthesizer.synthesizeEventExplanation({ event, evidence, generate: async () => { throw new Error("Groq timeout"); } });
  assert.equal(failed.mode, "deterministic");
  assert.match(failed.explanation.summary, /Fed cut rates/);
});

test("synthesis separates the Panta quote, qualitative stance, opposing evidence, and uncertainty", () => {
  const evidence = [
    { id: "1", title: "Bitcoin inflows rise", summary: "Institutional inflows increased.", url: "https://coinshares.com/a", publishedAt: "2026-10-06T00:00:00Z", direction: "supports-yes", reliability: "medium", relevance: "high", freshness: "fresh", pageRetrieved: true, independenceStatus: "unknown" },
    { id: "2", title: "Downside risks grow", summary: "The asset faces downside risks.", url: "https://reuters.com/b", publishedAt: "2026-10-06T00:00:00Z", direction: "supports-no", reliability: "medium", relevance: "high", freshness: "fresh", pageRetrieved: true, independenceStatus: "unknown" },
  ];
  const result = synthesizer.synthesizeResearch({ market: market("Will Bitcoin hit $85k?"), evidence, priorEvidence: [{ url: "https://coinshares.com/a" }], refreshed: true, marketImpliedProbability: 0.62 });
  assert.equal(result.assessment.stance, "mixed");
  assert.match(result.conclusion, /\$0\.62 per share/);
  assert.match(result.conclusion, /not a MIRA forecast or proof/i);
  assert.ok(result.keyFindings.length > 0);
  assert.ok(result.whatChanged.some((item) => item.includes("New source")));
  assert.ok(result.whatCouldChange.length > 0);
  assert.ok(result.uncertainty.length > 0);
});

test("neutral retrieved sources do not create a directional MIRA assessment", () => {
  const result = synthesizer.synthesizeResearch({ market: market("Will Bitcoin reach $85k?"), evidence: [
    { id: "1", title: "Bitcoin price page", summary: "Current price data.", url: "https://coingecko.com/a", publishedAt: "2026-10-06T00:00:00Z", direction: "neutral", reliability: "medium", relevance: "high", freshness: "fresh", pageRetrieved: true, independenceStatus: "unknown" },
  ], refreshed: false, marketImpliedProbability: null });
  assert.equal(result.assessment.stance, "insufficient");
  assert.ok(result.uncertainty.some((item) => item.includes("directional signal")));
});

test("search-result snippets alone cannot support a directional synthesis", () => {
  const result = synthesizer.synthesizeResearch({ market: market("Will Bitcoin reach $85k?"), evidence: [
    { id: "snippet", title: "Bitcoin outlook", summary: "Search snippet only", url: "https://example.com/snippet", publishedAt: null, direction: "supports-yes", reliability: "high", relevance: "high", freshness: "undated", pageRetrieved: false, independenceStatus: "unknown" },
  ], refreshed: false, marketImpliedProbability: 0.5 });
  assert.equal(result.assessment.stance, "insufficient");
  assert.match(result.uncertainty.join(" "), /full-page source/i);
});

test("evidence records cited source URLs, timestamps, page retrieval, and direction", async () => {
  const evaluatorSource = await readFile(new URL("./source-evaluator.ts", import.meta.url), "utf8");
  const evaluatorJavascript = ts.transpileModule(evaluatorSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const evaluatorUrl = `data:text/javascript;base64,${Buffer.from(evaluatorJavascript).toString("base64")}`;
  const engine = await loadTs("./evidence-engine.ts", { 'from "./source-evaluator"': `from "${evaluatorUrl}"` });
  const result = engine.buildEvidence({
    marketQuestion: "Will Bitcoin hit $85,000?",
    plannedQueries: [{ query: "Bitcoin price bullish", dimension: "price trend", side: "yes" }],
    results: [{ title: "Bitcoin reaches new high", url: "https://coinshares.com/report", content: "Bitcoin rises as inflows increase. This source text is long enough to become an evidence claim.", rawContent: null, publishedAt: "2026-10-06T00:00:00Z", score: 0.9, query: "Bitcoin price bullish" }],
    pages: [{ url: "https://coinshares.com/report", title: "Bitcoin report", content: "Bitcoin rises as inflows increase. This full page was successfully retrieved for evidence extraction.", publishedAt: "2026-10-06T00:00:00Z", retrievedAt: "2026-10-06T12:00:00Z", retrieved: true }],
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].direction, "supports-yes");
  assert.equal(result[0].pageRetrieved, true);
  assert.equal(result[0].url, "https://coinshares.com/report");
  assert.ok(result[0].publishedAt && result[0].retrievedAt);
});

test("Tavily page shells do not masquerade as successfully reviewed articles", async () => {
  const shell = await pageReader.retrievePages([{ title: "Arsenal-Leeds preview", url: "https://onefootball.com/story", content: "Arsenal vs Leeds preview for October 10, 2026 with injury information.", rawContent: "OneFootball's home page /en/home Arsenal vs Leeds preview.", publishedAt: "2026-10-09T08:00:00Z", score: 0.9, query: "Arsenal Leeds preview" }], "Arsenal Leeds October 10 2026");
  assert.equal(shell[0].retrieved, false);
  assert.equal(shell[0].content, "Arsenal vs Leeds preview for October 10, 2026 with injury information.");
  assert.match(shell[0].failureReason, /page shell/i);
  assert.equal(shell[0].publishedAt, "2026-10-09T08:00:00Z", "search result publication metadata remains intact");
});

test("near-duplicate URLs with repeated content are kept visible but excluded as independent evidence", async () => {
  const evaluatorSource = await readFile(new URL("./source-evaluator.ts", import.meta.url), "utf8");
  const evaluatorJavascript = ts.transpileModule(evaluatorSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const evaluatorUrl = `data:text/javascript;base64,${Buffer.from(evaluatorJavascript).toString("base64")}`;
  const engine = await loadTs("./evidence-engine.ts", { 'from "./source-evaluator"': `from "${evaluatorUrl}"` });
  const content = "Bitcoin institutional fund flows rose during the latest reporting period. This identical source excerpt contains enough detail to compare source independence and claim identity.";
  const results = engine.buildEvidence({
    marketQuestion: "Will Bitcoin hit $100,000?", plannedQueries: [{ query: "Bitcoin fund flows", dimension: "flows", side: "neutral" }],
    results: [
      { title: "Bitcoin fund flows update", url: "https://reuters.com/story?id=1", content, rawContent: null, publishedAt: "2026-10-08T00:00:00Z", score: 0.9, query: "Bitcoin fund flows" },
      { title: "Bitcoin fund flows update", url: "https://reuters.com/story?id=1&utm_source=tavily", content, rawContent: null, publishedAt: "2026-10-08T00:00:00Z", score: 0.88, query: "Bitcoin fund flows" },
    ],
    pages: [
      { url: "https://reuters.com/story?id=1", title: "Bitcoin fund flows update", content, publishedAt: "2026-10-08T00:00:00Z", retrievedAt: "2026-10-09T00:00:00Z", retrieved: true },
      { url: "https://reuters.com/story?id=1&utm_source=tavily", title: "Bitcoin fund flows update", content, publishedAt: "2026-10-08T00:00:00Z", retrievedAt: "2026-10-09T00:00:00Z", retrieved: true },
    ],
  });
  assert.equal(results.length, 2, "distinct original URLs remain visible");
  assert.equal(results.filter((item) => item.independenceStatus === "duplicate-content").length, 1);
  assert.equal(results.filter((item) => item.usageStatus === "used").length, 1);
});

test("failed retrieval keeps a relevant search snippet explicitly limited", async () => {
  const evaluatorSource = await readFile(new URL("./source-evaluator.ts", import.meta.url), "utf8");
  const evaluatorJavascript = ts.transpileModule(evaluatorSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const evaluatorUrl = `data:text/javascript;base64,${Buffer.from(evaluatorJavascript).toString("base64")}`;
  const engine = await loadTs("./evidence-engine.ts", { 'from "./source-evaluator"': `from "${evaluatorUrl}"` });
  const [item] = engine.buildEvidence({
    marketQuestion: "Will Bitcoin hit $100,000?", plannedQueries: [{ query: "Bitcoin ETF inflows", dimension: "flows", side: "neutral" }],
    results: [{ title: "Bitcoin ETF inflows rise", url: "https://reuters.com/bitcoin-flows", content: "Bitcoin ETF inflows increased during the latest reported week, according to fund data.", rawContent: null, publishedAt: null, score: 0.9, query: "Bitcoin ETF inflows" }],
    pages: [{ url: "https://reuters.com/bitcoin-flows", title: "Bitcoin ETF inflows rise", content: "Bitcoin ETF inflows increased during the latest reported week, according to fund data.", publishedAt: null, retrievedAt: "2026-10-09T12:00:00Z", retrieved: false, failureReason: "extract failed" }],
  });
  assert.equal(item.pageRetrieved, false);
  assert.equal(item.publishedAt, null);
  assert.equal(item.retrievedAt, "2026-10-09T12:00:00Z");
  assert.match(item.summary, /Search result text only/i);
  assert.equal(item.usageStatus, "context-only");
});

test("research report renders external original URLs as clickable links", async () => {
  const source = await readFile(new URL("../../components/ai/ResearchReport.tsx", import.meta.url), "utf8");
  assert.match(source, /<a[^>]+href=\{item\.url\}[^>]+target="_blank"[^>]*>Read source/);
  assert.match(source, /Published: \{dateLabel\(item\.publishedAt\)\} · Retrieved: \{dateLabel\(item\.retrievedAt\)\}/);
});

test("relevance uses the specific planned search query while unreliable sources remain rejected", () => {
  const direct = sourceEvaluator.assessSource({ title: "Bitcoin ETF inflows accelerate", url: "https://reuters.com/markets/crypto", content: "Institutional ETF inflows increase as Bitcoin demand grows.", score: 0.82 }, "Will Bitcoin hit $100,000 by December?", "Bitcoin ETF institutional flows latest");
  assert.notEqual(direct.relevance, "low");
  assert.equal(direct.reliability, "medium");
  const unrelated = sourceEvaluator.assessSource({ title: "Local football transfer", url: "https://reuters.com/sports", content: "A club signed a midfielder.", score: 0.9 }, "Will Bitcoin hit $100,000 by December?", "Bitcoin ETF institutional flows");
  assert.equal(unrelated.relevance, "low");
  assert.equal(sourceEvaluator.assessSource({ title: "Bitcoin rumor", url: "https://unknown.example/post", content: "Bitcoin ETF inflows reportedly increase.", score: 0.9 }, "Will Bitcoin hit $100,000?", "Bitcoin ETF inflows").reliability, "low");
  assert.equal(sourceEvaluator.assessSource({ title: "Alan Shearer predictions including Liverpool vs Man City", url: "https://metro.co.uk/sports", content: "Arsenal are among several teams discussed.", score: 0.9 }, "Will Arsenal beat Leeds United on October 10?", "Arsenal Leeds Premier League predictions").relevance, "low", "one team mention in a different match is not direct matchup evidence");
});

test("sports evidence distinguishes the exact Arsenal-Leeds fixture from context and other fixtures", () => {
  const question = "Will Arsenal beat Leeds United on October 10, 2026?";
  const page = (url, title, content) => ({ title, url, content, rawContent: null, publishedAt: "2026-10-09T08:00:00Z", score: 0.95, query: "Arsenal Leeds Premier League match preview" });
  const exact = page("https://reuters.com/sports/arsenal-leeds-preview", "Arsenal and Leeds prepare for October 10 Premier League fixture", "Arsenal will host Leeds United on October 10, 2026 in the Premier League. This is a preview of the upcoming fixture.");
  const mixedHistory = page("https://reuters.com/sports/arsenal-leeds-mixed", "Arsenal vs Leeds preview: October 10, 2026", "Arsenal host Leeds United on October 10, 2026 in the Premier League. Arsenal won the previous meeting in 2024.");
  const exactNumericDate = page("https://onefootball.com/arsenal-leeds-numeric", "PREVIEW | Arsenal vs Leeds United: team news (Premier League 10/10)", "Arsenal vs Leeds United: injury updates and lineup news for the Premier League fixture.");
  const passingMention = page("https://bbc.com/sport/arsenal-other", "Arsenal face Chelsea on October 10, 2026", "Arsenal meet Chelsea on October 10, 2026 in the Premier League. Leeds United are mentioned briefly in an unrelated transfer paragraph.");
  const previous = page("https://espn.com/arsenal-leeds-old", "Arsenal beat Leeds in 2024", "Arsenal beat Leeds United in their previous meeting on September 24, 2024.");
  const arsenalOther = page("https://reuters.com/arsenal-chelsea", "Arsenal host Chelsea", "Arsenal face Chelsea in a Premier League match on October 10, 2026.");
  const leedsOther = page("https://bbc.com/leeds-other", "Leeds face Norwich", "Leeds United play Norwich City in the Championship on October 10, 2026.");
  const context = page("https://onefootball.com/arsenal-form", "Arsenal recent form", "Arsenal have won three of their last five league matches and have no new injuries.");
  const ambiguous = page("https://metro.co.uk/arsenal-leeds", "Arsenal and Leeds team news", "Arsenal and Leeds United have both announced squad updates ahead of the next round.");
  const conflictingCompetition = page("https://example.com/cup", "Arsenal-Leeds FA Cup preview", "Arsenal meet Leeds United in the FA Cup on October 10, 2026.");
  const fixtures = [exact, mixedHistory, exactNumericDate, passingMention, previous, arsenalOther, leedsOther, context, ambiguous, conflictingCompetition];
  const planned = [{ query: exact.query, dimension: "schedule and matchup", side: "neutral" }];
  const evidence = evidenceEngine.buildEvidence({ marketQuestion: question, marketDescription: "Premier League fixture; resolves according to the full-time result of the specified fixture.", marketCategory: "sports", results: fixtures, pages: fixtures.map((item) => ({ url: item.url, title: item.title, content: item.content, publishedAt: item.publishedAt, retrievedAt: "2026-10-09T09:00:00Z", retrieved: true })), plannedQueries: planned });
  const byUrl = new Map(evidence.map((item) => [item.url, item]));
  assert.equal(byUrl.get(exact.url).eventRelevance, "direct-fixture");
  assert.equal(byUrl.get(mixedHistory.url).eventRelevance, "direct-fixture", "a directly identified target fixture remains relevant even if the report also mentions an older meeting");
  assert.equal(byUrl.get(exactNumericDate.url).eventRelevance, "direct-fixture", "numeric date formats in Panta event coverage identify the exact fixture");
  for (const item of [passingMention, previous, arsenalOther, leedsOther, context, ambiguous, conflictingCompetition]) {
    assert.notEqual(byUrl.get(item.url).eventRelevance, "direct-fixture", item.url);
    assert.equal(byUrl.get(item.url).direction, "neutral", `${item.url} cannot support an outcome claim`);
  }
  assert.equal(byUrl.get(previous.url).eventRelevance, "contextual");
  assert.equal(byUrl.get(arsenalOther.url).eventRelevance, "contextual");
  assert.equal(byUrl.get(leedsOther.url).eventRelevance, "contextual");
  assert.equal(byUrl.get(context.url).eventRelevance, "contextual");
  assert.equal(byUrl.get(ambiguous.url).eventRelevance, "contextual", "both teams without a matching date do not identify the fixture");
  assert.equal(byUrl.get(conflictingCompetition.url).eventRelevance, "contextual");

  const undatedTarget = evidenceEngine.buildEvidence({ marketQuestion: "Will Arsenal beat Leeds United?", marketCategory: "sports", results: [page("https://reuters.com/undated", "Arsenal-Leeds preview", "Arsenal will face Leeds United in the upcoming fixture.")], pages: [{ url: "https://reuters.com/undated", title: "Arsenal-Leeds preview", content: "Arsenal will face Leeds United in the upcoming fixture.", publishedAt: null, retrievedAt: "2026-10-09T09:00:00Z", retrieved: true }], plannedQueries: planned });
  assert.equal(undatedTarget[0].eventRelevance, "contextual", "without a target date, an upcoming mention cannot establish which fixture is meant");

  const intel = eventIntel.buildEventIntelligence({ query: "Research this match", market: { ...market(question, "sports"), closeAt: "2026-10-10T17:00:00Z" }, evidence: [byUrl.get(ambiguous.url), byUrl.get(arsenalOther.url), byUrl.get(exact.url)].filter(Boolean), researchedAt: "2026-10-09T10:00:00Z" });
  assert.equal(intel.marketRelevance, "directly-relevant");
  assert.ok(intel.event.evidenceIds.includes(byUrl.get(exact.url).id));
  assert.ok(!intel.event.evidenceIds.includes(byUrl.get(ambiguous.url).id), "context evidence is not represented as direct event evidence");
  const contextOnlyIntel = eventIntel.buildEventIntelligence({ query: "Research this match", market: { ...market(question, "sports"), closeAt: "2026-10-10T17:00:00Z" }, evidence: [byUrl.get(ambiguous.url), byUrl.get(arsenalOther.url)].filter(Boolean), researchedAt: "2026-10-09T10:00:00Z" });
  assert.equal(contextOnlyIntel.marketRelevance, "contextual");
  assert.match(contextOnlyIntel.event.summary, /do not identify the exact target fixture/i);
  assert.equal(contextOnlyIntel.event.timeline.length, 0);
  const snippetIntel = eventIntel.buildEventIntelligence({ query: "Research this match", market: { ...market(question, "sports"), closeAt: "2026-10-10T17:00:00Z" }, evidence: [{ ...byUrl.get(exact.url), pageRetrieved: false }], researchedAt: "2026-10-09T10:00:00Z" });
  assert.match(snippetIntel.event.summary, /search-result snippet only/i);
});

test("source hierarchy assigns primary, reporting, specialist, and unverified tiers", () => {
  const source = (url) => ({ title: "Relevant report", url, content: "Fed rate decision report", score: 0.9 });
  assert.equal(sourceEvaluator.assessSource(source("https://federalreserve.gov/news"), "Fed rate decision").tier, 1);
  assert.equal(sourceEvaluator.assessSource(source("https://www.reuters.com/news"), "Fed rate decision").tier, 2);
  assert.equal(sourceEvaluator.assessSource(source("https://www.coingecko.com/report"), "Fed rate decision").tier, 3);
  assert.equal(sourceEvaluator.assessSource(source("https://unknown.example/post"), "Fed rate decision").tier, 4);
  assert.equal(sourceEvaluator.assessSource(source("https://www.arsenal.com/news/team-update"), "Arsenal team update").sourceType, "primary-official");
  const social = sourceEvaluator.assessSource(source("https://www.facebook.com/post"), "Arsenal team update");
  assert.equal(social.sourceType, "social-user-generated");
  assert.equal(social.reliability, "low", "unverified platform metadata does not authenticate a speaker");
  assert.equal(sourceEvaluator.assessSource({ title: "West Ham vs QPR live commentary", url: "https://example.com/live", content: "West Ham United play QPR in a live match.", score: 0.9 }, "Will Arsenal beat Leeds United on October 10, 2026?").relevance, "low", "a shared generic club term must not make unrelated reporting relevant");
  assert.equal(sourceEvaluator.assessSource({ title: "Arsenal official team update", url: "https://www.arsenal.com/news/team-update", content: "Arsenal confirm their team news.", score: 0.9 }, "Will Arsenal beat Leeds United on October 10, 2026?").relevance, "medium");
});

test("Tavily missing-key and malformed-result handling do not create sources", async () => {
  const tavily = await loadTs("./tavily-search-provider.ts", { 'import "server-only";': "" });
  const unavailable = await new tavily.TavilySearchProvider("").search({ query: "market", depth: "deep" });
  assert.equal(unavailable.status, "unavailable");
  assert.equal(unavailable.results.length, 0);
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ results: [
    { title: "bad protocol", url: "http://example.com", content: "text" },
    { title: "invalid date", url: "https://example.com/story", content: "real returned content", published_date: "not a date", score: 0.5 },
  ] });
  try {
    const found = await new tavily.TavilySearchProvider("test-server-key").search({ query: "market", depth: "deep" });
    assert.equal(found.results.length, 1);
    assert.equal(found.results[0].publishedAt, null);
    assert.equal(found.results[0].url, "https://example.com/story");
  } finally { globalThis.fetch = oldFetch; }
});

test("Tavily empty results produce no source or evidence placeholders", async () => {
  const tavily = await loadTs("./tavily-search-provider.ts", { 'import "server-only";': "" });
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ results: [] });
  try {
    const result = await new tavily.TavilySearchProvider("test-server-key").search({ query: "no matching sources", depth: "deep" });
    assert.equal(result.status, "ok");
    assert.deepEqual(result.results, []);
  } finally { globalThis.fetch = oldFetch; }
});

test("Tavily timeout is identified safely and a caller cancellation remains cancellation", async () => {
  const tavily = await loadTs("./tavily-search-provider.ts", { 'import "server-only";': "" });
  const oldFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => { throw new DOMException("secret upstream detail", "TimeoutError"); };
    const timedOut = await new tavily.TavilySearchProvider("test-server-key").search({ query: "topic", depth: "quick" });
    assert.equal(timedOut.status, "error");
    assert.equal(timedOut.message, "Tavily search timed out.");
    assert.doesNotMatch(timedOut.message, /secret|upstream detail/i);
    const controller = new AbortController();
    controller.abort();
    globalThis.fetch = async () => { throw new DOMException("aborted", "AbortError"); };
    await assert.rejects(() => new tavily.TavilySearchProvider("test-server-key").search({ query: "topic", depth: "quick", signal: controller.signal }), { name: "AbortError" });
  } finally { globalThis.fetch = oldFetch; }
});

test("model synthesis rejects unknown citations instead of silently dropping them", async () => {
  const modelSynthesizer = await loadTs("./ai-synthesizer.ts", { 'import "server-only";': "", 'import { synthesizeResearchJson } from "@/lib/ai";': "const synthesizeResearchJson = async () => null;" });
  const evidence = [{ id: "source-1", title: "Arsenal training report", claim: "Arsenal confirmed the first-team squad completed training ahead of Leeds.", summary: "Arsenal confirmed the first-team squad completed training ahead of Leeds.", url: "https://example.com/real" }];
  const invalid = modelSynthesizer.validateModelSynthesis({
    summary: "A cautious finding.", stance: "mixed", assessmentEvidenceIds: ["source-1", "invented-id"],
    evidenceReviews: [],
    keyFindings: [{ text: "A grounded finding.", evidenceIds: ["source-1"] }],
    whatChanged: [], whatCouldChange: [], uncertainties: [],
  }, evidence);
  assert.equal(invalid, null);
  const valid = modelSynthesizer.validateModelSynthesis({ summary: "Arsenal confirmed training ahead of Leeds, but this does not establish a result.", stance: "mixed", assessmentEvidenceIds: ["source-1"], evidenceReviews: [], keyFindings: [{ text: "Arsenal confirmed the first-team squad trained.", evidenceIds: ["source-1"] }], whatChanged: [], whatCouldChange: [], uncertainties: [] }, evidence);
  assert.ok(valid, modelSynthesizer.modelSynthesisValidationFailure({ summary: "Arsenal confirmed training ahead of Leeds, but this does not establish a result.", stance: "mixed", assessmentEvidenceIds: ["source-1"], evidenceReviews: [], keyFindings: [{ text: "Arsenal confirmed the first-team squad trained.", evidenceIds: ["source-1"] }], whatChanged: [], whatCouldChange: [], uncertainties: [] }, evidence));
  assert.deepEqual(valid.assessmentEvidenceIds, ["source-1"]);
  assert.deepEqual(valid.keyFindings[0].evidenceIds, ["source-1"]);
  const mapper = await loadTs("./ai-synthesizer.ts", { 'import "server-only";': "", 'import { synthesizeResearchJson } from "@/lib/ai";': "const synthesizeResearchJson = async (input) => input.validate(globalThis.__miraStructuredGroqOutput);" });
  globalThis.__miraStructuredGroqOutput = { summary: "Arsenal confirmed training ahead of Leeds, but this does not establish a result.", stance: "mixed", assessmentEvidenceIds: ["E1"], evidenceReviews: [], keyFindings: [{ text: "Arsenal confirmed the first-team squad trained.", evidenceIds: ["E1"] }], whatChanged: [], whatCouldChange: [], uncertainties: [] };
  const mapped = await mapper.synthesizeWithModelDetailed({ market: market("Will Arsenal beat Leeds United on October 10, 2026?", "sports"), evidence: [{ ...evidence[0], id: "source-1", eventRelevance: "direct-fixture" }], marketImpliedProbability: null, priorUrls: [] });
  assert.equal(mapped.failureReason, null);
  assert.deepEqual(mapped.synthesis.assessmentEvidenceIds, ["source-1"], "compact model IDs map back to stable evidence IDs");
  assert.deepEqual(mapped.synthesis.keyFindings[0].evidenceIds, ["source-1"]);
  delete globalThis.__miraStructuredGroqOutput;
  assert.equal(modelSynthesizer.validateModelSynthesis({ summary: "Uncited", stance: "mixed", assessmentEvidenceIds: ["invented-id"] }, evidence), null);
  const insufficient = modelSynthesizer.validateModelSynthesis({ summary: "The Arsenal training report does not establish either case.", stance: "insufficient", assessmentEvidenceIds: ["source-1"], evidenceReviews: [], keyFindings: [], whatChanged: [], whatCouldChange: [], uncertainties: [] }, evidence);
  assert.deepEqual(insufficient.assessmentEvidenceIds, ["source-1"]);
  assert.equal(modelSynthesizer.validateModelSynthesis({ summary: "The available records do not establish either case.", stance: "insufficient", assessmentEvidenceIds: [], evidenceReviews: [], keyFindings: [], whatChanged: [], whatCouldChange: [], uncertainties: [] }, evidence), null, "uncited insufficient assessments cannot ignore supplied evidence");
  const noEvidence = modelSynthesizer.validateModelSynthesis({ summary: "No relevant evidence was supplied; the outcome cannot be assessed.", stance: "insufficient", assessmentEvidenceIds: [], evidenceReviews: [], keyFindings: [], whatChanged: [], whatCouldChange: [], uncertainties: [] }, []);
  assert.deepEqual(noEvidence.assessmentEvidenceIds, [], "a genuine no-evidence result does not invent a citation");
  const unsupported = { summary: "Arsenal won 3-0 against Leeds.", stance: "favorable-yes", assessmentEvidenceIds: ["source-1"], evidenceReviews: [], keyFindings: [{ text: "Arsenal won 3-0.", evidenceIds: ["source-1"] }], whatChanged: [], whatCouldChange: [], uncertainties: [] };
  assert.equal(modelSynthesizer.validateModelSynthesis(unsupported, evidence), null, "a real ID does not make unsupported score/result claims valid");
  assert.match(modelSynthesizer.modelSynthesisValidationFailure(unsupported, evidence), /number or date absent/);
  const unsupportedVerblessNumber = { ...unsupported, summary: "Arsenal won against Leeds.", keyFindings: [{ text: "Arsenal won against Leeds.", evidenceIds: ["source-1"] }] };
  assert.equal(modelSynthesizer.validateModelSynthesis(unsupportedVerblessNumber, evidence), null, "unsupported outcome verbs are rejected even without invented scores");
  assert.match(modelSynthesizer.modelSynthesisValidationFailure(unsupportedVerblessNumber, evidence), /factual terms absent/);
  assert.equal(modelSynthesizer.validateModelSynthesis({ ...unsupported, summary: "Arsenal training is mentioned.", assessmentEvidenceIds: ["fabricated-id"] }, evidence), null, "fabricated IDs are rejected");
  const contextOnlyEvidence = [{ ...evidence[0], eventRelevance: "contextual" }];
  assert.equal(modelSynthesizer.validateModelSynthesis({ ...valid, stance: "favorable-yes" }, contextOnlyEvidence), null, "context-only team information cannot support a target-fixture stance");
  const badOutput = modelSynthesizer.validateModelSynthesis({ summary: "A finding", stance: "mixed", assessmentEvidenceIds: [], evidenceReviews: [], keyFindings: [], whatChanged: [], whatCouldChange: [], uncertainties: [] }, evidence);
  assert.equal(badOutput, null, "non-insufficient claims still require a valid citation");
  assert.equal(modelSynthesizer.validateModelSynthesis({ summary: "Arsenal won the fixture.", stance: "insufficient", assessmentEvidenceIds: [], evidenceReviews: [], keyFindings: [], whatChanged: [], whatCouldChange: [], uncertainties: [] }, evidence), null, "insufficient stance does not excuse an uncited factual claim");
  assert.equal(modelSynthesizer.validateModelSynthesis("not JSON", evidence), null, "malformed model output is rejected");
  assert.match(modelSynthesizer.modelSynthesisValidationFailure({ summary: "x", stance: "mixed" }, evidence), /missing required fields/);
  assert.match(modelSynthesizer.modelSynthesisValidationFailure({ summary: "x", stance: "mixed", assessmentEvidenceIds: ["fake"], evidenceReviews: [], keyFindings: [], whatChanged: [], whatCouldChange: [], uncertainties: [] }, evidence), /evidence ID that was not supplied/);
});

test("research cache keys separate market, depth, and query", async () => {
  const cache = await loadTs("./research-cache.ts");
  const key = cache.researchCacheKey({ marketId: "market-1", depth: "deep", query: "Research this" });
  assert.notEqual(key, cache.researchCacheKey({ marketId: "market-2", depth: "deep", query: "Research this" }));
  assert.notEqual(key, cache.researchCacheKey({ marketId: "market-1", depth: "quick", query: "Research this" }));
  assert.notEqual(key, cache.researchCacheKey({ marketId: "market-1", depth: "deep", query: "What's changed?" }));
});

test("an explicit topic with no matching Panta market researches the topic without borrowing selected-market context", async () => {
  let discoveredQuery = "";
  let searches = 0;
  const provider = {
    source: "panta", environment: "test",
    getMarket: async () => null,
    discoverMarkets: async (query) => { discoveredQuery = query; return []; },
  };
  historicalState.evidence = [{ id: "bitcoin-source", claim: "Bitcoin topic source claim.", summary: "Bitcoin topic source claim with enough contextual detail to review.", title: "Bitcoin reporting", source: "Example", domain: "example.com", url: "https://example.com/bitcoin", publishedAt: null, retrievedAt: "2026-10-08T10:00:00.000Z", direction: "neutral", relevance: "medium", reliability: "medium", sourceTier: 2, reliabilityReason: "Test fixture source", sourceType: "independent-reporting", independenceStatus: "unknown", evidenceType: "reporting", pageRetrieved: true, freshness: "undated" }];
  historicalState.search = { search: async () => { searches += 1; return { status: "ok", results: [{ title: "Bitcoin reporting", url: "https://example.com/bitcoin", content: "Bitcoin topic source claim with enough contextual detail to review.", rawContent: "Bitcoin source content.", publishedAt: null, score: 0.8, query: "Bitcoin" }] }; } };
  const report = await historical.runResearch({
    question: "What is happening with Bitcoin?",
    contextMarkets: [{ id: "arsenal-1", question: "Will Arsenal win the next match?" }],
    provider,
  });
  assert.equal(searches, 2, "the planned topic searches run even without a matching Panta contract");
  assert.equal(discoveredQuery, "", "general topic research does not search for an unrelated contract");
  assert.equal(report.market, null);
  assert.equal(report.evidence.length, 1);
  assert.equal(report.status, "partial", "general research is labeled partial because no Panta contract was matched");
  assert.match(report.synthesisMessage, /general topic research/i);
  const topicSummary = synthesizer.synthesizeResearch({ market: null, evidence: historicalState.evidence, refreshed: false, marketImpliedProbability: null });
  assert.match(topicSummary.conclusion, /no relevant Panta market/i);
  assert.doesNotMatch(report.conclusion, /Arsenal/i);
});

test("validated model synthesis preserves stable evidence citations in the final research report", async () => {
  const selected = { ...market("Will Bitcoin reach $85,000?"), closeAt: "2026-12-31T00:00:00.000Z" };
  const source = { id: "bitcoin-report-id", claim: "Bitcoin demand increased according to a retrieved market report.", summary: "Bitcoin demand increased according to a retrieved market report.", title: "Bitcoin demand report", source: "Example", domain: "example.com", url: "https://example.com/bitcoin-demand", publishedAt: "2026-10-08T10:00:00.000Z", retrievedAt: "2026-10-09T10:00:00.000Z", direction: "neutral", relevance: "high", reliability: "medium", sourceTier: 2, reliabilityReason: "Test source", sourceType: "independent-reporting", independenceStatus: "unknown", usageStatus: "used", usageReason: "Test evidence", evidenceType: "reporting", pageRetrieved: true, freshness: "fresh" };
  historicalState.evidence = [source];
  historicalState.modelSynthesisResult = { synthesis: { summary: "Bitcoin demand increased according to the retrieved report.", stance: "insufficient", assessmentEvidenceIds: [source.id], evidenceReviews: [], keyFindings: [{ text: "Bitcoin demand increased.", evidenceIds: [source.id] }], whatChanged: [], whatCouldChange: [], uncertainties: [] }, failureReason: null };
  historicalState.search = { search: async () => ({ status: "ok", results: [{ title: source.title, url: source.url, content: source.claim, rawContent: source.claim, publishedAt: source.publishedAt, score: 0.9, query: "Bitcoin research" }] }) };
  const provider = { source: "panta", environment: "live", getMarket: async () => selected, discoverMarkets: async () => [] };
  const report = await historical.runResearch({ question: "Research this market", contextMarkets: [{ id: selected.id, question: selected.question }], provider, marketId: selected.id, refresh: true });
  assert.equal(historicalState.modelSynthesisCalls, 1);
  assert.equal(report.synthesisMode, "model");
  assert.ok(report.conclusion.includes("Bitcoin demand report"), "the validated assessment citation is retained in the rendered report text");
  assert.ok(report.keyFindings[0].includes("Bitcoin demand report"));
  assert.equal(report.evidence[0].id, source.id, "evidence IDs remain stable in the report collection");
  assert.equal(report.evidence[0].url, source.url, "original URL survives synthesis");
  assert.equal(report.evidence[0].publishedAt, source.publishedAt);
  assert.equal(report.evidence[0].retrievedAt, source.retrievedAt);
  delete historicalState.modelSynthesisResult;
});

test("a cancelled research request exits before Panta discovery or persistence work", async () => {
  const controller = new AbortController();
  controller.abort();
  let providerCalls = 0;
  const provider = { source: "panta", getMarket: async () => { providerCalls += 1; return null; }, discoverMarkets: async () => { providerCalls += 1; return []; } };
  await assert.rejects(() => historical.runResearch({ question: "What is happening with Bitcoin?", contextMarkets: [], provider, signal: controller.signal }), { name: "AbortError" });
  assert.equal(providerCalls, 0);
});

test("research-provider failure preserves the independently retrieved Panta market fields", async () => {
  const selected = market("Will Bitcoin reach $85,000?");
  historicalState.search = { search: async () => ({ status: "error", results: [], message: "Tavily search timed out." }) };
  historicalState.evidence = [];
  const provider = { source: "panta", environment: "live", getMarket: async () => selected, discoverMarkets: async () => [] };
  const report = await historical.runResearch({ question: selected.question, marketId: selected.id, contextMarkets: [{ id: selected.id, question: selected.question }], provider, refresh: true });
  assert.equal(report.market?.id, selected.id);
  assert.equal(report.market?.yesProbability, selected.yesProbability);
  assert.equal(report.market?.volumeUsd, selected.volumeUsd);
  assert.equal(report.evidence.length, 0);
  assert.equal(report.searchStatus, "failed");
  assert.match(report.searchMessage, /Tavily search timed out/);
});

test("research makes at most one supplemental search when trusted evidence supports only one side", async () => {
  delete historicalState.modelSynthesisResult;
  const selected = market("Will Bitcoin reach $85,000?");
  historicalState.searchCalls = 0;
  const supplementalQueries = [];
  historicalState.search = { search: async (request) => {
    historicalState.searchCalls += 1;
    const supplemental = request.query.includes("independent reporting");
    if (supplemental) supplementalQueries.push(request.query);
    const yes = !supplemental && request.query === "yes";
    if (!yes && !supplemental) return { status: "ok", results: [] };
    const url = yes ? "https://example.com/yes" : "https://example.com/no";
    return { status: "ok", results: [{ title: yes ? "Bitcoin demand rises" : "Bitcoin downside risks", url, content: "A sufficiently detailed retrieved report about Bitcoin market activity and its possible implications.", rawContent: null, publishedAt: null, score: 0.9, query: request.query }] };
  } };
  historicalState.evidenceBuilder = ({ results, plannedQueries }) => results.map((result) => ({
    id: result.url, title: result.title, claim: result.content, summary: result.content, source: "example.com", domain: "example.com", url: result.url,
    publishedAt: null, retrievedAt: "2026-10-09T12:00:00.000Z", direction: plannedQueries[0]?.side === "no" ? "supports-no" : "supports-yes",
    reliability: "high", relevance: "high", independenceStatus: "unknown", pageRetrieved: true,
  }));
  const provider = { source: "panta", environment: "test", getMarket: async () => selected, discoverMarkets: async () => [] };
  const report = await historical.runResearch({ question: selected.question, marketId: selected.id, contextMarkets: [{ id: selected.id, question: selected.question }], provider, depth: "quick", refresh: true });
  assert.equal(historicalState.searchCalls, 3, "two planned searches plus one bounded supplemental call");
  assert.equal(supplementalQueries.length, 1);
  assert.ok(report.evidence.some((item) => item.direction === "supports-no"));
  assert.equal(report.plan.queries.length, 3);
  assert.match(report.plan.queries[2].dimension, /adaptive evidence gap/);
  assert.equal(report.synthesisMode, "deterministic");
  assert.match(report.synthesisMessage, /test provider failure/i);
  assert.equal(report.diagnostics.groqStatus, "failed");
  assert.equal(report.diagnostics.fallbackUsed, true);
  delete historicalState.evidenceBuilder;
});

test("publication time comes from source metadata and never retrieval time", () => {
  assert.equal(pageReader.extractPublicationDate('<meta property="article:published_time" content="2026-10-01T09:00:00Z">'), "2026-10-01T09:00:00.000Z");
  assert.equal(pageReader.extractPublicationDate('<script type="application/ld+json">{"datePublished":"2026-10-02"}</script>'), "2026-10-02T00:00:00.000Z");
  assert.equal(pageReader.extractPublicationDate('<time datetime="2026-10-03">October 3</time>'), "2026-10-03T00:00:00.000Z");
  assert.equal(pageReader.extractPublicationDate("Published: October 4, 2026"), "2026-10-04T00:00:00.000Z");
  assert.equal(pageReader.extractPublicationDate("Retrieved October 7, 2026. No publication metadata."), null);
  assert.deepEqual(pageReader.extractPublicationDateInfo('<script type="application/ld+json">{"datePublished":"2026-10-02"}</script>'), { publishedAt: "2026-10-02T00:00:00.000Z", precision: "date" });
  assert.deepEqual(pageReader.extractPublicationDateInfo('<meta property="article:published_time" content="2026-10-01T09:00:00Z">'), { publishedAt: "2026-10-01T09:00:00.000Z", precision: "timestamp" });
});

test("resolved markets are explicitly excluded from fresh directional assessment", () => {
  assert.equal(marketStatus.isResolvedMarket("resolved"), true);
  assert.equal(marketStatus.isResolvedMarket("active"), false);
  assert.equal(marketStatus.isResolvedMarket("closed"), false);
});

test("resolved markets can be researched for historical context without current prices or directional forecasts", async () => {
  const resolved = market("Will Bitcoin hit $85,000 by October 4?", "crypto");
  resolved.status = "resolved";
  historicalState.spotCalls = 0;
  historicalState.modelSynthesisCalls = 0;
  historicalState.searchCalls = 0;
  historicalState.evidence = [
    { id: "yes-source", title: "Historical upside report", url: "https://example.com/yes", summary: "Historical source supporting YES.", claim: "Historical source supporting YES.", source: "Example", domain: "example.com", publishedAt: "2026-10-03T00:00:00Z", retrievedAt: "2026-10-07T00:00:00Z", direction: "supports-yes", relevance: "high", reliability: "medium", reliabilityReason: "test source", evidenceType: "reporting", pageRetrieved: true, freshness: "stale" },
    { id: "no-source", title: "Historical downside report", url: "https://example.com/no", summary: "Historical source supporting NO.", claim: "Historical source supporting NO.", source: "Example", domain: "example.com", publishedAt: "2026-10-03T00:00:00Z", retrievedAt: "2026-10-07T00:00:00Z", direction: "supports-no", relevance: "high", reliability: "medium", reliabilityReason: "test source", evidenceType: "reporting", pageRetrieved: true, freshness: "stale" },
  ];
  historicalState.search = { search: async () => { historicalState.searchCalls += 1; return { status: "ok", results: [{ title: "Historical result", url: `https://example.com/${historicalState.searchCalls}`, content: "Retrieved historical source text with enough detail.", rawContent: null, publishedAt: "2026-10-03T00:00:00Z", score: 0.9, query: "historical query" }] }; } };
  const provider = { source: "panta", environment: "live", getMarket: async () => resolved, discoverMarkets: async () => [] };
  const report = await historical.runResearch({ question: "What changed since yesterday?", contextMarkets: [{ id: resolved.id, question: resolved.question }], provider, marketId: resolved.id, refresh: true });
  assert.equal(historicalState.searchCalls, 2, "fresh historical research performs its planned Tavily searches");
  assert.equal(report.refreshed, true);
  assert.equal(report.evidence.length, 2);
  assert.equal(report.status, "limited");
  assert.equal(report.marketImpliedProbability, null);
  assert.equal(report.marketMetrics.spotPriceUsd, null);
  assert.equal(historicalState.spotCalls, 0, "resolved markets do not use current spot data");
  assert.equal(historicalState.modelSynthesisCalls, 0, "resolved markets do not ask Groq for a directional assessment");
  assert.equal(report.assessment.stance, "insufficient");
  assert.match(report.conclusion, /resolved.*historical context only/i);
  assert.match(report.synthesisMessage, /disabled for resolved markets/);
  assert.deepEqual(report.evidence.map((item) => item.direction), ["supports-yes", "supports-no"]);
});
