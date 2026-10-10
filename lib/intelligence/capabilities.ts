export type MiraCapabilityName =
  | "conversation"
  | "market-discovery"
  | "market-analysis"
  | "market-comparison"
  | "research"
  | "research-refresh"
  | "research-followup"
  | "trade-preparation"
  | "portfolio"
  | "help";

export type MiraCapability = {
  name: MiraCapabilityName;
  description: string;
  inputRequirements: string[];
  outputSchema: string;
  safetyConstraints: string[];
  whenToUse: string;
};

/** User-facing orchestration contract; providers stay behind the existing API adapters. */
export const MIRA_CAPABILITIES: readonly MiraCapability[] = [
  { name: "conversation", description: "Handle greetings and conversational follow-ups.", inputRequirements: ["message", "optional conversation context"], outputSchema: "reply", safetyConstraints: ["Do not call external providers for ordinary greetings."], whenToUse: "The user greets MIRA or asks a conversational question." },
  { name: "market-discovery", description: "Find markets matching a topic or request.", inputRequirements: ["topic or discovery request"], outputSchema: "ranked market list", safetyConstraints: ["Keep provider and demo data labelled."], whenToUse: "The user asks what markets exist or names a topic." },
  { name: "market-analysis", description: "Analyze provider market activity and signals.", inputRequirements: ["analysis question"], outputSchema: "analysis result with source and timestamps", safetyConstraints: ["Do not present market prices as outcome proof or MIRA forecasts."], whenToUse: "The user asks about market activity, movement, volume, or impact." },
  { name: "market-comparison", description: "Compare provider-reported market data.", inputRequirements: ["two or more identified markets"], outputSchema: "market comparison", safetyConstraints: ["Do not infer causation from related markets."], whenToUse: "The user asks to compare identified markets." },
  { name: "research", description: "Research a market using current market data and retrieved external evidence.", inputRequirements: ["identified market or unambiguous market context", "research question"], outputSchema: "cited research report", safetyConstraints: ["Use retrieved evidence only; evaluate both sides; never invent probability."], whenToUse: "The user asks for research, news, or evidence about a market." },
  { name: "research-refresh", description: "Gather fresh evidence and compare it with prior research.", inputRequirements: ["identified market", "prior research when available"], outputSchema: "fresh report with change labels", safetyConstraints: ["Bypass research cache and distinguish prior from new evidence."], whenToUse: "The user asks what changed, what is new, or to refresh research." },
  { name: "research-followup", description: "Answer questions about evidence in the latest report.", inputRequirements: ["latest report context", "follow-up question"], outputSchema: "evidence-grounded reply", safetyConstraints: ["Only cite evidence present in the report."], whenToUse: "The user asks why, asks for a side, or asks which source supports a finding." },
  { name: "trade-preparation", description: "Request a quote and prepare a reviewable trade ticket.", inputRequirements: ["exact active market", "YES/NO side", "amount"], outputSchema: "trade ticket requiring explicit wallet confirmation", safetyConstraints: ["Never sign, submit, or spend without the user's explicit confirmation."], whenToUse: "The user explicitly asks to buy, purchase, or trade." },
  { name: "portfolio", description: "Read positions for the connected wallet.", inputRequirements: ["connected wallet"], outputSchema: "provider-reported positions", safetyConstraints: ["Never fabricate holdings."], whenToUse: "The user asks about their positions or portfolio." },
  { name: "help", description: "Explain MIRA's available capabilities.", inputRequirements: ["help request"], outputSchema: "capability summary", safetyConstraints: ["Describe only supported capabilities."], whenToUse: "The user asks what MIRA can do." },
] as const;

export function getMiraCapability(name: MiraCapabilityName): MiraCapability {
  return MIRA_CAPABILITIES.find((capability) => capability.name === name)!;
}
