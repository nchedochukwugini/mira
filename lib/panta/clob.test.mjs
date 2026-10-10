import test from "node:test";
import assert from "node:assert/strict";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import {
  PANTA_EVENT_DISCRIMINATOR,
  PANTA_ORDER_NODE_DISCRIMINATOR,
  PANTA_PRICE_LEVEL_DISCRIMINATOR,
  buildOutcomeBooks,
  classifyPantaInstruction,
  decodeOrderMatchedEvent,
  decodeOrderMatchedEventRaw,
  decodeOrderNode,
  decodePantaEvent,
  decodePriceLevel,
} from "./clob-layout.ts";
import { normalizePantaMarket } from "../intelligence/core.ts";

const key = (byte) => new PublicKey(new Uint8Array(32).fill(byte)).toBase58();
const system = SystemProgram.programId.toBase58();

function eventData({ active = true, graduated = true, resolved = false, cancelled = false, totalVolume = 0n, primaryPool = 0n, activeVolume = 0n } = {}) {
  const chunks = [PANTA_EVENT_DISCRIMINATOR, Buffer.alloc(32), Buffer.alloc(6 * 8 + 8 * 16 + 8 + 5 * 16 + 8 + 16)];
  const write128 = (offset, value) => { chunks[2].writeBigUInt64LE(value & ((1n << 64n) - 1n), offset - 40); chunks[2].writeBigUInt64LE(value >> 64n, offset - 40 + 8); };
  write128(168, totalVolume); write128(272, primaryPool);
  const string = (value) => { const bytes = Buffer.from(value); const length = Buffer.alloc(4); length.writeUInt32LE(bytes.length); return Buffer.concat([length, bytes]); };
  const vec = Buffer.alloc(4);
  const flags = Buffer.from([active, graduated, resolved, cancelled].map(Number));
  const activeBytes = Buffer.alloc(16); activeBytes.writeBigUInt64LE(activeVolume & ((1n << 64n) - 1n)); activeBytes.writeBigUInt64LE(activeVolume >> 64n, 8);
  return Buffer.concat([...chunks, string("Test market?"), string("Test rules"), vec, activeBytes, Buffer.alloc(3), flags]);
}

function levelData({ event = key(2), price = 630_000_000n, bidHead = system, bidTail = system, askHead = system, askTail = system, bidCount = 0n, askCount = 0n, totalBid = 0n, totalAsk = 0n } = {}) {
  const data = Buffer.alloc(218);
  PANTA_PRICE_LEVEL_DISCRIMINATOR.copy(data, 0);
  data[8] = 1;
  new PublicKey(event).toBuffer().copy(data, 9);
  data.writeBigUInt64LE(price, 41);
  data[49] = 254;
  data.writeBigUInt64LE(totalBid, 50);
  data.writeBigUInt64LE(totalAsk, 58);
  data.writeBigUInt64LE(bidCount, 66);
  data.writeBigUInt64LE(askCount, 74);
  for (const [value, offset] of [[bidHead, 90], [bidTail, 122], [askHead, 154], [askTail, 186]]) new PublicKey(value).toBuffer().copy(data, offset);
  return data;
}

function orderData({ owner = key(3), event = key(2), priceLevel = key(4), amount = 1_250_000n, side = 0, type = 0, intent = 0, price = 630_000_000n, previous = system, next = system } = {}) {
  const data = Buffer.alloc(269);
  PANTA_ORDER_NODE_DISCRIMINATOR.copy(data, 0);
  data[8] = 1;
  new PublicKey(owner).toBuffer().copy(data, 9);
  new PublicKey(event).toBuffer().copy(data, 41);
  new PublicKey(priceLevel).toBuffer().copy(data, 73);
  data.writeBigUInt64LE(amount, 105);
  data.writeBigUInt64LE(amount, 113);
  data.writeBigInt64LE(1_790_000_000n, 121);
  data[129] = side;
  data[130] = type;
  data[131] = intent;
  data.writeBigUInt64LE(price, 132);
  for (const [value, offset] of [[previous, 157], [next, 189]]) new PublicKey(value).toBuffer().copy(data, offset);
  return data;
}

