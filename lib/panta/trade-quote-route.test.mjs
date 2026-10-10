import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const state = globalThis.__miraTradeQuoteRouteTest = { market: null, quotes: 0, persisted: 0 };
const moduleUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const safetySource = await readFile(new URL("./trade-safety.ts", import.meta.url), "utf8");
const safetyJavascript = ts.transpileModule(safetySource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const safetyUrl = moduleUrl(safetyJavascript);
const mocks = {
  "next/server": `export const NextResponse={json:(data,init={})=>new Response(JSON.stringify(data),{...init,headers:{"content-type":"application/json",...init.headers}})};`,
  "@/lib/providers/market-provider": `export function getMarketProvider(){const s=globalThis.__miraTradeQuoteRouteTest;return{source:"panta",environment:"live",getMarket:async()=>s.market,getQuote:async(input)=>{s.quotes++;return{id:"quote-1",marketId:input.marketId,outcome:input.outcome,amountUsd:input.amountUsd,source:"panta",expiresAt:new Date(Date.now()+60000).toISOString()}}}}`,
  "@/lib/db": `export async function persistTradePreparation(){globalThis.__miraTradeQuoteRouteTest.persisted++}`,
  "@/lib/panta/trade-safety": safetyJavascript,
};
let source = await readFile(new URL("../../app/api/trade/quote/route.ts", import.meta.url), "utf8");
source = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
for (const [specifier, mock] of Object.entries(mocks)) source = source.replaceAll(`"${specifier}"`, `"${specifier === "@/lib/panta/trade-safety" ? safetyUrl : moduleUrl(mock)}"`);
const route = await import(moduleUrl(source));

const baseMarket = (phase = "primary") => ({
  id: "panta-market", question: "Will the event happen?", source: "panta", status: "active", phase,
  pantaIsResolved: false, pantaSecondaryActive: phase === "secondary", pantaIsGraduated: phase === "secondary",
  startAt: new Date(Date.now() - 60 * 60_000).toISOString(), closeAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
});
const postQuote = () => route.POST(new Request("http://localhost/api/trade/quote", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ marketId: "panta-market", outcome: "YES", amountUsd: 1, wallet: "11111111111111111111111111111111" }),
}));

test("secondary markets are rejected before the primary quote endpoint can be called", async () => {
  Object.assign(state, { market: baseMarket("secondary"), quotes: 0, persisted: 0 });
  const response = await postQuote();
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /secondary\/P2P.*no primary quote/i);
  assert.equal(state.quotes, 0);
  assert.equal(state.persisted, 0);
});

test("verified primary markets continue through the existing Panta quote flow", async () => {
  Object.assign(state, { market: baseMarket("primary"), quotes: 0, persisted: 0 });
  const response = await postQuote();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, "quoted");
  assert.equal(state.quotes, 1);
  assert.equal(state.persisted, 1);
});
