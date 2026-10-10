import "server-only";
import type { ReadPageResult, SearchResult } from "./types";

type ExtractPayload = { results?: Array<{ url?: unknown; raw_content?: unknown; content?: unknown; images?: unknown }>; failed_results?: Array<{ url?: unknown; error?: unknown }> };

export function extractPublicationDateInfo(content: string): { publishedAt: string; precision: "date" | "timestamp" } | null {
  const patterns = [
    /<meta[^>]+(?:property|name)=["'](?:article:published_time|datePublished|pubdate|publishdate)["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:article:published_time|datePublished|pubdate|publishdate)["']/i,
    /["']datePublished["']\s*:\s*["']([^"']+)["']/i,
    /<time[^>]+datetime=["']([^"']+)["']/i,
    /(?:^|[\n\s])Published(?:\s+on)?\s*:\s*([A-Z][a-z]{2,8}\s+\d{1,2},?\s+\d{4})/i,
  ];
  for (const pattern of patterns) {
    const value = content.match(pattern)?.[1];
    const isDateOnly = value && /^(?:\d{4}-\d{2}-\d{2}|[A-Z][a-z]{2,8}\s+\d{1,2},?\s+\d{4})$/i.test(value);
    const parsed = value ? Date.parse(isDateOnly ? `${value} UTC` : value) : Number.NaN;
    if (value && Number.isFinite(parsed)) return { publishedAt: new Date(parsed).toISOString(), precision: isDateOnly ? "date" : "timestamp" };
  }
  return null;
}
export function extractPublicationDate(content: string): string | null { return extractPublicationDateInfo(content)?.publishedAt ?? null; }
export function isPageShellContent(content: string): boolean {
  const start = content.replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/gi, " ").replace(/\s+/g, " ").trim().slice(0, 240);
  return /^(?:[\w.'’-]{2,60}\s+(?:home page|homepage)|home page\b|enable javascript\b|javascript is disabled\b|access denied\b|page not found\b)/i.test(start);
}

export async function retrievePages(sources: SearchResult[], query: string, signal?: AbortSignal): Promise<ReadPageResult[]> {
  const retrievedAt = new Date().toISOString();
  if (!sources.length) return [];
  const key = process.env.TAVILY_API_KEY?.trim();
  const pages = new Map<string, ReadPageResult>();
  for (const source of sources) {
    if (source.rawContent) {
      const extracted = extractPublicationDateInfo(source.rawContent);
      const shell = isPageShellContent(source.rawContent);
      pages.set(source.url, { url: source.url, title: source.title, content: shell ? source.content : source.rawContent.slice(0, 20_000), publishedAt: source.publishedAt ?? (shell ? null : extracted?.publishedAt) ?? null, publishedAtPrecision: source.publishedAt ? source.publishedAtPrecision : shell ? undefined : extracted?.precision, retrievedAt, retrieved: !shell, ...(shell ? { failureReason: "Retrieved content was a page shell; only the search-result snippet is available." } : {}) });
    } else pages.set(source.url, { url: source.url, title: source.title, content: source.content, publishedAt: source.publishedAt, publishedAtPrecision: source.publishedAtPrecision, retrievedAt, retrieved: false, failureReason: "Search result had no full page content." });
  }
  if (!key) return [...pages.values()];
  const needsExtract = sources.filter((source) => !source.rawContent).slice(0, 5);
  await Promise.all(needsExtract.map(async (source) => {
    try {
      const response = await fetch("https://api.tavily.com/extract", {
        method: "POST", cache: "no-store", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(25_000)]) : AbortSignal.timeout(25_000),
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ urls: [source.url], query: query.slice(0, 300), extract_depth: "advanced", chunks_per_source: 2, format: "markdown" }),
      });
      const body = await response.json().catch(() => ({})) as ExtractPayload;
      if (!response.ok) {
        pages.set(source.url, { ...pages.get(source.url)!, failureReason: `Page retrieval failed (HTTP ${response.status}); only search-result text is available.` });
        return;
      }
      const row = body.results?.find((result) => result.url === source.url) ?? body.results?.[0];
      const content = typeof row?.raw_content === "string" ? row.raw_content : typeof row?.content === "string" ? row.content : "";
      if (content.trim() && !isPageShellContent(content)) {
        const extracted = extractPublicationDateInfo(content);
        pages.set(source.url, { url: source.url, title: source.title, content: content.slice(0, 20_000), publishedAt: source.publishedAt ?? extracted?.publishedAt ?? null, publishedAtPrecision: source.publishedAt ? source.publishedAtPrecision : extracted?.precision, retrievedAt: new Date().toISOString(), retrieved: true });
      }
      else pages.set(source.url, { ...pages.get(source.url)!, failureReason: content.trim() ? "Tavily returned a page shell; only search-result text is available." : "Tavily returned no readable page content; only search-result text is available." });
    } catch (error) {
      if (signal?.aborted || (error instanceof Error && error.name === "AbortError")) throw new DOMException("Research request was cancelled.", "AbortError");
      pages.set(source.url, { ...pages.get(source.url)!, failureReason: error instanceof Error && error.name === "TimeoutError" ? "Page retrieval timed out; only search-result text is available." : "Page retrieval failed; only search-result text is available." });
    }
  }));
  return sources.map((source) => pages.get(source.url)!);
}