test("decodes active Panta Event flags and rejects malformed or unknown accounts", () => {
  assert.deepEqual(decodePantaEvent(eventData()), { creator: key(0), creatorBytes: Buffer.alloc(32), question: "Test market?", claimableAt: 0n, totalVolumeBaseUnits: 0n, primaryPoolBaseUnits: 0n, activeVolumeBaseUnits: 0n, isActive: true, isGraduated: true, isResolved: false, isCancelled: false });
  assert.equal(decodePantaEvent(eventData({ resolved: true }))?.isResolved, true);
  assert.equal(decodePantaEvent(Buffer.alloc(2982)), null);
  assert.equal(decodePantaEvent(eventData().subarray(0, 40)), null);
});

test("decodes primary-pool and separate volume raw base units from the verified Event offsets", () => {
  const decoded = decodePantaEvent(eventData({ totalVolume: 11_547_196_079n, primaryPool: 11_547_196_079n, activeVolume: 11_047_196_079n }));
  assert.equal(decoded?.primaryPoolBaseUnits, 11_547_196_079n);
  assert.equal(decoded?.totalVolumeBaseUnits, 11_547_196_079n);
  assert.equal(decoded?.activeVolumeBaseUnits, 11_047_196_079n);
});

test("decodes verified PriceLevel and OrderNode layouts including YES bid and NO ask", () => {
  const event = key(2); const level = key(4); const bid = key(5); const ask = key(6);
  const decodedLevel = decodePriceLevel(level, levelData({ event, price: 1_000_000_000n, bidHead: bid, bidTail: bid, askHead: ask, askTail: ask, bidCount: 1n, askCount: 1n, totalBid: 1_000_000n, totalAsk: 2_000_000n }));
  assert.equal(decodedLevel?.event, event);
  assert.equal(decodedLevel?.priceLamports, 1_000_000_000n);
  assert.equal(decodeOrderNode(bid, orderData({ event, priceLevel: level, amount: 1_000_000n, side: 0, type: 0 }))?.side, "YES");
  const decodedAsk = decodeOrderNode(ask, orderData({ event, priceLevel: level, amount: 2_000_000n, side: 1, type: 1, intent: 1 }));
  assert.equal(decodedAsk?.side, "NO");
  assert.equal(decodedAsk?.orderType, "ask");
  assert.equal(decodePriceLevel(level, Buffer.alloc(218)), null);
  assert.equal(decodeOrderNode(bid, orderData({ side: 4 })), null);
  assert.equal(decodeOrderNode(bid, Buffer.alloc(269)), null);
});

test("primary-pool snapshots are not represented as executable order-book depth", () => {
  const market = normalizePantaMarket({ marketId: "pool-only", quoteAsset: "usdc", primaryPoolLamports: "200563692" });
  const books = buildOutcomeBooks({ levels: [], nodes: new Map() });
  assert.equal(market.primaryPoolLiquidity?.rawBaseUnits, "200563692");
  assert.equal(market.primaryPoolLiquidity?.amount, null, "the raw quote asset is not authoritative before registry resolution");
  assert.equal(market.primaryPoolLiquidityUsd, null);
  assert.equal(market.liquidityUsd, null);
  assert.equal(books.yes.bidDepth, 0);
  assert.equal(books.yes.askDepth, 0);
  assert.equal(books.no.bidDepth, 0);
  assert.equal(books.no.askDepth, 0);
});

