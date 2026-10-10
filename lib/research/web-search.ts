import "server-only";
import type { ResearchSearchProvider } from "./types";
import { TavilySearchProvider } from "./tavily-search-provider";

let provider: TavilySearchProvider | undefined;
export function getResearchSearchProvider(): ResearchSearchProvider {
  provider ??= new TavilySearchProvider();
  return provider;
}
export function hasResearchSearchProvider(): boolean { return Boolean(process.env.TAVILY_API_KEY?.trim()); }
