import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const dataUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const compile = async (path, mocks) => {
  let source = await readFile(new URL(path, import.meta.url), "utf8");
  source = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const [specifier, mock] of Object.entries(mocks)) source = source.replaceAll(`"${specifier}"`, JSON.stringify(dataUrl(mock)));
  return import(dataUrl(source));
};

const next = `export const NextResponse={json:(data,init={})=>new Response(JSON.stringify(data),{...init,headers:{"content-type":"application/json",...init.headers}})};`;
const safety = `export function isQuoteExpired(value){return Boolean(value&&Date.parse(value)<=Date.now())} export function isTradeEligibleMarket(m){return Boolean(m&&m.source==="panta"&&m.status==="active"&&m.phase==="primary"&&m.pantaIsResolved===false)} export function tradeIneligibilityReason(){return "Market not eligible"}`;
const buildState = globalThis.__miraTxBuildState = { calls: 0, persisted: 0, market: null, validationError: null };
const buildProvider = `export function getMarketProvider(){const s=globalThis.__miraTxBuildState;return{source:"panta",environment:"live",getMarket:async()=>s.market,buildTrade:async()=>{s.calls++;return{orderId:"order-1",quoteId:"quote-1",wallet:"11111111111111111111111111111111",marketId:"11111111111111111111111111111111",side:"yes",amountUsdc:"1.00",recentBlockhash:"blockhash",lastValidBlockHeight:999,instructions:[{programId:"6gM5afTQBq5VZCfgpGqcsqzfWd5maLSCKWtGjbEobZMp",data:"AA==",accounts:[]}]}}}} export function getProviderMode(){return "panta"}`;
const buildDb = `export async function getTradeTicketByQuoteId(){return globalThis.__miraTxBuildState.ticket} export async function updateTradeTicket(...args){globalThis.__miraTxBuildState.persisted++;globalThis.__miraTxBuildState.saved=args;return "ticket-1"}`;
const buildValidation = `export async function validatePrimaryBuild(){const s=globalThis.__miraTxBuildState;if(s.validationError)throw new Error(s.validationError);return{instructions:[{programId:"6gM5afTQBq5VZCfgpGqcsqzfWd5maLSCKWtGjbEobZMp",data:"AA==",accounts:[]}],fingerprint:"ab".repeat(32),contextSlot:123}}`;
const buildRoute = await compile("../../app/api/trade/build/route.ts", {
  "next/server": next,
  "@/lib/providers/market-provider": buildProvider,
  "@/lib/db": buildDb,
  "@/lib/panta/trade-safety": safety,
  "@/lib/panta/transaction-security": buildValidation,
});

