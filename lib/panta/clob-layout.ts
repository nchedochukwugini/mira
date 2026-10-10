import { PublicKey, SystemProgram } from "@solana/web3.js";
import type { OrderBookLevel, OutcomeOrderBook, QuoteAsset } from "@/lib/panta/types";

/** Account discriminators and Borsh layouts from Panta's deployed frontend Anchor IDL. */
export const PANTA_CLOB_PROGRAM_ID = "6gM5afTQBq5VZCfgpGqcsqzfWd5maLSCKWtGjbEobZMp";
export const PANTA_EVENT_DISCRIMINATOR = Buffer.from([125, 192, 125, 158, 9, 115, 152, 233]);
export const PANTA_PRICE_LEVEL_DISCRIMINATOR = Buffer.from([236, 106, 90, 162, 188, 41, 219, 186]);
export const PANTA_ORDER_NODE_DISCRIMINATOR = Buffer.from([220, 235, 38, 63, 66, 140, 138, 244]);
export const PANTA_USER_POSITION_DISCRIMINATOR = Buffer.from([251, 248, 209, 245, 83, 234, 17, 27]);
export const PANTA_ORDER_MATCHED_DISCRIMINATOR = Buffer.from([211, 0, 178, 174, 61, 245, 45, 250]);
export const SHARE_DECIMALS = 6;
export const PRICE_SCALE = 1_000_000_000;

const SYSTEM_PROGRAM = SystemProgram.programId.toBase58();
const sameBytes = (left: Buffer, right: Buffer) => left.length === right.length && left.equals(right);
const pubkeyAt = (data: Buffer, offset: number) => new PublicKey(data.subarray(offset, offset + 32)).toBase58();
const u64At = (data: Buffer, offset: number) => data.readBigUInt64LE(offset);
const u128At = (data: Buffer, offset: number) => data.readBigUInt64LE(offset) | (data.readBigUInt64LE(offset + 8) << BigInt(64));

export type DecodedPantaEvent = {
  creator: string;
  creatorBytes: Buffer;
  question: string;
  claimableAt: bigint;
  totalVolumeBaseUnits: bigint;
  primaryPoolBaseUnits: bigint;
  activeVolumeBaseUnits: bigint;
  isActive: boolean;
  isGraduated: boolean;
  isResolved: boolean;
  isCancelled: boolean;
};

export type DecodedPriceLevel = {
  address: string;
  event: string;
  priceLamports: bigint;
  totalBidAmount: bigint;
  totalAskAmount: bigint;
  bidCount: bigint;
  askCount: bigint;
  bidHead: string;
  bidTail: string;
  askHead: string;
  askTail: string;
};

export type DecodedOrderNode = {
  address: string;
  owner: string;
  event: string;
  priceLevel: string;
  amount: bigint;
  originalAmount: bigint;
  side: "YES" | "NO";
  orderType: "bid" | "ask";
  intent: "buy" | "sell";
  priceLamports: bigint;
  previous: string;
  next: string;
};

export type DecodedUserPosition = { address: string; event: string; owner: string; initialized: boolean };

/** Later frontend IDL UserPosition layout: discriminator, bool, event, owner, bump, eight u128s. */
export function decodeUserPosition(address: string, data: Buffer): DecodedUserPosition | null {
  if (data.length !== 202 || !sameBytes(data.subarray(0, 8), PANTA_USER_POSITION_DISCRIMINATOR) || data[8] !== 1) return null;
  return { address, initialized: true, event: pubkeyAt(data, 9), owner: pubkeyAt(data, 41) };
}

function readEventString(data: Buffer, cursor: { offset: number }): string {
  if (cursor.offset + 4 > data.length) throw new Error("Malformed Panta Event string length.");
  const length = data.readUInt32LE(cursor.offset);
  cursor.offset += 4;
  if (length > 4096 || cursor.offset + length > data.length) throw new Error("Malformed Panta Event string.");
  const value = data.toString("utf8", cursor.offset, cursor.offset + length);
  cursor.offset += length;
  return value;
}

/** Decodes only fields required to validate Panta Event identity and lifecycle. */
export function decodePantaEvent(data: Buffer): DecodedPantaEvent | null {
  try {
    if (data.length < 8 || !sameBytes(data.subarray(0, 8), PANTA_EVENT_DISCRIMINATOR)) return null;
    const creatorBytes = Buffer.from(data.subarray(8, 40));
    const cursor = { offset: 8 + 32 + (6 * 8) + (8 * 16) + 8 + (5 * 16) + 8 + 16 };
    const question = readEventString(data, cursor);
    readEventString(data, cursor); // resolution_rule
    if (cursor.offset + 4 > data.length) return null;
    const sourceCount = data.readUInt32LE(cursor.offset);
    cursor.offset += 4;
    if (sourceCount > 64) return null;
    for (let index = 0; index < sourceCount; index += 1) readEventString(data, cursor);
    const activeVolumeBaseUnits = u128At(data, cursor.offset);
    cursor.offset += 16; // active_volume
    cursor.offset += 3; // bump fields
    if (cursor.offset + 4 > data.length) return null;
    const flags = [...data.subarray(cursor.offset, cursor.offset + 4)];
    if (flags.some((flag) => flag !== 0 && flag !== 1)) return null;
    const claimableAt = data.readBigInt64LE(304);
    const creator = new PublicKey(creatorBytes).toBase58();
    return { creator, creatorBytes, question, claimableAt, totalVolumeBaseUnits: u128At(data, 168), primaryPoolBaseUnits: u128At(data, 272), activeVolumeBaseUnits, isActive: flags[0] === 1, isGraduated: flags[1] === 1, isResolved: flags[2] === 1, isCancelled: flags[3] === 1 };
  } catch { return null; }
}

