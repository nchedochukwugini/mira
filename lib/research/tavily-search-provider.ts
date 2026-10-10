import "server-only";
import type { ResearchDepth, ResearchSearchProvider, ResearchSearchRequest, ResearchSearchResult, SearchResult } from "./types";

type TavilyRow = { title?: unknown; url?: unknown; content?: unknown; raw_content?: unknown; published_date?: unknown; score?: unknown };
type TavilyPayload = { results?: TavilyRow[]; detail?: { error?: string } | string };
const API = "https://api.tavily.com";

export class TavilySearchProvider implements ResearchSearchProvider {
  constructor(private readonly apiKey = process.env.TAVILY_API_KEY) {}
  get configured() { return Boolean(this.apiKey?.trim()); }

  async search(request: ResearchSearchRequest): Promise<ResearchSearchResult> {
    if (!this.apiKey?.trim()) return { status: "unavailable", results: [], message: "Live web research is not configured. Set TAVILY_API_KEY on the server to enable it." };
    try {
      const depth: ResearchDepth = request.depth;
      const response = await fetch(`${API}/search`, {
        method: "POST", cache: "no-store", signal: request.signal ? AbortSignal.any([request.signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000),
        headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          query: request.query.slice(0, 400), search_depth: depth === "quick" ? "basic" : "advanced",
          topic: "general", max_results: Math.min(5, Math.max(2, request.maxResults ?? 4)),
          chunks_per_source: depth === "full" ? 3 : 2, include_answer: false,
          include_raw_content: true, include_published_date: true,
          ...(request.recencyDays && request.recencyDays <= 1 ? { time_range: "day" } : request.recencyDays && request.recencyDays <= 7 ? { time_range: "week" } : request.recencyDays && request.recencyDays <= 30 ? { time_range: "month" } : {}),
        }),
      });
      const payload = await response.json().catch(() => ({})) as TavilyPayload;
      if (!response.ok) return { status: "error", results: [], message: `Tavily search returned HTTP ${response.status}${response.status === 401 ? " (check TAVILY_API_KEY)" : response.status === 429 ? " (rate limit reached)" : ""}.` };
      const results: SearchResult[] = (payload.results ?? []).flatMap((row) => {
        if (typeof row.title !== "string" || typeof row.url !== "string" || typeof row.content !== "string") return [];
        try {
          const url = new URL(row.url);
          if (url.protocol !== "https:") return [];
          const published = typeof row.published_date === "string" && Number.isFinite(Date.parse(row.published_date)) ? new Date(row.published_date).toISOString() : null;
          const publishedAtPrecision = published ? (/^\d{4}-\d{2}-\d{2}$/.test(row.published_date as string) ? "date" as const : "timestamp" as const) : undefined;
          return [{ title: row.title.slice(0, 240), url: url.toString(), content: row.content.slice(0, 1600), rawContent: typeof row.raw_content === "string" && row.raw_content.trim() ? row.raw_content.slice(0, 20_000) : null, publishedAt: published, publishedAtPrecision, score: typeof row.score === "number" && Number.isFinite(row.score) ? row.score : null, query: request.query }];
        } catch { return []; }
      });
      return { status: "ok", results };
    } catch (error) {
      if (request.signal?.aborted || (error instanceof Error && error.name === "AbortError")) throw new DOMException("Research request was cancelled.", "AbortError");
      return { status: "error", results: [], message: error instanceof Error && error.name === "TimeoutError" ? "Tavily search timed out." : "Tavily search could not be reached." };
    }
  }
}
