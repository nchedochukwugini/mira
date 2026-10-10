import test from "node:test";
import assert from "node:assert/strict";
import { assertSolanaMainnet, createSolanaMainnetConnection, SOLANA_MAINNET_GENESIS_HASH, SolanaRpcConfigurationError } from "./rpc.ts";

test("Panta market RPC requires a configured HTTPS endpoint and never defaults to devnet", () => {
  assert.throws(() => createSolanaMainnetConnection(""), (error) => error instanceof SolanaRpcConfigurationError && error.reason === "solana_rpc_not_configured");
  assert.throws(() => createSolanaMainnetConnection("http://rpc.example"), (error) => error instanceof SolanaRpcConfigurationError && error.reason === "solana_rpc_must_use_https");
  assert.doesNotThrow(() => createSolanaMainnetConnection("https://rpc.example"));
});

test("mainnet RPC refuses a non-mainnet genesis hash", async () => {
  await assert.doesNotReject(() => assertSolanaMainnet({ getGenesisHash: async () => SOLANA_MAINNET_GENESIS_HASH }));
  await assert.rejects(() => assertSolanaMainnet({ getGenesisHash: async () => "devnet-genesis" }), (error) => error instanceof SolanaRpcConfigurationError && error.reason === "solana_rpc_not_mainnet");
});
