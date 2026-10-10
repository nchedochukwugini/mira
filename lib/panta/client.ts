import "server-only";
import type { Market, Position, TradeQuote } from "@/lib/panta/types";
import { normalizePantaQuote } from "@/lib/panta/trade-data";
import { normalizePantaMarket } from "@/lib/intelligence/core";
import { rankDiscoveredMarkets } from "@/lib/intelligence/market-suggestions";

const baseUrl = (process.env.PANTA_API_URL || process.env.PANTA_API_BASE_URL || "https://live-api.panta.market/api/v1").replace(/\/$/, "");
const apiKey = process.env.PANTA_API_KEY;
const MARKET_PAGE_SIZE = 50;
const MAX_MARKET_PAGES = 100;
const MAX_SECONDARY_DETAILS = 16;

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
    liquidityUsd: mergeMeasuredValue(detail.liquidityUsd, catalog.liquidityUsd),
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
  private secondaryDetailCache = new Map<string, { expiresAt: number; market: Market }>();


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
    const catalog = [...new Map(rows.map(normalizePantaMarket).filter((market): market is Market => market !== null).map((market) => [market.id, market])).values()];
    const catalogById = new Map(catalog.map((market) => [market.id, market]));
    // Detail carries current secondary quotes and account metadata omitted by
    // the catalog. Bound enrichment work; the detail route resolves any other
    // explicitly selected market on demand.
    const secondaryMarkets = catalog.filter((market) => market.phase === "secondary" && market.status === "active").slice(0, MAX_SECONDARY_DETAILS);
    const resolvedSecondary = await Promise.all(secondaryMarkets.map(async (market) => {
      const cached = this.secondaryDetailCache.get(market.id);
      if (cached && cached.expiresAt > Date.now()) return mergeMarketCatalogQuotes(cached.market, market);
      try {
        const payload = await this.request(`/markets/${encodeURIComponent(market.id)}/`, signal ? { signal } : {});
        const detail = normalizePantaMarket(object(payload).data ?? payload);
        if (!detail || detail.id !== market.id || detail.phase !== "secondary") return market;
        const enriched = mergeMarketCatalogQuotes(detail, market);
        this.secondaryDetailCache.set(market.id, { market: enriched, expiresAt: Date.now() + 5_000 });
        return enriched;
      } catch (error) {
        if (signal?.aborted) throw error;
        return market;
      }
    }));
    resolvedSecondary.forEach((market) => catalogById.set(market.id, market));
    const normalized = [...catalogById.values()];
    this.marketCatalog = { expiresAt: Date.now() + 5_000, byId: new Map(normalized.map((market) => [market.id, market])) };
    if (!query?.trim()) return normalized;
    return rankDiscoveredMarkets(query, normalized);
  }

  async getMarket(id: string, signal?: AbortSignal): Promise<Market | null> {
    const payload = await this.request(`/markets/${encodeURIComponent(id)}/`, signal ? { signal } : {});
    const detail = normalizePantaMarket(object(payload).data ?? payload);
    if (detail?.phase === "secondary") {
      this.secondaryDetailCache.set(id, { market: detail, expiresAt: Date.now() + 5_000 });
    }
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