export function decodePriceLevel(address: string, data: Buffer): DecodedPriceLevel | null {
  if (data.length !== 218 || !sameBytes(data.subarray(0, 8), PANTA_PRICE_LEVEL_DISCRIMINATOR) || data[8] !== 1) return null;
  return {
    address,
    event: pubkeyAt(data, 9),
    priceLamports: u64At(data, 41),
    totalBidAmount: u64At(data, 50),
    totalAskAmount: u64At(data, 58),
    bidCount: u64At(data, 66),
    askCount: u64At(data, 74),
    bidHead: pubkeyAt(data, 90),
    bidTail: pubkeyAt(data, 122),
    askHead: pubkeyAt(data, 154),
    askTail: pubkeyAt(data, 186),
  };
}

export function decodeOrderNode(address: string, data: Buffer): DecodedOrderNode | null {
  if (data.length !== 269 || !sameBytes(data.subarray(0, 8), PANTA_ORDER_NODE_DISCRIMINATOR) || data[8] !== 1) return null;
  const side = data[129];
  const orderType = data[130];
  const intent = data[131];
  if ((side !== 0 && side !== 1) || (orderType !== 0 && orderType !== 1) || (intent !== 0 && intent !== 1)) return null;
  return {
    address,
    owner: pubkeyAt(data, 9),
    event: pubkeyAt(data, 41),
    priceLevel: pubkeyAt(data, 73),
    amount: u64At(data, 105),
    originalAmount: u64At(data, 113),
    side: side === 0 ? "YES" : "NO",
    orderType: orderType === 0 ? "bid" : "ask",
    intent: intent === 0 ? "buy" : "sell",
    priceLamports: u64At(data, 132),
    previous: pubkeyAt(data, 157),
    next: pubkeyAt(data, 189),
  };
}

export function decodeOrderMatchedEventRaw(data: Buffer): { outcome: "YES" | "NO"; priceUnits: bigint; shareQuantityUnits: bigint } | null {
  if (data.length < 121 || !sameBytes(data.subarray(0, 8), PANTA_ORDER_MATCHED_DISCRIMINATOR)) return null;
  const side = data[8 + 96];
  if (side !== 0 && side !== 1) return null;
  const priceUnits = u64At(data, 8 + 97);
  const shareQuantityUnits = u64At(data, 8 + 105);
  if (priceUnits === BigInt(0) || shareQuantityUnits === BigInt(0)) return null;
  return { outcome: side === 0 ? "YES" : "NO", priceUnits, shareQuantityUnits };
}

export function decodeOrderMatchedEvent(data: Buffer): { outcome: "YES" | "NO"; price: number; size: number } | null {
  const raw = decodeOrderMatchedEventRaw(data);
  if (!raw) return null;
  const price = Number(raw.priceUnits) / PRICE_SCALE;
  const size = Number(raw.shareQuantityUnits) / 10 ** SHARE_DECIMALS;
  if (!Number.isFinite(price) || !Number.isFinite(size) || price <= 0 || size <= 0) return null;
  return { outcome: raw.outcome, price, size };
}

export function classifyPantaInstruction(name: string): "order_placed" | "order_cancelled" | null {
  if (name === "SecondaryLimitOrderUsdc") return "order_placed";
  if (name === "CancelSecondaryOrderUsdc") return "order_cancelled";
  return null;
}

export function makeEmptyOutcomeBook(outcome: "YES" | "NO", quoteAsset: QuoteAsset | null = null): OutcomeOrderBook {
  return { outcome, quoteAsset, bids: [], asks: [], bidOrderCount: 0, askOrderCount: 0, openOrderCount: 0, bestBid: null, bestAsk: null, midpoint: null, spread: null, bidDepth: 0, askDepth: 0, bidDepthQuote: 0, askDepthQuote: 0 };
}

