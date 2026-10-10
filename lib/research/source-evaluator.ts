import type { SearchResult } from "./types";

export type SourceAssessment = { domain: string; reliability: "high" | "medium" | "low"; tier: 1 | 2 | 3 | 4; reason: string; relevance: "high" | "medium" | "low"; sourceType: import("./types").ResearchSourceType };
const primaryDomains = [".gov", ".gov.uk", "federalreserve.gov", "newyorkfed.org", "sec.gov", "cftc.gov", "ecb.europa.eu", "ons.gov.uk", "census.gov", "bls.gov", "noaa.gov", "who.int", "fifa.com", "olympics.com", "nhl.com", "arsenal.com", "leedsunited.com", "premierleague.com", "thefa.com"];
const reportingDomains = ["reuters.com", "apnews.com", "bbc.com", "bbc.co.uk", "ft.com", "bloomberg.com", "espn.com", "forbes.com", "metro.co.uk", "onefootball.com", "squawka.com", "coindesk.com", "theblock.co", "wsj.com", "nytimes.com", "theguardian.com"];
const dataDomains = ["coingecko.com", "coinmarketcap.com", "glassnode.com", "coinglass.com", "farside.co.uk", "coinshares.com", "cmegroup.com", "bitget.com", "binance.com", "kraken.com", "messari.io"];
const socialDomains = ["facebook.com", "instagram.com", "x.com", "twitter.com", "tiktok.com", "reddit.com", "threads.net"];
const aggregators = ["news.google.com", "news.yahoo.com", "sports.yahoo.com", "msn.com"];
function hostOf(url: string) { try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; } }
function includesDomain(host: string, domains: string[]) { return domains.some((domain) => host === domain || host.endsWith(`.${domain}`) || (domain.startsWith(".") && host.endsWith(domain))); }

export function assessSource(source: SearchResult, marketQuestion: string, searchQuery = ""): SourceAssessment {
  const domain = hostOf(source.url);
  const official = includesDomain(domain, primaryDomains);
  const reported = includesDomain(domain, reportingDomains);
  const dataProvider = includesDomain(domain, dataDomains);
  const social = includesDomain(domain, socialDomains);
  const aggregator = includesDomain(domain, aggregators);
  const tier: SourceAssessment["tier"] = official ? 1 : reported ? 2 : dataProvider || aggregator ? 3 : 4;
  const reliability = official ? "high" : reported || dataProvider || aggregator ? "medium" : "low";
  const sourceType: SourceAssessment["sourceType"] = official ? "primary-official" : reported ? "independent-reporting" : dataProvider ? "specialist-data-provider" : social ? "social-user-generated" : aggregator ? "aggregator-syndicated" : "unknown";
  const reason = official ? "Official organization domain; this supports claims about its own announcements, not every third-party claim." : dataProvider ? "Recognized specialist or market-data provider; methodology and coverage still need context." : reported ? "Recognized reporting or specialist outlet; the underlying claim still needs context." : social ? "User-generated platform content; the speaker and claim were not independently authenticated by the retrieved metadata." : aggregator ? "Aggregator domain; the originating report and any syndication relationship need separate verification." : "Publisher reliability and provenance were not established by this domain allowlist.";
  const genericTerms = new Set(["will", "what", "when", "where", "which", "who", "how", "happen", "happening", "is", "are", "was", "were", "the", "and", "for", "with", "from", "about", "before", "after", "against", "beat", "win", "wins", "match", "game", "united", "october", "november", "december", "january", "february", "march", "april", "may", "june", "july", "august", "september"]);
  // Search queries are often much more specific than the contract title (for
  // example, an ETF flow article may be relevant to a price market without
  // repeating its exact target and deadline). Score against both, while
  // keeping query boilerplate out of the token set.
  const queryTerms = searchQuery.toLowerCase().match(/[a-z]+/g) ?? [];
  const queryNoise = new Set(["latest", "evidence", "independent", "reporting", "official", "source", "outlook", "case", "against", "supporting", "downside", "risks"]);
  const marketTokens = [...new Set(marketQuestion.toLowerCase().match(/[a-z]+/g) ?? [])].filter((word) => word.length > 2 && !genericTerms.has(word));
  const tokens = [...new Set([...marketTokens, ...queryTerms.filter((word) => !queryNoise.has(word))])].filter((word) => word.length > 2 && !genericTerms.has(word));
  const content = `${source.title} ${source.content}`.toLowerCase();
  const hits = tokens.filter((word) => new RegExp(`\\b${word}\\b`).test(content)).length;
  const anchorHits = marketTokens.filter((word) => new RegExp(`\\b${word}\\b`).test(content)).length;
  const unrelatedMatchup = /\b(?:beat|versus|vs)\b/i.test(marketQuestion) && marketTokens.length >= 2 && anchorHits < 2 && /\b(?:versus|vs)\b/i.test(content);
  const relevance = hits === 0 || unrelatedMatchup || (tokens.length > 2 && hits < 2)
    ? "low"
    : source.score !== null && source.score >= 0.75 && hits >= 2
      ? "high"
      : "medium";
  return { domain, reliability, tier, reason, relevance, sourceType };
}
