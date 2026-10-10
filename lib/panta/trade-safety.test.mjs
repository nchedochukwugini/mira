import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("./trade-safety.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const safety = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`);
const now = Date.parse("2026-10-09T12:00:00.000Z");
const market = (overrides = {}) => ({ id: "panta-1", question: "Will Bitcoin reach $100k?", source: "panta", status: "active", phase: "primary", pantaIsResolved: false, startAt: "2026-10-08T00:00:00.000Z", closeAt: "2026-10-10T00:00:00.000Z", ...overrides });

test("only matching verified open Panta markets enter trade preparation", () => {
  assert.equal(safety.isTradeEligibleMarket(market(), now), true);
  assert.equal(safety.isTradeEligibleMarket(market({ status: "resolved", pantaIsResolved: true }), now), false);
  assert.equal(safety.isTradeEligibleMarket(market({ status: "closed" }), now), false);
  assert.equal(safety.isTradeEligibleMarket(market({ pantaIsResolved: null }), now), false);
  assert.equal(safety.isTradeEligibleMarket(market({ question: "Market title unavailable" }), now), false);
  assert.equal(safety.isTradeEligibleMarket(market({ closeAt: "2026-10-09T11:00:00.000Z" }), now), false);
  assert.equal(safety.isTradeEligibleMarket(market({ startAt: "2026-10-09T13:00:00.000Z" }), now), false);
  const verifiedSecondary = market({ phase: "secondary", pantaSecondaryActive: true, pantaIsGraduated: true });
  assert.equal(safety.isTradeEligibleMarket(verifiedSecondary, now), false, "secondary markets must not reach the current primary quote/build/submit flow");
  assert.equal(safety.isSecondaryTradeEligibleMarket(verifiedSecondary, now), true);
  assert.equal(safety.isSecondaryMarketCandidate(market({ phase: "secondary", status: "unknown", pantaIsResolved: false, pantaSecondaryActive: null, pantaIsGraduated: null }), now), true, "catalog candidates must be hydrated before the ticket opens");
  assert.equal(safety.isSecondaryMarketCandidate(market({ phase: "secondary", pantaIsResolved: true, pantaSecondaryActive: true, pantaIsGraduated: true }), now), false);
  assert.match(safety.tradeIneligibilityReason(verifiedSecondary), /secondary\/P2P.*separate secondary limit-order flow.*no primary quote/i);
  assert.equal(safety.isSecondaryTradeEligibleMarket(market({ phase: "secondary", pantaSecondaryActive: true, pantaIsGraduated: true, closeAt: "2026-10-09T11:00:00.000Z" }), now), false);
  assert.equal(safety.isSecondaryTradeEligibleMarket(market({ phase: "secondary", pantaSecondaryActive: true, pantaIsGraduated: true, startAt: "2026-10-09T13:00:00.000Z" }), now), false);
  assert.equal(safety.isTradeEligibleMarket(market({ phase: "secondary", pantaSecondaryActive: true, pantaIsGraduated: null }), now), false);
  assert.equal(safety.isTradeEligibleMarket(market({ phase: "secondary", pantaSecondaryActive: null, pantaIsGraduated: true }), now), false);
  assert.equal(safety.isTradeEligibleMarket(market({ phase: "secondary", pantaSecondaryActive: true, pantaIsGraduated: false }), now), false);
  assert.equal(safety.isSecondaryTradeEligibleMarket(market({ phase: "secondary", pantaSecondaryActive: true, pantaIsGraduated: null }), now), false);
  assert.equal(safety.isSecondaryTradeEligibleMarket(market({ phase: "secondary", pantaSecondaryActive: null, pantaIsGraduated: true }), now), false);
  assert.equal(safety.isSecondaryTradeEligibleMarket(market({ phase: "secondary", pantaSecondaryActive: true, pantaIsGraduated: false }), now), false);
});

test("secondary eligibility is distinct from the primary quote flow", () => {
  const secondary = market({ phase: "secondary", pantaSecondaryActive: true, pantaIsGraduated: true });
  assert.equal(safety.isTradeEligibleMarket(secondary, now), false);
  assert.equal(safety.isSecondaryTradeEligibleMarket(secondary, now), true);
  assert.equal(safety.isSecondaryMarketCandidate(secondary, now), true);
  assert.match(safety.tradeIneligibilityReason({ source: "panta", phase: "secondary" }), /separate secondary limit-order flow/);
  assert.match(safety.tradeIneligibilityReason({ source: "panta", phase: "primary" }), /primary-market quote flow/);
});
