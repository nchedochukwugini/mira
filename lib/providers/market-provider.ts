import { PantaClient } from "@/lib/panta/client";
import { demoMarketProvider } from "@/lib/providers/mock-market-provider";
import type { MarketProvider } from "@/lib/panta/types";

let pantaProvider: PantaClient | undefined;

export function demoProviderAllowed(nodeEnv = process.env.NODE_ENV, providerMode = process.env.NEXT_PUBLIC_MARKET_PROVIDER): boolean {
  return nodeEnv !== "production" && providerMode === "demo";
}

export function getMarketProvider(): MarketProvider {
  // Demo fixtures are opt-in for local development. A missing Panta key must
  // surface as an unavailable provider, never as plausible live inventory.
  if (demoProviderAllowed()) return demoMarketProvider;
  pantaProvider ??= new PantaClient();
  return pantaProvider;
}

export function getProviderMode(): "demo" | "panta" {
  return getMarketProvider().source;
}

export function getProviderEnvironment(): "test" | "live" | "unknown" {
  return getMarketProvider().environment ?? "unknown";
}
