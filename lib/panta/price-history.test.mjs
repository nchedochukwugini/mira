import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PublicKey } from "@solana/web3.js";
import {
  clearPantaPriceHistoryCacheForTests,
  filterAndNormalizeHistory,
  getPantaPriceHistory,
  isPriceHistoryRange,
} from "./price-history.ts";
import { PANTA_CLOB_PROGRAM_ID, PANTA_ORDER_MATCHED_DISCRIMINATOR } from "./clob-layout.ts";

const eventPda = "CLQqZ7r6WYC5xNumWrmC7UAkQ1Z6pdCbjJSy7wQu1DgL";
const now = Date.parse("2026-10-10T12:00:00.000Z");
const market = {
  id: eventPda,
  question: "Will BTC reach a new all-time high by December 31, 2026?",
  source: "panta",
  pantaEventPda: eventPda,
  quoteAsset: "USDC",
  quoteAssetResolution: { asset: "USDC", status: "resolved" },
};

function matchedLog(outcome, price) {
  const data = Buffer.alloc(121);
  PANTA_ORDER_MATCHED_DISCRIMINATOR.copy(data, 0);
  new PublicKey(eventPda).toBuffer().copy(data, 8);
  data[104] = outcome === "YES" ? 0 : 1;
  data.writeBigUInt64LE(BigInt(Math.round(price * 1_000_000_000)), 105);
  data.writeBigUInt64LE(2_000_000n, 113);
  return `Program data: ${data.toString("base64")}`;
}

function mockConnection(rows, txs) {
  return {
    getSignaturesForAddress: async (key, options) => {
      assert.equal(key.toBase58(), eventPda);
      assert.equal(options.limit, 36);
      return rows;
    },
    getTransaction: async (signature, options) => {
      assert.equal(options.maxSupportedTransactionVersion, 1);
      return txs[signature] ?? null;
    },
  };
}

test("supported range mapping exactly matches Panta's public chart controls", () => {
  for (const range of ["1h", "6h", "1d", "7d", "all"]) assert.equal(isPriceHistoryRange(range), true);
  assert.equal(isPriceHistoryRange("24h"), false);
});

test("normalizes actual fills, retains duplicate timestamps, preserves zero and orders chronologically", () => {
  const series = filterAndNormalizeHistory({
    marketId: eventPda, eventPda, quoteAsset: "SOL", range: "all", retrievedAt: new Date(now).toISOString(),
    signaturesRead: 3, transactionsRead: 3,
    fills: [
      { signature: "later", slot: 3, blockTime: now / 1000, outcome: "YES", price: 0.6 },
      { signature: "same-time-no", slot: 2, blockTime: now / 1000 - 60, outcome: "NO", price: 1 },
      { signature: "same-time-yes", slot: 1, blockTime: now / 1000 - 60, outcome: "YES", price: 0.4 },
    ],
  });
  assert.equal(series.status, "available");
  assert.equal(series.quoteAsset, "SOL");
  assert.deepEqual(series.observations.map((point) => point.signature), ["same-time-no", "same-time-yes", "later"]);
  assert.equal(series.observations[0].yesProbability, 0);
  assert.equal(series.observations[0].slot, 2);
  assert.equal(series.observations[0].source, "panta-solana-order-matched");
});

test("range filtering uses the retrieval timestamp, rejecting missing and malformed observations", () => {
  const series = filterAndNormalizeHistory({
    marketId: eventPda, eventPda, quoteAsset: "USDC", range: "1h", retrievedAt: new Date(now).toISOString(), signaturesRead: 4, transactionsRead: 4,
    fills: [
      { signature: "in-range", slot: 1, blockTime: now / 1000 - 900, outcome: "YES", price: 0.2 },
      { signature: "out-of-range", slot: 2, blockTime: now / 1000 - 7200, outcome: "YES", price: 0.3 },
      { signature: "missing-time", slot: 3, blockTime: null, outcome: "YES", price: 0.4 },
      { signature: "bad-price", slot: 4, blockTime: now / 1000, outcome: "YES", price: 1.2 },
    ],
  });
  assert.equal(series.status, "available");
  assert.deepEqual(series.observations.map((point) => point.signature), ["in-range"]);
  const invalid = filterAndNormalizeHistory({ marketId: eventPda, eventPda, quoteAsset: "USDC", range: "1h", retrievedAt: new Date(now).toISOString(), signaturesRead: 1, transactionsRead: 1, fills: [{ signature: "bad", slot: 1, blockTime: null, outcome: "YES", price: 0.2 }] });
  assert.equal(invalid.status, "invalid");
  assert.equal(invalid.observations.length, 0);
});

