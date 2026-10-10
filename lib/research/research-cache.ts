import type { ResearchReport } from "./types";

const TTL_MS = 5 * 60_000;
const MAX_ENTRIES = 100;
const cache = new Map<string, { expiresAt: number; report: ResearchReport }>();

export function researchCacheKey(input: { marketId: string; depth: string; query: string }) {
  return `${input.marketId}|${input.depth}|${input.query.toLowerCase().trim().replace(/\s+/g, " ")}`;
}
export function getCachedResearch(key: string): ResearchReport | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) { cache.delete(key); return null; }
  return entry.report;
}
export function setCachedResearch(key: string, report: ResearchReport) {
  cache.set(key, { report, expiresAt: Date.now() + TTL_MS });
  while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
}
export function clearResearchCache() { cache.clear(); }
