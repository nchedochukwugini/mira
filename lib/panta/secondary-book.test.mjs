import assert from "node:assert/strict";
import test from "node:test";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { discoverSecondaryMakers, isSupportedPantaTraversalLimit, MIRA_MAX_MAKER_TRAVERSAL } from "./secondary-book.ts";
import { PANTA_CLOB_PROGRAM_ID, PANTA_ORDER_NODE_DISCRIMINATOR, PANTA_PRICE_LEVEL_DISCRIMINATOR, PANTA_USER_POSITION_DISCRIMINATOR } from "./clob-layout.ts";

const program = new PublicKey(PANTA_CLOB_PROGRAM_ID);
const key = (n) => new PublicKey(new Uint8Array(32).fill(n));
const system = SystemProgram.programId;
const event = key(1);
const owner = key(2);
const price = 500_000_000n;
const u64 = (b, at, n) => b.writeBigUInt64LE(n, at);
function levelData(options = {}) {
  const data = Buffer.alloc(218); PANTA_PRICE_LEVEL_DISCRIMINATOR.copy(data); data[8] = 1; event.toBuffer().copy(data, 9); u64(data, 41, price);
  const head = options.head ?? key(3); const tail = options.tail ?? head;
  u64(data, 58, options.totalAsk ?? 1_000_000n); u64(data, 66, 0n); u64(data, 74, options.count ?? 1n); system.toBuffer().copy(data, 90); system.toBuffer().copy(data, 122);
  head.toBuffer().copy(data, 154); tail.toBuffer().copy(data, 186); return data;
}
function nodeData(level, options = {}) {
  const data = Buffer.alloc(269); PANTA_ORDER_NODE_DISCRIMINATOR.copy(data); data[8] = 1; owner.toBuffer().copy(data, 9); event.toBuffer().copy(data, 41); level.toBuffer().copy(data, 73);
  u64(data, 105, options.amount ?? 1_000_000n); u64(data, 113, options.original ?? 1_000_000n); data[129] = options.side ?? 0; data[130] = options.type ?? 1; data[131] = 1; u64(data, 132, price);
  system.toBuffer().copy(data, 157); (options.next ?? system).toBuffer().copy(data, 189); return data;
}
function positionData(options = {}) {
  const data = Buffer.alloc(202); PANTA_USER_POSITION_DISCRIMINATOR.copy(data); data[8] = options.initialized === false ? 0 : 1; event.toBuffer().copy(data, 9); (options.owner ?? owner).toBuffer().copy(data, 41); return data;
}
function setup(overrides = {}) {
  const level = PublicKey.findProgramAddressSync([Buffer.from("level_usdc"), event.toBuffer(), (() => { const b = Buffer.alloc(8); b.writeBigUInt64LE(price); return b; })()], program)[0];
  const node = key(3); const position = PublicKey.findProgramAddressSync([Buffer.from("position"), event.toBuffer(), owner.toBuffer()], program)[0];
  const accounts = new Map([
    [level.toBase58(), { owner: program, data: levelData(overrides.level) }],
    [node.toBase58(), { owner: overrides.nodeOwner ?? program, data: nodeData(level, overrides.node) }],
    [position.toBase58(), { owner: overrides.positionProgram ?? program, data: positionData(overrides.position) }],
  ]);
  const lookup = (pubkey) => accounts.get(pubkey.toBase58()) ?? null;
  const connection = {
    getAccountInfoAndContext: async (pubkey) => ({ context: { slot: 100 }, value: lookup(pubkey) }),
    getMultipleAccountsInfoAndContext: async (pubkeys) => ({ context: { slot: 105 }, value: pubkeys.map(lookup) }),
  };
  return { connection, level, node, position };
}
const discover = (connection) => discoverSecondaryMakers({ connection, event, price, side: "YES", buy: true, maxTraversePerTx: 10 });

test("maker discovery returns validated node, maker position, and frontend tail sentinel in order", async () => {
  const fixture = setup(); const result = await discover(fixture.connection);
  assert.equal(result.slot, 105); assert.equal(result.complete, true); assert.equal(result.nodes.length, 1);
  assert.deepEqual(result.remainingAccounts.map((meta) => meta.pubkey.toBase58()), [fixture.node.toBase58(), fixture.position.toBase58(), fixture.node.toBase58()]);
  assert.ok(result.remainingAccounts.every((meta) => meta.isWritable && !meta.isSigner));
});

test("Panta's production traversal setting of 50 is accepted while MIRA keeps its local cap at 32", async () => {
  assert.equal(isSupportedPantaTraversalLimit(50), true);
  assert.equal(isSupportedPantaTraversalLimit(0), false);
  assert.equal(isSupportedPantaTraversalLimit(51), false);
  const fixture = setup();
  const result = await discoverSecondaryMakers({ connection: fixture.connection, event, price, side: "YES", buy: true, maxTraversePerTx: 50 });
  assert.equal(result.traversalLimit, MIRA_MAX_MAKER_TRAVERSAL);
  assert.equal(result.nodes.length, 1);
});

test("maker discovery rejects wrong owner, outcome, order side, quantity, links, and position state", async (t) => {
  const cases = [
    ["wrong program owner", { nodeOwner: key(9) }],
    ["invalid outcome enum", { node: { side: 2 } }],
    ["wrong order type", { node: { type: 0 } }],
    ["zero remaining", { node: { amount: 0n } }],
    ["inconsistent original amount", { node: { amount: 2_000_000n, original: 1_000_000n } }],
    ["malformed maker position", { position: { initialized: false } }],
    ["wrong maker position owner", { position: { owner: key(8) } }],
    ["wrong maker position program", { positionProgram: key(9) }],
  ];
  for (const [name, input] of cases) await t.test(name, async () => assert.rejects(discover(setup(input).connection)));
});

test("frontend opposite-list traversal retains valid YES and NO nodes for on-chain matching", async () => {
  const fixture = setup({ node: { side: 1 } }); const result = await discover(fixture.connection);
  assert.equal(result.nodes[0].side, "NO", "the frontend traversal does not filter outcome before supplying maker accounts");
});

test("maker discovery rejects inconsistent level counts and cycles", async () => {
  await assert.rejects(discover(setup({ level: { count: 2n } }).connection));
  const fixture = setup();
  fixture.connection.getAccountInfoAndContext = async (pubkey) => {
    const result = await setup().connection.getAccountInfoAndContext(pubkey);
    if (pubkey.equals(fixture.node)) return { ...result, value: { ...result.value, data: nodeData(fixture.level, { next: fixture.node }) } };
    return result;
  };
  await assert.rejects(discover(fixture.connection), /cycle/);
});

test("maker discovery rejects a tail that is not terminal and account state changed in the final coherent read", async () => {
  const badTail = setup({ level: { tail: key(4) } });
  await assert.rejects(discover(badTail.connection), /tail|terminal/i);
  const changed = setup();
  const original = changed.connection.getMultipleAccountsInfoAndContext;
  let calls = 0;
  changed.connection.getMultipleAccountsInfoAndContext = async (pubkeys, options) => {
    const result = await original(pubkeys, options); calls += 1;
    if (calls === 2) return { ...result, value: result.value.map((account, index) => index === 1 ? { ...account, data: nodeData(changed.level, { next: key(9) }) } : account) };
    return result;
  };
  await assert.rejects(discover(changed.connection), /next link|terminal/i);
});
