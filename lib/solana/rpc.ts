import "server-only";
import { Connection } from "@solana/web3.js";

export const SOLANA_MAINNET_GENESIS_HASH = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";

export class SolanaRpcConfigurationError extends Error {
  constructor(readonly reason: "solana_rpc_not_configured" | "solana_rpc_must_use_https" | "solana_rpc_not_mainnet") {
    super(reason === "solana_rpc_not_configured"
      ? "SOLANA_RPC_URL is required for Panta mainnet market data."
      : reason === "solana_rpc_not_mainnet"
        ? "The configured Solana RPC endpoint is not Solana mainnet."
        : "SOLANA_RPC_URL must use HTTPS outside local development.");
    this.name = "SolanaRpcConfigurationError";
  }
}

let cachedConnection: { url: string; connection: Connection } | null = null;

export function createSolanaMainnetConnection(url = process.env.SOLANA_RPC_URL): Connection {
  if (!url?.trim()) throw new SolanaRpcConfigurationError("solana_rpc_not_configured");
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new SolanaRpcConfigurationError("solana_rpc_must_use_https"); }
  const isLocal = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (parsed.protocol !== "https:" && !isLocal) throw new SolanaRpcConfigurationError("solana_rpc_must_use_https");
  if (!cachedConnection || cachedConnection.url !== url) {
    cachedConnection = { url, connection: new Connection(url, { commitment: "confirmed" }) };
  }
  return cachedConnection.connection;
}

export async function assertSolanaMainnet(connection: Pick<Connection, "getGenesisHash">): Promise<void> {
  const genesis = await connection.getGenesisHash();
  if (genesis !== SOLANA_MAINNET_GENESIS_HASH) throw new SolanaRpcConfigurationError("solana_rpc_not_mainnet");
}
