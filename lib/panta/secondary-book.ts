import "server-only";
import { PublicKey, SystemProgram, type Connection } from "@solana/web3.js";
import {
  decodeOrderNode, decodePriceLevel, decodeUserPosition, PANTA_CLOB_PROGRAM_ID,
  type DecodedOrderNode, type DecodedPriceLevel,
} from "@/lib/panta/clob-layout";
import type { InstructionAccount } from "@/lib/panta/secondary-instructions";

const PROGRAM = new PublicKey(PANTA_CLOB_PROGRAM_ID);
const DEFAULT_KEY = SystemProgram.programId.toBase58();
const MAX_TRAVERSE = 32;

export type SecondaryMakerSnapshot = {
  priceLevel: DecodedPriceLevel;
  nodes: DecodedOrderNode[];
  remainingAccounts: InstructionAccount[];
  slot: number;
  traversalLimit: number;
  complete: boolean;
};

function derivePosition(event: PublicKey, owner: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("position"), event.toBuffer(), owner.toBuffer()], PROGRAM)[0];
}

function deriveLevel(event: PublicKey, price: bigint): PublicKey {
  const encoded = Buffer.alloc(8); encoded.writeBigUInt64LE(price);
  return PublicKey.findProgramAddressSync([Buffer.from("level_usdc"), event.toBuffer(), encoded], PROGRAM)[0];
}

function decodeNodeAt(address: string, data: Buffer, event: string, level: DecodedPriceLevel, orderType: "bid" | "ask", previous: string): DecodedOrderNode {
  const node = decodeOrderNode(address, data);
  if (!node || node.event !== event || node.priceLevel !== level.address || node.priceLamports !== level.priceLamports
    || node.orderType !== orderType || node.intent !== (orderType === "ask" ? "sell" : "buy") || node.previous !== previous
    || node.amount <= BigInt(0) || node.originalAmount < node.amount) {
    throw new Error(`Maker order ${address} has malformed, stale, mismatched, or non-open state.`);
  }
  return node;
}

/**
 * Reproduces the first-party traversal (opposite head, node/position pairs, tail),
 * then re-reads every selected account together at one RPC context slot. This is a
 * bounded observation, not an atomic guarantee through later transaction execution.
 */
