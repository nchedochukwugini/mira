export type MarketStatus = "active" | "closed" | "resolved" | "unknown";

export type MarketPoint = {
  timestamp: string;
  yesProbability: number | null;
};

export type Market = {
  id: string;
  question: string;
  category: string | null;
  description: string | null;
  status: MarketStatus;
  yesProbability: number | null;
  noProbability: number | null;
  volumeUsd: number | null;
  liquidityUsd: number | null;
  priceChange24h: number | null;
  startAt?: string | null;
  closeAt: string | null;
  updatedAt: string | null;
  imageUrl: string | null;
  history: MarketPoint[];
  relatedMarketIds: string[];
  source: "panta" | "demo";
  phase?: string | null;
  pantaProgramId?: string | null;
  pantaSecondaryActive?: boolean | null;
  pantaIsGraduated?: boolean | null;
  pantaIsResolved?: boolean | null;
};

export type OrderBookLevel = {
  /** USDC per share, normalized as a decimal (for example 0.63 or 1.00). */
  price: number;
  /** Remaining shares at this price. */
  size: number;
  side: "bid" | "ask";
};

export type OutcomeOrderBook = {
  outcome: "YES" | "NO";
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  bestBid: number | null;
  bestAsk: number | null;
  midpoint: number | null;
  spread: number | null;
  /** Visible price-times-size notional, denominated in USDC. */
  bidDepth: number;
  /** Visible price-times-size notional, denominated in USDC. */
  askDepth: number;
};

export type OrderBookSnapshot = {
  marketId: string;
  marketQuestion: string;
  source: "panta-solana";
  sourceLabel: "Panta · Solana";
  observedAt: number;
  slot: number | null;
  pantaReference: { yesPrice: number | null; noPrice: number | null; observedAt: string | null };
  dataStatus: "complete" | "partial" | "unavailable";
  freshness: "live" | "recent" | "stale" | "unavailable";
  yes: OutcomeOrderBook;
  no: OutcomeOrderBook;
  activity: OrderActivity[];
  activityStatus: "complete" | "partial" | "unavailable";
  history?: OrderBookHistoryPoint[];
  historyStatus: "available" | "not_collected" | "unavailable";
  reason?: string;
  message?: string;
};

export type OrderBookHistoryPoint = {
  observedAt: number;
  slot: number;
  yesBestBid: number | null;
  yesBestAsk: number | null;
  noBestBid: number | null;
  noBestAsk: number | null;
};

export type OrderActivity = {
  signature: string;
  marketId: string;
  programId: string;
  slot: number;
  observedAt: number | null;
  kind: "order_placed" | "order_cancelled" | "order_matched" | "unknown";
  instruction: string;
  decoderVersion: "panta-clob-log-v1";
  verificationStatus: "matched-event-verified" | "instruction-observed" | "unknown";
  classificationReason: string;
  outcome?: "YES" | "NO";
  price?: number;
  size?: number;
};

export type DataStatus = "live" | "demo" | "partial" | "unavailable";
export type PantaEnvironment = "test" | "live" | "unknown";
export type AnalysisIntentType = "market_discovery" | "probability_comparison" | "biggest_movers" | "related_markets" | "market_sensitivity" | "event_impact" | "trend_analysis" | "liquidity_analysis" | "volume_analysis" | "closing_soon";
export type AnalysisTimeframe = "current" | "1h" | "24h" | "7d";
export type AnalysisRequest = "relevant_markets" | "probability_comparison" | "probability_movement" | "related_markets" | "event_impact" | "trend" | "liquidity" | "volume";

export type MarketIntent = {
  intent: AnalysisIntentType;
  entities: string[];
  timeframe: AnalysisTimeframe;
  requestedAnalysis: AnalysisRequest[];
};

export type MarketSnapshot = {
  marketId: string;
  yesProbability: number | null;
  noProbability: number | null;
  volumeUsd: number | null;
  liquidityUsd: number | null;
  status: MarketStatus;
  observedAt: string;
  providerUpdatedAt: string | null;
  source: "panta" | "demo";
  dataStatus: DataStatus;
  warnings: string[];
};

export type MarketMovement = {
  marketId: string;
  previousProbability: number;
  currentProbability: number;
  absoluteChange: number;
  percentageChange: number | null;
  timeframe: Exclude<AnalysisTimeframe, "current">;
  previousTimestamp: string;
  observedAt: string;
};

