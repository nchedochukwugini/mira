export type TradePreparationState = "preparing" | "ready" | "awaiting-confirmation" | "signing" | "broadcasting" | "confirmed" | "failed" | "cancelled";

export function canOpenWalletSigning(input: { status: TradePreparationState; source: "panta" | "demo"; explicitConfirmAction: boolean }): boolean {
  return input.status === "awaiting-confirmation" && input.source === "panta" && input.explicitConfirmAction;
}

export function isQuoteExpired(expiresAt: string | null, now = Date.now()): boolean {
  if (!expiresAt) return false;
  const expiry = Date.parse(expiresAt);
  return Number.isFinite(expiry) && expiry <= now;
}

export function isTradeEligibleMarket(market: {
  id: string; question: string; source: "panta" | "demo"; status: string;
  phase?: string | null; pantaIsResolved?: boolean | null; pantaSecondaryActive?: boolean | null;
  pantaIsGraduated?: boolean | null; startAt?: string | null; closeAt: string | null;
} | null | undefined, now = Date.now()): boolean {
  return Boolean(market && hasVerifiedOpenMarketWindow(market, now) && market.phase === "primary");
}

export function isSecondaryTradeEligibleMarket(market: {
  id: string; question: string; source: "panta" | "demo"; status: string;
  phase?: string | null; pantaIsResolved?: boolean | null; pantaSecondaryActive?: boolean | null;
  pantaIsGraduated?: boolean | null; startAt?: string | null; closeAt: string | null;
} | null | undefined, now = Date.now()): boolean {
  return Boolean(market && hasVerifiedOpenMarketWindow(market, now)
    && market.phase === "secondary"
    && market.pantaSecondaryActive === true
    && market.pantaIsGraduated === true);
}

export function isSecondaryMarketCandidate(market: {
  id: string; question: string; source: "panta" | "demo"; phase?: string | null;
  pantaIsResolved?: boolean | null; startAt?: string | null; closeAt: string | null;
} | null | undefined, now = Date.now()): boolean {
  return Boolean(market && market.source === "panta" && market.phase === "secondary"
    && market.pantaIsResolved === false && hasOpenWindow(market.startAt, market.closeAt, now)
    && market.id.trim() && market.question.trim() && market.question !== "Market title unavailable");
}

function hasVerifiedOpenMarketWindow(market: {
  id: string; question: string; source: "panta" | "demo"; status: string;
  pantaIsResolved?: boolean | null; startAt?: string | null; closeAt: string | null;
} | null | undefined, now: number): boolean {
  if (!market || market.source !== "panta" || market.status !== "active" || !market.id.trim() || !market.question.trim() || market.question === "Market title unavailable" || market.pantaIsResolved !== false) return false;
  return hasOpenWindow(market.startAt, market.closeAt, now);
}

function hasOpenWindow(startAt: string | null | undefined, closeAt: string | null, now: number): boolean {
  if (!startAt || !closeAt) return false;
  const opensAt = Date.parse(startAt);
  const closesAt = Date.parse(closeAt);
  return Number.isFinite(opensAt) && Number.isFinite(closesAt) && opensAt <= now && closesAt > now && opensAt < closesAt;
}

export function tradeIneligibilityReason(market: {
  source: "panta" | "demo"; phase?: string | null;
} | null | undefined): string {
  if (market?.source === "panta" && market.phase === "secondary") {
    return "This is a Panta secondary/P2P market. It uses MIRA’s separate secondary limit-order flow; no primary quote or transaction was requested.";
  }
  return "Panta has not verified that this market is currently eligible for MIRA’s primary-market quote flow. No quote or transaction was requested.";
}
