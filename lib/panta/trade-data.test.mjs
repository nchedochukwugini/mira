import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("./trade-data.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const data = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`);

test("normalizes the documented Panta primary quote response without inventing quote values", () => {
  const quote = data.normalizePantaQuote({ quoteId: "qt_live", marketId: "market-live", side: "no", amountUsdc: "20.00", shares: "39.12", avgPrice: "0.510000", feeUsdc: "0.40", expiresAt: "2026-10-06T12:01:30.000Z" }, "live");
  assert.equal(quote.id, "qt_live");
  assert.equal(quote.marketId, "market-live");
  assert.equal(quote.outcome, "NO");
  assert.equal(quote.amountUsd, 20);
  assert.equal(quote.shares, 39.12);
  assert.equal(quote.averagePrice, 0.51);
  assert.equal(quote.feeUsd, 0.4);
  assert.equal(quote.environment, "live");
});

test("missing Panta quote fields remain unavailable and fail request binding", () => {
  const quote = data.normalizePantaQuote({ quoteId: "qt_partial", shares: null, feeUsdc: null }, "test");
  assert.equal(quote.marketId, "");
  assert.equal(quote.outcome, "");
  assert.equal(Number.isNaN(quote.amountUsd), true);
  assert.equal(quote.shares, null);
  assert.equal(quote.feeUsd, null);
  assert.equal(quote.environment, "test");
});
