import type { Market } from "@/lib/panta/types";
import type { PlannedResearchQuery, ResearchDepth, ResearchPlan } from "./types";
import { classifyResearchTypes } from "./event-intelligence";

function categoryFor(question: string, category: string | null): ResearchPlan["category"] {
  const text = `${question} ${category ?? ""}`.toLowerCase();
  if (/bitcoin|\bbtc\b|ethereum|\beth\b|crypto|solana|\bsol\b/.test(text)) return "crypto";
  if (/election|president|congress|senate|governor|politic|trump|biden|candidate/.test(text)) return "politics";
  if (/\b(cpi|inflation|fed|federal reserve|interest rate|gdp|jobs report|unemployment|econom)/.test(text)) return "economics";
  if (/\b(nba|nfl|mlb|nhl|premier league|champions league|match|game|team|win|beat|score|playoff|sports?)\b/.test(text)) return "sports";
  return "general";
}

function subjectFor(question: string, category: ResearchPlan["category"]): string {
  if (category === "crypto") {
    if (/\b(bitcoin|btc)\b/i.test(question)) return "Bitcoin BTC";
    if (/\b(ethereum|ether|eth)\b/i.test(question)) return "Ethereum ETH";
    if (/\b(solana|sol)\b/i.test(question)) return "Solana SOL";
  }
  return question
    .replace(/^(will|whether|does|do|is|are)\s+/i, "")
    .replace(/\b(by|before|after)\s+(?:\$?\d[\d,.kmb%]*|october|november|december|january|february|march|april|may|june|july|august|september|monday|tuesday|wednesday|thursday|friday|saturday|sunday).*$/i, "")
    .replace(/[?]/g, "")
    .slice(0, 150)
    .trim();
}

export function createResearchPlan(input: { query: string; market?: Market | null; depth?: ResearchDepth }): ResearchPlan {
  const depth = input.depth ?? "deep";
  const marketQuestion = input.market?.question ?? input.query;
  const category = categoryFor(input.market?.question ?? input.query, input.market?.category ?? null);
  const subject = subjectFor(marketQuestion, category);
  const currentDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const dimensions: Record<ResearchPlan["category"], string[]> = {
    crypto: ["current price and market structure", "ETF and institutional flows", "macro conditions", "regulation", "protocol or company announcements", "supporting evidence", "downside and opposing evidence"],
    sports: ["team and player status", "injuries and suspensions", "recent form and statistics", "schedule and matchup", "official team announcements", "evidence for each outcome"],
    politics: ["polling and polling changes", "official election information", "campaign developments and endorsements", "regional and demographic evidence", "evidence for each outcome"],
    economics: ["official economic releases", "central bank statements", "relevant macro data", "credible financial reporting", "evidence for and against the outcome"],
    general: ["official primary sources", "recent developments", "reliable reporting", "supporting evidence", "opposing evidence"],
  };
  const queries: PlannedResearchQuery[] = [];
  const add = (query: string, dimension: string, side: PlannedResearchQuery["side"], recencyDays = 30) => queries.push({ query: `${query} latest as of ${currentDate}`, dimension, side, recencyDays });
  if (category === "crypto") {
    add(`${subject} price market trend`, "current price and market structure", "neutral", 7);
    if (/\$|\d/.test(marketQuestion)) add(`${subject} ${marketQuestion.match(/\$?\d[\d,.kmb]*/)?.[0] ?? "price target"} outlook evidence`, "target distance and price thesis", "yes", 14);
    add(`${subject} ETF institutional flows`, "ETF and institutional flows", "yes", 14);
    add(`${subject} macro conditions rates dollar`, "macro conditions", "neutral", 14);
    add(`${subject} official regulatory protocol announcement`, "regulation and official announcements", "neutral", 30);
    add(`${subject} bearish downside resistance risks`, "downside and opposing evidence", "no", 14);
  } else if (category === "sports") {
    add(`${subject} injuries suspensions lineup official`, "team and player status", "neutral", 7);
    add(`${subject} recent form statistics schedule`, "recent form and matchup", "neutral", 30);
    add(`${subject} team official announcements`, "official team announcements", "neutral", 14);
    add(`${subject} arguments for winning`, "evidence supporting YES", "yes", 30);
    add(`${subject} arguments against winning`, "evidence supporting NO", "no", 30);
  } else if (category === "politics") {
    add(`${subject} latest polling poll average`, "polling and polling changes", "neutral", 30);
    add(`${subject} official election results announcement`, "official election information", "neutral", 30);
    add(`${subject} campaign developments endorsement`, "campaign developments", "neutral", 14);
    add(`${subject} evidence candidate likely to win`, "evidence supporting YES", "yes", 30);
    add(`${subject} evidence candidate could lose polling`, "evidence supporting NO", "no", 30);
  } else if (category === "economics") {
    add(`${subject} official data release`, "official economic releases", "neutral", 30);
    add(`${subject} central bank statement`, "central bank statements", "neutral", 30);
    add(`${subject} macroeconomic data latest`, "macro data and reporting", "neutral", 30);
    add(`${subject} upside case`, "evidence supporting YES", "yes", 30);
    add(`${subject} downside risks case against`, "evidence supporting NO", "no", 30);
  } else {
    add(`${subject} official primary source announcement`, "official primary sources", "neutral", 30);
    add(`${subject} recent developments reporting`, "recent developments", "neutral", 14);
    add(`${subject} evidence supporting outcome`, "evidence supporting YES", "yes", 30);
    add(`${subject} opposing evidence risks`, "evidence supporting NO", "no", 30);
  }
  const maxQueries = depth === "quick" ? 3 : depth === "full" ? 10 : 7;
  const researchTypes = classifyResearchTypes(input.query);
  const now = new Date();
  const to = now.toISOString();
  const localToday = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const timeWindow: ResearchPlan["timeWindow"] = /\btoday\b/i.test(input.query)
    ? { label: "today", from: new Date(`${localToday}T00:00:00+01:00`).toISOString(), to }
    : /\b(since yesterday|last 24 hours?|past 24 hours?|last day)\b/i.test(input.query)
      ? { label: "last-24-hours", from: new Date(now.getTime() - 86_400_000).toISOString(), to }
      : /\b(this week|last 7 days?|past week|over the last week)\b/i.test(input.query)
        ? { label: "last-7-days", from: new Date(now.getTime() - 7 * 86_400_000).toISOString(), to }
        : /\bsince i last checked\b/i.test(input.query)
          ? { label: "since-previous-run", from: null, to }
          : { label: "unspecified", from: null, to };
  const scopedQueries = queries.slice(0, maxQueries).map((item) => ({ ...item, recencyDays: timeWindow.label === "today" || timeWindow.label === "last-24-hours" ? 1 : timeWindow.label === "last-7-days" ? 7 : item.recencyDays }));
  return { marketQuestion, category, depth, dimensions: dimensions[category], queries: scopedQueries, researchTypes, timeWindow };
}