test("empty successful response stays empty, while incomplete retrieval is marked partial", () => {
  const empty = filterAndNormalizeHistory({ marketId: eventPda, eventPda, quoteAsset: "SOL", range: "6h", retrievedAt: new Date(now).toISOString(), signaturesRead: 0, transactionsRead: 0, fills: [] });
  assert.equal(empty.status, "empty");
  assert.equal(empty.reason, "no-matched-trades-in-range");
  const partial = filterAndNormalizeHistory({ marketId: eventPda, eventPda, quoteAsset: "SOL", range: "all", retrievedAt: new Date(now).toISOString(), signaturesRead: 1, transactionsRead: 0, fills: [], partial: true });
  assert.equal(partial.completeness, "partial");
});

test("live reader uses the Event PDA, decodes matched logs only, and caches by range", async () => {
  clearPantaPriceHistoryCacheForTests();
  const rows = [
    { signature: "sig-a", slot: 10, blockTime: now / 1000 - 120, err: null },
    { signature: "sig-b", slot: 11, blockTime: now / 1000 - 60, err: null },
  ];
  const connection = mockConnection(rows, {
    "sig-a": { meta: { err: null, logMessages: [`Program ${PANTA_CLOB_PROGRAM_ID} invoke [1]`, matchedLog("NO", 0.75)] } },
    "sig-b": { meta: { err: null, logMessages: [`Program ${PANTA_CLOB_PROGRAM_ID} invoke [1]`, "Program data: bm90LWEtZmlsbA=="] } },
  });
  const options = { connection, verifiedEvent: { event: { question: market.question } } };
  const first = await getPantaPriceHistory(market, "1d", options);
  const cached = await getPantaPriceHistory(market, "1d", { connection: { ...connection, getSignaturesForAddress: async () => { throw new Error("cache miss"); } }, ...options });
  assert.equal(first.status, "available");
  assert.equal(first.observations.length, 1);
  assert.equal(first.observations[0].yesProbability, 0.25);
  assert.equal(first.observations[0].signature, "sig-a");
  assert.equal(cached, first);
  assert.equal(first.signaturesRead, 2);
  assert.equal(first.transactionsRead, 2);
  assert.equal(first.latestSignatureSlot, 10);
  assert.equal(first.latestSignatureBlockTime, new Date((now / 1000 - 120) * 1000).toISOString());
  assert.equal(first.signatureLimit, 36);
  assert.equal(first.coverage, "all-available");
});

test("failed history RPC stays separate from current market details and remains retryable", async () => {
  clearPantaPriceHistoryCacheForTests();
  const connection = mockConnection([], {});
  connection.getSignaturesForAddress = async () => { throw new Error("RPC unavailable"); };
  const failed = await getPantaPriceHistory(market, "1h", { connection, verifiedEvent: { event: { question: market.question } } });
  assert.equal(market.question, "Will BTC reach a new all-time high by December 31, 2026?");
  assert.equal(failed.status, "error");
  assert.equal(failed.observations.length, 0);
  assert.equal(failed.reason, "history-rpc-unavailable");
});

test("empty chart wording describes the selected period and does not draw a synthetic line", async () => {
  const chart = await readFile(new URL("../../components/charts/MarketPriceHistory.tsx", import.meta.url), "utf8");
  const plot = await readFile(new URL("../../components/charts/MiniChart.tsx", import.meta.url), "utf8");
  assert.match(chart, /No historical price observations were returned for this period/);
  assert.match(chart, /rangeLabel\[range\]/);
  assert.match(plot, /points\.flatMap/);
  assert.doesNotMatch(plot, /<polyline|<path/);
});

test("unsupported ranges and conflicting quote metadata never trigger RPC or normalize data", async () => {
  const unsupported = await getPantaPriceHistory(market, "24h");
  assert.equal(unsupported.status, "unsupported");
  assert.equal(unsupported.range, "24h");
  const conflicting = await getPantaPriceHistory({ ...market, quoteAssetResolution: { asset: "SOL", status: "conflict" } }, "1d");
  assert.equal(conflicting.status, "invalid");
  assert.equal(conflicting.reason, "quote-asset-unresolved");
});
