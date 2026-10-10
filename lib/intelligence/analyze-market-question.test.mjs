import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const moduleUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
async function loadCore() {
  const source = await readFile(new URL("./core.ts", import.meta.url), "utf8");
  const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  return moduleUrl(javascript);
}
const coreUrl = await loadCore();
const tradeSafetySource = await readFile(new URL("../panta/trade-safety.ts", import.meta.url), "utf8");
const tradeSafetyJavascript = ts.transpileModule(tradeSafetySource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const tradeSafetyUrl = moduleUrl(tradeSafetyJavascript);
let source = await readFile(new URL("./analyzeMarketQuestion.ts", import.meta.url), "utf8");
source = source.replace('from "@/lib/intelligence/core"', `from "${coreUrl}"`);
source = source.replace('from "@/lib/panta/trade-safety"', `from "${tradeSafetyUrl}"`);
const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const analysis = await import(moduleUrl(javascript));

test("current discovery never returns resolved Bitcoin markets as current listings", async () => {
  const market = {
    id: "resolved-btc", question: "Will Bitcoin hit $85,000?", category: "crypto", description: null, status: "resolved",
    yesProbability: 1, noProbability: 0, volumeUsd: 7, liquidityUsd: null, priceChange24h: null,
    closeAt: "2026-10-04T00:00:00.000Z", updatedAt: "2026-10-04T00:00:00.000Z", imageUrl: null,
    history: [], relatedMarketIds: [], source: "panta",
  };
  const provider = { source: "panta", environment: "live", discoverMarkets: async () => [market], getMarket: async () => market };
  const result = await analysis.analyzeMarketQuestion("What Bitcoin markets are available right now?", provider);
  assert.deepEqual(result.markets, []);
  assert.match(result.answer, /resolved or outside their trading window/i);
  assert.match(result.answer, /No verified active matching markets/i);
  assert.doesNotMatch(result.answer, /final YES value|historical volume/);
});

test("current discovery includes matching Panta markets only when provider status and window are verified", async () => {
  const eligible = {
    id: "active-btc", question: "Will Bitcoin reach $100,000?", category: "crypto", description: null,
    status: "active", yesProbability: 0.42, noProbability: 0.58, volumeUsd: 25, liquidityUsd: null,
    priceChange24h: null, startAt: "2026-10-08T00:00:00.000Z", closeAt: "2026-10-10T00:00:00.000Z",
    updatedAt: "2026-10-08T12:00:00.000Z", imageUrl: null, history: [], relatedMarketIds: [], source: "panta",
    phase: "primary", pantaIsResolved: false,
  };
  const unknown = { ...eligible, id: "unknown-btc", status: "unknown", pantaIsResolved: null };
  const expired = { ...eligible, id: "expired-btc", closeAt: "2026-10-08T00:00:00.000Z" };
  const provider = { source: "panta", environment: "live", discoverMarkets: async () => [unknown, expired, eligible], getMarket: async (id) => [unknown, expired, eligible].find((market) => market.id === id) };
  const result = await analysis.analyzeMarketQuestion("What is happening in Bitcoin markets now?", provider, Date.parse("2026-10-09T12:00:00.000Z"));
  assert.deepEqual(result.markets.map((market) => market.id), ["active-btc"]);
});

test("an explicit historical Bitcoin query can still retrieve resolved markets", async () => {
  const market = {
    id: "resolved-btc", question: "Will Bitcoin hit $85,000?", category: "crypto", description: null, status: "resolved",
    yesProbability: 1, noProbability: 0, volumeUsd: 7, liquidityUsd: null, priceChange24h: null,
    closeAt: "2026-10-04T00:00:00.000Z", updatedAt: "2026-10-04T00:00:00.000Z", imageUrl: null,
    history: [], relatedMarketIds: [], source: "panta",
  };
  const provider = { source: "panta", environment: "live", discoverMarkets: async () => [market], getMarket: async () => market };
  const result = await analysis.analyzeMarketQuestion("Show me past Bitcoin markets", provider);
  assert.deepEqual(result.markets.map((item) => item.id), ["resolved-btc"]);
  assert.match(result.answer, /resolved.*historical close time/i);
  assert.match(result.answer, /historical outcome fields/i);
});

test("natural-language catalog discovery reads the full live catalog adapter without a literal search", async () => {
  const markets = [
    { id: "panta-1", question: "Will Bitcoin reach $100,000?", category: "crypto", description: null, status: "active", yesProbability: 0.42, noProbability: 0.58, volumeUsd: 25, liquidityUsd: null, priceChange24h: null, startAt: "2026-10-08T00:00:00.000Z", closeAt: "2026-10-10T00:00:00.000Z", updatedAt: "2026-10-08T12:00:00.000Z", imageUrl: null, history: [], relatedMarketIds: [], source: "panta", phase: "primary", pantaIsResolved: false },
    { id: "panta-2", question: "Will Ethereum reach $5,000?", category: "crypto", description: null, status: "active", yesProbability: null, noProbability: null, volumeUsd: null, liquidityUsd: null, priceChange24h: null, startAt: "2026-10-08T00:00:00.000Z", closeAt: "2026-10-10T00:00:00.000Z", updatedAt: null, imageUrl: null, history: [], relatedMarketIds: [], source: "panta", phase: "primary", pantaIsResolved: false },
  ];
  const calls = [];
  const provider = { source: "panta", environment: "live", discoverMarkets: async (query) => { calls.push(query); return markets; }, getMarket: async (id) => markets.find((market) => market.id === id) };
  const result = await analysis.analyzeMarketQuestion("Which markets are available?", provider, Date.parse("2026-10-09T12:00:00.000Z"));
  assert.deepEqual(calls, [undefined]);
  assert.deepEqual(result.markets.map(({ id }) => id), ["panta-1", "panta-2"]);
  assert.match(result.answer, /Panta returned 2 catalog entries/);
  assert.match(result.answer, /unavailable in the provider data/);
});

test("catalog provider failures remain errors instead of becoming a genuine empty catalog", async () => {
  const provider = { source: "panta", environment: "live", discoverMarkets: async () => { throw new Error("Panta API unavailable"); }, getMarket: async () => null };
  await assert.rejects(() => analysis.analyzeMarketQuestion("Which markets are available?", provider), /Panta API unavailable/);
});

test("24-hour movers are not ranked without valid timestamped history", async () => {
  const market = { id: "no-history", question: "Will Bitcoin reach $100,000?", category: "crypto", description: null, status: "active", yesProbability: 0.42, noProbability: 0.58, volumeUsd: 25, liquidityUsd: null, priceChange24h: 0.9, closeAt: null, updatedAt: "2026-10-08T12:00:00.000Z", imageUrl: null, history: [], relatedMarketIds: [], source: "panta" };
  const provider = { source: "panta", environment: "live", discoverMarkets: async () => [market], getMarket: async () => market };
  const result = await analysis.analyzeMarketQuestion("Find markets with the biggest 24-hour moves.", provider, Date.parse("2026-10-09T12:00:00.000Z"));
  assert.equal(result.movements.length, 0);
  assert.equal(result.confidence, "insufficient");
  assert.match(result.answer, /not enough timestamped price history/i);
});
