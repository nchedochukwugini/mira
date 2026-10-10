import { NextResponse } from "next/server";
import { analyzeMarketQuestion } from "@/lib/intelligence/analyzeMarketQuestion";
import { answerMarketDetail, asksForMarketReasoning, classifyConversationMessage, extractExplicitSubject, shouldInterpretWithGroq, type ConversationContext } from "@/lib/intelligence/conversation";
import { getMarketProvider } from "@/lib/providers/market-provider";
import { getPantaOrderBookSnapshot } from "@/lib/panta/clob";
import { summarizeOrderBookForMira } from "@/lib/intelligence/order-book-context";
import { getSnapshotMicrostructure } from "@/lib/panta/microstructure-service";
import { runResearch } from "@/lib/research";
import { getSpotPrice } from "@/lib/markets/spot-price";
import { calculateMovement, extractMarketIntent, rankMarkets, semanticRelevance } from "@/lib/intelligence/core";
import { explainMarketReasoning, understandMessage } from "@/lib/ai";
import { getConversation, getLatestMarketResearch, getPantaMicrostructureHistory, persistMarketObservation, persistResearch } from "@/lib/db";
import { buildMarketReasoning } from "@/lib/intelligence/market-reasoning";
import { buildCrossMarketReport, mergeMarketHistory, mergeSnapshotObservation } from "@/lib/intelligence/cross-market";
import { asksForMarketIntelligence, buildMarketIntelligenceContext, synthesizeMarketIntelligence } from "@/lib/intelligence/market-intelligence";
import { buildEventIntelligence } from "@/lib/research/event-intelligence";
import type { ResearchReport } from "@/lib/research/types";
import type { MarketIntelligenceResult } from "@/lib/intelligence/market-intelligence";
import type { CrossMarketReport } from "@/lib/intelligence/cross-market";
import type { Market } from "@/lib/panta/types";
import type { ConversationDecision } from "@/lib/intelligence/conversation";
import { PantaError } from "@/lib/panta/client";
import { compareVerifiedActivity } from "@/lib/intelligence/verified-activity";
import { isTradeEligibleMarket, tradeIneligibilityReason } from "@/lib/panta/trade-safety";
import { isUuid } from "@/lib/db/api-error";

export const dynamic = "force-dynamic";

async function assembleMarketIntelligence(input: { marketId: string; question: string; context: ConversationContext; researchReport?: ResearchReport; onProgress?: (step: string) => void }): Promise<{ market: Market | null; intelligence: MarketIntelligenceResult }> {
  const provider = getMarketProvider();
  const generatedAt = new Date().toISOString();
  input.onProgress?.("Reading the selected Panta market");
  const market = await provider.getMarket(input.marketId).catch(() => null);
  if (!market) {
    input.onProgress?.("Market details are unavailable; preserving retrieved research");
    const context = buildMarketIntelligenceContext({ market: null, generatedAt, research: input.researchReport?.evidence, researchStatus: input.researchReport ? "available" : "not-run", researchedAt: input.researchReport?.researchedAt, events: input.researchReport?.eventIntelligence });
    input.onProgress?.("Building the available market intelligence summary");
    return { market: null, intelligence: await synthesizeMarketIntelligence(context, /\bshould i buy\s+(?:yes|no)\b/i.test(input.question)) };
  }
  await persistMarketObservation(market).catch(() => undefined);
  input.onProgress?.("Checking the order book, saved observations, and research");
  const [snapshotResult, historyResult, researchResult] = await Promise.allSettled([
    market.source === "panta" ? getPantaOrderBookSnapshot(market.id) : Promise.resolve(null),
    market.source === "panta" ? getPantaMicrostructureHistory(market.id, { limit: 500 }) : Promise.resolve([]),
    input.researchReport ? Promise.resolve({ status: "available" as const, evidence: input.researchReport.evidence, researchedAt: input.researchReport.researchedAt }) : getLatestMarketResearch(market.id),
  ]);
  const snapshot = snapshotResult.status === "fulfilled" ? snapshotResult.value : null;
  const history = historyResult.status === "fulfilled" ? historyResult.value : [];
  const persistedResearch = researchResult.status === "fulfilled" ? researchResult.value : { status: "unavailable" as const, evidence: [], researchedAt: null };
  const evidence = input.researchReport?.evidence ?? persistedResearch.evidence;
  const researchStatus = researchResult.status === "rejected" ? "unavailable" as const : persistedResearch.status;
  const researchAt = input.researchReport?.researchedAt ?? persistedResearch.researchedAt ?? input.context.researchMemory?.researchedAt ?? evidence[0]?.retrievedAt ?? null;
  const microstructure = snapshot ? await getSnapshotMicrostructure(snapshot).catch(() => null) : null;
  input.onProgress?.("Reviewing activity and event updates");
  const reasoning = buildMarketReasoning({ market, snapshot, microstructure, history, historyStatus: historyResult.status === "rejected" ? "unavailable" : history.length ? "available" : "not-observed", research: evidence, researchStatus });
  const event = input.researchReport?.eventIntelligence ?? (evidence.length ? buildEventIntelligence({
    query: input.question,
    market,
    evidence,
    priorEvidence: (input.context.researchEvidence ?? []).map(({ id, title, url, claim, summary, publishedAt, retrievedAt }) => ({ id, title, url, claim: claim ?? summary, summary, publishedAt, retrievedAt })),
    researchedAt: generatedAt,
  }) : null);
  const explicitRelatedIds = input.context.markets?.map((item) => item.id).filter((id) => id !== market.id) ?? [];
  const relatedIds = [...new Set([...market.relatedMarketIds, ...explicitRelatedIds])].slice(0, 3);
  let crossMarket: CrossMarketReport | null = null;
  if (relatedIds.length) {
    input.onProgress?.("Comparing provider-linked and selected related markets");
    const related = (await Promise.all(relatedIds.map((id) => provider.getMarket(id).catch(() => null)))).filter((item): item is NonNullable<typeof item> => Boolean(item));
    const marketsWithHistory = await Promise.all([market, ...related].map(async (item) => {
      if (item.source !== "panta") return item;
      const observations = await getPantaMicrostructureHistory(item.id, { limit: 500 }).catch(() => []);
      const points = observations.flatMap((point) => point.pantaReference.observedAt && point.pantaReference.yesPrice !== null ? [{ timestamp: point.pantaReference.observedAt, yesProbability: point.pantaReference.yesPrice }] : []);
      return mergeMarketHistory(item, points);
    }));
    const [primary, ...comparisons] = marketsWithHistory;
    const primaryWithSnapshot = snapshot ? mergeSnapshotObservation(primary!, snapshot) : primary!;
    crossMarket = buildCrossMarketReport({ primaryMarket: primaryWithSnapshot, relatedMarkets: comparisons });
  }
  const context = buildMarketIntelligenceContext({
    market, providerLabel: provider.source === "panta" ? provider.environment === "live" ? "Connected market data" : provider.environment === "test" ? "Panta · Test" : "Panta · Environment unknown" : "Demo data",
    snapshot, microstructure, history, reasoning, events: event, research: evidence, researchStatus, researchedAt: researchAt,
    crossMarket, generatedAt,
  });
  input.onProgress?.("Building and grounding the market intelligence explanation");
  return { market, intelligence: await synthesizeMarketIntelligence(context, /\bshould i buy\s+(?:yes|no)\b/i.test(input.question)) };
}