export type RelatedMarket = {
  marketId: string;
  relatedMarketId: string;
  relationship: "provider_link" | "shared_entity" | "category_overlap";
  relevanceScore: number;
  explanation: string;
  supportingEvidence: string[];
  dataStatus: DataStatus;
};

export type MarketEvidence = {
  marketId: string;
  observation: string;
  significance: "high" | "medium" | "low";
  timestamp: string | null;
  timestampType: "provider" | "retrieved" | "missing";
  source: "panta" | "demo";
  dataStatus: DataStatus;
};

export type MarketRanking = {
  marketId: string;
  relevanceScore: number;
  semanticRelevance: number;
  signals: string[];
};

export type TradeIntent = {
  marketId: string;
  side: "YES" | "NO";
  requestedAmount: number | null;
  reason: string;
  sourceAnalysisId: string;
};

export type TradeQuote = {
  id: string;
  marketId: string;
  outcome: "YES" | "NO";
  amountUsd: number;
  shares: number | null;
  averagePrice: number | null;
  feeUsd: number | null;
  expiresAt: string | null;
  raw: unknown;
  source: "panta" | "demo";
  environment?: "test" | "live" | "unknown";
};

export type PantaTradeBuild = {
  orderId: string;
  quoteId: string;
  wallet: string;
  marketId: string;
  side: "yes" | "no";
  amountUsdc: string;
  expectedShares: string | null;
  feeUsdc: string | null;
  instructions: Array<{ programId: string; data: string; accounts: Array<{ pubkey: string; isSigner: boolean; isWritable: boolean }> }>;
  recentBlockhash: string;
  lastValidBlockHeight: number | null;
  expiresAt: string | null;
  source: "panta";
  environment: "test" | "live" | "unknown";
};

export type Position = {
  id: string;
  marketId: string;
  question: string;
  outcome: string;
  shares: number;
  currentValueUsd: number | null;
  claimable: boolean;
};

export type ProviderResult<T> = {
  data: T;
  source: "panta" | "demo";
  updatedAt: string;
};

export type Insight = {
  kind: "observation" | "evidence" | "context" | "insufficient";
  title: string;
  body: string;
  marketIds?: string[];
};

export type AnalysisResult = {
  id: string;
  query: string;
  answer: string;
  insights: Insight[];
  markets: Market[];
  relatedMarketIds: string[];
  confidence: "high" | "medium" | "low" | "insufficient";
  source: "panta" | "demo";
  providerEnvironment?: PantaEnvironment;
  createdAt: string;
  intent: MarketIntent;
  snapshots: MarketSnapshot[];
  movements: MarketMovement[];
  relatedMarkets: RelatedMarket[];
  evidence: MarketEvidence[];
  rankings: MarketRanking[];
  dataStatus: DataStatus;
  tradeIntent: TradeIntent | null;
  webResearch?: {
    status: "live" | "unavailable";
    summary: string;
    sources: Array<{ title: string; url: string; snippet?: string; publishedAt: string | null }>;
  };
};

export type MarketProvider = {
  readonly source: "panta" | "demo";
  readonly environment?: "test" | "live" | "unknown";
  discoverMarkets(query?: string, signal?: AbortSignal): Promise<Market[]>;
  getMarket(id: string, signal?: AbortSignal): Promise<Market | null>;
  getMarketTrades(marketId: string): Promise<unknown[]>;
  getPositions(wallet: string): Promise<Position[]>;
  getQuote(input: {
    marketId: string;
    outcome: "YES" | "NO";
    amountUsd: number;
    wallet: string;
  }): Promise<TradeQuote>;
  buildTrade(input: { quoteId: string; wallet: string }): Promise<unknown>;
  submitTrade(input: { orderId: string; signature: string; wallet: string }): Promise<unknown>;
  verifyTrade(input: { orderId: string; signature: string; wallet: string }): Promise<unknown>;
  getCreatorFees(wallet: string): Promise<unknown>;
  buildClaim(input: { marketId: string; wallet: string }): Promise<unknown>;
  attributeTrade(input: { signature: string; marketId: string; wallet: string }): Promise<unknown>;
};
