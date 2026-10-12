import "server-only";
import type { Market, MarketPriceHistory, Position, QuoteAssetResolution, TradeQuote } from "@/lib/panta/types";
import { applyDecodedPantaEvent, getPantaEventData } from "@/lib/panta/event-data";
import { normalizePantaQuote } from "@/lib/panta/trade-data";
import { normalizePantaMarket, normalizePrimaryPoolLiquidityUsd, normalizePrimaryPoolAmount, normalizeQuoteAsset } from "@/lib/intelligence/core";
import { rankDiscoveredMarkets } from "@/lib/intelligence/market-suggestions";
import { getPantaPriceHistory } from "@/lib/panta/price-history";

const baseUrl = (process.env.PANTA_API_URL || process.env.PANTA_API_BASE_URL || "https://live-api.panta.market/api/v1").replace(/\/$/, "");
const apiKey = process.env.PANTA_API_KEY;
const MARKET_PAGE_SIZE = 50;
const MAX_MARKET_PAGES = 100;
const MAX_SECONDARY_DETAILS = 16;
const OFFICIAL_EVENT_API = "https://production-api.balr.fun/api/v1/events";

export function applyAuthoritativeQuoteMetadata(market: Market, metadata: unknown, observedAt = new Date().toISOString()): Market {
  const row = object(metadata);
  const pda = text(row.eventPda, row.event_pda, row.pda, row.address);
  const marketUuid = text(row.id, row.eventId, row.event_id);
  const matches = Boolean(pda && (marketUuid === market.id || pda === market.id || pda === market.pantaEventPda));
  if (!matches) {
    return { ...market, pantaEventPda: null, pantaEventRegistryTitle: null, pantaEventRegistryCreator: null, quoteAsset: null, quoteAssetResolution: { asset: null, status: "unresolved", source: "none", observedAt: null, rawAuthoritative: null, rawProvider: market.quoteAssetRaw ?? null, message: "Panta event metadata did not match the market PDA." }, yesProbability: null, noProbability: null, history: [], pantaPrices: { yes: null, no: null, quoteAsset: null, kind: market.priceProvenance?.kind ?? "unknown", observedAt: null }, primaryPoolLiquidityUsd: null, primaryPoolLiquidity: normalizePrimaryPoolAmount(market.primaryPoolLiquidity?.rawBaseUnits, null), activeVolume: { amount: null, asset: null, source: null, observedAt: null }, totalVolume: { amount: null, asset: null, source: null, observedAt: null }, volumeUsd: null, totalVolumeUsd: null };
  }
  const rawAuthoritative = text(row.quoteAsset, row.quote_asset);
  const asset = normalizeQuoteAsset(rawAuthoritative);
  const rawProvider = market.quoteAssetRaw ?? null;
  const providerAsset = normalizeQuoteAsset(rawProvider);
  const resolution: QuoteAssetResolution = {
    asset,
    status: !asset ? rawAuthoritative ? "unsupported" : "unresolved" : providerAsset && providerAsset !== asset ? "conflict" : "resolved",
    source: "panta-event-registry",
    observedAt,
    rawAuthoritative,
    rawProvider,
    ...(!asset ? { message: "Panta event registry did not provide a supported quote asset." } : providerAsset && providerAsset !== asset ? { message: `Legacy market detail says ${providerAsset}; authoritative event metadata says ${asset}.` } : {}),
  };
  const retrievedAt = market.dataRetrievedAt ?? observedAt;
  const normalizedPool = normalizePrimaryPoolAmount(market.primaryPoolLiquidity?.rawBaseUnits, asset);
  // `primaryPoolLamports` is an explicitly SOL base-unit field. The legacy
  // quote label can conflict without making this independently named raw
  // measurement ambiguous; keep its SOL interpretation and preserve the
  // conflict in quoteAssetResolution for diagnostics.
  const pool = { ...normalizedPool, observedAt: market.primaryPoolLiquidity?.rawBaseUnits ? retrievedAt : null };
  const activeRaw = market.volumeRaw?.active;
  const totalRaw = market.volumeRaw?.total;
  const activeAsset = market.volumeRaw?.activeSource?.toUpperCase();
  const totalAsset = market.volumeRaw?.totalSource?.toUpperCase();
  const parseQuoteAmount = (raw: string | number | null | undefined, taggedAsset: string | undefined) => {
    if (!asset || taggedAsset !== asset || raw === null || raw === undefined || raw === "") return null;
    const parsed = typeof raw === "number" ? raw : Number(raw);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  };
  const active = parseQuoteAmount(activeRaw, activeAsset);
  const total = parseQuoteAmount(totalRaw, totalAsset);
  const conversion = market.usdConversion;
  const conversionTime = conversion ? Date.parse(conversion.observedAt) : Number.NaN;
  const conversionValid = Boolean(conversion && conversion.source.trim() && Number.isFinite(conversionTime) && conversionTime <= Date.now() && Date.now() - conversionTime <= 5 * 60_000 && conversion.usdPerQuote > 0 && Number.isFinite(conversion.usdPerQuote));
  const poolUsd = asset === "USDC" && conversionValid && pool.amount !== null ? pool.amount * conversion!.usdPerQuote : null;
  const activeUsdRaw = activeAsset === "USD" && activeRaw !== null && activeRaw !== undefined ? Number(activeRaw) : null;
  const totalUsdRaw = totalAsset === "USD" && totalRaw !== null && totalRaw !== undefined ? Number(totalRaw) : null;
  const hasConflict = resolution.status === "conflict";
  const readRawPrice = (raw: string | number | null | undefined) => {
    if (!asset || hasConflict || raw === null || raw === undefined || raw === "") return null;
    const value = typeof raw === "number" ? raw : Number(raw);
    return Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
  };
  const yesPrice = asset === "USDC" && !hasConflict ? market.yesProbability : readRawPrice(market.rawPantaPrices?.yes);
  const noPrice = asset === "USDC" && !hasConflict ? market.noProbability : readRawPrice(market.rawPantaPrices?.no);
  return {
    ...market,
    pantaEventPda: pda,
    pantaEventRegistryTitle: text(row.title),
    pantaEventRegistryCreator: text(row.creatorAddress, row.creator_address),
    quoteAsset: asset,
    quoteAssetResolution: resolution,
    primaryPoolLiquidity: pool,
    primaryPoolLiquidityUsd: poolUsd ?? (asset === "USDC" && conversionValid ? normalizePrimaryPoolLiquidityUsd(pool.rawBaseUnits, asset, conversion!.usdPerQuote) : null),
    activeVolume: { amount: active, asset: active === null ? null : asset, source: active === null ? null : market.volumeRaw?.activeSource ?? null, observedAt: active === null ? null : retrievedAt },
    totalVolume: { amount: total, asset: total === null ? null : asset, source: total === null ? null : market.volumeRaw?.totalSource ?? null, observedAt: total === null ? null : retrievedAt },
    yesProbability: asset === "USDC" && !hasConflict ? market.yesProbability : null,
    noProbability: asset === "USDC" && !hasConflict ? market.noProbability : null,
    pantaPrices: { yes: yesPrice, no: noPrice, quoteAsset: hasConflict ? null : asset, kind: market.priceProvenance?.kind ?? "unknown", observedAt: market.priceProvenance?.observedAt ?? null },
    history: asset && !hasConflict ? market.history : [],
    // Backwards-compatible USD aliases are populated only from validated USDC fields.
    volumeUsd: activeUsdRaw !== null && Number.isFinite(activeUsdRaw) && activeUsdRaw >= 0 ? activeUsdRaw : active !== null && conversionValid ? active * conversion!.usdPerQuote : null,
    totalVolumeUsd: totalUsdRaw !== null && Number.isFinite(totalUsdRaw) && totalUsdRaw >= 0 ? totalUsdRaw : total !== null && conversionValid ? total * conversion!.usdPerQuote : null,
  };
}

