import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { createMarketReasoningExplainer } from "./index.ts";

async function loadTs(path) {
  const source = (await readFile(new URL(path, import.meta.url), "utf8")).replace('import "server-only";', "");
  const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`);
}

const { GroqProvider, getAIConfig } = await loadTs("./groq.ts");
const { validateMiraIntent } = await loadTs("./schemas.ts");
const valid = { intent: "greeting" };
const request = { system: "MIRA", user: { message: "hi" }, schema: { type: "object" }, validate: (value) => value?.intent ? value : null };

test("Groq configuration is centralized and defaults only the model", () => {
  const previousKey = process.env.GROQ_API_KEY;
  const previousModel = process.env.GROQ_MODEL;
  try {
    delete process.env.GROQ_API_KEY;
    delete process.env.GROQ_MODEL;
    assert.deepEqual(getAIConfig(), { configured: false, model: "openai/gpt-oss-120b" });
    process.env.GROQ_API_KEY = "server-test-key";
    process.env.GROQ_MODEL = "configured-model";
    assert.deepEqual(getAIConfig(), { configured: true, model: "configured-model" });
  } finally {
    if (previousKey === undefined) delete process.env.GROQ_API_KEY; else process.env.GROQ_API_KEY = previousKey;
    if (previousModel === undefined) delete process.env.GROQ_MODEL; else process.env.GROQ_MODEL = previousModel;
  }
});

test("missing API key returns limited result without making a request", async () => {
  let called = false;
  const result = await new GroqProvider({ apiKey: "", fetcher: async () => { called = true; throw new Error("must not call"); } }).completeJson(request);
  assert.equal(result, null);
  assert.equal(called, false);
});

test("Groq receives deterministic reasoning as supplied context and cannot return an invalid explanation", async () => {
  const reasoning = { marketId: "market-1", marketPriceContext: { yesPrice: 0.52 }, observationCount: 1, comparisonObservationCount: 2, signals: [{ kind: "BID_LIQUIDITY_INCREASE", observed: "YES visible bid depth increased." }], uncertainty: ["Only two observations exist."] };
  let input;
  const explain = createMarketReasoningExplainer({ completeJson: async (value) => { input = value; return value.validate({ answer: "YES bid liquidity increased across the observations; only two observations are available." }) ? { answer: "YES bid liquidity increased across the observations; only two observations are available." } : null; } });
  const answer = await explain("What's happening?", reasoning);
  assert.equal(answer, "YES bid liquidity increased across the observations; only two observations are available.");
  assert.deepEqual(input.user, { question: "What's happening?", deterministicMarketReasoning: reasoning });
  assert.match(input.system, /Do not add or calculate prices, spreads, depth, timestamps, trends, citations, sources, or facts/);
  assert.equal(input.validate({ answer: "unsupported" }), null);
});

test("Groq explanations containing unsupported cents or ungrounded research claims are rejected", async () => {
  const reasoning = { marketPriceContext: { yesPrice: null, noPrice: null }, structure: { yes: { bestBid: 1, bestAsk: null, midpoint: null, spread: null }, no: null }, changes: [], signals: [], researchStatus: "not-run" };
  for (const answer of ["Panta now prices YES at 50¢, which is a strong change.", "The latest research supports YES based on a new official announcement."]) {
    const explain = createMarketReasoningExplainer({ completeJson: async (input) => input.validate({ answer }) ? { answer } : null });
    assert.equal(await explain("What's happening?", reasoning), null, answer);
  }
});

test("valid structured response is parsed and uses configured Groq model", async () => {
  let requestBody;
  const provider = new GroqProvider({ apiKey: "test-key", model: "test-model", fetcher: async (_url, init) => {
    requestBody = JSON.parse(init.body);
    return Response.json({ choices: [{ message: { content: JSON.stringify(valid) } }] });
  } });
  assert.deepEqual(await provider.completeJson(request), valid);
  assert.equal(requestBody.model, "test-model");
  assert.equal(requestBody.response_format.type, "json_schema");
});

test("malformed output, HTTP failures, and timeouts fail gracefully", async () => {
  const malformed = new GroqProvider({ apiKey: "test-key", fetcher: async () => Response.json({ choices: [{ message: { content: "{" } }] }) });
  const rejected = new GroqProvider({ apiKey: "test-key", fetcher: async () => new Response("", { status: 429 }) });
  const timeout = new GroqProvider({ apiKey: "test-key", fetcher: async () => { throw new DOMException("Timed out", "TimeoutError"); } });
  assert.equal(await malformed.completeJson(request), null);
  assert.equal(await rejected.completeJson(request), null);
  assert.equal(await timeout.completeJson(request), null);
});

test("structured intent validation rejects unknown actions and unreasonable trade amounts", () => {
  const intent = { intent: "trade_request", requiresMarketData: true, marketReference: { type: "ordinal", value: "2" }, tradeOutcome: "YES", tradeAmountUsdc: 50 };
  assert.equal(validateMiraIntent(intent).tradeAmountUsdc, 50);
  assert.equal(validateMiraIntent({ ...intent, intent: "submit_trade" }), null);
  assert.equal(validateMiraIntent({ ...intent, tradeAmountUsdc: 1_000_000 }), null);
  assert.equal(validateMiraIntent({ ...intent, tradeAmountUsdc: Number.NaN }), null);
  assert.equal(validateMiraIntent({ ...intent, intent: "market_intelligence" }).intent, "market_intelligence");
});
