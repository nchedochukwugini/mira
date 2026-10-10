import "server-only";

export type WebResearch = {
  status: "live" | "unavailable";
  summary: string;
  sources: Array<{ title: string; url: string; snippet?: string; publishedAt: string | null; source?: string }>;
};

type WebSource = WebResearch["sources"][number];

async function searchGdelt(query: string): Promise<WebSource[] | null> {
  try {
    const url = new URL("https://api.gdeltproject.org/api/v2/doc/doc");
    url.searchParams.set("query", query.slice(0, 400));
    url.searchParams.set("mode", "artlist");
    url.searchParams.set("maxrecords", "5");
    url.searchParams.set("timespan", "1week");
    url.searchParams.set("sort", "datedesc");
    url.searchParams.set("format", "json");
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(5000), headers: { Accept: "application/json" } });
    if (!response.ok) return null;
    const payload = await response.json() as { articles?: Array<{ title?: string; url?: string; seendate?: string }> };
    return (payload.articles ?? []).flatMap((item): WebSource[] => {
      if (typeof item.title !== "string" || typeof item.url !== "string") return [];
      try {
        const resultUrl = new URL(item.url);
        if (resultUrl.protocol !== "https:") return [];
        // GDELT seendate is when GDELT observed the article, not its publication date.
        // Keep publication time unknown instead of presenting observation time as publication.
        return [{ title: item.title.slice(0, 240), url: resultUrl.toString(), publishedAt: null }];
      } catch {
        return [];
      }
    }).slice(0, 5);
  } catch {
    return null;
  }
}

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_match, decimal: string) => String.fromCodePoint(Number(decimal)))
    .replace(/&#x([\da-f]+);/gi, (_match, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
    .replace(/\s+/g, " ").trim();
}

function readTag(block: string, name: string): string | null {
  const openTag = new RegExp("<" + name + "(?:\\s[^>]*)?>([\\s\\S]*?)<\\/" + name + ">", "i");
  const match = block.match(openTag);
  return match?.[1] ? decodeXml(match[1]) : null;
}

async function searchGoogleNews(query: string): Promise<WebSource[] | null> {
  try {
    const url = new URL("https://news.google.com/rss/search");
    url.searchParams.set("q", query.slice(0, 400));
    url.searchParams.set("hl", "en-US");
    url.searchParams.set("gl", "US");
    url.searchParams.set("ceid", "US:en");
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(6000), headers: { Accept: "application/rss+xml, application/xml, text/xml" } });
    if (!response.ok) return null;
    const xml = await response.text();
    const items = [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].map((match) => match[1] ?? "");
    return items.flatMap((item): WebSource[] => {
      const title = readTag(item, "title");
      const href = readTag(item, "link");
      if (!title || !href) return [];
      try {
        const resultUrl = new URL(href);
        if (resultUrl.protocol !== "https:") return [];
        const description = item.match(/<description(?:\s[^>]*)?>([\s\S]*?)<\/description>/i)?.[1];
        const snippet = description ? decodeXml(description).slice(0, 500) : undefined;
        const published = readTag(item, "pubDate");
        const parsedDate = published ? new Date(published) : null;
        const publisher = readTag(item, "source");
        return [{ title: title.slice(0, 240), url: resultUrl.toString(), snippet, publishedAt: parsedDate && !Number.isNaN(parsedDate.valueOf()) ? parsedDate.toISOString() : null, ...(publisher ? { source: publisher.slice(0, 120) } : {}) }];
      } catch {
        return [];
      }
    }).slice(0, 5);
  } catch {
    return null;
  }
}

export async function researchMarketOnWeb(query: string): Promise<WebResearch> {
  const [gdeltSources, googleSources] = await Promise.all([searchGdelt(query), searchGoogleNews(query)]);
  const usingGoogle = !gdeltSources?.length && Boolean(googleSources?.length);
  const sources = gdeltSources?.length ? gdeltSources : googleSources ?? [];
  if (sources.length) {
    const items = sources.slice(0, 3).map((source) => usingGoogle ? (source.snippet || source.title) : "“" + source.title + "”");
    return {
      status: "live",
      summary: "Recent news coverage includes: " + items.join(" ") + (usingGoogle ? " Open the linked reports for full context." : ". These are headlines; open the linked articles for their full reporting."),
      sources,
    };
  }
  if (gdeltSources || googleSources) return { status: "live", summary: "No matching news headlines were returned for the past week.", sources: [] };
  return {
    status: "unavailable",
    summary: "Free news search services could not be reached. The market analysis below still uses the selected market data provider.",
    sources: [],
  };
}