function createMarketIntelligenceStream(run: (onProgress: (step: string) => void) => Promise<unknown>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (value: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`));
      void run((step) => send({ type: "progress", step }))
        .then((payload) => send({ type: "result", payload }))
        .catch((error) => send({ type: "result", payload: { error: error instanceof Error ? error.message : "Market intelligence could not be completed." }, status: 502 }))
        .finally(() => controller.close());
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" } });
}

function normalizePendingTrade(value: unknown): NonNullable<ConversationContext["pendingTrade"]> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const draft = value as Record<string, unknown>;
  const normalized = {
    ...(typeof draft.marketId === "string" ? { marketId: draft.marketId.slice(0, 160) } : {}),
    ...(typeof draft.marketQuestion === "string" ? { marketQuestion: draft.marketQuestion.slice(0, 500) } : {}),
    ...(draft.outcome === "YES" || draft.outcome === "NO" ? { outcome: draft.outcome as "YES" | "NO" } : {}),
    ...(typeof draft.amountUsdc === "number" && Number.isFinite(draft.amountUsdc) && draft.amountUsdc > 0 ? { amountUsdc: draft.amountUsdc } : {}),
    ...(typeof draft.marketQuery === "string" ? { marketQuery: draft.marketQuery.slice(0, 300) } : {}),
  };
  return normalized;
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { question?: unknown; context?: Partial<ConversationContext> };
    const question = typeof body.question === "string" ? body.question.trim().slice(0, 500) : "";
    if (!question) return NextResponse.json({ error: "Send a message for MIRA." }, { status: 400 });
    const rawMarkets = Array.isArray(body.context?.markets) ? body.context.markets : [];
    if (body.context?.conversationId !== undefined && !isUuid(body.context.conversationId)) return NextResponse.json({ error: "Conversation ID must be a UUID.", errorCode: "invalid_conversation_id" }, { status: 400 });
    const pendingInput = normalizePendingTrade(body.context?.pendingTrade);
    let context: ConversationContext = {
      conversationId: typeof body.context?.conversationId === "string" ? body.context.conversationId.slice(0, 80) : undefined,
      previousQuestion: typeof body.context?.previousQuestion === "string" ? body.context.previousQuestion.slice(0, 500) : undefined,
      recentMessages: Array.isArray(body.context?.recentMessages) ? body.context.recentMessages.slice(-6).flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const message = item as { role?: unknown; content?: unknown };
        return (message.role === "user" || message.role === "assistant") && typeof message.content === "string"
          ? [{ role: message.role, content: message.content.slice(0, 400) }]
          : [];
      }) : undefined,
      activeMarketId: typeof body.context?.activeMarketId === "string" ? body.context.activeMarketId.slice(0, 160) : undefined,
      markets: rawMarkets.slice(0, 30).flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const market = item as { id?: unknown; question?: unknown };
        return typeof market.id === "string" && typeof market.question === "string"
          ? [{ id: market.id.slice(0, 160), question: market.question.slice(0, 500) }]
          : [];
      }),
      pendingTrade: pendingInput,
      researchMarketId: typeof body.context?.researchMarketId === "string" ? body.context.researchMarketId.slice(0, 160) : undefined,
      researchQuestion: typeof body.context?.researchQuestion === "string" ? body.context.researchQuestion.slice(0, 500) : undefined,
      researchSummary: typeof body.context?.researchSummary === "string" ? body.context.researchSummary.slice(0, 3000) : undefined,
      researchEvidence: Array.isArray(body.context?.researchEvidence) ? body.context.researchEvidence.slice(0, 18).flatMap((raw) => {
        if (!raw || typeof raw !== "object") return [];
        const item = raw as Record<string, unknown>;
        if (typeof item.title !== "string" || typeof item.source !== "string" || typeof item.url !== "string" || typeof item.summary !== "string") return [];
        try { if (new URL(item.url).protocol !== "https:") return []; } catch { return []; }
        const directions = ["supports-yes", "supports-no", "neutral", "uncertain"];
        return [{ ...(typeof item.id === "string" ? { id: item.id.slice(0, 240) } : {}), title: item.title.slice(0, 240), source: item.source.slice(0, 120), url: item.url.slice(0, 1500), publishedAt: typeof item.publishedAt === "string" ? item.publishedAt.slice(0, 80) : null, ...(item.publishedAtPrecision === "date" ? { publishedAtPrecision: "date" as const } : item.publishedAtPrecision === "timestamp" ? { publishedAtPrecision: "timestamp" as const } : {}), ...(typeof item.retrievedAt === "string" ? { retrievedAt: item.retrievedAt.slice(0, 80) } : {}), ...(typeof item.claim === "string" ? { claim: item.claim.slice(0, 500) } : {}), summary: item.summary.slice(0, 500), direction: directions.includes(String(item.direction)) ? item.direction as "supports-yes" | "supports-no" | "neutral" | "uncertain" : "uncertain" }];
      }) : undefined,
      researchMemory: body.context?.researchMemory && typeof body.context.researchMemory === "object" ? (() => {
        const memory = body.context.researchMemory as Record<string, unknown>;
        if (typeof memory.marketId !== "string" || typeof memory.researchedAt !== "string" || typeof memory.query !== "string" || typeof memory.assessment !== "string") return undefined;
        const sourceUrls = Array.isArray(memory.sourceUrls) ? memory.sourceUrls.slice(0, 30).flatMap((value) => { try { const url = new URL(String(value)); return url.protocol === "https:" ? [url.toString().slice(0, 1500)] : []; } catch { return []; } }) : [];
        return { marketId: memory.marketId.slice(0, 160), researchedAt: memory.researchedAt.slice(0, 80), query: memory.query.slice(0, 500), assessment: memory.assessment.slice(0, 1000), keyFindings: Array.isArray(memory.keyFindings) ? memory.keyFindings.filter((item): item is string => typeof item === "string").slice(0, 10).map((item) => item.slice(0, 500)) : [], evidenceIds: Array.isArray(memory.evidenceIds) ? memory.evidenceIds.filter((item): item is string => typeof item === "string").slice(0, 30).map((item) => item.slice(0, 80)) : [], sourceUrls, uncertainties: Array.isArray(memory.uncertainties) ? memory.uncertainties.filter((item): item is string => typeof item === "string").slice(0, 10).map((item) => item.slice(0, 500)) : [] };
      })() : undefined,
    };
    // Neon is the durable memory source. The browser can supply transient UI
    // context, but an existing conversation always restores its saved state
    // before intent resolution so reloads and new requests stay consistent.
    if (context.conversationId) {
      const conversation = await getConversation(context.conversationId);
      if (!conversation) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
      const state = conversation.state && typeof conversation.state === "object" ? conversation.state as Record<string, unknown> : {};
      const hasSaved = (key: string) => Object.prototype.hasOwnProperty.call(state, key);
      const savedMessages = [...conversation.messages];
      const latest = savedMessages.at(-1);
      if (latest?.role === "user" && latest.content === question) savedMessages.pop();
      const recentMessages = savedMessages
        .filter((message) => (message.role === "user" || message.role === "assistant") && typeof message.content === "string")
        .slice(-6)
        .map((message) => ({ role: message.role as "user" | "assistant", content: message.content.slice(0, 400) }));
      const savedMarkets = Array.isArray(state.markets) ? state.markets.slice(0, 30).flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const market = item as { id?: unknown; question?: unknown };
        return typeof market.id === "string" && typeof market.question === "string" ? [{ id: market.id.slice(0, 160), question: market.question.slice(0, 500) }] : [];
      }) : [];
      const savedEvidence = Array.isArray(state.researchEvidence) ? state.researchEvidence.slice(0, 18).flatMap((raw) => {
        if (!raw || typeof raw !== "object") return [];
        const item = raw as Record<string, unknown>;
        if (typeof item.title !== "string" || typeof item.source !== "string" || typeof item.url !== "string" || typeof item.summary !== "string") return [];
        try { if (new URL(item.url).protocol !== "https:") return []; } catch { return []; }
        const directions = ["supports-yes", "supports-no", "neutral", "uncertain"];
        return [{ ...(typeof item.id === "string" ? { id: item.id.slice(0, 240) } : {}), title: item.title.slice(0, 240), source: item.source.slice(0, 120), url: item.url.slice(0, 1500), publishedAt: typeof item.publishedAt === "string" ? item.publishedAt.slice(0, 80) : null, ...(item.publishedAtPrecision === "date" ? { publishedAtPrecision: "date" as const } : item.publishedAtPrecision === "timestamp" ? { publishedAtPrecision: "timestamp" as const } : {}), ...(typeof item.retrievedAt === "string" ? { retrievedAt: item.retrievedAt.slice(0, 80) } : {}), ...(typeof item.claim === "string" ? { claim: item.claim.slice(0, 500) } : {}), summary: item.summary.slice(0, 500), direction: directions.includes(String(item.direction)) ? item.direction as "supports-yes" | "supports-no" | "neutral" | "uncertain" : "uncertain" }];
      }) : [];
      const savedMemory = state.researchMemory && typeof state.researchMemory === "object" ? state.researchMemory as Record<string, unknown> : undefined;
      const priorUserMessage = [...conversation.messages].reverse().find((message) => message.role === "user" && message.content !== question)?.content;
      context = {
        ...context,
        previousQuestion: typeof priorUserMessage === "string" ? priorUserMessage.slice(0, 500) : context.previousQuestion,
        recentMessages,
        activeMarketId: hasSaved("activeMarketId") ? typeof state.activeMarketId === "string" ? state.activeMarketId.slice(0, 160) : undefined : context.activeMarketId,
        markets: Array.isArray(state.markets) ? savedMarkets : context.markets,
        pendingTrade: hasSaved("pendingTrade") ? normalizePendingTrade(state.pendingTrade) : context.pendingTrade,
        researchMarketId: hasSaved("researchMarketId") ? typeof state.researchMarketId === "string" ? state.researchMarketId.slice(0, 160) : undefined : context.researchMarketId,
        researchQuestion: hasSaved("researchQuestion") ? typeof state.researchQuestion === "string" ? state.researchQuestion.slice(0, 500) : undefined : context.researchQuestion,
        researchSummary: hasSaved("researchSummary") ? typeof state.researchSummary === "string" ? state.researchSummary.slice(0, 3000) : undefined : context.researchSummary,
        researchEvidence: Array.isArray(state.researchEvidence) ? savedEvidence : context.researchEvidence,
        researchMemory: hasSaved("researchMemory")
          ? savedMemory && typeof savedMemory.marketId === "string" && typeof savedMemory.researchedAt === "string" && typeof savedMemory.query === "string" && typeof savedMemory.assessment === "string"
          ? { marketId: savedMemory.marketId.slice(0, 160), researchedAt: savedMemory.researchedAt.slice(0, 80), query: savedMemory.query.slice(0, 500), assessment: savedMemory.assessment.slice(0, 1000), keyFindings: Array.isArray(savedMemory.keyFindings) ? savedMemory.keyFindings.filter((value): value is string => typeof value === "string").slice(0, 10) : [], evidenceIds: Array.isArray(savedMemory.evidenceIds) ? savedMemory.evidenceIds.filter((value): value is string => typeof value === "string").slice(0, 30) : [], sourceUrls: Array.isArray(savedMemory.sourceUrls) ? savedMemory.sourceUrls.filter((value): value is string => typeof value === "string").slice(0, 30) : [], uncertainties: Array.isArray(savedMemory.uncertainties) ? savedMemory.uncertainties.filter((value): value is string => typeof value === "string").slice(0, 10) : [] }
          : undefined
          : context.researchMemory,
      };
    }
    const deterministic = classifyConversationMessage(question, context);
    const explicitResearchFollowup = Boolean(context.researchSummary) && /\b(?:what supports? (?:yes|no)|what(?:'s| is) working against|supporting signals?|opposing signals?|what does the latest research)\b/i.test(question);
    const explicitSubject = extractExplicitSubject(question);
    // Greetings, help, and an explicit cancellation are already unambiguous
    // deterministic turns. Keep them off the model path to avoid a needless
    // Groq request while preserving Groq interpretation for market language.
    const modelIntent = !shouldInterpretWithGroq(deterministic, context)
      ? null
      : await understandMessage(question, {
      previousQuestion: context.previousQuestion?.slice(0, 250), recentMessages: context.recentMessages?.slice(-6), markets: context.markets?.slice(0, 8), activeMarketId: context.activeMarketId,
      pendingTrade: context.pendingTrade, researchMarketId: context.researchMarketId, researchQuestion: context.researchQuestion,
      researchSummary: context.researchSummary?.slice(0, 1000),
      researchEvidence: context.researchEvidence?.slice(0, 4).map(({ title, source, publishedAt, summary, direction }) => ({ title, source, publishedAt, summary: summary.slice(0, 250), direction })),
    });
    let decision: ConversationDecision = deterministic;
    if (modelIntent) {
      const reference = modelIntent.marketReference;
      const ordinalValue = reference?.type === "ordinal" ? ({ first: 1, second: 2, third: 3, fourth: 4, fifth: 5 } as Record<string, number>)[reference.value?.toLowerCase() ?? ""] ?? Number(reference.value) : Number.NaN;
      const referencedMarket = reference?.type === "id"
        ? context.markets?.find((market) => market.id === reference.value)
        : reference?.type === "ordinal"
          ? Number.isInteger(ordinalValue) && ordinalValue > 0 ? context.markets?.[ordinalValue - 1] : undefined
          : reference?.type === "active" ? context.markets?.find((market) => market.id === context.activeMarketId) : undefined;
      // Preserve the existing deterministic trade interpretation where the model did not
      // return a complete, bounded trade request. The model can never authorize submission.
      const isTrade = modelIntent.intent === "trade_request";
      decision = {
        intent: modelIntent.intent,
        // The model's explicit tool decision is authoritative for ordinary
        // conversation. In particular, a stale workspace selection cannot
        // turn a teaching/example follow-up into a market fetch. Trade
        // preparation remains constrained by deterministic outcome/amount
        // parsing and still never submits a transaction.
        requiresMarketData: isTrade
          ? Boolean((modelIntent.tradeOutcome ?? deterministic.tradeOutcome) && (modelIntent.tradeAmountUsdc ?? deterministic.tradeAmountUsdc))
          : modelIntent.requiresMarketData && !["greeting", "help", "general", "clarification", "trade_cancel"].includes(modelIntent.intent),
        reply: modelIntent.reply,
        marketId: referencedMarket?.id ?? (modelIntent.intent === "research" ? context.researchMarketId : undefined),
        marketQuestion: referencedMarket?.question ?? context.researchQuestion,
        analysisQuestion: modelIntent.analysisQuestion ?? question,
        spotAsset: modelIntent.spotAsset,
        tradeOutcome: modelIntent.tradeOutcome ?? (isTrade ? deterministic.tradeOutcome : undefined),
        tradeAmountUsdc: modelIntent.tradeAmountUsdc ?? (isTrade ? deterministic.tradeAmountUsdc : undefined),
        tradeMarketQuery: modelIntent.tradeMarketQuery ?? (isTrade ? deterministic.tradeMarketQuery : undefined),
        tradeQuestion: isTrade ? question : undefined,
        pendingTradeDraft: isTrade && (!modelIntent.tradeOutcome || !modelIntent.tradeAmountUsdc) ? deterministic.pendingTradeDraft : undefined,
        comparisonSubjects: modelIntent.comparisonSubjects,
        comparisonDimension: modelIntent.comparisonDimension,
      };
      // Never let a model reinterpret an in-progress cancellation or an already parsed
      // explicit trade correction as an unrelated request.
      const explicitTopicSwitch = deterministic.intent === "market_discovery" && /\b(?:forget|ignore|drop)\b/i.test(question);
      const contextualInterest = deterministic.intent === "market_analysis" && /\b(most interesting|which one.*interesting|which .*looks? .*interesting)\b/i.test(question);
      const deterministicComparison = deterministic.intent === "market_analysis" && /\b(compare|versus|vs\.?)\b/i.test(question) && ((question.match(/\b(bitcoin|btc|ethereum|eth|fed|federal reserve|trump|election|inflation|cpi)\b/gi)?.length ?? 0) > 1 || /\b(first|1st|one|second|2nd|two|third|3rd|three|fourth|4th|four|fifth|5th|five)\b/i.test(question));
      if (deterministic.intent === "trade_cancel" || deterministic.intent === "trade_request" || deterministic.intent === "research" || (deterministic.intent === "clarification" && !context.recentMessages?.length) || deterministic.intent === "market_intelligence" || explicitTopicSwitch || contextualInterest || deterministicComparison) decision = deterministic;
      // A current correction that explicitly switches a resolved comparison to
      // actual activity must not be downgraded to detail on the stale selected
      // market, even if the model's broad intent label is imperfect.
      if (modelIntent.comparisonDimension === "activity" && (modelIntent.comparisonSubjects?.length ?? 0) >= 2) {
        decision = { ...decision, intent: "market_analysis", requiresMarketData: true, marketId: undefined, marketQuestion: undefined, comparisonSubjects: modelIntent.comparisonSubjects, comparisonDimension: "activity" };
      }
    }
    const aiMode = modelIntent ? "groq" : "limited";
    const implicitFollowup = /\b(?:it|that|those|them|there|same|why|example|more simply|actually|i meant|you misunderstood)\b/i.test(question);
    const explicitMarketTarget = /\b(?:this market|that market|selected market|panta|prediction market|market data|order book|live price|current price|find markets|search markets|research)\b/i.test(question);
    if (!modelIntent && context.recentMessages?.length && implicitFollowup && !explicitMarketTarget && decision.marketId && decision.marketId === context.activeMarketId) {
      // On model failure, do not let a contextual pronoun or correction fall
      // back to whichever market happens to be selected in the workspace.
      decision = { intent: "clarification", requiresMarketData: false, reply: "MIRA’s language model is unavailable, so I can’t safely resolve that follow-up from the conversation right now. I haven’t queried the selected market; please retry shortly." };
    }
    const asksOrderBook = decision.requiresMarketData && asksForMarketReasoning(question) && !explicitResearchFollowup && !explicitSubject && decision.intent !== "research";
    const orderBookMarketId = decision.marketId
      ?? (!explicitSubject ? context.activeMarketId ?? (context.markets?.length === 1 ? context.markets[0]?.id : undefined) : undefined);
    const orderBookSnapshot = asksOrderBook && orderBookMarketId ? await getPantaOrderBookSnapshot(orderBookMarketId) : null;
    const microstructure = orderBookSnapshot ? await getSnapshotMicrostructure(orderBookSnapshot).catch(() => null) : null;
    if (asksOrderBook && decision.intent !== "market_intelligence") {
      if (!orderBookSnapshot) return NextResponse.json({ intent: "market_detail", reply: "Select one Panta market first so I can inspect its verified on-chain order book.", aiMode });
      const market = await getMarketProvider().getMarket(orderBookMarketId!);
      if (!market || market.source !== "panta") return NextResponse.json({ intent: "market_detail", reply: "I can’t assemble verified Panta reasoning for this selected market.", orderBook: orderBookSnapshot, microstructure, source: orderBookSnapshot.source, aiMode });
      const [historyResult, researchResult] = await Promise.allSettled([getPantaMicrostructureHistory(market.id, { limit: 500 }), getLatestMarketResearch(market.id)]);
      const history = historyResult.status === "fulfilled" ? historyResult.value : [];
      const reasoning = buildMarketReasoning({ market, snapshot: orderBookSnapshot, microstructure, history, historyStatus: historyResult.status === "rejected" ? "unavailable" : history.length ? "available" : "not-observed", research: researchResult.status === "fulfilled" ? researchResult.value.evidence : [], researchStatus: researchResult.status === "rejected" ? "unavailable" : researchResult.value.status });
      const narrative = market.status === "resolved" ? reasoning.explanation : await explainMarketReasoning(question, reasoning).catch(() => null) ?? reasoning.explanation;
      const reply = /\b(order\s*book|bids?\b|asks?\s+(?:side|at|for)|spread\b|visible depth|order depth|imbalance|microstructure|market structure)\b/i.test(question) ? `${narrative}\n\n${summarizeOrderBookForMira(orderBookSnapshot, microstructure)}` : narrative;
      return NextResponse.json({ intent: "market_detail", reply, reasoning, orderBook: orderBookSnapshot, microstructure, source: orderBookSnapshot.source, aiMode });
    }
    if (!decision.requiresMarketData) return NextResponse.json({ intent: decision.intent, reply: decision.reply ?? "What would you like to explore?", pendingTradeDraft: decision.pendingTradeDraft ?? (decision.intent === "trade_cancel" ? null : undefined), aiMode });
    if (decision.intent === "spot_price" && decision.spotAsset) {
      const price = await getSpotPrice(decision.spotAsset);
      if (price === null) {
        return NextResponse.json({ intent: decision.intent, reply: "I couldn’t retrieve a live spot quote right now. Please try again shortly.", aiMode });
      }
      const formattedPrice = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(price);
      const assetName = decision.spotAsset === "BTC" ? "Bitcoin" : "Ethereum";
      return NextResponse.json({
        intent: decision.intent,
        aiMode,
        reply: "Kraken’s " + decision.spotAsset + "/USD spot ticker reports " + assetName + " at " + formattedPrice + " as of " + new Date().toISOString() + ". This is an exchange-specific last-traded price, not a prediction-market YES/NO price.",
      });
    }

    const provider = getMarketProvider();
    const asksVerifiedActivity = decision.intent === "market_analysis"
      && (decision.comparisonDimension === "activity" || /\b(?:trading activity|trade activity|matched trade activity|actual trades?)\b/i.test(question));
    if (asksVerifiedActivity) {
      const subjects = [...new Set((decision.comparisonSubjects ?? []).map((subject) => subject.trim()).filter(Boolean))].slice(0, 2);
      if (subjects.length < 2) return NextResponse.json({ intent: "clarification", reply: "I understand you want to compare actual trading activity, but I could not resolve both subjects from the conversation. Which two subjects should I compare?", aiMode });
      const activityComparison = await compareVerifiedActivity({ subjects, provider, getSnapshot: getPantaOrderBookSnapshot });
      return NextResponse.json({ intent: decision.intent, reply: activityComparison.answer, activityComparison, source: provider.source, environment: provider.environment ?? "unknown", aiMode });
    }
    if (decision.intent === "market_intelligence") {
      const marketId = decision.marketId ?? context.researchMarketId ?? context.activeMarketId ?? context.markets?.[0]?.id;
      if (!marketId) return NextResponse.json({ intent: "clarification", reply: "Select a market first and I’ll assemble its current prices, order book, activity, research, related-market context, and uncertainty.", aiMode });
      if (request.headers.get("accept")?.includes("text/event-stream")) {
        return createMarketIntelligenceStream(async (onProgress) => {
          const result = await assembleMarketIntelligence({ marketId, question, context, onProgress });
          return { intent: decision.intent, market: result.market ?? undefined, reply: result.intelligence.answer, marketIntelligence: result.intelligence, source: provider.source, environment: provider.environment ?? "unknown", aiMode: result.intelligence.explanationMode === "groq" ? "groq" : "limited" };
        });
      }
      const result = await assembleMarketIntelligence({ marketId, question, context });
      return NextResponse.json({ intent: decision.intent, market: result.market ?? undefined, reply: result.intelligence.answer, marketIntelligence: result.intelligence, source: provider.source, environment: provider.environment ?? "unknown", aiMode: result.intelligence.explanationMode === "groq" ? "groq" : "limited" });
    }
    const asksCrossMarket = decision.intent === "market_analysis" && /\b(related markets?|moving together|moving differently|diverg\w*|same event|shared news|both markets|these markets|they moving|they move)\b/i.test(question);
    if (asksCrossMarket) {
      const listed = context.markets ?? [];
      const primaryRef = listed.find((item) => item.id === context.activeMarketId) ?? listed[0];
      if (!primaryRef) return NextResponse.json({ intent: decision.intent, reply: "Select a market or show me the two market names you want compared.", aiMode });
      const primary = await provider.getMarket(primaryRef.id);
      if (!primary) return NextResponse.json({ intent: decision.intent, reply: "I could not retrieve the selected market from Panta, so I cannot compare it yet.", aiMode });
      let relatedRefs = listed.filter((item) => item.id !== primary.id);
      if (!relatedRefs.length) {
        const candidates = primary.relatedMarketIds.length
          ? await Promise.all(primary.relatedMarketIds.slice(0, 6).map(async (id) => provider.getMarket(id).catch(() => null)))
          : (await provider.discoverMarkets(primary.question).catch(() => [])).filter((item) => item.id !== primary.id).slice(0, 4);
        relatedRefs = candidates.filter((item): item is NonNullable<typeof item> => Boolean(item)).map(({ id, question }) => ({ id, question }));
      }
      const related = (await Promise.all(relatedRefs.slice(0, 6).map(async (item) => provider.getMarket(item.id).catch(() => null)))).filter((item): item is NonNullable<typeof item> => Boolean(item));
      await Promise.all([primary, ...related].map((market) => persistMarketObservation(market).catch(() => undefined)));
      const enriched = await Promise.all([primary, ...related].map(async (market) => {
        if (market.source !== "panta") return market;
        const saved = await getPantaMicrostructureHistory(market.id, { limit: 500 }).catch(() => []);
        const points = saved.flatMap((snapshot) => snapshot.pantaReference.observedAt && snapshot.pantaReference.yesPrice !== null
          ? [{ timestamp: snapshot.pantaReference.observedAt, yesProbability: snapshot.pantaReference.yesPrice }]
          : []);
        return mergeMarketHistory(market, points);
      }));
      const [primaryWithHistory, ...relatedWithHistory] = enriched;
      const crossMarketReport = buildCrossMarketReport({ primaryMarket: primaryWithHistory!, relatedMarkets: relatedWithHistory });
      const first = crossMarketReport.relatedMarkets[0];
      const movementText = first
        ? first.movement.status === "insufficient"
          ? "I do not have enough timestamped observations to establish whether the markets moved together."
          : `The available timestamped changes are ${first.movement.status}; timing is ${first.movement.timingAlignment.status}. This describes observed movement and does not establish causation.`
        : "I could not retrieve a related comparison market.";
      const relationshipText = first ? `The strongest available comparison is “${first.market.question}”: ${first.relationship.type} (${first.relationship.confidence} relationship confidence).` : "No related comparison was available.";
      const uncertaintyText = first?.uncertainty.length ? ` ${first.uncertainty.join(" ")}` : "";
      const historicalText = primary.status === "resolved" || first?.market.status === "resolved" ? " At least one market is resolved; those values are historical context only." : "";
      const reply = `${relationshipText} ${movementText}${uncertaintyText}${historicalText}`;
      return NextResponse.json({ intent: decision.intent, reply, crossMarketReport, source: provider.source, environment: provider.environment ?? "unknown", aiMode });
    }
    const asksRelativeInterest = /\b(most interesting|which one.*interesting|which .*looks? .*interesting)\b/i.test(question);
    if (decision.intent === "market_analysis" && asksRelativeInterest && context.markets?.length) {
      const observed = (await Promise.all(context.markets.slice(0, 12).map(async (item) => provider.getMarket(item.id).catch(() => null)))).filter((market): market is NonNullable<typeof market> => market !== null);
      await Promise.all(observed.map((market) => persistMarketObservation(market).catch(() => undefined)));
      const active = observed.filter((market) => market.status === "active");
      if (!active.length) {
        const resolved = observed.filter((market) => market.status === "resolved").length;
        const reply = resolved === observed.length && resolved > 0
          ? `The ${resolved} markets in the list are resolved, so there isn’t a current market to rank. Their reported prices and volume are historical; they don’t indicate a live opportunity.`
          : "I can’t rank these as current markets because Panta did not confirm any of the listed markets as active.";
        return NextResponse.json({ intent: decision.intent, reply, source: provider.source, environment: provider.environment ?? "unknown", aiMode });
      }
      const movements = active.map((market) => calculateMovement(market, "24h")).filter((movement): movement is NonNullable<typeof movement> => movement !== null);
      const rankings = rankMarkets(question, active, movements, extractMarketIntent(question)).sort((a, b) => b.relevanceScore - a.relevanceScore);
      const topRank = rankings[0];
      const top = topRank ? active.find((market) => market.id === topRank.marketId) : undefined;
      const hasComparableSignal = active.some((market) => (market.volumeUsd ?? 0) > 0 || (market.liquidityUsd ?? 0) > 0) || movements.length > 0;
      if (!top || !hasComparableSignal) {
        return NextResponse.json({ intent: decision.intent, reply: "Panta confirms these markets are active, but the list doesn’t provide enough comparable activity or price-history data to say which is most interesting. That would be a judgment call, not evidence of value.", source: provider.source, environment: provider.environment ?? "unknown", aiMode });
      }
      const basis = top.volumeUsd !== null ? `Panta reports ${top.volumeUsd} USDC in volume` : top.liquidityUsd !== null ? `Panta reports ${top.liquidityUsd} USDC in liquidity` : "Panta returned a measurable price-history signal";
      const yes = top.yesProbability === null ? "unavailable" : `${(top.yesProbability * 100).toFixed(1)}%`;
      return NextResponse.json({ intent: decision.intent, market: top, reply: `Of the active markets we discussed, “${top.question}” stands out on the available activity data: ${basis}. Panta currently reports YES at ${yes}. That makes it the most notable by these provider signals, not a claim that it is profitable or mispriced.`, source: provider.source, environment: provider.environment ?? "unknown", aiMode });
    }
    if (decision.intent === "research") {
      const refreshText = question.toLowerCase().replace(/[’]/g, "'");
      const forceFresh = modelIntent?.refreshResearch === true || /\b(what'?s changed|what has changed|what changed|has anything changed|anything new|what'?s new|research again|update(?: this)? research|refresh this|since yesterday|since i last checked|since your last analysis|check the latest|latest news|latest development|what happened today|give me the timeline|is that confirmed|which sources confirm|are sources disagreeing|how does this relate to the market|what markets are affected)\b/i.test(refreshText);
      const asksWhatChanged = /\b(what'?s changed|what has changed|what changed|has anything changed|since i last checked|since your last analysis)\b/i.test(refreshText);
      const opposing = /\b(against\s+yes|argument against|evidence against|case against|strongest.*no|other side|supports?\s+no|for\s+no)\b/i.test(refreshText);
      const supporting = /\b(for\s+yes|evidence for|supports?\s+yes|case for|strongest.*yes)\b/i.test(refreshText);
      if (/\b(what did you find earlier|previous research|what did you find before)\b/i.test(refreshText) && context.researchMemory) {
        const memory = context.researchMemory;
        return NextResponse.json({ intent: decision.intent, reply: `In the prior research on “${context.researchQuestion ?? memory.query}” (${new Date(memory.researchedAt).toLocaleString()}), my assessment was: ${memory.assessment}\n\nKey findings: ${memory.keyFindings.length ? memory.keyFindings.join("; ") : "No key findings were retained."}\n\nThose are saved conclusions from the previous report; they are not new evidence.`, source: provider.source, environment: provider.environment ?? "unknown", aiMode });
      }
      if (asksWhatChanged && !context.researchMemory && !context.researchSummary) {
        const market = explicitSubject
          ? (context.markets ?? []).find((item) => item.id === decision.marketId)
          : (context.markets ?? []).find((item) => item.id === (decision.marketId ?? context.activeMarketId));
        const subject = market?.question ?? explicitSubject;
        const reply = market
          ? `I don’t have an earlier research run for “${market.question}” to compare against. Would you like me to research it now?`
          : subject
            ? `I don’t have an earlier research run for “${subject}” to compare against. Would you like me to research it now?`
          : "I don’t have an earlier research run to compare against, and I’m not sure which market you mean. Which market should I research?";
        return NextResponse.json({ intent: decision.intent, reply, source: provider.source, environment: provider.environment ?? "unknown", aiMode });
      }
      const sourceFollowup = /\b(which|what) source supports? (that|this|it)\b/i.test(refreshText);
      if (!forceFresh && sourceFollowup && context.researchSummary) {
        if (!context.researchEvidence?.length) {
          return NextResponse.json({ intent: decision.intent, reply: "The prior research report did not retain a citable source for that point. I won’t invent one; ask me to refresh the research if you want a new search.", source: provider.source, environment: provider.environment ?? "unknown", aiMode });
        }
        const selected = context.researchEvidence.find((item) => item.direction === "supports-yes" || item.direction === "supports-no") ?? context.researchEvidence[0];
        const reply = `The source I can point to from the prior report is “${selected.title}” (${selected.source}${selected.publishedAt ? `, published ${new Date(selected.publishedAt).toLocaleDateString()}` : ", publication date unavailable"}). ${selected.summary} This is evidence from the retrieved report, not proof of the outcome.`;
        return NextResponse.json({ intent: decision.intent, reply, sourceLink: { title: selected.title, url: selected.url }, source: provider.source, environment: provider.environment ?? "unknown", aiMode });
      }
      if (!forceFresh && (opposing || supporting) && context.researchSummary) {
        const candidates = (context.researchEvidence ?? []).filter((item) => item.direction === (opposing ? "supports-no" : "supports-yes"));
        const selected = candidates[0];
        const reply = selected
          ? `From the research already retrieved, the strongest available evidence supporting ${opposing ? "NO" : "YES"} is “${selected.title}” from ${selected.source}${selected.publishedAt ? `, published ${new Date(selected.publishedAt).toLocaleDateString()}` : ", publication date unavailable"}. The retrieved description says: ${selected.summary} This is reported evidence, not proof of the market outcome. Its source is linked in the research report above.`
          : `The prior research did not retrieve a source classified as ${opposing ? "supporting NO" : "supporting YES"}. I don't have enough evidence from that report to state a strong argument; ask me to refresh the research for a new search.`;
        return NextResponse.json({ intent: decision.intent, reply, source: provider.source, environment: provider.environment ?? "unknown", aiMode });
      }
      const researchSubjectId = context.researchMemory?.marketId ?? context.researchMarketId;
      const sameResearchSubject = explicitSubject
        ? Boolean(decision.marketId && decision.marketId === researchSubjectId)
        : true;
      const priorEvidence = sameResearchSubject
        ? context.researchEvidence?.map((item) => ({ url: item.url, id: item.id, title: item.title, claim: item.claim ?? item.summary, summary: item.summary, publishedAt: item.publishedAt, retrievedAt: item.retrievedAt })) ?? context.researchMemory?.sourceUrls?.map((url) => ({ url }))
        : [];
      const report = await runResearch({ question: decision.analysisQuestion ?? question, contextMarkets: context.markets ?? [], marketId: decision.marketId ?? (explicitSubject ? undefined : context.researchMarketId), provider, refresh: forceFresh, priorEvidence, priorResearchAt: sameResearchSubject ? context.researchMemory?.researchedAt : undefined, signal: request.signal });
      if (request.signal.aborted) return NextResponse.json({ error: "Research request was cancelled.", errorCode: "cancelled" }, { status: 499 });
      if (report.market) await persistMarketObservation(report.market).catch(() => undefined);
      await persistResearch(report, typeof body.context?.conversationId === "string" ? body.context.conversationId : undefined).catch(() => undefined);
      const marketIntelligence = asksForMarketIntelligence(question) && report.market
        ? (await assembleMarketIntelligence({ marketId: report.market.id, question, context, researchReport: report })).intelligence
        : undefined;
      return NextResponse.json({ intent: decision.intent, researchReport: report, marketIntelligence, reply: marketIntelligence?.answer, source: provider.source, environment: provider.environment ?? "unknown", aiMode: marketIntelligence?.explanationMode === "groq" ? "groq" : aiMode });
    }
    if (decision.intent === "trade_request") {
      const market = decision.marketId ? await provider.getMarket(decision.marketId) : null;
      const normalizedTradeMarketQuery = decision.tradeMarketQuery?.trim();
      const tradeMarketQuery = normalizedTradeMarketQuery && /[\p{L}\p{N}]/u.test(normalizedTradeMarketQuery) ? normalizedTradeMarketQuery : undefined;
      if (!market && tradeMarketQuery) {
        const candidates = await provider.discoverMarkets(tradeMarketQuery);
        const ranked = candidates.map((candidate) => ({ market: candidate, score: semanticRelevance(tradeMarketQuery, candidate) }))
          .filter((item) => item.score > 0 && isTradeEligibleMarket(item.market))
          .sort((a, b) => b.score - a.score || a.market.id.localeCompare(b.market.id));
        // Search relevance narrows the candidate list; it does not establish
        // the exact contract the user intends to trade. Require an explicit
        // selection before asking about outcome/size or preparing a quote.
        if (ranked.length) return NextResponse.json({ intent: decision.intent, reply: "I found these matching Panta markets. Which one do you mean?", tradeChoices: ranked.slice(0, 5).map((item) => item.market), pendingTradeDraft: { ...decision.pendingTradeDraft, outcome: decision.tradeOutcome ?? decision.pendingTradeDraft?.outcome, amountUsdc: decision.tradeAmountUsdc ?? decision.pendingTradeDraft?.amountUsdc, marketQuery: tradeMarketQuery }, aiMode });
        else return NextResponse.json({ intent: decision.intent, reply: `I couldn’t find a currently tradeable Panta market matching “${tradeMarketQuery}”. Resolved, closed, expired, or unverified listings can’t be used for a trade. You can ask me to research past markets separately.`, pendingTradeDraft: null, aiMode });
      }
      if (!market) return NextResponse.json({ intent: decision.intent, reply: "Sure. Which market would you like to trade?", pendingTradeDraft: { ...(decision.pendingTradeDraft ?? { outcome: decision.tradeOutcome, amountUsdc: decision.tradeAmountUsdc }), marketQuery: undefined }, aiMode });
      if (!isTradeEligibleMarket(market)) return NextResponse.json({ intent: decision.intent, reply: `${tradeIneligibilityReason(market)}${market.phase === "secondary" ? ` Market: “${market.question}” (${market.id}).` : ` Market: “${market.question}”.`}`, pendingTradeDraft: null, aiMode });
      if (!decision.tradeOutcome) return NextResponse.json({ intent: decision.intent, reply: "Would you like to buy YES or NO?", pendingTradeDraft: { ...decision.pendingTradeDraft, marketId: market.id, marketQuestion: market.question, marketQuery: undefined }, aiMode });
      if (!Number.isFinite(decision.tradeAmountUsdc) || (decision.tradeAmountUsdc ?? 0) <= 0 || Number((decision.tradeAmountUsdc ?? 0).toFixed(2)) !== decision.tradeAmountUsdc) return NextResponse.json({ intent: decision.intent, reply: "How much would you like to spend in USDC? Enter a positive amount with up to two decimal places.", pendingTradeDraft: { ...decision.pendingTradeDraft, marketId: market.id, marketQuestion: market.question, outcome: decision.tradeOutcome, amountUsdc: undefined, marketQuery: undefined }, aiMode });
      return NextResponse.json({
        intent: decision.intent,
        aiMode,
        tradeRequest: { market, outcome: decision.tradeOutcome, amountUsdc: decision.tradeAmountUsdc, source: provider.source, environment: provider.environment ?? "unknown" },
        source: provider.source,
        environment: provider.environment ?? "unknown",
        reply: "I’m checking this with Panta before you commit. The trade is not placed unless you confirm it in the wallet.",
      });
    }
    if (decision.intent === "market_detail") {
      const market = decision.marketId ? await provider.getMarket(decision.marketId) : null;
      if (!market) return NextResponse.json({ intent: "clarification", reply: "I couldn’t retrieve that market’s details. Which market would you like me to look at?", source: provider.source, aiMode });
      await persistMarketObservation(market).catch(() => undefined);
      return NextResponse.json({ intent: decision.intent, reply: answerMarketDetail(question, market), market, source: market.source, environment: provider.environment ?? "unknown", aiMode });
    }

    const data = await analyzeMarketQuestion(decision.analysisQuestion ?? question, provider);
    await Promise.all(data.markets.map((market) => persistMarketObservation(market).catch(() => undefined)));
    return NextResponse.json({ intent: decision.intent, data: { ...data, query: question }, source: provider.source, environment: provider.environment ?? "unknown", updatedAt: data.createdAt, aiMode });
  } catch (error) {
    if (request.signal.aborted || error instanceof Error && error.name === "AbortError") return NextResponse.json({ error: "Analysis request was cancelled.", errorCode: "cancelled" }, { status: 499 });
    if (error instanceof PantaError) return NextResponse.json({ error: error.message, errorCode: error.status === 504 ? "timeout" : "panta_unavailable" }, { status: error.status ?? 502 });
    if (error instanceof Error && error.name === "TimeoutError") return NextResponse.json({ error: "Analysis timed out while waiting for an upstream source.", errorCode: "timeout" }, { status: 504 });
    return NextResponse.json({ error: "Analysis could not be completed.", errorCode: "analysis_unavailable" }, { status: 502 });
  }
}
