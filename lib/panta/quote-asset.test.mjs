import test from "node:test";
import assert from "node:assert/strict";
import { identifyPantaFillQuoteMint, identifyQuoteMint, decimalNotionalFromRawUnits, SOLANA_MAINNET_USDC_MINT, SOLANA_MAINNET_USDT_MINT, SOLANA_MAINNET_WRAPPED_SOL_MINT, SPL_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "./quote-asset.ts";
import { SECONDARY_LIMIT_ORDER_USDC_DISCRIMINATOR } from "./secondary-instructions.ts";

function mintAccount(decimals = 6) { const data = Buffer.alloc(82); data[44] = decimals; data[45] = 1; return data; }
test("USDC is recognized by canonical mainnet mint, token owner, and on-chain decimals", () => {
  const result = identifyQuoteMint({ network: "mainnet-beta", mint: SOLANA_MAINNET_USDC_MINT, owner: SPL_TOKEN_PROGRAM_ID, data: mintAccount() });
  assert.equal(result.status, "verified"); assert.equal(result.symbol, "USDC"); assert.equal(result.decimals, 6);
  assert.equal(identifyQuoteMint({ network: "devnet", mint: SOLANA_MAINNET_USDC_MINT, owner: SPL_TOKEN_PROGRAM_ID, data: mintAccount() }).status, "unsupported");
});
test("known assets use mint identity and unknown symbol lookalikes remain unnamed", () => {
  const usdt = identifyQuoteMint({ network: "mainnet-beta", mint: SOLANA_MAINNET_USDT_MINT, owner: SPL_TOKEN_PROGRAM_ID, data: mintAccount(6) });
  assert.equal(usdt.status, "verified"); assert.equal(usdt.symbol, "USDT"); assert.notEqual(usdt.mint, SOLANA_MAINNET_USDC_MINT);
  const sol = identifyQuoteMint({ network: "mainnet-beta", mint: SOLANA_MAINNET_WRAPPED_SOL_MINT, owner: SPL_TOKEN_PROGRAM_ID, data: mintAccount(9) });
  assert.equal(sol.symbol, "SOL"); assert.equal(sol.mint, SOLANA_MAINNET_WRAPPED_SOL_MINT);
  const unknownMint = "11111111111111111111111111111111";
  const unknown = identifyQuoteMint({ network: "mainnet-beta", mint: unknownMint, owner: TOKEN_2022_PROGRAM_ID, data: mintAccount(6) });
  assert.equal(unknown.status, "verified"); assert.equal(unknown.symbol, null);
  assert.equal(identifyQuoteMint({ network: "mainnet-beta", mint: unknownMint, owner: SPL_TOKEN_PROGRAM_ID, data: mintAccount(9) }).symbol, null);
});
test("missing or unsupported mint metadata never falls back to USDC", () => {
  assert.equal(identifyQuoteMint({ network: "mainnet-beta", mint: null, owner: null, data: null }).status, "unknown");
  assert.equal(identifyQuoteMint({ network: "mainnet-beta", mint: SOLANA_MAINNET_USDC_MINT, owner: SPL_TOKEN_PROGRAM_ID, data: mintAccount(9) }).status, "unsupported");
  assert.equal(identifyQuoteMint({ network: "mainnet-beta", mint: SOLANA_MAINNET_USDC_MINT, owner: "11111111111111111111111111111111", data: mintAccount() }).status, "unsupported");
  assert.equal(identifyQuoteMint({ network: "unknown", mint: SOLANA_MAINNET_USDC_MINT, owner: SPL_TOKEN_PROGRAM_ID, data: mintAccount() }).status, "unsupported");
});
test("trade denomination requires recognized instruction bound to its Event PDA", () => {
  const accounts = Array.from({ length: 13 }, (_, index) => `account-${index}`); accounts[2] = "event-a"; accounts[12] = SOLANA_MAINNET_USDC_MINT;
  const data = Buffer.concat([SECONDARY_LIMIT_ORDER_USDC_DISCRIMINATOR, Buffer.alloc(8)]);
  assert.deepEqual(identifyPantaFillQuoteMint([{ programId: "6gM5afTQBq5VZCfgpGqcsqzfWd5maLSCKWtGjbEobZMp", accounts, data }], "event-a"), { mint: SOLANA_MAINNET_USDC_MINT, status: "identified", reason: null });
  assert.equal(identifyPantaFillQuoteMint([{ programId: "other", accounts, data }], "event-a").status, "unknown");
  assert.equal(identifyPantaFillQuoteMint([{ programId: "6gM5afTQBq5VZCfgpGqcsqzfWd5maLSCKWtGjbEobZMp", accounts, data }], "event-b").status, "unknown");
});
test("notional uses exact protocol raw scales without floating point", () => {
  assert.equal(decimalNotionalFromRawUnits(BigInt("600000000"), BigInt("100000000")), "60");
  assert.equal(decimalNotionalFromRawUnits(BigInt("600000000"), BigInt("1")), "0.0000006");
  assert.equal(decimalNotionalFromRawUnits(BigInt(0), BigInt("1000000")), null);
});