export async function discoverSecondaryMakers(input: {
  connection: Connection;
  event: PublicKey;
  price: bigint;
  side: "YES" | "NO";
  buy: boolean;
  maxTraversePerTx: number;
}): Promise<SecondaryMakerSnapshot> {
  const { connection, event, price } = input;
  const limit = Math.min(Math.max(1, Math.trunc(input.maxTraversePerTx)), MAX_TRAVERSE);
  const expectedLevelAddress = deriveLevel(event, price);
  const first = await connection.getAccountInfoAndContext(expectedLevelAddress, { commitment: "confirmed" });
  if (!first.value || !first.value.owner.equals(PROGRAM)) throw new Error("The requested USDC price level is missing or is not owned by the Panta program.");
  const firstLevel = decodePriceLevel(expectedLevelAddress.toBase58(), first.value.data);
  if (!firstLevel || firstLevel.event !== event.toBase58() || firstLevel.priceLamports !== price) throw new Error("PriceLevel account does not match the requested market and price.");

  const head = input.buy ? firstLevel.askHead : firstLevel.bidHead;
  const tail = input.buy ? firstLevel.askTail : firstLevel.bidTail;
  const count = input.buy ? firstLevel.askCount : firstLevel.bidCount;
  const orderType = input.buy ? "ask" : "bid";
  if (head === DEFAULT_KEY) {
    if (tail !== DEFAULT_KEY || count !== BigInt(0)) throw new Error("PriceLevel empty-list pointers or count are inconsistent.");
    return { priceLevel: firstLevel, nodes: [], remainingAccounts: [], slot: first.context.slot, traversalLimit: limit, complete: true };
  }
  if (tail === DEFAULT_KEY || count <= BigInt(0)) throw new Error("PriceLevel list head, tail, and count are inconsistent.");

  // Collect keys with a bounded walk. Every link is rechecked in the coherent read below.
  const addresses: string[] = [];
  let cursor = head;
  let previous = DEFAULT_KEY;
  const visited = new Set<string>();
  while (cursor !== DEFAULT_KEY && addresses.length < limit) {
    if (visited.has(cursor)) throw new Error("Maker linked list contains a cycle or duplicate node.");
    visited.add(cursor); addresses.push(cursor);
    const nodeKey = new PublicKey(cursor);
    const account = await connection.getAccountInfoAndContext(nodeKey, { commitment: "confirmed", minContextSlot: first.context.slot });
    if (!account.value || !account.value.owner.equals(PROGRAM)) throw new Error(`Maker order ${cursor} is missing or has the wrong program owner.`);
    const node = decodeNodeAt(cursor, account.value.data, event.toBase58(), firstLevel, orderType, previous);
    previous = cursor; cursor = node.next;
  }
  const nextAfterWalk = cursor;
  if (addresses.length > Number(count)) throw new Error("PriceLevel count is smaller than its traversed maker list.");
  const complete = cursor === DEFAULT_KEY;
  if (complete && (previous !== tail || BigInt(addresses.length) !== count)) throw new Error("Maker traversal does not terminate at the recorded tail and count.");

  const ownerByNode = new Map<string, string>();
  const keys = [expectedLevelAddress, ...addresses.map((address) => new PublicKey(address)), new PublicKey(tail)];
  // First coherent pass obtains owners to derive maker positions; second coherent pass
  // below verifies both nodes and positions against the exact same minContextSlot.
  const keyResponse = await connection.getMultipleAccountsInfoAndContext(keys, { commitment: "confirmed", minContextSlot: first.context.slot });
  const coherentLevel = keyResponse.value[0];
  if (!coherentLevel || !coherentLevel.owner.equals(PROGRAM)) throw new Error("PriceLevel changed owner or disappeared during maker discovery.");
  const level = decodePriceLevel(expectedLevelAddress.toBase58(), coherentLevel.data);
  if (!level || level.event !== event.toBase58() || level.priceLamports !== price
    || (input.buy ? level.askHead : level.bidHead) !== head || (input.buy ? level.askTail : level.bidTail) !== tail
    || (input.buy ? level.askCount : level.bidCount) !== count) {
    throw new Error("PriceLevel changed while the maker snapshot was being built.");
  }
  addresses.forEach((address, index) => {
    const account = keyResponse.value[index + 1];
    if (!account || !account.owner.equals(PROGRAM)) throw new Error(`Maker order ${address} is missing or has the wrong owner at the snapshot slot.`);
    const node = decodeNodeAt(address, account.data, event.toBase58(), level, orderType, index ? addresses[index - 1]! : DEFAULT_KEY);
    ownerByNode.set(address, node.owner);
  });
  const tailAccount = keyResponse.value[keyResponse.value.length - 1];
  if (!tailAccount || !tailAccount.owner.equals(PROGRAM)) throw new Error("Recorded maker tail is missing or is not program-owned.");
  const tailNode = decodeOrderNode(tail, tailAccount.data);
  if (!tailNode || tailNode.event !== event.toBase58() || tailNode.priceLevel !== level.address || tailNode.priceLamports !== price
    || tailNode.orderType !== orderType || tailNode.next !== DEFAULT_KEY || tailNode.amount <= BigInt(0)) {
    throw new Error("Recorded tail account is not the open terminal node for this market, side, and price level.");
  }
  if (complete && addresses[addresses.length - 1] !== tail) throw new Error("Complete maker traversal has the wrong tail.");
  if (new Set(addresses).size !== addresses.length) throw new Error("Maker account sequence contains duplicate order nodes.");

  const positionKeys = addresses.map((address) => derivePosition(event, new PublicKey(ownerByNode.get(address)!)));
  // Final coherent snapshot includes the level, every maker node, terminal tail,
  // and all maker positions in one RPC context.
  const snapshotResponse = await connection.getMultipleAccountsInfoAndContext(
    [expectedLevelAddress, ...addresses.map((address) => new PublicKey(address)), new PublicKey(tail), ...positionKeys],
    { commitment: "confirmed", minContextSlot: keyResponse.context.slot },
  );
  const snapshotLevelInfo = snapshotResponse.value[0];
  if (!snapshotLevelInfo || !snapshotLevelInfo.owner.equals(PROGRAM)) throw new Error("PriceLevel disappeared in the final maker snapshot.");
  const snapshotLevel = decodePriceLevel(expectedLevelAddress.toBase58(), snapshotLevelInfo.data);
  if (!snapshotLevel || snapshotLevel.event !== event.toBase58() || snapshotLevel.priceLamports !== price
    || (input.buy ? snapshotLevel.askHead : snapshotLevel.bidHead) !== head || (input.buy ? snapshotLevel.askTail : snapshotLevel.bidTail) !== tail
    || (input.buy ? snapshotLevel.askCount : snapshotLevel.bidCount) !== count) {
    throw new Error("PriceLevel changed before the maker snapshot was returned.");
  }
  const tailIndex = 1 + addresses.length;
  const finalTailInfo = snapshotResponse.value[tailIndex];
  const finalTail = finalTailInfo?.owner.equals(PROGRAM) ? decodeOrderNode(tail, finalTailInfo.data) : null;
  if (!finalTail || finalTail.event !== event.toBase58() || finalTail.priceLevel !== snapshotLevel.address || finalTail.next !== DEFAULT_KEY
    || finalTail.orderType !== orderType || finalTail.amount <= BigInt(0)) throw new Error("The tail changed or is no longer the open terminal order.");
  const nodes: DecodedOrderNode[] = [];
  const remainingAccounts: InstructionAccount[] = [];
  let traversedAmount = BigInt(0);
  for (let index = 0; index < addresses.length; index += 1) {
    const address = addresses[index]!;
    const nodeAccount = snapshotResponse.value[index + 1];
    if (!nodeAccount || !nodeAccount.owner.equals(PROGRAM)) throw new Error(`Maker order ${address} changed owner or disappeared in the final snapshot.`);
    const node = decodeNodeAt(address, nodeAccount.data, event.toBase58(), snapshotLevel, orderType, index ? addresses[index - 1]! : DEFAULT_KEY);
    const expectedNext = index + 1 < addresses.length ? addresses[index + 1]! : nextAfterWalk;
    if (node.next !== expectedNext) throw new Error(`Maker order ${address} changed its next link during discovery.`);
    const positionAddress = positionKeys[index]!.toBase58();
    const positionAccount = snapshotResponse.value[tailIndex + 1 + index];
    if (!positionAccount || !positionAccount.owner.equals(PROGRAM)) throw new Error(`Maker position ${positionAddress} is missing or not program-owned.`);
    const position = decodeUserPosition(positionAddress, positionAccount.data);
    if (!position || position.event !== event.toBase58() || position.owner !== node.owner || positionAddress !== derivePosition(event, new PublicKey(node.owner)).toBase58()) {
      throw new Error(`Maker position ${positionAddress} does not belong to maker ${node.owner} and this market.`);
    }
    nodes.push(node);
    traversedAmount += node.amount;
    remainingAccounts.push({ pubkey: new PublicKey(address), isSigner: false, isWritable: true });
    remainingAccounts.push({ pubkey: positionKeys[index]!, isSigner: false, isWritable: true });
  }
  const aggregate = input.buy ? snapshotLevel.totalAskAmount : snapshotLevel.totalBidAmount;
  if (traversedAmount > aggregate || (complete && traversedAmount !== aggregate)) throw new Error("Maker quantities do not reconcile with the PriceLevel aggregate.");
  // The frontend supplies the list tail after node/position pairs. It can equal a
  // traversed node; that duplicate is a distinct sentinel role in the IDL client.
  if (tail !== DEFAULT_KEY) remainingAccounts.push({ pubkey: new PublicKey(tail), isSigner: false, isWritable: true });
  return { priceLevel: snapshotLevel, nodes, remainingAccounts, slot: snapshotResponse.context.slot, traversalLimit: limit, complete };
}
