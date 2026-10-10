import type { ConversationIntent } from "@/lib/intelligence/conversation";

export type MiraIntent = {
  intent: ConversationIntent;
  requiresMarketData: boolean;
  reply?: string;
  marketReference?: { type: "id" | "ordinal" | "active" | "none"; value?: string };
  analysisQuestion?: string;
  researchQuestion?: string;
  refreshResearch?: boolean;
  spotAsset?: "BTC" | "ETH";
  tradeOutcome?: "YES" | "NO";
  tradeAmountUsdc?: number;
  tradeMarketQuery?: string;
  comparisonSubjects?: string[];
  comparisonDimension?: "none" | "probability" | "activity" | "liquidity" | "volume" | "conceptual";
};

export const intentSchema = {
  type: "object", additionalProperties: false,
  properties: {
    intent: { type: "string", enum: ["greeting", "help", "market_discovery", "market_analysis", "market_detail", "market_intelligence", "research", "trade_request", "trade_cancel", "spot_price", "clarification", "general"] },
    requiresMarketData: { type: "boolean" },
    reply: { type: "string" },
    marketReference: { type: "object", additionalProperties: false, properties: { type: { type: "string", enum: ["id", "ordinal", "active", "none"] }, value: { type: "string" } }, required: ["type", "value"] },
    analysisQuestion: { type: "string" }, researchQuestion: { type: "string" }, refreshResearch: { type: "boolean" },
    spotAsset: { type: "string", enum: ["BTC", "ETH"] }, tradeOutcome: { type: "string", enum: ["YES", "NO"] },
    tradeAmountUsdc: { type: "number" }, tradeMarketQuery: { type: "string" },
    comparisonSubjects: { type: "array", items: { type: "string" } },
    comparisonDimension: { type: "string", enum: ["none", "probability", "activity", "liquidity", "volume", "conceptual"] },
  }, required: ["intent", "requiresMarketData", "reply", "marketReference", "analysisQuestion", "researchQuestion", "refreshResearch", "spotAsset", "tradeOutcome", "tradeAmountUsdc", "tradeMarketQuery", "comparisonSubjects", "comparisonDimension"],
} as const;

export function validateMiraIntent(value: unknown): MiraIntent | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const intents: ConversationIntent[] = ["greeting", "help", "market_discovery", "market_analysis", "market_detail", "market_intelligence", "research", "trade_request", "trade_cancel", "spot_price", "clarification", "general"];
  if (!intents.includes(row.intent as ConversationIntent) || typeof row.requiresMarketData !== "boolean") return null;
  const ref = row.marketReference && typeof row.marketReference === "object" ? row.marketReference as Record<string, unknown> : {};
  if (!["id", "ordinal", "active", "none"].includes(String(ref.type))) return null;
  const text = (v: unknown) => typeof v === "string" && v.trim() ? v.trim().slice(0, 500) : undefined;
  if (row.tradeAmountUsdc !== undefined && (typeof row.tradeAmountUsdc !== "number" || !Number.isFinite(row.tradeAmountUsdc) || row.tradeAmountUsdc < 0 || row.tradeAmountUsdc > 100_000)) return null;
  const amount = typeof row.tradeAmountUsdc === "number" && row.tradeAmountUsdc > 0 ? row.tradeAmountUsdc : undefined;
  return {
    intent: row.intent as ConversationIntent, requiresMarketData: row.requiresMarketData,
    reply: text(row.reply), marketReference: { type: ref.type as "id" | "ordinal" | "active" | "none", value: text(ref.value) },
    analysisQuestion: text(row.analysisQuestion), researchQuestion: text(row.researchQuestion), refreshResearch: row.refreshResearch === true,
    spotAsset: row.spotAsset === "BTC" || row.spotAsset === "ETH" ? row.spotAsset : undefined,
    tradeOutcome: row.tradeOutcome === "YES" || row.tradeOutcome === "NO" ? row.tradeOutcome : undefined,
    tradeAmountUsdc: amount, tradeMarketQuery: text(row.tradeMarketQuery),
    comparisonSubjects: Array.isArray(row.comparisonSubjects) ? row.comparisonSubjects.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).slice(0, 4).map((item) => item.trim().slice(0, 120)) : undefined,
    comparisonDimension: ["none", "probability", "activity", "liquidity", "volume", "conceptual"].includes(String(row.comparisonDimension)) ? row.comparisonDimension as MiraIntent["comparisonDimension"] : undefined,
  };
}
