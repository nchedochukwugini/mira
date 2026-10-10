import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const state = globalThis.__miraAnalyzeTest = {};
const moduleUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;

const conversationSource = await readFile(new URL("./conversation.ts", import.meta.url), "utf8");
const conversationJavascript = ts.transpileModule(conversationSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const conversationUrl = moduleUrl(conversationJavascript);
const tradeSafetySource = await readFile(new URL("../panta/trade-safety.ts", import.meta.url), "utf8");
const tradeSafetyJavascript = ts.transpileModule(tradeSafetySource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const tradeSafetyUrl = moduleUrl(tradeSafetyJavascript);
const mocks = {
  "next/server": `export const NextResponse={json:(data,init={})=>new Response(JSON.stringify(data),{...init,headers:{"content-type":"application/json",...init.headers}})};`,
  "@/lib/intelligence/conversation": null,
  "@/lib/intelligence/analyzeMarketQuestion": `export async function analyzeMarketQuestion(question){const s=globalThis.__miraAnalyzeTest;s.analysisQuestion=question;return s.analysisResult}`,
  "@/lib/providers/market-provider": `const s=()=>globalThis.__miraAnalyzeTest; export function getMarketProvider(){s().pantaAcquires++;return {source:"panta",environment:"test",getMarket:async(id)=>{s().pantaCalls++;s().marketLookupCalls++;if(s().failPantaTimeout)throw new globalThis.__MiraPantaError("Panta API request timed out.",504);if(s().failPanta)throw Error("Panta unavailable");return s().marketById?.[id]??null},discoverMarkets:async(query)=>{s().pantaCalls++;s().discoveredQuery=query;return s().discoveredMarkets??[]}}}`,
  "@/lib/panta/client": `export class PantaError extends Error { constructor(message,status){super(message);this.status=status;} } globalThis.__MiraPantaError=PantaError;`,
  "@/lib/panta/trade-safety": tradeSafetyJavascript,
  "@/lib/research": `export async function runResearch(input){const s=()=>globalThis.__miraAnalyzeTest;s().researchRuns++;s().tavilyCalls++;s().researchInput=input;return s().freshReport}`,
  "@/lib/markets/spot-price": `export async function getSpotPrice(){globalThis.__miraAnalyzeTest.spotCalls++;return null}`,
  "@/lib/intelligence/core": `export const calculateMovement=()=>null;export const extractMarketIntent=()=>({});export const rankMarkets=()=>[];export const semanticRelevance=(query,market)=>globalThis.__miraAnalyzeTest.marketScores?.[market.id]??0;`,
  "@/lib/ai": `export async function understandMessage(message,context){const s=globalThis.__miraAnalyzeTest;s.groqCalls++;s.lastGroqContext=context;return s.modelIntent??null}export async function explainMarketReasoning(){return null}`,
  "@/lib/db": `const s=()=>globalThis.__miraAnalyzeTest;export async function getConversation(){s().neonReads++;if(s().failNeon)throw Error("Neon unavailable");return s().savedConversation??{messages:[],state:{}}}export async function getPantaMicrostructureHistory(){return []}export async function getPersistedVerifiedFills(){s().fillReads=(s().fillReads??0)+1;return null}export async function getLatestMarketResearch(){return {status:"not-run",evidence:[]}}export async function persistMarketObservation(){if(s().failNeonWrite)throw Error("Neon write unavailable");s().neonWrites++}export async function persistResearch(){if(s().failNeonWrite)throw Error("Neon write unavailable");s().neonWrites++;s().researchPersists++}`,
  "@/lib/intelligence/persisted-fills": `export function summarizePersistedFills(input){return {source:"persisted-verified-fills",marketId:input.marketId,eventPda:null,status:"unavailable",observedFrom:null,observedTo:null,lastFillAt:null,verifiedFillCount:null,metrics:null,coverageStatus:"unavailable",limitations:["test unavailable"],transactions:[]}}`,
  "@/lib/intelligence/market-reasoning": `export function buildMarketReasoning(){return {explanation:"Deterministic market reasoning",signals:[],uncertainty:[]}}`,
};
mocks["@/lib/intelligence/conversation"] = `export {classifyConversationMessage,shouldInterpretWithGroq,answerMarketDetail,asksForMarketReasoning,extractExplicitSubject} from "${conversationUrl}"`;

let routeSource = await readFile(new URL("../../app/api/analyze/route.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(routeSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
let mapped = compiled;
for (const [specifier, source] of Object.entries(mocks)) mapped = mapped.replaceAll(`"${specifier}"`, `"${specifier === "@/lib/panta/trade-safety" ? tradeSafetyUrl : moduleUrl(source)}"`);
let route;
try { route = await import(moduleUrl(mapped)); } catch (error) { throw new Error(error instanceof Error ? error.message : String(error)); }

const evidence = [
  { title: "Upside inflows", source: "Example Yes", url: "https://yes.example/story", publishedAt: "2026-10-06T00:00:00.000Z", summary: "Institutional inflows rose, supporting the YES outcome.", direction: "supports-yes" },
  { title: "Downside risk", source: "Example No", url: "https://no.example/story", publishedAt: null, summary: "A demand shock could prevent the target, supporting NO.", direction: "supports-no" },
];
const freshReport = { market: { id: "m-1", question: "Will Bitcoin reach $100k?" }, researchedAt: "2026-10-07T00:00:00.000Z", evidence: [{ id: "fresh-1", url: "https://fresh.example/report", direction: "supports-no" }], status: "complete", refreshed: true, conclusion: "Fresh report", plan: {}, assessment: {}, keyFindings: [], uncertainty: [] };
const reset = () => Object.assign(state, { groqCalls: 0, tavilyCalls: 0, pantaCalls: 0, pantaAcquires: 0, marketLookupCalls: 0, spotCalls: 0, researchRuns: 0, researchPersists: 0, neonReads: 0, neonWrites: 0, discoveredQuery: undefined, discoveredMarkets: [], marketScores: {}, failPanta: false, failPantaTimeout: false, failNeon: false, failNeonWrite: false, marketById: {}, freshReport, researchInput: undefined, lastGroqContext: undefined, modelIntent: undefined, analysisQuestion: undefined, analysisResult: { id:"test",markets:[],answer:"Compared using saved market context",createdAt:"2026-10-07T00:00:00.000Z",confidence:"insufficient",source:"panta" }, savedConversation: { messages: [], state: {} } });
async function analyze(question, context = {}, signal) {
  const persistedContext = context.conversationId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(context.conversationId)
    ? { ...context, conversationId: "00000000-0000-4000-8000-000000000001" }
    : context;
  const response = await route.POST(new Request("http://localhost/api/analyze", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question, context: persistedContext }), ...(signal ? { signal } : {}) }));
  return { status: response.status, body: await response.json() };
}

test("greetings return MIRA responses without Groq, Tavily, or Panta calls", async () => {
  for (const message of ["Hi", "Hello", "Hey", "Good morning", "Thanks", "Goodbye"]) {
    reset();
    const result = await analyze(message, { conversationId: "persisted-conversation" });
    assert.equal(result.status, 200, message);
    assert.equal(result.body.intent, "greeting", message);
    assert.ok(result.body.reply, message);
    assert.equal(state.groqCalls, 0, `${message}: Groq`);
    assert.equal(state.tavilyCalls, 0, `${message}: Tavily`);
    assert.equal(state.pantaCalls, 0, `${message}: Panta API`);
    assert.equal(state.pantaAcquires, 0, `${message}: Panta provider`);
    assert.equal(state.neonReads, 1, `${message}: load persisted conversation`);
  }
});

test("Groq receives only the bounded persisted conversation window for follow-up understanding", async () => {
  reset();
  state.modelIntent = { intent: "general", requiresMarketData: false, reply: "They differ in the metric you asked about.", marketReference: { type: "none", value: "" } };
  const history = Array.from({ length: 10 }, (_, index) => ({
    role: index % 2 ? "assistant" : "user",
    content: index % 2 ? `Older answer ${index}` : `Older question ${index}`,
  }));
  history.push({ role: "user", content: "Why are those different?" });
  state.savedConversation = { messages: history, state: {} };
  const result = await analyze("Why are those different?", { conversationId: "bounded-history" });
  assert.equal(result.status, 200);
  assert.equal(result.body.reply, "They differ in the metric you asked about.");
  assert.equal(state.lastGroqContext.recentMessages.length, 6);
  assert.equal(state.lastGroqContext.recentMessages.at(-1).content, "Older answer 9");
  assert.ok(state.lastGroqContext.recentMessages.every((message) => message.content.length <= 400));
});

test("Bitcoin teaching follow-ups stay conversational despite an unrelated selected market", async () => {
  reset();
  state.savedConversation = { messages: [], state: { activeMarketId: "arsenal", markets: [{ id: "arsenal", question: "Will Arsenal win the next match?" }] } };
  const turns = [
    ["Mira explain bitcoin price to me as if I am a beginner", "general", "Bitcoin's price is the amount people are currently willing to pay for one bitcoin. Think of it like a changing price tag.", false],
    ["I don't understand. Can you explain that more simply?", "general", "Bitcoin's price is like a price tag that changes when more people want to buy or sell it.", false],
    ["Give me a real example.", "general", "Imagine one bitcoin costs 60,000 dollars: someone with half a bitcoin would have about 30,000 dollars worth, before fees.", false],
    ["Why does that happen?", "general", "The price changes because buyers and sellers keep making offers, and the latest agreement becomes the displayed price.", false],
    ["Okay, now compare it with Ethereum.", "market_analysis", "Bitcoin and Ethereum serve different purposes: Bitcoin focuses on peer-to-peer money, while Ethereum supports programmable applications. Are you asking for a conceptual comparison or measured market activity?", false],
    ["You misunderstood me. I meant trading activity, not price.", "market_analysis", "Bitcoin and Ethereum activity comparison: available verified matches will be reported; unavailable activity data is marked unavailable.", true],
  ];
  for (const [question, intent, reply, requiresMarketData] of turns) {
    const isActivityCorrection = /trading activity/i.test(question);
    state.modelIntent = { intent, requiresMarketData, reply, marketReference: { type: "none", value: "" }, analysisQuestion: "Compare verified Bitcoin and Ethereum trading activity", ...(/compare it with Ethereum|trading activity/i.test(question) ? { comparisonSubjects: ["Bitcoin", "Ethereum"], comparisonDimension: isActivityCorrection ? "activity" : "conceptual" } : {}) };
    const result = await analyze(question, { conversationId: "topic-continuity" });
    assert.equal(result.status, 200, question);
    assert.equal(result.body.intent, intent, question);
    if (intent === "market_analysis") {
      if (requiresMarketData) {
        assert.equal(result.body.activityComparison.observations.length, 2);
        assert.deepEqual(result.body.activityComparison.observations.map((observation) => observation.subject), ["Bitcoin", "Ethereum"]);
        assert.ok(result.body.activityComparison.observations.every((observation) => observation.status === "empty"), "empty catalog result is reported without inventing activity");
      } else assert.doesNotMatch(result.body.reply, /which two markets/i);
    }
    else assert.equal(result.body.reply, reply, question);
    if (!requiresMarketData) {
      assert.equal(state.pantaCalls, 0, `${question}: must not call Panta`);
      assert.equal(state.pantaAcquires, 0, `${question}: must not acquire a Panta provider`);
      assert.equal(state.spotCalls, 0, `${question}: explanation must not fetch spot quotes`);
    }
    state.savedConversation.messages.push({ role: "user", content: question }, { role: "assistant", content: result.body.reply });
  }
  assert.equal(state.groqCalls, turns.length, "each contextual turn is interpreted by Groq");
  assert.ok(state.savedConversation.messages.some((message) => message.role === "user" && /trading activity, not price/i.test(message.content)), "the correction remains persisted for the next follow-up");
});

test("science and business follow-ups use dialogue context rather than the selected market", async () => {
  for (const [history, followup, answer] of [
    [[{ role: "user", content: "Explain how vaccines train the immune system." }, { role: "assistant", content: "They help the immune system recognize a target." }], "Can you give an example?", "A vaccine can show immune cells a harmless piece of a virus so they can recognize it later."],
    [[{ role: "user", content: "How does compound interest work for a small business?" }, { role: "assistant", content: "Returns can build on earlier returns." }], "What if I meant simple interest?", "With simple interest, each period's interest is calculated on the original amount, not on prior interest."],
    [[{ role: "user", content: "Explain the offside rule in football." }, { role: "assistant", content: "It limits attackers waiting near the goal." }], "Actually, I meant American football.", "Got it: in American football, offside is a pre-snap penalty for a defender crossing the line of scrimmage."],
  ]) {
    reset();
    state.savedConversation = { messages: history, state: { activeMarketId: "btc", markets: [{ id: "btc", question: "Will Bitcoin exceed $100k?" }] } };
    state.modelIntent = { intent: "general", requiresMarketData: false, reply: answer, marketReference: { type: "none", value: "" } };
    const result = await analyze(followup, { conversationId: "cross-domain" });
    assert.equal(result.status, 200);
    assert.equal(result.body.reply, answer);
    assert.equal(state.pantaCalls, 0);
    assert.equal(state.spotCalls, 0);
    assert.equal(state.lastGroqContext.recentMessages[0].content, history[0].content);
  }
});

test("an explicit activity correction beats a stale selected-market detail classification", async () => {
  reset();
  state.savedConversation = {
    messages: [
      { role: "user", content: "Explain Bitcoin price to me simply." },
      { role: "assistant", content: "Bitcoin price is the amount buyers and sellers agree on." },
      { role: "user", content: "Compare it with Ethereum." },
      { role: "assistant", content: "Bitcoin and Ethereum differ in purpose and market activity." },
      { role: "user", content: "I meant trading activity, not price." },
    ],
    state: { activeMarketId: "selected-market", markets: [{ id: "selected-market", question: "Will an unrelated sports team win?" }] },
  };
  state.modelIntent = { intent: "market_detail", requiresMarketData: true, reply: "Looking up selected market", marketReference: { type: "active", value: "" }, comparisonSubjects: ["Bitcoin", "Ethereum"], comparisonDimension: "activity" };
  const result = await analyze("I meant trading activity, not price.", { conversationId: "corrected-comparison" });
  assert.equal(result.status, 200);
  assert.equal(result.body.intent, "market_analysis");
  assert.deepEqual(result.body.activityComparison.observations.map((item) => item.subject), ["Bitcoin", "Ethereum"]);
  assert.equal(state.marketLookupCalls, 0, "the stale selected market is never fetched");
  assert.equal(state.pantaCalls, 2, "only the two explicitly resolved comparison subjects are discovered");
});

test("Groq-unavailable contextual corrections never fall back to the selected market", async () => {
  reset();
  state.savedConversation = {
    messages: [
      { role: "user", content: "Explain Bitcoin price to me simply." },
      { role: "assistant", content: "Bitcoin price is set by buyers and sellers." },
      { role: "user", content: "Compare it with Ethereum." },
      { role: "assistant", content: "Bitcoin and Ethereum are different networks." },
    ],
    state: { activeMarketId: "stale-market", markets: [{ id: "stale-market", question: "Will an unrelated market resolve?" }] },
  };
  const result = await analyze("You misunderstood me. I meant trading activity, not price.", { conversationId: "model-unavailable-followup" });
  assert.equal(result.status, 200);
  assert.equal(result.body.aiMode, "limited");
  assert.match(result.body.reply, /language model is unavailable/i);
  assert.equal(state.pantaCalls, 0);
  assert.equal(state.spotCalls, 0);
  assert.equal(state.tavilyCalls, 0);
});

test("YES and NO follow-ups reuse only matching prior evidence and never start fresh research", async () => {
  for (const [question, expectedDirection, excludedDirection, label] of [
    ["What supports NO?", "supports-no", "supports-yes", "NO"],
    ["What supports YES?", "supports-yes", "supports-no", "YES"],
  ]) {
    reset();
    const result = await analyze(question, {
      markets: [{ id: "m-1", question: "Will Bitcoin reach $100k?" }], activeMarketId: "m-1",
      researchMarketId: "m-1", researchQuestion: "Will Bitcoin reach $100k?", researchSummary: "Prior evidence review",
      researchEvidence: evidence,
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.intent, "research");
    assert.match(result.body.reply, new RegExp(`supporting ${label}`));
    assert.match(result.body.reply, new RegExp(expectedDirection === "supports-no" ? "Downside risk" : "Upside inflows"));
    assert.doesNotMatch(result.body.reply, new RegExp(excludedDirection === "supports-no" ? "Downside risk" : "Upside inflows"));
    assert.equal(state.researchRuns, 0, `${question}: research runs`);
    assert.equal(state.tavilyCalls, 0, `${question}: Tavily`);
    assert.equal(state.pantaCalls, 0, `${question}: Panta API`);
    assert.equal(state.groqCalls, 1, `${question}: optional language interpretation`);
    assert.equal(state.lastGroqContext.activeMarketId, "m-1");
  }
});

test("an existing report with no classified evidence does not trigger duplicate research", async () => {
  reset();
  const result = await analyze("What supports NO?", {
    markets: [{ id: "m-1", question: "Will Bitcoin reach $100k?" }], activeMarketId: "m-1",
    researchMarketId: "m-1", researchQuestion: "Will Bitcoin reach $100k?", researchSummary: "The market is resolved; no fresh assessment was made.", researchEvidence: [],
  });
  assert.equal(result.status, 200);
  assert.match(result.body.reply, /prior research did not retrieve a source classified as supporting NO/i);
  assert.equal(state.researchRuns, 0);
  assert.equal(state.tavilyCalls, 0);
  assert.equal(state.pantaCalls, 0);
});

test("Groq cannot override a deterministic comparison resolved from saved market context", async () => {
  reset();
  state.modelIntent = { intent: "clarification", requiresMarketData: false, reply: "Which market?", marketReference: { type: "none", value: "" } };
  const result = await analyze("Compare this with the first Bitcoin market", {
    markets: [{ id: "btc-1", question: "Will Bitcoin exceed $100k?" }, { id: "btc-2", question: "Will Bitcoin reach $120k?" }], activeMarketId: "btc-2",
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.intent, "market_analysis");
  assert.match(state.analysisQuestion, /Will Bitcoin exceed \$100k/);
  assert.match(state.analysisQuestion, /Will Bitcoin reach \$120k/);
});

test("explicit freshness requests run new research and persist its new evidence", async () => {
  reset();
  const result = await analyze("What changed since yesterday?", {
    markets: [{ id: "m-1", question: "Will Bitcoin reach $100k?" }], activeMarketId: "m-1",
    researchMarketId: "m-1", researchQuestion: "Will Bitcoin reach $100k?", researchSummary: "Old report", researchEvidence: evidence,
  });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.researchReport.refreshed, true);
  assert.equal(result.body.researchReport.evidence[0].id, "fresh-1");
  assert.equal(state.researchRuns, 1);
  assert.equal(state.tavilyCalls, 1);
  assert.equal(state.researchInput.refresh, true);
  assert.equal(state.researchInput.marketId, "m-1");
  assert.equal(state.researchPersists, 1, "fresh research report persisted");
});

test("Panta and Neon read failures return errors without fabricating data", async () => {
  reset();
  state.failPanta = true;
  const panta = await analyze("Tell me about this market", { markets: [{ id: "m-1", question: "Will Bitcoin reach $100k?" }], activeMarketId: "m-1" });
  assert.equal(panta.status, 502);
  assert.equal("market" in panta.body, false);
  assert.equal("data" in panta.body, false);
  assert.equal("tradeRequest" in panta.body, false);

  reset();
  state.failNeon = true;
  const neon = await analyze("Hi", { conversationId: "neon-failure" });
  assert.equal(neon.status, 502);
  assert.equal(neon.body.reply, undefined);
  assert.equal("data" in neon.body, false);
  assert.equal(state.groqCalls, 0);
  assert.equal(state.pantaCalls, 0);
  assert.equal(state.tavilyCalls, 0);

  reset();
  state.failNeonWrite = true;
  const write = await analyze("What changed since yesterday?", {
    markets: [{ id: "m-1", question: "Will Bitcoin reach $100k?" }], activeMarketId: "m-1",
    researchMarketId: "m-1", researchQuestion: "Will Bitcoin reach $100k?", researchSummary: "Old report", researchEvidence: evidence,
  });
  assert.equal(write.status, 200, "a valid research answer is returned even when its optional persistence write fails");
  assert.ok(write.body.researchReport);
  assert.equal(state.researchPersists, 0, "failed persistence does not masquerade as a saved report");
});

test("Panta upstream timeout preserves HTTP 504 and reports its subsystem without exposing upstream details", async () => {
  reset();
  state.failPantaTimeout = true;
  const result = await analyze("Tell me about this market", { markets: [{ id: "m-1", question: "Will Bitcoin reach $100k?" }], activeMarketId: "m-1" });
  assert.equal(result.status, 504);
  assert.equal(result.body.errorCode, "timeout");
  assert.equal(result.body.error, "Panta API request timed out.");
  assert.doesNotMatch(JSON.stringify(result.body), /secret|stack|internal detail/i);
});

test("browser cancellation returns 499 and does not persist a completed research result", async () => {
  reset();
  const controller = new AbortController();
  controller.abort();
  const result = await analyze("What is happening with Bitcoin?", {}, controller.signal);
  assert.equal(result.status, 499);
  assert.equal(result.body.errorCode, "cancelled");
  assert.equal(state.researchPersists, 0);
  assert.equal(state.neonWrites, 0);
});

test("explicit Bitcoin research overrides restored Arsenal selection and saved Arsenal evidence", async () => {
  reset();
  state.savedConversation = {
    messages: [{ role: "user", content: "Earlier Arsenal question" }],
    state: {
      activeMarketId: "arsenal-1",
      markets: [{ id: "arsenal-1", question: "Will Arsenal win the next match?" }],
      researchMarketId: "arsenal-1",
      researchQuestion: "Will Arsenal win the next match?",
      researchEvidence: evidence,
      researchMemory: { marketId: "arsenal-1", researchedAt: "2026-10-06T00:00:00.000Z", query: "Arsenal", assessment: "Arsenal prior research", keyFindings: [], evidenceIds: [], sourceUrls: evidence.map((item) => item.url), uncertainties: [] },
    },
  };
  const result = await analyze("What is happening with Bitcoin?", { conversationId: "saved-arsenal" });
  assert.equal(result.status, 200);
  assert.equal(result.body.intent, "research");
  assert.equal(state.researchInput.marketId, undefined, "stale selected/research market cannot become the research target");
  assert.match(state.researchInput.question, /Bitcoin/i, "planner input preserves the explicit subject");
  assert.equal(state.researchInput.priorEvidence.length, 0, "Arsenal evidence is excluded from Bitcoin synthesis");
  assert.equal(result.body.researchReport.market.id, "m-1");
  assert.match(result.body.researchReport.market.question, /Bitcoin/i);
});

test("explicit Bitcoin freshness request does not compare against another selected market", async () => {
  reset();
  const result = await analyze("What changed with Bitcoin since yesterday?", {
    markets: [{ id: "arsenal-1", question: "Will Arsenal win the next match?" }], activeMarketId: "arsenal-1",
  });
  assert.equal(result.status, 200);
  assert.match(result.body.reply, /earlier research run for “Bitcoin”/i);
  assert.doesNotMatch(result.body.reply, /Arsenal/i);
  assert.equal(state.researchRuns, 0, "a prior timestamped baseline is needed to report changes");
});

test("an explicit Arsenal question resolves Arsenal even when Bitcoin is selected", async () => {
  reset();
  const result = await analyze("What is happening with Arsenal?", {
    markets: [{ id: "arsenal-1", question: "Will Arsenal win the next match?" }, { id: "bitcoin-1", question: "Will Bitcoin exceed $100k?" }],
    activeMarketId: "bitcoin-1", researchMarketId: "bitcoin-1", researchQuestion: "Will Bitcoin exceed $100k?", researchSummary: "Bitcoin report",
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.intent, "research");
  assert.equal(state.researchInput.marketId, "arsenal-1");
  assert.match(state.researchInput.question, /Arsenal/i);
  assert.equal(state.researchInput.priorEvidence.length, 0);
});

test("ambiguous follow-up retains the selected Arsenal context", async () => {
  reset();
  const result = await analyze("What is happening?", {
    markets: [{ id: "arsenal-1", question: "Will Arsenal win the next match?" }], activeMarketId: "arsenal-1",
    researchMarketId: "arsenal-1", researchQuestion: "Will Arsenal win the next match?", researchSummary: "Earlier Arsenal research",
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.intent, "research");
  assert.equal(state.researchInput.marketId, "arsenal-1");
  assert.match(state.researchInput.question, /happening/i);
});

test("a Bitcoin request cannot reuse a cached Arsenal analysis from the same conversation", async () => {
  reset();
  const result = await analyze("What is happening with Bitcoin?", {
    conversationId: "same-session", activeMarketId: "arsenal-1",
    markets: [{ id: "arsenal-1", question: "Will Arsenal win the next match?" }],
    researchMarketId: "arsenal-1", researchQuestion: "Will Arsenal win the next match?", researchSummary: "Cached Arsenal report", researchEvidence: evidence,
  });
  assert.equal(result.status, 200);
  assert.equal(state.researchRuns, 1);
  assert.equal(state.researchInput.marketId, undefined);
  assert.match(state.researchInput.question, /Bitcoin/i);
  assert.equal(state.researchInput.priorEvidence.length, 0);
});

test("complete trade requests prepare a reviewable draft; ordinary yes is not confirmation", async () => {
  reset();
  state.marketById["m-1"] = { id: "m-1", question: "Will Bitcoin reach $100k?", status: "active", source: "panta", phase: "primary", pantaIsResolved: false, startAt: "2026-10-08T00:00:00Z", closeAt: "2026-12-31T00:00:00Z" };
  const prepared = await analyze("Buy YES on this market with $10", {
    markets: [{ id: "m-1", question: "Will Bitcoin reach $100k?" }], activeMarketId: "m-1",
  });
  assert.equal(prepared.status, 200);
  assert.equal(prepared.body.intent, "trade_request");
  assert.equal(prepared.body.tradeRequest.market.id, "m-1");
  assert.equal(prepared.body.tradeRequest.outcome, "YES");
  assert.equal(prepared.body.tradeRequest.amountUsdc, 10);
  assert.equal(state.researchRuns, 0);
  assert.equal(state.tavilyCalls, 0);

  reset();
  const plainYes = await analyze("Yes");
  assert.equal(plainYes.status, 200);
  assert.notEqual(plainYes.body.intent, "trade_request");
  assert.equal(plainYes.body.tradeRequest, undefined);
  assert.equal(state.pantaCalls, 0);
});

test("conversational trade asks for a market first and quotes only after exact selection, side, amount, and active status", async () => {
  reset();
  const start = await analyze("Prepare me a trade.");
  assert.equal(start.body.reply, "Sure. Which market would you like to trade?");
  assert.deepEqual(start.body.pendingTradeDraft, {});
  assert.equal(start.body.tradeRequest, undefined);
  assert.equal(state.marketLookupCalls, 0);
  assert.equal(state.discoveredQuery, undefined);

  const candidates = [
    { id: "btc-100", question: "Will Bitcoin reach $100,000?", status: "active", source: "panta", phase: "primary", pantaIsResolved: false, startAt: "2026-10-08T00:00:00Z", closeAt: "2026-12-31T00:00:00Z" },
    { id: "btc-120", question: "Will Bitcoin reach $120,000?", status: "active", source: "panta", phase: "primary", pantaIsResolved: false, startAt: "2026-10-08T00:00:00Z", closeAt: "2026-12-31T00:00:00Z" },
  ];
  state.discoveredMarkets = candidates;
  state.marketScores = { "btc-100": 0.8, "btc-120": 0.8 };
  const search = await analyze("Bitcoin reaching $100,000.", { pendingTrade: start.body.pendingTradeDraft });
  assert.equal(state.discoveredQuery, "Bitcoin reaching $100,000.");
  assert.equal(search.body.reply, "I found these matching Panta markets. Which one do you mean?");
  assert.deepEqual(search.body.tradeChoices.map(({ id }) => id), ["btc-100", "btc-120"]);
  assert.equal(search.body.tradeRequest, undefined);

  state.marketById["btc-100"] = candidates[0];
  const selection = await analyze("The first one.", {
    markets: candidates.map(({ id, question }) => ({ id, question })),
    activeMarketId: "unrelated", pendingTrade: search.body.pendingTradeDraft,
  });
  assert.equal(selection.body.reply, "Would you like to buy YES or NO?");
  assert.equal(selection.body.pendingTradeDraft.marketId, "btc-100");
  assert.equal(selection.body.tradeRequest, undefined);

  const side = await analyze("YES", { markets: candidates, activeMarketId: "unrelated", pendingTrade: selection.body.pendingTradeDraft });
  assert.match(side.body.reply, /How much/);
  assert.equal(side.body.pendingTradeDraft.marketId, "btc-100");
  assert.equal(side.body.tradeRequest, undefined);

  const amount = await analyze("20", { markets: candidates, activeMarketId: "unrelated", pendingTrade: side.body.pendingTradeDraft });
  assert.equal(amount.body.tradeRequest.market.id, "btc-100");
  assert.equal(amount.body.tradeRequest.outcome, "YES");
  assert.equal(amount.body.tradeRequest.amountUsdc, 20);

  reset();
  state.marketById["closed"] = { id: "closed", question: "Closed market", status: "closed", source: "panta", phase: "primary", pantaIsResolved: true, startAt: "2026-10-08T00:00:00Z", closeAt: "2026-10-08T01:00:00Z" };
  const closed = await analyze("Buy YES with $20", { markets: [{ id: "closed", question: "Closed market" }], pendingTrade: { marketId: "closed" } });
  assert.match(closed.body.reply, /no quote or transaction was requested/i);
  assert.equal(closed.body.tradeRequest, undefined);
});
