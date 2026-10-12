import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const dataUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const source = await readFile(new URL("../../app/api/trade/secondary/build/route.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const state = globalThis.__secondaryBuildRouteTest = { downstreamCalls: 0 };
const mocks = {
  "@solana/web3.js": `export class PublicKey { constructor(value){ if(typeof value!=="string") throw Error(); this.value=value } toBytes(){return Uint8Array.of(1)} toBase58(){return this.value} equals(){return true} static isOnCurve(){return true} } export const SystemProgram={programId:new PublicKey("system")}; export class TransactionMessage {} export class VersionedTransaction { constructor(message){this.message=message} serialize(){return Uint8Array.of(1)} }`,
  "@/lib/db": `export async function createSecondaryOperation(){globalThis.__secondaryBuildRouteTest.downstreamCalls++}`,
  "@/lib/http/json-api-response": `export function jsonApiError(code,message,status){return Response.json({error:{code,message}},{status,headers:{"Cache-Control":"no-store"}})}`,
  "@/lib/providers/market-provider": `export function getMarketProvider(){globalThis.__secondaryBuildRouteTest.downstreamCalls++;return {source:"panta"}}`,
  "@/lib/solana/rpc": `export async function assertSolanaMainnet(){} export function createSolanaMainnetConnection(){return {}}`,
  "@/lib/panta/clob-layout": `export const PANTA_CLOB_PROGRAM_ID="program"; export function decodeOrderNode(){return null}`,
  "@/lib/panta/secondary-book": `export async function discoverSecondaryMakers(){return {}} export function isSupportedPantaTraversalLimit(){return true}`,
  "@/lib/panta/secondary-transaction-limits": `export function fitsSecondaryTransactionLimits(){return true}`,
  "@/lib/panta/secondary-instructions": `export function buildSecondaryCancellationInstruction(){} export function buildSecondaryPlacementInstruction(){} export function instructionToWalletFormat(){} export function secondaryPriceUnits(){} export function secondaryShareUnits(){}`,
  "@/lib/panta/transaction-security": `export async function readPantaBuildContext(){return {}}`,
};
let compiled = javascript;
for (const [specifier, mock] of Object.entries(mocks)) compiled = compiled.replaceAll(`"${specifier}"`, JSON.stringify(dataUrl(mock)));
const route = await import(dataUrl(compiled));

test("secondary build reports malformed JSON using the JSON API envelope", async () => {
  state.downstreamCalls = 0;
  const response = await route.POST(new Request("https://mira.example/api/trade/secondary/build", { method: "POST", body: "{" }));
  assert.equal(response.status, 400);
  assert.match(response.headers.get("content-type") ?? "", /application\/json/i);
  assert.equal((await response.json()).error.code, "invalid_json");
  assert.equal(state.downstreamCalls, 0);
});

test("secondary build rejects an empty request before calling providers", async () => {
  state.downstreamCalls = 0;
  const response = await route.POST(new Request("https://mira.example/api/trade/secondary/build", {
    method: "POST", headers: { "content-type": "application/json" }, body: "{}",
  }));
  assert.equal(response.status, 400);
  assert.match(response.headers.get("content-type") ?? "", /application\/json/i);
  assert.equal((await response.json()).error.code, "invalid_request");
  assert.equal(state.downstreamCalls, 0);
});
