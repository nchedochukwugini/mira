import assert from "node:assert/strict";
import test from "node:test";
import { compareVerifiedActivity } from "./verified-activity.ts";

const market = (id, subject) => ({ id, question: `Will ${subject} reach the target?`, category: "Crypto", description: null, status: "active", yesProbability: null, noProbability: null, volumeUsd: null, liquidityUsd: null, priceChange24h: null, closeAt: null, updatedAt: null, imageUrl: null, history: [], relatedMarketIds: [], source: "panta" });
const snapshot = (activity, status = "complete", dataStatus = "complete") => ({ marketId: "m", marketQuestion: "Will asset reach target?", source: "panta-solana", sourceLabel: "Panta · Solana", observedAt: 1_791_500_000_000, slot: 1, pantaReference: { yesPrice: null, noPrice: null, observedAt: null }, dataStatus, freshness: "live", yes: { outcome: "YES", bids: [], asks: [], bestBid: null, bestAsk: null, midpoint: null, spread: null, bidDepth: 0, askDepth: 0 }, no: { outcome: "NO", bids: [], asks: [], bestBid: null, bestAsk: null, midpoint: null, spread: null, bidDepth: 0, askDepth: 0 }, activity, activityStatus: status, historyStatus: "not_collected" });
const event = (kind, verificationStatus) => ({ signature: `${kind}-${verificationStatus}`, marketId: "m", programId: "p", slot: 1, observedAt: 1_791_500_000_000, kind, instruction: "event", decoderVersion: "panta-clob-log-v1", verificationStatus, classificationReason: "fixture" });

test("comparison counts only decoded matched events and preserves observation timestamp", async () => {
  const result = await compareVerifiedActivity({
    subjects: ["Bitcoin", "Ethereum"],
    provider: { source: "panta", discoverMarkets: async (query) => [market(`${query}-id`, query)] },
    getSnapshot: async () => snapshot([event("order_matched", "matched-event-verified"), event("order_placed", "instruction-observed"), event("order_cancelled", "instruction-observed" )]),
    now: () => "2026-10-09T00:00:00.000Z",
  });
  assert.equal(result.observations.length, 2);
  assert.deepEqual(result.observations.map((item) => item.verifiedMatchedEvents), [1, 1]);
  assert.ok(result.observations.every((item) => item.status === "available" && item.observedAt));
  assert.doesNotMatch(result.answer, /placed|cancelled/i);
});

test("provider empty, provider error, and missing activity remain distinct", async () => {
  const empty = await compareVerifiedActivity({ subjects: ["Bitcoin", "Ethereum"], provider: { source: "panta", discoverMarkets: async (query) => query === "Bitcoin" ? [] : [market("eth", "Ethereum")] }, getSnapshot: async () => snapshot([], "unavailable", "unavailable") });
  assert.equal(empty.observations[0].status, "empty");
  assert.equal(empty.observations[0].verifiedMatchedEvents, null);
  assert.equal(empty.observations[1].status, "unavailable");

  const failed = await compareVerifiedActivity({ subjects: ["Bitcoin", "Ethereum"], provider: { source: "panta", discoverMarkets: async (query) => { if (query === "Bitcoin") throw Error("private upstream details"); return [market("eth", "Ethereum")]; } }, getSnapshot: async () => { throw Error("rpc details"); } });
  assert.equal(failed.observations[0].status, "error");
  assert.equal(failed.observations[1].status, "error");
  assert.doesNotMatch(failed.answer, /private upstream|rpc details/);
});

test("partial activity and complete empty observations do not claim no trades occurred", async () => {
  const partial = await compareVerifiedActivity({ subjects: ["Bitcoin", "Ethereum"], provider: { source: "panta", discoverMarkets: async (query) => [market(query, query)] }, getSnapshot: async () => snapshot([], "partial", "partial") });
  assert.ok(partial.observations.every((item) => item.status === "partial" && item.verifiedMatchedEvents === 0));
  assert.match(partial.answer, /does not establish that no trades occurred/i);
  const complete = await compareVerifiedActivity({ subjects: ["Bitcoin", "Ethereum"], provider: { source: "panta", discoverMarkets: async (query) => [market(query, query)] }, getSnapshot: async () => snapshot([], "complete", "complete") });
  assert.ok(complete.observations.every((item) => item.status === "available" && item.verifiedMatchedEvents === 0));
  assert.match(complete.answer, /bounded observation/i);
  assert.doesNotMatch(complete.answer, /zero liquidity|no bets|no trades exist/i);
});
