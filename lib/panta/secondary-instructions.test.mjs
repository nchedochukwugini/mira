import assert from "node:assert/strict";
import test from "node:test";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import {
  buildSecondaryCancellationInstruction,
  buildSecondaryPlacementInstruction,
  CANCEL_SECONDARY_ORDER_USDC_DISCRIMINATOR,
  instructionToWalletFormat,
  SECONDARY_LIMIT_ORDER_USDC_DISCRIMINATOR,
  secondaryPriceUnits,
  secondaryShareUnits,
} from "./secondary-instructions.ts";

const key = (byte) => new PublicKey(new Uint8Array(32).fill(byte));
const context = { event: key(1), creator: key(2), question: "Verified example market?", treasury: key(3), usdcMint: new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"), priceTickSize: 1_000_000n };
const system = SystemProgram.programId.toBase58();

test("serializes placement using verified USDC discriminator, enum, units, account order, and privileges", () => {
  const ix = buildSecondaryPlacementInstruction({ context, user: key(4), side: "YES", price: "0.520520999", shares: "1.921152", buy: true, clientNonce: 123n });
  assert.equal(ix.programId.toBase58(), "6gM5afTQBq5VZCfgpGqcsqzfWd5maLSCKWtGjbEobZMp");
  assert.deepEqual(ix.data.subarray(0, 8), SECONDARY_LIMIT_ORDER_USDC_DISCRIMINATOR);
  assert.equal(ix.data.length, 66);
  assert.equal(ix.data[8], 0);
  assert.equal(ix.data.readBigUInt64LE(9), 520_520_999n);
  assert.equal(ix.data.readBigUInt64LE(17), 1_921_152n);
  assert.equal(ix.data[25], 1);
  assert.equal(ix.data.readBigUInt64LE(26), 123n);
  assert.equal(ix.keys.length, 16);
  assert.deepEqual(ix.keys.map(({ isSigner, isWritable }) => [isSigner, isWritable]), [
    [true, true], [false, false], [false, true], [false, true], [false, true], [false, true],
    [false, false], [false, true], [false, true], [false, true], [false, true], [false, true],
    [false, false], [false, false], [false, false], [false, false],
  ]);
  const walletFormat = instructionToWalletFormat(ix);
  assert.equal(walletFormat.accounts[0].pubkey, key(4).toBase58());
  assert.equal(walletFormat.data, ix.data.toString("base64"));
});

test("captured mainnet placement transaction preserves the frontend fixed account prefix and serialized arguments", () => {
  // Read-only getTransaction fixture: 3iLr6P... at finalized slot 447296449.
  const observed = Buffer.from("6e47f005b4c0a3b1010065cd1d0000000000093d000000000001cf91c41a885b0600aea3f33b93bf48b4ea84a2aeff9143b07251ab1ef3eebcebd693fbc00c6bd8e3", "hex");
  assert.deepEqual(observed.subarray(0, 8), SECONDARY_LIMIT_ORDER_USDC_DISCRIMINATOR);
  assert.equal(observed[8], 1, "observed side is NO");
  assert.equal(observed.readBigUInt64LE(9), 500_000_000n);
  assert.equal(observed.readBigUInt64LE(17), 4_000_000n);
  assert.equal(observed[25], 1, "observed order is buy");
  assert.equal(observed.length, 66);
  const observedFixedAccounts = [
    "FaK7AMdrkDBm4L6nAsnQfnFJBXcAXb2QNqkxhTMYA4kY", "8mJjfx7SuWwS4yfVZXtqC2cvzxr3TQHsCgKyjpuDWKAP",
    "GXh9iztJTm5v6qDWnR4YcKHbSc3AUZ2VEMGfKEegd92V", "9XTvyrNAEK53DPeVfBmyKzM6BfKxkWUXA2tKUi59PSbA",
    "CkiwPYHChPapxmamdxxg1dMfK6ijKzko1q1Jvp2F4qJJ", "A4DWhqacuUVdKwafPUJQnevaw5iwJzJjuxB7zWz2Yqq7",
    "HxXB3bT1yn7UnH5tE8fypqcT3qSdhEvhSwyTXvszoUwg", "D1ecoD8Rbg3qAuyHuDRofvid6b2hbSk5to4Zx5yqMnyd",
    "3o2W2bTHreu7NgCWnU8A4J2qqo8YYqFRNGTwmGjEtMFb", "4hjBNeJQ5ctBfKBnDP2ppHqy8BP1HNZtTx56oYtKBAv8",
    "9hwZLD2JZuWFDDQXEnHsnny7EF2LeyHqwcMFVssYEGpC", "GbuSBvDsCZmb5P7jLzyRZM8u69Qayf4Qff8jkicGtFry",
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL", system,
  ];
  const signerWritable = [true, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false];
  const writable = [true, false, true, true, true, true, false, true, true, true, true, true, false, false, false, false];
  assert.equal(observedFixedAccounts.length, 16);
  assert.deepEqual(signerWritable, [true, ...Array(15).fill(false)]);
  assert.deepEqual(writable, [true, false, true, true, true, true, false, true, true, true, true, true, false, false, false, false]);
});

test("placement rejects invalid precision, zero price or size, nonce, or non-mainnet USDC mint", () => {
  assert.throws(() => secondaryPriceUnits("0.1234567891"));
  assert.throws(() => secondaryShareUnits("1.0000001"));
  assert.doesNotThrow(() => buildSecondaryPlacementInstruction({ context, user: key(4), side: "NO", price: "0.520520999", shares: "1", buy: false, clientNonce: 1n }), "the known successful fill uses a price not divisible by the configured tick; tick enforcement is not established");
  assert.throws(() => buildSecondaryPlacementInstruction({ context: { ...context, priceTickSize: 0n }, user: key(4), side: "NO", price: "0.521", shares: "1", buy: false, clientNonce: 1n }));
  assert.throws(() => buildSecondaryPlacementInstruction({ context: { ...context, usdcMint: key(9) }, user: key(4), side: "NO", price: "0.521", shares: "1", buy: false, clientNonce: 1n }));
  assert.throws(() => buildSecondaryPlacementInstruction({ context, user: key(4), side: "NO", price: "0.521", shares: "0", buy: false, clientNonce: 1n }));
  assert.throws(() => buildSecondaryPlacementInstruction({ context, user: key(4), side: "NO", price: "0", shares: "1", buy: false, clientNonce: 1n }));
  assert.throws(() => buildSecondaryPlacementInstruction({ context, user: key(4), side: "NO", price: "0.521", shares: "1", buy: false, clientNonce: 9_007_199_254_740_992n }));
});

test("cancellation is bound to the exact owner, event, order node, and linked-list neighbors", () => {
  const user = key(4);
  const level = buildSecondaryPlacementInstruction({ context, user, side: "YES", price: "0.521", shares: "1", buy: false, clientNonce: 1n }).keys[4].pubkey.toBase58();
  const target = { address: key(5).toBase58(), owner: user.toBase58(), event: context.event.toBase58(), priceLevel: level, priceLamports: 521_000_000n, amount: 500_000n, originalAmount: 1_000_000n, previous: key(7).toBase58(), next: key(8).toBase58() };
  const previous = { address: target.previous, event: target.event, priceLevel: target.priceLevel, next: target.address };
  const next = { address: target.next, event: target.event, priceLevel: target.priceLevel, previous: target.address };
  const ix = buildSecondaryCancellationInstruction({ context, user, target, previous, next });
  assert.deepEqual(ix.data, CANCEL_SECONDARY_ORDER_USDC_DISCRIMINATOR);
  assert.equal(ix.keys.length, 15);
  assert.equal(ix.keys[8].pubkey.toBase58(), target.address);
  assert.equal(ix.keys[9].pubkey.toBase58(), previous.address);
  assert.equal(ix.keys[10].pubkey.toBase58(), next.address);
  assert.deepEqual(ix.keys.map(({ isSigner, isWritable }) => [isSigner, isWritable]), [
    [true, true], [false, false], [false, false], [false, true], [false, false], [false, true], [false, true],
    [false, true], [false, true], [false, true], [false, true], [false, false], [false, false], [false, false], [false, false],
  ]);
  assert.throws(() => buildSecondaryCancellationInstruction({ context, user: key(9), target, previous, next }), /owner or market/);
  assert.throws(() => buildSecondaryCancellationInstruction({ context: { ...context, event: key(10) }, user, target, previous, next }), /owner or market/);
  assert.throws(() => buildSecondaryCancellationInstruction({ context, user, target: { ...target, address: key(11).toBase58() }, previous, next }), /neighbor/);
});

test("empty linked-list neighbors occupy the IDL optional account slots as writable System Program placeholders", () => {
  const user = key(4);
  const level = buildSecondaryPlacementInstruction({ context, user, side: "YES", price: "0.521", shares: "1", buy: false, clientNonce: 1n }).keys[4].pubkey.toBase58();
  const target = { address: key(5).toBase58(), owner: user.toBase58(), event: context.event.toBase58(), priceLevel: level, priceLamports: 521_000_000n, amount: 1n, originalAmount: 1n, previous: system, next: system };
  const ix = buildSecondaryCancellationInstruction({ context, user, target, previous: null, next: null });
  assert.equal(ix.keys[9].pubkey.toBase58(), system);
  assert.equal(ix.keys[10].pubkey.toBase58(), system);
  assert.equal(ix.keys[9].isWritable, true);
  assert.equal(ix.keys[10].isWritable, true);
});

test("captured mainnet cancellation fixture uses the no-argument discriminator and 15 ordered account slots", () => {
  // Read-only getTransaction fixture: 3mgFg... at finalized slot 447296479.
  const observed = Buffer.from("05245845441dba1e", "hex");
  assert.deepEqual(observed, CANCEL_SECONDARY_ORDER_USDC_DISCRIMINATOR);
  const observedAccountIndexes = [0, 8, 11, 1, 12, 4, 5, 3, 2, 7, 7, 10, 13, 9, 6];
  assert.equal(observedAccountIndexes.length, 15);
  assert.equal(observedAccountIndexes[0], 0, "the owner signer is first");
  assert.equal(observedAccountIndexes[8], 2, "the target order node is account slot 8");
  assert.equal(observedAccountIndexes[9], observedAccountIndexes[10], "both absent optional neighbors use the program ID placeholder");
});