test("groups multiple outcome-specific levels and calculates best prices, spread, and USDC notional depth", () => {
  const event = key(2); const firstLevel = key(4); const secondLevel = key(7); const yesNode = key(5); const yesAsk = key(6); const noNode = key(8);
  const levels = [
    { address: firstLevel, event, priceLamports: 630_000_000n, totalBidAmount: 1_250_000n, totalAskAmount: 2_000_000n, bidCount: 1n, askCount: 1n, bidHead: yesNode, bidTail: yesNode, askHead: yesAsk, askTail: yesAsk },
    { address: secondLevel, event, priceLamports: 640_000_000n, totalBidAmount: 1_000_000n, totalAskAmount: 0n, bidCount: 1n, askCount: 0n, bidHead: noNode, bidTail: noNode, askHead: system, askTail: system },
  ];
  const nodes = new Map([
    [yesNode, { address: yesNode, owner: key(3), event, priceLevel: firstLevel, amount: 1_250_000n, originalAmount: 1_250_000n, side: "YES", orderType: "bid", intent: "buy", priceLamports: 630_000_000n, previous: system, next: system }],
    [yesAsk, { address: yesAsk, owner: key(9), event, priceLevel: firstLevel, amount: 2_000_000n, originalAmount: 2_000_000n, side: "YES", orderType: "ask", intent: "sell", priceLamports: 630_000_000n, previous: system, next: system }],
    [noNode, { address: noNode, owner: key(10), event, priceLevel: secondLevel, amount: 1_000_000n, originalAmount: 1_000_000n, side: "NO", orderType: "bid", intent: "buy", priceLamports: 640_000_000n, previous: system, next: system }],
  ]);
  const result = buildOutcomeBooks({ levels, nodes, quoteAsset: "SOL" });
  assert.equal(result.partial, false);
  assert.equal(result.yes.bestBid, 0.63);
  assert.equal(result.yes.bestAsk, 0.63);
  assert.equal(result.yes.spread, 0);
  assert.equal(result.yes.bidDepth, 0.7875);
  assert.equal(result.yes.askDepth, 1.26);
  assert.equal(result.yes.quoteAsset, "SOL");
  assert.equal(result.yes.bids[0]?.quoteNotional, 0.7875);
  assert.equal(result.yes.openOrderCount, 2);
  assert.equal(result.no.bestBid, 0.64);
  assert.equal(result.no.bestAsk, null);
  assert.equal(result.no.spread, null);
  assert.equal(result.no.midpoint, null);
});

test("empty and incomplete books never invent the missing side", () => {
  const event = key(2); const level = key(4); const missing = key(11);
  const result = buildOutcomeBooks({ levels: [{ address: level, event, priceLamports: 500_000_000n, totalBidAmount: 1n, totalAskAmount: 0n, bidCount: 1n, askCount: 0n, bidHead: missing, bidTail: missing, askHead: system, askTail: system }], nodes: new Map() });
  assert.equal(result.partial, true);
  assert.equal(result.yes.bids.length, 0);
  assert.equal(result.yes.bestBid, null);
  assert.equal(result.yes.bestAsk, null);
  const empty = buildOutcomeBooks({ levels: [], nodes: new Map() });
  assert.equal(empty.partial, false);
  assert.equal(empty.no.bids.length, 0);
  assert.equal(empty.no.asks.length, 0);
});

test("cycles, orphaned nodes and inconsistent counts or aggregates make a book partial", () => {
  const event = key(2); const level = key(4); const nodeAddress = key(5);
  const node = { address: nodeAddress, owner: key(3), event, priceLevel: level, amount: 1_000_000n, originalAmount: 1_000_000n, side: "YES", orderType: "bid", intent: "buy", priceLamports: 500_000_000n, previous: system, next: nodeAddress };
  const cycle = buildOutcomeBooks({ levels: [{ address: level, event, priceLamports: 500_000_000n, totalBidAmount: 1_000_000n, totalAskAmount: 0n, bidCount: 1n, askCount: 0n, bidHead: nodeAddress, bidTail: nodeAddress, askHead: system, askTail: system }], nodes: new Map([[nodeAddress, node]]) });
  assert.equal(cycle.partial, true);
  const wrongCount = buildOutcomeBooks({ levels: [{ address: level, event, priceLamports: 500_000_000n, totalBidAmount: 1_000_000n, totalAskAmount: 0n, bidCount: 0n, askCount: 0n, bidHead: nodeAddress, bidTail: nodeAddress, askHead: system, askTail: system }], nodes: new Map([[nodeAddress, { ...node, next: system }]]) });
  assert.equal(wrongCount.partial, true);
  const orphan = buildOutcomeBooks({ levels: [], nodes: new Map([[nodeAddress, node]]) });
  assert.equal(orphan.partial, true);
});