export class PantaError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "PantaError";
  }
}

export function pantaTransportFailure(error: unknown): { message: string; status: number } {
  if (error instanceof Error && error.name === "TimeoutError") return { message: "Panta API request timed out.", status: 504 };
  if (error instanceof Error && error.name === "AbortError") return { message: "Panta API request was cancelled.", status: 499 };
  return { message: "Could not reach the Panta API.", status: 502 };
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function list(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const record = object(value);
  if (Array.isArray(record.data)) return record.data;
  if (Array.isArray(record.markets)) return record.markets;
  if (Array.isArray(record.results)) return record.results;
  if (Array.isArray(record.items)) return record.items;
  const nested = object(record.data);
  for (const key of ["markets", "results", "items", "positions"]) {
    if (Array.isArray(nested[key])) return nested[key] as unknown[];
  }
  return [];
}

function marketPage(value: unknown): { items: unknown[]; nextCursor: string | null } {
  const record = object(value);
  const nested = object(record.data);
  const items = list(value);
  const cursor = text(record.nextCursor, record.next_cursor, record.nextPageCursor, record.next_page_cursor, nested.nextCursor, nested.next_cursor, nested.nextPageCursor, nested.next_page_cursor);
  return { items, nextCursor: cursor };
}

function text(...values: unknown[]): string | null {
  const value = values.find((candidate) => typeof candidate === "string" && candidate.trim());
  return typeof value === "string" ? value : null;
}

function number(...values: unknown[]): number | null {
  const value = values.find((candidate) => candidate !== null && candidate !== undefined && candidate !== "");
  if (value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function mergeMarketCatalogQuotes(detail: Market, catalog: Market | undefined): Market {
  if (!catalog) return detail;
  const mergeMeasuredValue = (detailValue: number | null, catalogValue: number | null): number | null => {
    if (detailValue !== null && catalogValue !== null && detailValue !== catalogValue) return null;
    return detailValue ?? catalogValue;
  };
  const corroboratedActiveStatus = detail.status === "unknown"
    && catalog.status === "active"
    && detail.phase !== null
    && detail.phase === catalog.phase
    && detail.pantaIsResolved === false
    && (detail.phase !== "secondary" || catalog.pantaSecondaryActive === true);
  return {
    ...detail,
    // Panta's detail payload can omit a title that was present in the catalog.
    // Keep both surfaces consistent, while leaving a genuinely missing title
    // unavailable instead of deriving one from an identifier or description.
    question: detail.question.trim() && detail.question !== "Market title unavailable"
      ? detail.question
      : catalog.question,
    // A disagreement has no source timestamp or documented precedence, so do
    // not silently choose one endpoint's measured value.
    yesProbability: mergeMeasuredValue(detail.yesProbability, catalog.yesProbability),
    noProbability: mergeMeasuredValue(detail.noProbability, catalog.noProbability),
    volumeUsd: mergeMeasuredValue(detail.volumeUsd, catalog.volumeUsd),
    totalVolumeUsd: mergeMeasuredValue(detail.totalVolumeUsd, catalog.totalVolumeUsd),
    liquidityUsd: mergeMeasuredValue(detail.liquidityUsd, catalog.liquidityUsd),
    primaryPoolLiquidityUsd: mergeMeasuredValue(detail.primaryPoolLiquidityUsd, catalog.primaryPoolLiquidityUsd),
    updatedAt: detail.updatedAt ?? catalog.updatedAt,
    history: detail.history.length ? detail.history : catalog.history,
    status: corroboratedActiveStatus ? "active" : detail.status,
    pantaSecondaryActive: detail.pantaSecondaryActive ?? catalog.pantaSecondaryActive,
    pantaIsResolved: detail.pantaIsResolved ?? catalog.pantaIsResolved,
  };
}

export class PantaClient {
  readonly source = "panta" as const;
  readonly environment = apiKey?.startsWith("pk_test_") ? "test" as const : apiKey?.startsWith("pk_live_") ? "live" as const : "unknown" as const;
  private marketCatalog: { expiresAt: number; byId: Map<string, Market> } | null = null;
  private marketDetailCache = new Map<string, { expiresAt: number; market: Market; kind: "secondary" | "primary-pool" | "fallback" }>();
  private officialEventMetadata: { expiresAt: number; byPda: Map<string, Record<string, unknown>> } | null = null;


  private async request(path: string, init: RequestInit = {}): Promise<unknown> {
    if (!apiKey) throw new PantaError("PANTA_API_KEY is not configured.", 503);
    let response: Response;
    let body: string;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        ...init,
        cache: "no-store",
        signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
        headers: {
          Accept: "application/json",
          "X-Api-Key": apiKey,
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...init.headers,
        },
      });
      body = await response.text();
    } catch (error) {
      const failure = pantaTransportFailure(error);
      throw new PantaError(failure.message, failure.status);
    }
    let parsed: unknown;
    try { parsed = body ? JSON.parse(body) as unknown : null; } catch { parsed = body; }
    if (!response.ok) {
      const record = object(parsed);
      const code = text(record.code);
      // Provider response text is not safe to return to browsers: upstreams can
      // echo submitted values or internal diagnostics in their error payload.
      const safeCode = code && /^[A-Z0-9_-]{1,48}$/i.test(code) ? code : null;
      throw new PantaError(safeCode ? `Panta rejected the request (${safeCode}).` : `Panta API returned HTTP ${response.status}.`, response.status);
    }
    return parsed;
  }

  private async getOfficialEventMetadata(): Promise<Map<string, Record<string, unknown>>> {
    if (this.officialEventMetadata && this.officialEventMetadata.expiresAt > Date.now()) return this.officialEventMetadata.byPda;
    const byPda = new Map<string, Record<string, unknown>>();
    try {
      const response = await fetch(OFFICIAL_EVENT_API, { cache: "no-store", headers: { Accept: "application/json" }, signal: AbortSignal.timeout(5_000) });
      if (!response.ok) throw new Error("Panta event registry unavailable");
      const payload: unknown = await response.json();
      for (const value of list(payload)) {
        const row = object(value);
        const pda = text(row.eventPda, row.event_pda, row.pda, row.address);
        const id = text(row.id, row.eventId, row.event_id);
        if (id) byPda.set(id, row);
        if (pda) byPda.set(pda, row);
      }
    } catch { /* Missing authority is explicit and cached briefly to avoid retry bursts. */ }
    this.officialEventMetadata = { byPda, expiresAt: Date.now() + 5_000 };
    return byPda;
  }

  private async resolveMarketQuote(market: Market): Promise<Market> {
    const rows = await this.getOfficialEventMetadata();
    return applyAuthoritativeQuoteMetadata(market, rows.get(market.id) ?? null);
  }

  async discoverMarkets(query?: string, signal?: AbortSignal): Promise<Market[]> {
    const rows: unknown[] = [];
    let cursor: string | null = null;
    // Browse and search must use the same cursor pagination so discovery does
    // not silently stop at Panta's first (often small) default page.
    const pageLimit = MAX_MARKET_PAGES;
    for (let page = 0; page < pageLimit; page += 1) {
      const params = new URLSearchParams({ limit: String(MARKET_PAGE_SIZE) });
      if (cursor) params.set("cursor", cursor);
      const payload = await this.request(`/markets/?${params.toString()}`, signal ? { signal } : {});
      const result = marketPage(payload);
      rows.push(...result.items);
      if (!result.nextCursor || result.nextCursor === cursor || result.items.length === 0) break;
      cursor = result.nextCursor;
    }
    const catalogFetchedAt = new Date().toISOString();
    const catalog = [...new Map(rows.map(normalizePantaMarket).filter((market): market is Market => market !== null).map((market) => [market.id, { ...market, dataRetrievedAt: catalogFetchedAt }])).values()];
    const officialEvents = await this.getOfficialEventMetadata();
    const trustedCatalog = catalog.map((market) => applyAuthoritativeQuoteMetadata(market, officialEvents.get(market.id) ?? null));
    const catalogById = new Map(trustedCatalog.map((market) => [market.id, market]));
    // Detail carries current secondary quotes and primary-pool metadata omitted
    // by the catalog. Keep all list enrichment within the existing 16-detail cap.
    const secondaryMarkets = trustedCatalog.filter((market) => market.phase === "secondary" && market.status === "active").slice(0, MAX_SECONDARY_DETAILS);
    const secondaryIds = new Set(secondaryMarkets.map((market) => market.id));
    const poolCandidates = (query?.trim() ? rankDiscoveredMarkets(query, trustedCatalog) : trustedCatalog)
      .filter((market) => market.primaryPoolLiquidityUsd === null && !secondaryIds.has(market.id));
    const detailMarkets = [...secondaryMarkets, ...poolCandidates.slice(0, Math.max(0, MAX_SECONDARY_DETAILS - secondaryMarkets.length))];
    const resolvedDetails = await Promise.all(detailMarkets.map(async (market) => {
      const cached = this.marketDetailCache.get(market.id);
      if (cached && cached.expiresAt > Date.now()) {
        if (cached.kind === "secondary") return applyAuthoritativeQuoteMetadata(mergeMarketCatalogQuotes(cached.market, market), officialEvents.get(market.id) ?? null);
        if (cached.kind === "primary-pool") return applyAuthoritativeQuoteMetadata({ ...market, primaryPoolLiquidity: cached.market.primaryPoolLiquidity, volumeRaw: cached.market.volumeRaw, dataRetrievedAt: cached.market.dataRetrievedAt }, officialEvents.get(market.id) ?? null);
        return market;
      }
      try {
        const payload = await this.request(`/markets/${encodeURIComponent(market.id)}/`, signal ? { signal } : {});
        const detail = normalizePantaMarket(object(payload).data ?? payload);
        if (!detail || detail.id !== market.id) {
          this.marketDetailCache.set(market.id, { market, kind: "fallback", expiresAt: Date.now() + 5_000 });
          return market;
        }
        // Secondary detail also supplies live book-phase metadata used by
        // existing consumers. For primary/resolved cards, consume only the new
        // pool snapshot so detail status and volume cannot change catalog semantics.
        const timestampedDetail = { ...detail, dataRetrievedAt: new Date().toISOString() };
        const merged = detail.phase === "secondary"
          ? mergeMarketCatalogQuotes(timestampedDetail, market)
          : { ...market, primaryPoolLiquidity: timestampedDetail.primaryPoolLiquidity, volumeRaw: timestampedDetail.volumeRaw, dataRetrievedAt: timestampedDetail.dataRetrievedAt };
        const enriched = applyAuthoritativeQuoteMetadata(merged, officialEvents.get(market.id) ?? null);
        this.marketDetailCache.set(market.id, { market: enriched, kind: detail.phase === "secondary" ? "secondary" : "primary-pool", expiresAt: Date.now() + 5_000 });
        return enriched;
      } catch (error) {
        if (signal?.aborted) throw error;
        // Cache the catalog fallback too, so an unavailable detail endpoint
        // does not trigger another burst on every discovery refresh.
        this.marketDetailCache.set(market.id, { market, kind: "fallback", expiresAt: Date.now() + 5_000 });
        return market;
      }
    }));
    const eventData = await getPantaEventData(resolvedDetails);
    resolvedDetails.forEach((market) => {
      const chain = eventData.get(market.id);
      const enriched = chain ? applyDecodedPantaEvent(market, chain.event, chain.observedAt, chain.slot) : market;
      catalogById.set(enriched.id, enriched);
      const cached = this.marketDetailCache.get(enriched.id);
      if (cached) this.marketDetailCache.set(enriched.id, { ...cached, market: enriched });
    });
    const normalized = [...catalogById.values()];
    this.marketCatalog = { expiresAt: Date.now() + 5_000, byId: new Map(normalized.map((market) => [market.id, market])) };
    if (!query?.trim()) return normalized;
    return rankDiscoveredMarkets(query, normalized);
  }

  async getMarket(id: string, signal?: AbortSignal): Promise<Market | null> {
    const payload = await this.request(`/markets/${encodeURIComponent(id)}/`, signal ? { signal } : {});
    const candidate = normalizePantaMarket(object(payload).data ?? payload);
    const rawMarket = candidate?.id === id ? candidate : null;
    const rawDetail = rawMarket ? { ...rawMarket, dataRetrievedAt: new Date().toISOString() } : null;
    const quoteResolved = rawDetail ? await this.resolveMarketQuote(rawDetail) : null;
    const chainData = quoteResolved ? (await getPantaEventData([quoteResolved])).get(id) : undefined;
    const detail = quoteResolved ? chainData ? applyDecodedPantaEvent(quoteResolved, chainData.event, chainData.observedAt, chainData.slot) : quoteResolved : null;
    if (detail) this.marketDetailCache.set(id, { market: detail, kind: detail.phase === "secondary" ? "secondary" : "primary-pool", expiresAt: Date.now() + 5_000 });
    const hasTitle = Boolean(detail?.question.trim()) && detail?.question !== "Market title unavailable";
    if (!detail || (detail.yesProbability !== null && detail.noProbability !== null && hasTitle && detail.status !== "unknown")) return detail;
    let catalog = this.marketCatalog;
    if (!catalog || catalog.expiresAt <= Date.now()) {
      await this.discoverMarkets(undefined, signal);
      catalog = this.marketCatalog;
    }
    return mergeMarketCatalogQuotes(detail, catalog?.byId.get(id));
  }

  async getMarketTrades(marketId: string): Promise<unknown[]> {
    return list(await this.request(`/markets/${encodeURIComponent(marketId)}/trades/`));
  }

  async getMarketHistory(marketId: string, range: string): Promise<MarketPriceHistory> {
    const market = await this.getMarket(marketId);
    if (!market) {
      return { marketId, eventPda: null, range: range as MarketPriceHistory["range"], status: "error", observations: [], quoteAsset: null, source: "none", retrievedAt: new Date().toISOString(), signaturesRead: 0, transactionsRead: 0, latestSignatureSlot: null, latestSignatureBlockTime: null, signatureLimit: 36, coverage: "unknown", completeness: "unavailable", reason: "market-not-found", message: "Market history is unavailable because the market could not be resolved." };
    }
    return getPantaPriceHistory(market, range);
  }

  async getPositions(wallet: string): Promise<Position[]> {
    const payload = await this.request(`/positions/?wallet=${encodeURIComponent(wallet)}`);
    const rows = list(payload).length ? list(payload) : Array.isArray(object(payload).positions) ? object(payload).positions as unknown[] : [];
    const parsed = rows.map((item) => {
      const row = object(item);
      const marketId = text(row.market_id, row.marketId, row.market_address) ?? "";
      return {
        id: text(row.id, row.position_id) ?? `${marketId}:${text(row.side, row.outcome) ?? ""}`,
        marketId,
        question: text(row.question, row.market_title, row.market_question) ?? "",
        outcome: text(row.side, row.outcome) ?? "",
        shares: number(row.shares, row.share_amount, row.quantity) ?? 0,
        currentValueUsd: number(row.current_value_usdc, row.current_value_usd, row.value_usdc),
        claimable: row.claimable === true || row.is_claimable === true,
      };
    }).filter((position) => position.marketId);
    const missingTitles = [...new Set(parsed.filter((position) => !position.question).map((position) => position.marketId))];
    const titles = new Map<string, string>();
    for (let index = 0; index < missingTitles.length; index += 8) {
      const batch = missingTitles.slice(index, index + 8);
      const resolved = await Promise.all(batch.map(async (marketId) => [marketId, (await this.getMarket(marketId))?.question ?? "Market question unavailable"] as const));
      resolved.forEach(([marketId, question]) => titles.set(marketId, question));
    }
    return parsed.map((position) => ({ ...position, question: position.question || titles.get(position.marketId) || "Market question unavailable" }));
  }

  async getQuote(input: { marketId: string; outcome: "YES" | "NO"; amountUsd: number; wallet: string }): Promise<TradeQuote> {
    const payload = await this.request("/primaryorderquote/", { method: "POST", body: JSON.stringify({ wallet: input.wallet, marketId: input.marketId, side: input.outcome.toLowerCase(), amountUsdc: input.amountUsd.toFixed(2) }) });
    return normalizePantaQuote(payload, this.environment);
  }

  buildTrade(input: { quoteId: string; wallet: string }): Promise<unknown> {
    return this.request("/primaryorderbuild/", { method: "POST", body: JSON.stringify({ quoteId: input.quoteId, wallet: input.wallet, maxSlippageBps: 100 }) });
  }

  submitTrade(input: { orderId: string; signature: string; wallet: string }): Promise<unknown> {
    return this.request("/primaryordersubmit/", { method: "POST", body: JSON.stringify(input) });
  }

  verifyTrade(input: { orderId: string; signature: string; wallet: string }): Promise<unknown> {
    return this.request("/primaryorderverify/", { method: "POST", body: JSON.stringify(input) });
  }

  getCreatorFees(wallet: string): Promise<unknown> {
    return this.request(`/claim/creator-fees/?wallet=${encodeURIComponent(wallet)}`);
  }

  buildClaim(input: { marketId: string; wallet: string }): Promise<unknown> {
    return this.request("/claim/build/", { method: "POST", body: JSON.stringify({ market_id: input.marketId, wallet: input.wallet }) });
  }

  attributeTrade(input: { signature: string; marketId: string; wallet: string; quoteId?: string }): Promise<unknown> {
    return this.request("/trades/", { method: "POST", body: JSON.stringify({ signature: input.signature, marketId: input.marketId, wallet: input.wallet, ...(input.quoteId ? { quoteId: input.quoteId } : {}) }) });
  }
}

export const pantaIsConfigured = Boolean(apiKey) && process.env.NEXT_PUBLIC_MARKET_PROVIDER !== "demo";