const market = (phase = "primary") => ({ id: "11111111111111111111111111111111", question: "Example?", source: "panta", status: "active", phase, pantaIsResolved: false, startAt: new Date(Date.now() - 60_000).toISOString(), closeAt: new Date(Date.now() + 60_000).toISOString() });
const request = (url, body) => new Request(`http://localhost${url}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const buildPost = (body = { quoteId: "quote-1", wallet: "11111111111111111111111111111111" }) => buildRoute.POST(request("/api/trade/build", body));

test("primary build returns instructions only after semantic validation and quote binding", async () => {
  Object.assign(buildState, { calls: 0, persisted: 0, market: market(), validationError: null, ticket: { status: "quoted", expires_at: new Date(Date.now() + 60_000).toISOString(), market_id: "11111111111111111111111111111111", side: "YES", amount_usdc: "1.00" } });
  const response = await buildPost(); const payload = await response.json();
  assert.equal(response.status, 200); assert.equal(payload.data.instructions.length, 1);
  assert.equal(buildState.calls, 1); assert.equal(buildState.persisted, 1);
  assert.equal(buildState.saved[4].fingerprint, "ab".repeat(32));
});

test("primary build rejects a semantic validator failure and returns no signable instructions", async () => {
  Object.assign(buildState, { calls: 0, persisted: 0, market: market(), validationError: "unexpected program ID", ticket: { status: "quoted", expires_at: new Date(Date.now() + 60_000).toISOString(), market_id: "11111111111111111111111111111111", side: "YES", amount_usdc: "1.00" } });
  const response = await buildPost(); const payload = await response.json();
  assert.equal(response.status, 502); assert.equal("data" in payload, false); assert.equal(buildState.persisted, 0);
});

test("secondary orders cannot fall through the primary builder and malformed requests lack wallet authorization", async () => {
  Object.assign(buildState, { calls: 0, persisted: 0, market: market("secondary"), validationError: null, ticket: { status: "quoted", expires_at: new Date(Date.now() + 60_000).toISOString(), market_id: "11111111111111111111111111111111", side: "YES", amount_usdc: "1.00" } });
  const secondary = await buildPost(); assert.equal(secondary.status, 409); assert.equal(buildState.calls, 0);
  const missingWallet = await buildPost({ quoteId: "quote-1" }); assert.equal(missingWallet.status, 400); assert.equal(buildState.calls, 0);
});

const claimState = globalThis.__miraTxClaimState = { built: 0, market: market(), validationError: null };
const claimProvider = `export function getMarketProvider(){const s=globalThis.__miraTxClaimState;return{source:"panta",buildClaim:async()=>{s.built++;return{instructions:[{programId:"claim",data:"AA==",accounts:[]}] }},getMarket:async()=>s.market}}`;
const claimValidator = `export async function validateClaimBuild(){const s=globalThis.__miraTxClaimState;if(s.validationError)throw new Error(s.validationError);return{claim:"claim_win_usdc",fingerprint:"cd".repeat(32),contextSlot:42}}`;
const claimRoute = await compile("../../app/api/claims/build/route.ts", { "next/server": next, "@/lib/providers/market-provider": claimProvider, "@/lib/panta/transaction-security": claimValidator });

test("claim build requires wallet and event authorization and returns only validated claim data", async () => {
  Object.assign(claimState, { built: 0, market: market(), validationError: null });
  const missing = await claimRoute.POST(request("/api/claims/build", { marketId: "11111111111111111111111111111111" }));
  assert.equal(missing.status, 400); assert.equal(claimState.built, 0);
  const accepted = await claimRoute.POST(request("/api/claims/build", { marketId: "11111111111111111111111111111111", wallet: "11111111111111111111111111111111" }));
  assert.equal(accepted.status, 200); assert.equal((await accepted.json()).claim, "claim_win_usdc");
  claimState.validationError = "claim signer does not match wallet";
  const rejected = await claimRoute.POST(request("/api/claims/build", { marketId: "11111111111111111111111111111111", wallet: "11111111111111111111111111111111" }));
  assert.equal(rejected.status, 502); assert.equal("data" in await rejected.json(), false);
});

const submitState = globalThis.__miraTxSubmitState = {};
const submitProvider = `export function getMarketProvider(){const s=globalThis.__miraTxSubmitState;return{source:"panta",getMarket:async()=>s.market,submitTrade:async()=>{s.submitted++;return{ok:true}}}}`;
const submitDb = `export async function getTradeTicketByOrderId(){return globalThis.__miraTxSubmitState.ticket} export async function claimTradeTicketForSubmission(){globalThis.__miraTxSubmitState.claimCalls++;return globalThis.__miraTxSubmitState.claimAllowed} export async function persistTransaction(){globalThis.__miraTxSubmitState.persisted++} export async function markTradeTicketSubmitted(){globalThis.__miraTxSubmitState.marked++}`;
const rpc = `export async function assertSolanaMainnet(){} export function createSolanaMainnetConnection(){const s=globalThis.__miraTxSubmitState;return{getTransaction:async()=>s.transaction,getBlockHeight:async()=>1}}`;
const submitValidator = `export function isSolanaSignature(){return true} export function validateObservedTransaction(){return globalThis.__miraTxSubmitState.chainMatches}`;
const submitRoute = await compile("../../app/api/trade/submit/route.ts", {
  "next/server": next, "@/lib/providers/market-provider": submitProvider,
  "@/lib/db": submitDb, "@/lib/panta/trade-safety": safety,
  "@/lib/panta/transaction-security": submitValidator, "@/lib/solana/rpc": rpc,
});
function submitTicket(extra = {}) { return { status: "prepared", wallet: "wallet", market_id: "market", expires_at: null, metadata: { buildValidation: { fingerprint: "hash", instructions: [], recentBlockhash: "blockhash", lastValidBlockHeight: 50 } }, ...extra }; }
function setupSubmit(overrides = {}) { Object.assign(submitState, { market: market(), ticket: submitTicket(), transaction: { meta: { err: null } }, chainMatches: true, claimAllowed: true, claimCalls: 0, submitted: 0, persisted: 0, marked: 0, ...overrides }); }
const submitPost = (body = { orderId: "order", signature: "sig", wallet: "wallet" }) => submitRoute.POST(request("/api/trade/submit", body));

test("submit rejects stale or legacy tickets without a validated build", async () => {
  setupSubmit({ ticket: submitTicket({ status: "prepared", metadata: {} }) });
  assert.equal((await submitPost()).status, 409); assert.equal(submitState.submitted, 0);
  setupSubmit({ ticket: submitTicket({ expires_at: new Date(Date.now() - 1000).toISOString() }) });
  assert.equal((await submitPost()).status, 409); assert.equal(submitState.submitted, 0);
});

test("submit rejects altered chain instructions and duplicate ticket claims", async () => {
  setupSubmit({ chainMatches: false });
  assert.equal((await submitPost()).status, 409); assert.equal(submitState.submitted, 0);
  setupSubmit({ claimAllowed: false });
  assert.equal((await submitPost()).status, 409); assert.equal(submitState.submitted, 0);
});

test("submit preserves a confirmed primary registration exactly once and checks wallet binding", async () => {
  setupSubmit();
  const mismatch = await submitPost({ orderId: "order", signature: "sig", wallet: "other-wallet" });
  assert.equal(mismatch.status, 409); assert.equal(submitState.submitted, 0);
  const success = await submitPost();
  assert.equal(success.status, 200); assert.equal(submitState.submitted, 1); assert.equal(submitState.claimCalls, 1);
});