test("decodes only the IDL OrderMatched event as matched activity", () => {
  const discriminator = Buffer.from([211, 0, 178, 174, 61, 245, 45, 250]);
  const data = Buffer.concat([discriminator, new PublicKey(key(2)).toBuffer(), Buffer.alloc(64), Buffer.from([0]), Buffer.alloc(16)]);
  data.writeBigUInt64LE(625_000_000n, 8 + 97);
  data.writeBigUInt64LE(2_500_000n, 8 + 105);
  assert.deepEqual(decodeOrderMatchedEvent(data), { outcome: "YES", price: 0.625, size: 2.5 });
  assert.deepEqual(decodeOrderMatchedEventRaw(data), { outcome: "YES", priceUnits: 625_000_000n, shareQuantityUnits: 2_500_000n });
  assert.equal(decodeOrderMatchedEvent(Buffer.alloc(121)), null);
});

test("only verified CLOB instruction names classify placement or cancellation; unfamiliar names stay unknown", () => {
  assert.equal(classifyPantaInstruction("SecondaryLimitOrderUsdc"), "order_placed");
  assert.equal(classifyPantaInstruction("CancelSecondaryOrderUsdc"), "order_cancelled");
  assert.equal(classifyPantaInstruction("PrimaryOrderUsdc"), null);
  assert.equal(classifyPantaInstruction("GraduateBreakingEventUsdc"), null);
});

test("normalizes Panta secondary mapping metadata without losing API identifiers", () => {
  const market = normalizePantaMarket({ marketId: key(2), question: "Example", phase: "secondary", status: "secondary_active", isActive: true, isGraduated: true, isResolved: false, programId: "6gM5afTQBq5VZCfgpGqcsqzfWd5maLSCKWtGjbEobZMp" });
  assert.equal(market?.id, key(2));
  assert.equal(market?.status, "active");
  assert.equal(market?.phase, "secondary");
  assert.equal(market?.pantaSecondaryActive, true);
  assert.equal(market?.pantaIsGraduated, true);
  assert.equal(market?.pantaIsResolved, false);
  assert.equal(market?.pantaProgramId, "6gM5afTQBq5VZCfgpGqcsqzfWd5maLSCKWtGjbEobZMp");
});

test("MIRA facts preserve on-chain provenance and summaries never turn an empty ask into zero", async () => {
  const { buildOrderBookFacts, summarizeOrderBookForMira } = await import("../intelligence/order-book-context.ts");
  const yes = buildOutcomeBooks({ levels: [], nodes: new Map(), quoteAsset: "USDC" }).yes;
  const snapshot = {
    marketId: key(2), marketQuestion: "Test", quoteAsset: "USDC", source: "panta-solana", sourceLabel: "Panta · Solana", observedAt: 1_790_000_000_000, slot: 123,
    dataStatus: "partial", freshness: "recent", pantaReference: { yesPrice: 0.63, noPrice: 0.37, observedAt: null },
    yes, no: { ...yes, outcome: "NO" }, activity: [], history: [], historyStatus: "not_collected",
  };
  const facts = buildOrderBookFacts(snapshot);
  assert.equal(facts.source, "panta-solana");
  assert.equal(facts.slot, 123);
  assert.equal(facts.dataStatus, "partial");
  assert.equal(facts.yes.bestBidUsdcPerShare, null);
  const answer = summarizeOrderBookForMira(snapshot);
  assert.match(answer, /No bids or asks returned by the current decoder/);
  assert.match(answer, /no ask levels returned by the current decoder/);
  assert.match(answer, /not a real-time feed/);
  assert.match(answer, /Panta API reference values are separate/);
  assert.doesNotMatch(answer, /asks? 0(?:\.00)?/i);
});
