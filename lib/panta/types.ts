export type MarketStatus = "active" | "closed" | "resolved" | "unknown";
export type QuoteAsset = "SOL" | "USDC";
export type QuoteAssetResolution = {
  asset: QuoteAsset | null;
  status: "resolved" | "conflict" | "unresolved" | "unsupported";
  source: "panta-event-registry" | "on-chain-event" | "none";
  observedAt: string | null;
  rawAuthoritative: string | null;
  rawProvider: string | null;
  message?: string;
};
export type QuoteAmount = { amount: number | null; asset: QuoteAsset | null; source: string | null; observedAt: string | null; slot?: number | null };

export type MarketPoint = {
  timestamp: string;
  yesProbability: number | null;
  /** Present on verified on-chain fill observations; absent on legacy provider points. */
  signature?: string;
  slot?: number;
  outcome?: "YES" | "NO";
  source?: string;
};

export type PriceHistoryRange = "1h" | "6h" | "1d" | "7d" | "all";
export type PriceHistoryStatus = "available" | "empty" | "unsupported" | "error" | "invalid";
export type MarketPriceHistory = {
  marketId: string;
  eventPda: string | null;
  range: string;
  status: PriceHistoryStatus;
  observations: MarketPoint[];
  quoteAsset: QuoteAsset | null;
  source: "panta-solana-order-matched" | "none";
  retrievedAt: string;
  signaturesRead: number;
  transactionsRead: number;
  latestSignatureSlot: number | null;
  latestSignatureBlockTime: string | null;
  signatureLimit: number;
  coverage: "all-available" | "bounded-latest-sample" | "unknown";
  completeness: "complete" | "partial" | "unavailable";
  reason?: string;
  message?: string;
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
  totalVolumeUsd: number | null;
  liquidityUsd: number | null;
  /** Compatibility USD field; only populated when an explicit verified USD conversion exists. */
  primaryPoolLiquidityUsd: number | null;
  /** Verified quote asset and source; legacy detail quoteAsset is retained only as rawProvider. */
  quoteAsset?: QuoteAsset | null;
  quoteAssetResolution?: QuoteAssetResolution;
  /** Original provider asset value for diagnostics. */
  quoteAssetRaw?: string | null;
  /** Solana Event account address; distinct from Panta's UUID market id. */
  pantaEventPda?: string | null;
  /** Official event-registry metadata used to bind the display market to its on-chain account. */
  pantaEventRegistryTitle?: string | null;
  pantaEventRegistryCreator?: string | null;
  dataRetrievedAt?: string | null;
  primaryPoolLiquidity?: QuoteAmount & { rawBaseUnits: string | null; baseUnitsPerUnit: number | null; state: "finalized_snapshot" | "current" | "unavailable" };
  primaryPoolLiquidityStatus?: "verified" | "conflict" | "unavailable";
  usdConversion?: { usdPerQuote: number; source: string; observedAt: string } | null;
  activeVolume?: QuoteAmount;
  totalVolume?: QuoteAmount;
  volumeRaw?: { active: string | number | null; total: string | number | null; activeSource: string | null; totalSource: string | null };
  matchedTradeCount?: number | null;
  /** Provider price fields with provenance; legacy yes/no probability fields remain compatibility values. */
  priceProvenance?: { kind: "best_bid" | "best_ask" | "last_trade" | "provider_spot" | "unknown"; source: string; observedAt: string | null };
  pantaPrices?: { yes: number | null; no: number | null; quoteAsset: QuoteAsset | null; kind: "best_bid" | "best_ask" | "last_trade" | "provider_spot" | "unknown"; observedAt: string | null };
  rawPantaPrices?: { yes: string | number | null; no: string | number | null };
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
  /** Quote asset per share, normalized as a decimal (for example 0.63 or 1.00). */
  price: number;
  /** Remaining shares at this price. */
  size: number;
  side: "bid" | "ask";
  quoteNotional?: number;
};

export type OutcomeOrderBook = {
  outcome: "YES" | "NO";
  quoteAsset?: QuoteAsset | null;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  bidOrderCount?: number;
  askOrderCount?: number;
  openOrderCount?: number;
  bestBid: number | null;
  bestAsk: number | null;
  midpoint: number | null;
  spread: number | null;
  /** Visible price-times-size notional, denominated in quoteAsset. */
  bidDepth: number;
  /** Visible price-times-size notional, denominated in quoteAsset. */
  askDepth: number;
  bidDepthQuote?: number;
  askDepthQuote?: number;
};

export type OrderBookSnapshot = {
  marketId: string;
  marketQuestion: string;
  quoteAsset?: QuoteAsset | null;
  quoteAssetResolution?: QuoteAssetResolution;
  accountAddresses?: { event: string; priceLevels: string[]; orderNodes: string[]; truncated: boolean };
  programId?: string | null;
  primaryPoolLiquidity?: QuoteAmount & { rawBaseUnits: string | null; baseUnitsPerUnit: number | null; state: "finalized_snapshot" | "current" | "unavailable" };
  primaryPoolLiquidityUsd?: number | null;
  primaryPoolLiquidityStatus?: "verified" | "conflict" | "unavailable";
  activeVolume?: QuoteAmount;
  totalVolume?: QuoteAmount;
  matchedTradeCount?: number | null;
  accountReadSlots?: { priceLevels: number; orderNodes: number; event: number };
  source: "panta-solana";
  sourceLabel: "Panta · Solana";
  observedAt: number;
  retrievedAt?: number;
  slot: number | null;
  pantaReference: { yesPrice: number | null; noPrice: number | null; observedAt: string | null; kind?: "best_bid" | "best_ask" | "last_trade" | "provider_spot" | "unknown"; source?: string };
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
  quoteAsset?: QuoteAsset | null;
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
  totalVolumeUsd: number | null;
  liquidityUsd: number | null;
  primaryPoolLiquidityUsd: number | null;
  quoteAsset?: QuoteAsset | null;
  quoteAssetResolution?: QuoteAssetResolution;
  activeVolume?: QuoteAmount;
  totalVolume?: QuoteAmount;
  primaryPoolLiquidity?: Market["primaryPoolLiquidity"];
  matchedTradeCount?: number | null;
  pantaPrices?: Market["pantaPrices"];
  priceProvenance?: Market["priceProvenance"];
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
  getMarketHistory(id: string, range: string): Promise<MarketPriceHistory>;
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