function summarizeLevels(outcome: "YES" | "NO", bids: OrderBookLevel[], asks: OrderBookLevel[], bidOrderCount: number, askOrderCount: number): OutcomeOrderBook {
  bids.sort((a, b) => b.price - a.price);
  asks.sort((a, b) => a.price - b.price);
  const bestBid = bids[0]?.price ?? null;
  const bestAsk = asks[0]?.price ?? null;
  return {
    outcome, bids, asks, bidOrderCount, askOrderCount, openOrderCount: bidOrderCount + askOrderCount, bestBid, bestAsk,
    midpoint: bestBid !== null && bestAsk !== null ? (bestBid + bestAsk) / 2 : null,
    spread: bestBid !== null && bestAsk !== null ? bestAsk - bestBid : null,
    bidDepth: bids.reduce((sum, level) => sum + (level.quoteNotional ?? level.price * level.size), 0),
    askDepth: asks.reduce((sum, level) => sum + (level.quoteNotional ?? level.price * level.size), 0),
  };
}

export function buildOutcomeBooks(input: { levels: DecodedPriceLevel[]; nodes: Map<string, DecodedOrderNode>; maxNodesPerSide?: number; quoteAsset?: QuoteAsset | null }) {
  const collected: Record<"YES" | "NO", { bids: Map<number, number>; asks: Map<number, number>; bidOrderCount: number; askOrderCount: number }> = {
    YES: { bids: new Map(), asks: new Map(), bidOrderCount: 0, askOrderCount: 0 }, NO: { bids: new Map(), asks: new Map(), bidOrderCount: 0, askOrderCount: 0 },
  };
  let partial = false;
  const usedNodes = new Set<string>();
  const maxNodes = input.maxNodesPerSide ?? 500;
  for (const level of input.levels) {
    if (level.priceLamports <= BigInt(0) || level.priceLamports > BigInt(PRICE_SCALE)) { partial = true; continue; }
    const price = Number(level.priceLamports) / PRICE_SCALE;
    for (const list of [
      { kind: "bid" as const, head: level.bidHead, tail: level.bidTail, count: level.bidCount },
      { kind: "ask" as const, head: level.askHead, tail: level.askTail, count: level.askCount },
    ]) {
      if (list.head === SYSTEM_PROGRAM) {
        const expectedAmount = list.kind === "bid" ? level.totalBidAmount : level.totalAskAmount;
        if (list.count !== BigInt(0) || list.tail !== SYSTEM_PROGRAM || expectedAmount !== BigInt(0)) partial = true;
        continue;
      }
      let address = list.head;
      let previous = SYSTEM_PROGRAM;
      const visited = new Set<string>();
      let traversed = 0;
      let traversedAmount = BigInt(0);
      while (address !== SYSTEM_PROGRAM) {
        if (visited.has(address) || traversed >= maxNodes) { partial = true; break; }
        visited.add(address);
        const node = input.nodes.get(address);
        if (!node || usedNodes.has(address) || node.event !== level.event || node.priceLevel !== level.address || node.priceLamports !== level.priceLamports || node.orderType !== list.kind || node.previous !== previous || node.amount <= BigInt(0) || node.amount > node.originalAmount || node.amount > BigInt(Number.MAX_SAFE_INTEGER)) { partial = true; break; }
        usedNodes.add(address);
        traversedAmount += node.amount;
        const size = Number(node.amount) / 10 ** SHARE_DECIMALS;
        const book = collected[node.side][list.kind === "bid" ? "bids" : "asks"];
        book.set(price, (book.get(price) ?? 0) + size);
        if (list.kind === "bid") collected[node.side].bidOrderCount += 1;
        else collected[node.side].askOrderCount += 1;
        previous = address;
        address = node.next;
        traversed += 1;
      }
      const expectedAmount = list.kind === "bid" ? level.totalBidAmount : level.totalAskAmount;
      if (address === SYSTEM_PROGRAM && (previous !== list.tail || BigInt(traversed) !== list.count || traversedAmount !== expectedAmount)) partial = true;
    }
  }
  if (usedNodes.size !== input.nodes.size) partial = true;
  const levels = (outcome: "YES" | "NO", kind: "bids" | "asks") => [...collected[outcome][kind]].map(([price, size]) => ({ price, size, quoteNotional: price * size, side: kind === "bids" ? "bid" as const : "ask" as const }));
  const yes = summarizeLevels("YES", levels("YES", "bids"), levels("YES", "asks"), collected.YES.bidOrderCount, collected.YES.askOrderCount);
  const no = summarizeLevels("NO", levels("NO", "bids"), levels("NO", "asks"), collected.NO.bidOrderCount, collected.NO.askOrderCount);
  yes.quoteAsset = input.quoteAsset ?? null; yes.bidDepthQuote = yes.bidDepth; yes.askDepthQuote = yes.askDepth;
  no.quoteAsset = input.quoteAsset ?? null; no.bidDepthQuote = no.bidDepth; no.askDepthQuote = no.askDepth;
  return { yes, no, partial };
}

export function isSystemAddress(address: string): boolean { return address === SYSTEM_PROGRAM; }
