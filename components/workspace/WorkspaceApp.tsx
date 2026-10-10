"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Bookmark, CircleHelp, Command, Leaf, ListFilter, Menu, RefreshCw, Search, Sparkles, Sprout } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { DaylightWorld } from "@/components/environment/DaylightWorld";
import { AnalysisMessage } from "@/components/ai/AnalysisBlocks";
import { ResearchReportView } from "@/components/ai/ResearchReport";
import type { ResearchReport } from "@/lib/research/types";
import type { ResearchMemory } from "@/lib/research/types";
import type { MarketIntelligenceResult } from "@/lib/intelligence/market-intelligence";
import { MarketIntelligenceView } from "@/components/markets/MarketIntelligenceView";
import { MarketCard } from "@/components/markets/MarketCard";
import { MarketIntelPanel } from "@/components/markets/MarketIntelPanel";
import { MiraInvestigation } from "@/components/mira/MiraInvestigation";
import { MiraCharacter } from "@/components/mira/MiraCharacter";
import type { MiraState } from "@/components/mira/miraStates";
import { HomeExperience } from "@/components/workspace/HomeExperience";
import { Composer } from "@/components/workspace/Composer";
import { rankMarketSuggestions } from "@/lib/intelligence/market-suggestions";
import { WorkspaceSidebar, type WorkspaceView } from "@/components/navigation/WorkspaceSidebar";
import { WalletButton } from "@/components/wallet/WalletButton";
import { TradeTicket } from "@/components/wallet/TradeTicket";
import { isDatabaseTemporarilyUnavailable } from "@/lib/db/api-error";
import type { AnalysisResult, Market, PantaEnvironment, Position } from "@/lib/panta/types";
import { isSecondaryTradeEligibleMarket } from "@/lib/panta/trade-safety";
import { classifyConversationMessage, type ConversationContext, type ConversationIntent, type PendingTradeDraft } from "@/lib/intelligence/conversation";
import type { SolanaWallet } from "@/lib/wallet/types";

export type AnalysisHistoryItem = { id: string; query: string; createdAt: string };
type ProviderMode = "demo" | "panta";
const WATCHLIST_KEY = "mira.watchlist.v1";
const RESEARCH_MEMORY_KEY = "mira.research-memory.v1";
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type ConversationTurn = {
  id: string;
  userMessage: string;
  reply?: string;
  sourceLink?: { title: string; url: string };
  analysis?: AnalysisResult;
  tradeChoices?: Market[];
  market?: Market;
  webResearch?: NonNullable<AnalysisResult["webResearch"]>;
  researchReport?: ResearchReport;
  marketIntelligence?: MarketIntelligenceResult;
  pending: boolean;
  requiresMarketData: boolean;
};
type RetryableTurn = { content: string; conversationId: string; userMessageId: string; assistantMessageId: string };

async function responseError(response: Response, fallback: string): Promise<string> {
  const payload = await response.json().catch(() => ({})) as { error?: unknown };
  return typeof payload.error === "string" ? payload.error : `${fallback} (HTTP ${response.status}).`;
}

async function isTransientDatabaseResponse(response: Response): Promise<boolean> {
  const payload = await response.clone().json().catch(() => null);
  return isDatabaseTemporarilyUnavailable(response, payload);
}

export function WorkspaceApp({ providerMode: initialProviderMode, providerEnvironment: initialEnvironment = "unknown" }: { providerMode: ProviderMode; providerEnvironment?: PantaEnvironment }) {
  const [providerMode, setProviderMode] = useState(initialProviderMode);
  const [providerEnvironment, setProviderEnvironment] = useState<PantaEnvironment>(initialEnvironment);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [view, setView] = useState<WorkspaceView>("analysis");
  const [prompt, setPrompt] = useState("");
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [conversationTurns, setConversationTurns] = useState<ConversationTurn[]>([]);
  const [activeTurnId, setActiveTurnId] = useState("");
  const [revealedMarkets, setRevealedMarkets] = useState<Market[]>([]);
  const [investigationQuestion, setInvestigationQuestion] = useState("");
  const [history, setHistory] = useState<AnalysisHistoryItem[]>([]);
  const [researchMemory, setResearchMemory] = useState<ResearchMemory[]>([]);
  const [markets, setMarkets] = useState<Market[]>([]);
  const [marketStatus, setMarketStatus] = useState<"loading" | "ready" | "error">("loading");
  const [marketError, setMarketError] = useState("");
  const [wallet, setWallet] = useState<SolanaWallet | null>(null);
  const [walletAddress, setWalletAddress] = useState("");
  const [watchedIds, setWatchedIds] = useState<Set<string>>(new Set());
  const [activeMarket, setActiveMarket] = useState<Market | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailWarning, setDetailWarning] = useState("");
  const [ticket, setTicket] = useState<{ market: Market; outcome: "YES" | "NO"; amountUsd?: number; autoPrepare?: boolean } | null>(null);
  const [pendingTradeDraft, setPendingTradeDraft] = useState<PendingTradeDraft | null>(null);
  const [thinking, setThinking] = useState(false);
  const [thinkingStep, setThinkingStep] = useState("Finding market signals");
  const [analysisError, setAnalysisError] = useState("");
  const [storageWarning, setStorageWarning] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<"conversation" | "intelligence">("conversation");
  const [marketSearch, setMarketSearch] = useState("");
  const [portfolio, setPortfolio] = useState<Position[]>([]);
  const [portfolioState, setPortfolioState] = useState<"idle" | "loading" | "error" | "ready">("idle");
  const [portfolioError, setPortfolioError] = useState("");
  const [miraState, setMiraState] = useState<MiraState>("greeting");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const analysisAbortController = useRef<AbortController | null>(null);
  const preferencesLoaded = useRef(false);
  const marketRequestId = useRef(0);
  const detailRequestId = useRef(0);
  const conversationId = useRef("");
  const retryableTurn = useRef<RetryableTurn | null>(null);
  const savedState = useRef<Record<string, unknown>>({});

  useEffect(() => () => { analysisAbortController.current?.abort(); }, []);

  const refreshMarkets = useCallback(async (query = "") => {
    const requestId = ++marketRequestId.current;
    setMarketStatus("loading");
    setMarketError("");
    try {
      const response = await fetch(`/api/markets${query.trim() ? `?q=${encodeURIComponent(query.trim())}` : ""}`, { cache: "no-store" });
      const payload = await response.json() as { data?: Market[]; source?: ProviderMode; environment?: PantaEnvironment; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Market provider could not be reached.");
      if (requestId !== marketRequestId.current) return;
      const found = payload.data ?? [];
      setMarkets(found);
      // Catalog order is not user intent. Keep an explicitly focused market,
      // but never turn the first discovered row into the active trade market.
      setActiveMarket((current) => current ? found.find((market) => market.id === current.id) ?? current : null);
      setMarketStatus("ready");
      setProviderMode(payload.source ?? initialProviderMode);
      setProviderEnvironment(payload.environment ?? initialEnvironment);
    } catch (error) {
      if (requestId !== marketRequestId.current) return;
      setMarketStatus("error");
      setMarketError(error instanceof Error ? error.message : "Markets could not be loaded.");
      setMarkets([]);
      setActiveMarket(null);
    }
  }, [initialEnvironment, initialProviderMode]);

  useEffect(() => {
    let storedWatchlist: string[] = [];
    let storedResearchMemory: ResearchMemory[] = [];
    try {
      storedWatchlist = JSON.parse(localStorage.getItem(WATCHLIST_KEY) ?? "[]") as string[];
      storedResearchMemory = JSON.parse(localStorage.getItem(RESEARCH_MEMORY_KEY) ?? "[]") as ResearchMemory[];
    } catch { /* Corrupt local preferences do not block the workspace. */ }
    const preferenceTask = window.setTimeout(() => {
      setWatchedIds(new Set(storedWatchlist));
      setResearchMemory(storedResearchMemory.filter((item) => item && typeof item.marketId === "string").slice(0, 20));
      preferencesLoaded.current = true;
    }, 0);
    const marketTask = window.setTimeout(() => { void refreshMarkets(); }, 0);
    const historyTask = window.setTimeout(() => {
      void fetch("/api/conversations", { cache: "no-store" }).then(async (response) => {
        if (!response.ok) return;
        const payload = await response.json() as { conversations?: Array<{ id: string; latest_message?: string | null; title?: string | null; created_at: string }> };
        setHistory((payload.conversations ?? []).map((item) => ({ id: item.id, query: item.latest_message || item.title || "Conversation", createdAt: item.created_at })));
      }).catch(() => { /* Database history is optional when unavailable. */ });
    }, 0);
    return () => {
      window.clearTimeout(preferenceTask);
      window.clearTimeout(marketTask);
      window.clearTimeout(historyTask);
    };
  }, [refreshMarkets]);

  useEffect(() => {
    if (!workspaceOpen || view !== "markets") return;
    const task = window.setTimeout(() => { void refreshMarkets(marketSearch); }, 320);
    return () => window.clearTimeout(task);
  }, [marketSearch, refreshMarkets, view, workspaceOpen]);

  useEffect(() => { if (preferencesLoaded.current) localStorage.setItem(WATCHLIST_KEY, JSON.stringify([...watchedIds])); }, [watchedIds]);
  useEffect(() => { if (preferencesLoaded.current) localStorage.setItem(RESEARCH_MEMORY_KEY, JSON.stringify(researchMemory.slice(0, 20))); }, [researchMemory]);

  const onWallet = useCallback((nextWallet: SolanaWallet | null) => {
    setWallet(nextWallet);
    setWalletAddress(nextWallet?.publicKey?.toBase58() ?? "");
  }, []);

  const focusMarket = useCallback(async (market: Market) => {
    const requestId = ++detailRequestId.current;
    setActiveMarket(market);
    setMobilePanel("intelligence");
    setDetailLoading(true);
    setDetailWarning("");
    if (market.source === "panta") setProviderMode("panta");
    try {
      const response = await fetch(`/api/markets/${encodeURIComponent(market.id)}`, { cache: "no-store" });
      const payload = await response.json() as { data?: Market; error?: string; source?: ProviderMode; environment?: PantaEnvironment };
      if (!response.ok || !payload.data) throw new Error(payload.error ?? "Market details are unavailable.");
      if (requestId !== detailRequestId.current) return;
      setActiveMarket(payload.data);
      setMarkets((current) => current.map((item) => item.id === payload.data?.id ? payload.data : item));
      setProviderMode(payload.source ?? payload.data.source);
      setProviderEnvironment(payload.environment ?? initialEnvironment);
    } catch (error) {
      if (requestId !== detailRequestId.current) return;
      setDetailWarning(error instanceof Error ? error.message : "Market details are unavailable; showing catalog values.");
    } finally {
      if (requestId === detailRequestId.current) setDetailLoading(false);
    }
  }, [initialEnvironment]);

  async function analyze(question = prompt) {
    const cleaned = question.trim();
    if (!cleaned || thinking) return;
    const savedRetry = retryableTurn.current?.content === cleaned ? retryableTurn.current : null;
    const turnPersistence: RetryableTurn = savedRetry ?? {
      content: cleaned,
      conversationId: conversationId.current || crypto.randomUUID(),
      userMessageId: crypto.randomUUID(),
      assistantMessageId: crypto.randomUUID(),
    };
    retryableTurn.current = turnPersistence;
    let sessionOnly = false;
    if (ticket && /^(cancel|never mind|nevermind|stop)$/i.test(cleaned)) {
      const turnId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setConversationTurns((current) => [...current, { id: turnId, userMessage: cleaned, reply: "Canceled this prepared trade. No transaction was signed or sent.", pending: false, requiresMarketData: false }].slice(-40));
      setActiveTurnId(turnId); setPrompt(""); setTicket(null); setPendingTradeDraft(null); setMiraState("explaining"); return;
    }
    if (ticket) {
      const changedAmount = cleaned.match(/\bactually make it\s+\$\s*([\d,]+(?:\.\d{1,2})?)/i);
      if (changedAmount) {
        const amountUsd = Number(changedAmount[1]?.replace(/,/g, ""));
        if (Number.isFinite(amountUsd) && amountUsd > 0) {
          const turnId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          setConversationTurns((current) => [...current, { id: turnId, userMessage: cleaned, reply: `I discarded the previous quote and am requesting a new Panta quote for $${amountUsd.toFixed(2)} USDC. You’ll need to review and confirm the updated trade.`, pending: false, requiresMarketData: false }].slice(-40));
          setActiveTurnId(turnId); setPrompt(""); setTicket({ market: ticket.market, outcome: ticket.outcome, amountUsd, autoPrepare: true }); setMiraState("trade-ready"); return;
        }
      }
      if (/\b(?:buy|purchase|trade|put)\b/i.test(cleaned)) setTicket(null);
    }
    const priorAnalysis = [...conversationTurns].reverse().find((turn) => (turn.analysis?.markets.length ?? 0) > 0)?.analysis;
    const previousTradeChoices = [...conversationTurns].reverse().find((turn) => (turn.tradeChoices?.length ?? 0) > 0)?.tradeChoices;
    const persistedMarkets = Array.isArray(savedState.current.markets) ? (savedState.current.markets as Array<{ id?: string; question?: string }>).filter((item): item is { id: string; question: string } => typeof item.id === "string" && typeof item.question === "string") : [];
    const displayedMarkets = (previousTradeChoices ?? priorAnalysis?.markets ?? []).map(({ id, question }) => ({ id, question }));
    const contextMarkets = [...(displayedMarkets.length ? displayedMarkets : persistedMarkets)];
    if (activeMarket) {
      const existing = contextMarkets.findIndex((market) => market.id === activeMarket.id);
      if (existing >= 0) contextMarkets[existing] = { id: activeMarket.id, question: activeMarket.question };
      else contextMarkets.push({ id: activeMarket.id, question: activeMarket.question });
    }
    const previousResearch = [...conversationTurns].reverse().find((turn) => turn.researchReport)?.researchReport;
    const rememberedMarketId = activeMarket?.id ?? (typeof savedState.current.activeMarketId === "string" ? savedState.current.activeMarketId : undefined);
    const savedResearch: ResearchMemory | undefined = previousResearch ? { marketId: previousResearch.market?.id ?? "", researchedAt: previousResearch.researchedAt, query: previousResearch.market?.question ?? "", keyFindings: previousResearch.keyFindings.slice(0, 10), evidenceIds: previousResearch.evidence.map((item) => item.id).slice(0, 30), sourceUrls: previousResearch.evidence.map((item) => item.url).slice(0, 30), assessment: previousResearch.assessment.explanation, uncertainties: previousResearch.uncertainty.slice(0, 10) } : researchMemory.find((item) => item.marketId === rememberedMarketId);
    const context: ConversationContext = {
      conversationId: conversationId.current || undefined,
      previousQuestion: conversationTurns.at(-1)?.userMessage,
      recentMessages: conversationTurns.slice(-6).flatMap((turn) => {
        const assistantMessage = turn.reply ?? turn.analysis?.answer ?? turn.marketIntelligence?.answer ?? turn.researchReport?.conclusion;
        return [{ role: "user" as const, content: turn.userMessage }, ...(assistantMessage ? [{ role: "assistant" as const, content: assistantMessage }] : [])];
      }).slice(-6),
      markets: contextMarkets.map(({ id, question: marketQuestion }) => ({ id, question: marketQuestion })),
      activeMarketId: activeMarket?.id ?? (typeof savedState.current.activeMarketId === "string" ? savedState.current.activeMarketId : undefined),
      pendingTrade: pendingTradeDraft ?? undefined,
      researchMarketId: previousResearch?.market?.id ?? savedResearch?.marketId ?? (typeof savedState.current.researchMarketId === "string" ? savedState.current.researchMarketId : undefined),
      researchQuestion: previousResearch?.market?.question ?? savedResearch?.query ?? (typeof savedState.current.researchQuestion === "string" ? savedState.current.researchQuestion : undefined),
      researchSummary: previousResearch?.conclusion ?? savedResearch?.assessment ?? (typeof savedState.current.researchSummary === "string" ? savedState.current.researchSummary : undefined),
      researchEvidence: previousResearch?.evidence.slice(0, 18).map(({ id, title, source, url, publishedAt, publishedAtPrecision, retrievedAt, claim, summary, direction }) => ({ id, title, source, url, publishedAt, publishedAtPrecision, retrievedAt, claim, summary, direction })) ?? (Array.isArray(savedState.current.researchEvidence) ? savedState.current.researchEvidence as ConversationContext["researchEvidence"] : undefined),
      researchMemory: savedResearch,
    };
    const localDecision = classifyConversationMessage(cleaned, context);
    const topicSwitchRequested = localDecision.intent === "market_discovery";
    const turnId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setConversationTurns((current) => [...current, { id: turnId, userMessage: cleaned, pending: true, requiresMarketData: localDecision.requiresMarketData }].slice(-40));
    setActiveTurnId(turnId);
    setPrompt("");
    setMobilePanel("conversation");
    setInvestigationQuestion(cleaned);
    setWorkspaceOpen(true);
    setView("analysis");
    setAnalysisError("");
    setThinking(true);
    setMiraState(localDecision.requiresMarketData ? "thinking" : localDecision.intent === "clarification" ? "thinking" : localDecision.intent === "greeting" ? "greeting" : "explaining");
    const steps = localDecision.intent === "market_intelligence"
      ? ["Reading market and saved observations", "Checking market structure and research context", "Building the unified market view"]
      : localDecision.intent === "research"
      ? ["Checking the selected Panta market", "Searching current sources for evidence on both sides", "Comparing retrieved evidence with provider pricing"]
      : localDecision.intent === "market_detail"
      ? ["Looking up the market we discussed", "Checking its reported details"]
      : localDecision.intent === "spot_price"
        ? ["Checking a live exchange ticker", "Verifying the latest spot price"]
      : ["Searching connected prediction markets", "Comparing prices, activity and liquidity", "Checking provider-linked context"];
    let index = 0;
    const requestController = new AbortController();
    analysisAbortController.current = requestController;
    setThinkingStep(localDecision.requiresMarketData ? steps[0] ?? "Searching markets" : "Thinking through your message");
    const timer = localDecision.requiresMarketData && localDecision.intent !== "research" && localDecision.intent !== "market_intelligence" ? setInterval(() => {
      index = (index + 1) % steps.length;
      setThinkingStep(steps[index] ?? "Reviewing source data");
    }, 820) : undefined;
    try {
      if (!conversationId.current) {
        const created = await fetch("/api/conversations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: turnPersistence.conversationId, title: cleaned.slice(0, 200) }) });
        if (!created.ok) {
          if (await isTransientDatabaseResponse(created)) {
            sessionOnly = true;
            context.conversationId = undefined;
          } else throw new Error(await responseError(created, "MIRA could not open a saved conversation"));
        } else {
          const createdPayload = await created.json() as { conversation?: { id?: string } };
          if (!createdPayload.conversation?.id) throw new Error("MIRA could not open a saved conversation.");
          conversationId.current = createdPayload.conversation.id;
          context.conversationId = conversationId.current;
        }
      }
      if (!sessionOnly && conversationId.current) {
        const savedUserMessage = await fetch(`/api/conversations/${conversationId.current}/message`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: cleaned, messageId: turnPersistence.userMessageId }) });
        if (!savedUserMessage.ok) {
          if (await isTransientDatabaseResponse(savedUserMessage)) {
            sessionOnly = true;
            context.conversationId = undefined;
          } else throw new Error(await responseError(savedUserMessage, "MIRA could not save your message"));
        } else setHistory((current) => [{ id: conversationId.current, query: cleaned, createdAt: new Date().toISOString() }, ...current.filter((item) => item.id !== conversationId.current)].slice(0, 100));
      }
      if (localDecision.requiresMarketData) {
        if (localDecision.intent !== "market_intelligence") await pause(280);
        setMiraState(localDecision.intent === "market_detail" ? "analyzing" : "searching");
        if (localDecision.intent === "research") setThinkingStep(steps[1] ?? "Searching current sources");
      }
      const response = await fetch("/api/analyze", { method: "POST", headers: { "Content-Type": "application/json", ...(localDecision.intent === "market_intelligence" ? { Accept: "text/event-stream" } : {}) }, body: JSON.stringify({ question: cleaned, context }), signal: requestController.signal });
      type AnalyzePayload = { intent?: ConversationIntent; reply?: string; sourceLink?: { title: string; url: string }; market?: Market; tradeChoices?: Market[]; webResearch?: NonNullable<AnalysisResult["webResearch"]>; researchReport?: ResearchReport; marketIntelligence?: MarketIntelligenceResult; crossMarketReport?: { primaryMarket: { id: string }; relatedMarkets: Array<{ market: { id: string } }> }; data?: AnalysisResult; tradeRequest?: { market: Market; outcome: "YES" | "NO"; amountUsdc: number; environment?: PantaEnvironment }; pendingTradeDraft?: PendingTradeDraft | null; source?: ProviderMode; environment?: PantaEnvironment; error?: string };
      let payload: AnalyzePayload;
      if (localDecision.intent === "market_intelligence" && response.headers.get("content-type")?.includes("text/event-stream")) {
        const reader = response.body?.getReader();
        if (!reader) throw new Error("MIRA could not read the market intelligence response.");
        const decoder = new TextDecoder();
        let buffer = "";
        let finalPayload: AnalyzePayload | undefined;
        while (true) {
          const { value, done } = await reader.read();
          buffer += decoder.decode(value, { stream: !done });
          const events = buffer.split("\n\n");
          buffer = events.pop() ?? "";
          for (const event of events) {
            const line = event.split("\n").find((part) => part.startsWith("data: "));
            if (!line) continue;
            const update = JSON.parse(line.slice(6)) as { type?: string; step?: string; payload?: AnalyzePayload; status?: number };
            if (update.type === "progress" && update.step) {
              setThinkingStep(update.step);
              setMiraState(update.step.toLowerCase().includes("building") ? "explaining" : "analyzing");
            } else if (update.type === "result") finalPayload = update.payload;
          }
          if (done) break;
        }
        if (!finalPayload) throw new Error("MIRA ended the market intelligence stream without a result.");
        payload = finalPayload;
      } else {
        payload = await response.json() as AnalyzePayload;
      }
      if (!response.ok) throw new Error(payload.error ?? "MIRA couldn’t complete that request.");
      if (payload.error) throw new Error(payload.error);
      const assistantText = payload.marketIntelligence?.answer ?? payload.researchReport?.conclusion ?? payload.data?.answer ?? payload.reply ?? (payload.tradeRequest ? "I’m checking this with Panta before you commit. The trade is not placed unless you confirm it in the wallet." : "MIRA completed the request.");
      const report = payload.researchReport;
      const selectedMarket = payload.market ?? report?.market;
      const updatedContextMarkets = selectedMarket
        ? contextMarkets.some((item) => item.id === selectedMarket.id)
          ? contextMarkets.map((item) => item.id === selectedMarket.id ? { id: selectedMarket.id, question: selectedMarket.question } : item)
          : [...contextMarkets, { id: selectedMarket.id, question: selectedMarket.question }]
        : contextMarkets;
      const memoryMarkets = topicSwitchRequested
        ? payload.data?.markets ?? []
        : payload.data?.markets.length
          ? payload.data.markets
          : updatedContextMarkets;
      const nextResearchMemory: ResearchMemory | null | undefined = topicSwitchRequested ? null : report?.market ? { marketId: report.market.id, researchedAt: report.researchedAt, query: report.market.question, keyFindings: report.keyFindings.slice(0, 10), evidenceIds: report.evidence.map((item) => item.id).slice(0, 30), sourceUrls: report.evidence.map((item) => item.url).slice(0, 30), assessment: report.assessment.explanation, uncertainties: report.uncertainty.slice(0, 10) } : context.researchMemory;
      const selectedAnalysisMarket = !topicSwitchRequested && payload.data?.markets.length === 1 ? payload.data.markets[0]?.id : undefined;
      const nextState = { activeMarketId: topicSwitchRequested ? null : payload.market?.id ?? report?.market?.id ?? selectedAnalysisMarket ?? activeMarket?.id ?? context.activeMarketId ?? null, markets: memoryMarkets.slice(0, 12).map(({ id, question }) => ({ id, question })), tradeChoices: topicSwitchRequested || payload.intent === "trade_request" ? (payload.tradeChoices ?? []).slice(0, 5) : savedState.current.tradeChoices, pendingTrade: topicSwitchRequested || payload.intent === "trade_cancel" ? null : payload.intent === "trade_request" ? payload.pendingTradeDraft ?? null : context.pendingTrade ?? savedState.current.pendingTrade ?? null, crossMarketContext: payload.crossMarketReport ? { primaryMarketId: payload.crossMarketReport.primaryMarket.id, relatedMarketIds: payload.crossMarketReport.relatedMarkets.map((item) => item.market.id), comparedAt: new Date().toISOString() } : savedState.current.crossMarketContext, marketIntelligence: payload.marketIntelligence ?? savedState.current.marketIntelligence, researchMarketId: topicSwitchRequested ? null : report?.market?.id ?? context.researchMarketId, researchQuestion: topicSwitchRequested ? null : report?.market?.question ?? context.researchQuestion, researchSummary: topicSwitchRequested ? null : report?.conclusion ?? context.researchSummary, researchEvidence: topicSwitchRequested ? [] : report?.evidence.slice(0, 12).map(({ id, title, source, url, publishedAt, publishedAtPrecision, retrievedAt, claim, summary, direction }) => ({ id, title, source, url, publishedAt, publishedAtPrecision, retrievedAt, claim: claim.slice(0, 500), summary: summary.slice(0, 500), direction })), researchMemory: nextResearchMemory, lastTopic: topicSwitchRequested ? (localDecision.analysisQuestion ?? cleaned).slice(0, 300) : cleaned.slice(0, 300) };
      savedState.current = nextState;
      if (!sessionOnly && conversationId.current) {
        const savedTurn = await fetch(`/api/conversations/${conversationId.current}/turn`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ assistantMessage: assistantText, messageId: turnPersistence.assistantMessageId, state: nextState }) });
        if (!savedTurn.ok) {
          if (await isTransientDatabaseResponse(savedTurn)) sessionOnly = true;
          else throw new Error(await responseError(savedTurn, "MIRA responded, but the conversation could not be saved"));
        }
      }
      if (sessionOnly) setStorageWarning("Conversation storage is temporarily unavailable. MIRA’s reply is available in this browser session, but it won’t appear in saved history.");
      retryableTurn.current = null;
      if (!sessionOnly) setHistory((current) => [{ id: conversationId.current, query: cleaned, createdAt: new Date().toISOString() }, ...current.filter((item) => item.id !== conversationId.current)].slice(0, 100));
      if (payload.data) {
        setAnalysis(payload.data);
        setRevealedMarkets([]);
        setThinkingStep("MIRA found provider listings and is bringing them into view");
        for (const market of payload.data.markets.slice(0, 4)) {
          await pause(240);
          setRevealedMarkets((current) => [...current, market]);
        }
        setMiraState("analyzing");
        setThinkingStep("Comparing timestamps, reported prices and related-market context");
        await pause(420);
        setProviderMode(payload.source ?? payload.data.source);
        setProviderEnvironment(payload.data.providerEnvironment ?? payload.environment ?? initialEnvironment);
        setMarkets((current) => {
          const byId = new Map(current.map((market) => [market.id, market]));
          payload.data?.markets.forEach((market) => byId.set(market.id, market));
          return [...byId.values()];
        });
        if (!topicSwitchRequested && payload.data.markets.length === 1) setActiveMarket(payload.data.markets[0]!);
        else if (topicSwitchRequested || payload.data.markets.length > 1) setActiveMarket(null);
        const entry = { id: payload.data.id, query: cleaned, createdAt: payload.data.createdAt };
        setHistory((current) => [entry, ...current.filter((item) => item.query !== cleaned)].slice(0, 20));
        setConversationTurns((current) => current.map((turn) => turn.id === turnId ? { ...turn, analysis: payload.data, pending: false } : turn));
        if (payload.data.confidence === "insufficient") setMiraState("insufficient-data");
        else {
          setMiraState("success");
          await pause(720);
          setMiraState("explaining");
        }
      } else {
        if (payload.researchReport) {
          if (payload.researchReport.market) {
            const report = payload.researchReport;
            const reportMarket = report.market!;
            const memory: ResearchMemory = { marketId: reportMarket.id, researchedAt: report.researchedAt, query: reportMarket.question, keyFindings: report.keyFindings.slice(0, 10), evidenceIds: report.evidence.map((item) => item.id).slice(0, 30), sourceUrls: report.evidence.map((item) => item.url).slice(0, 30), assessment: report.assessment.explanation, uncertainties: report.uncertainty.slice(0, 10) };
            setResearchMemory((current) => [memory, ...current.filter((item) => item.marketId !== memory.marketId)].slice(0, 20));
          }
          setThinkingStep("Evidence review complete; presenting the cited report");
          setMiraState("analyzing");
          setMarkets((current) => [...new Map([...current, ...(payload.researchReport?.market ? [payload.researchReport.market] : []), ...(payload.researchReport?.relatedMarkets ?? [])].map((market) => [market.id, market])).values()]);
          if (payload.researchReport.market) setActiveMarket(payload.researchReport.market);
          setProviderMode(payload.researchReport.market?.source ?? payload.source ?? providerMode);
          setConversationTurns((current) => current.map((turn) => turn.id === turnId ? { ...turn, researchReport: payload.researchReport, marketIntelligence: payload.marketIntelligence, pending: false, requiresMarketData: false } : turn));
          setMiraState("explaining");
          return;
        }
        if (!payload.reply) throw new Error("MIRA didn’t return a response. Please try again.");
        if (payload.tradeRequest) {
          setPendingTradeDraft(null);
          setTicket({ market: payload.tradeRequest.market, outcome: payload.tradeRequest.outcome, amountUsd: payload.tradeRequest.amountUsdc, autoPrepare: true });
          setActiveMarket(payload.tradeRequest.market);
          setProviderMode(payload.tradeRequest.market.source);
          setProviderEnvironment(payload.tradeRequest.environment ?? payload.environment ?? initialEnvironment);
          setMiraState("trade-ready");
        }
        if (payload.intent === "trade_request" && !payload.tradeRequest) setPendingTradeDraft(payload.pendingTradeDraft ?? pendingTradeDraft);
        if (payload.intent === "trade_cancel") setPendingTradeDraft(null);
        if (payload.tradeChoices?.length) {
          setMarkets((current) => [...new Map([...current, ...payload.tradeChoices!].map((market) => [market.id, market])).values()]);
          setConversationTurns((current) => current.map((turn) => turn.id === turnId ? { ...turn, tradeChoices: payload.tradeChoices, pending: false } : turn));
        }
        if (payload.market) {
          setActiveMarket(payload.market);
          setMarkets((current) => [...new Map([...current, payload.market!].map((market) => [market.id, market])).values()]);
          setProviderMode(payload.source ?? payload.market.source);
          setProviderEnvironment(payload.environment ?? initialEnvironment);
        }
        setConversationTurns((current) => current.map((turn) => turn.id === turnId ? { ...turn, reply: payload.reply, sourceLink: payload.sourceLink, market: payload.market, webResearch: payload.webResearch, marketIntelligence: payload.marketIntelligence, pending: false } : turn));
        setMiraState(payload.tradeRequest ? "trade-ready" : "explaining");
      }
    } catch (error) {
      if (!requestController.signal.aborted) {
        setAnalysisError(`${error instanceof Error ? error.message : "MIRA could not complete the request."} You can retry; the same message will not be duplicated.`);
        setPrompt(cleaned);
        setConversationTurns((current) => current.map((turn) => turn.id === turnId ? { ...turn, pending: false } : turn));
        setMiraState("error");
      }
    } finally {
      if (timer) clearInterval(timer);
      if (analysisAbortController.current === requestController) analysisAbortController.current = null;
      if (!requestController.signal.aborted) setThinking(false);
    }
  }

  const startNewAnalysis = useCallback(() => {
    conversationId.current = "";
    retryableTurn.current = null;
    savedState.current = {};
    setStorageWarning("");
    setWorkspaceOpen(true);
    setView("analysis");
    setMobilePanel("conversation");
    setPrompt("");
    setInvestigationQuestion("");
    setAnalysis(null);
    setConversationTurns([]);
    setActiveTurnId("");
    setRevealedMarkets([]);
    setAnalysisError("");
    setTicket(null);
    setPendingTradeDraft(null);
    setMiraState("greeting");
    setTimeout(() => inputRef.current?.focus(), 80);
  }, []);

  async function openHistory(item: AnalysisHistoryItem) {
    try {
      const response = await fetch(`/api/conversations/${item.id}`, { cache: "no-store" });
      const payload = await response.json() as { conversation?: { id: string; messages: Array<{ role: string; content: string; created_at: string }>; state?: Record<string, unknown> } };
      if (!response.ok || !payload.conversation) throw new Error("Could not load this conversation.");
      conversationId.current = payload.conversation.id;
      retryableTurn.current = null;
      savedState.current = payload.conversation.state ?? {};
      const turns: ConversationTurn[] = [];
      let pendingUser: { content: string; index: number } | undefined;
      payload.conversation.messages.forEach((message, index) => {
        if (message.role === "user") {
          if (pendingUser) turns.push({ id: `${item.id}-${pendingUser.index}`, userMessage: pendingUser.content, pending: false, requiresMarketData: false });
          pendingUser = { content: message.content, index };
        } else if (message.role === "assistant" && pendingUser) {
          turns.push({ id: `${item.id}-${pendingUser.index}`, userMessage: pendingUser.content, reply: message.content, pending: false, requiresMarketData: false });
          pendingUser = undefined;
        }
      });
      if (pendingUser) turns.push({ id: `${item.id}-${pendingUser.index}`, userMessage: pendingUser.content, pending: false, requiresMarketData: false });
      const savedIntelligence = payload.conversation.state?.marketIntelligence as MarketIntelligenceResult | undefined;
      if (savedIntelligence && turns.length) turns[turns.length - 1] = { ...turns[turns.length - 1]!, marketIntelligence: savedIntelligence };
      const savedTradeChoices = Array.isArray(payload.conversation.state?.tradeChoices)
        ? payload.conversation.state.tradeChoices.filter((market): market is Market => Boolean(market && typeof market === "object" && typeof (market as Market).id === "string" && typeof (market as Market).question === "string" && (market as Market).source === "panta")).slice(0, 5)
        : [];
      if (savedTradeChoices.length && turns.length) turns[turns.length - 1] = { ...turns[turns.length - 1]!, tradeChoices: savedTradeChoices };
      const savedTrade = payload.conversation.state?.pendingTrade;
      const restoredTradeFields: PendingTradeDraft = savedTrade && typeof savedTrade === "object"
        ? Object.fromEntries(Object.entries(savedTrade as Record<string, unknown>).filter(([key, value]) =>
          (["marketId", "marketQuestion", "marketQuery"].includes(key) && typeof value === "string")
          || (key === "outcome" && (value === "YES" || value === "NO"))
          || (key === "amountUsdc" && typeof value === "number" && Number.isFinite(value) && value > 0),
        )) as PendingTradeDraft
        : {};
      setPendingTradeDraft(savedTrade && typeof savedTrade === "object" ? restoredTradeFields : null);
      setConversationTurns(turns.slice(-40)); setActiveTurnId(turns.at(-1)?.id ?? ""); setWorkspaceOpen(true); setView("analysis"); setAnalysis(null); setAnalysisError(""); setMobilePanel("conversation");
      const state = payload.conversation.state ?? {};
      setActiveMarket(null);
      if (typeof state.activeMarketId === "string") {
        const known = Array.isArray(state.markets) ? state.markets as Array<{ id?: string; question?: string }> : [];
        const active = known.find((market) => market.id === state.activeMarketId);
        if (active?.id) void fetch(`/api/markets/${encodeURIComponent(active.id)}`, { cache: "no-store" }).then((res) => res.json()).then((result: { data?: Market }) => { if (result.data) setActiveMarket(result.data); }).catch(() => {});
      }
    } catch (error) { setAnalysisError(error instanceof Error ? error.message : "Could not load this conversation."); }
  }
  async function removeHistory(item: AnalysisHistoryItem) {
    const response = await fetch(`/api/conversations/${item.id}`, { method: "DELETE" });
    if (response.ok) { setHistory((current) => current.filter((entry) => entry.id !== item.id)); if (conversationId.current === item.id) startNewAnalysis(); }
  }

  function toggleWatch(market: Market) {
    setWatchedIds((current) => {
      const updated = new Set(current);
      if (updated.has(market.id)) updated.delete(market.id);
      else updated.add(market.id);
      return updated;
    });
  }

  const loadPortfolio = useCallback(async () => {
    if (!walletAddress) { setPortfolio([]); setPortfolioState("idle"); return; }
    setPortfolioState("loading");
    try {
      const response = await fetch(`/api/portfolio?wallet=${encodeURIComponent(walletAddress)}`, { cache: "no-store" });
      const payload = await response.json() as { data?: Position[]; error?: string; source?: ProviderMode };
      if (!response.ok) throw new Error(payload.error ?? "Portfolio unavailable.");
      setPortfolio(payload.data ?? []);
      setPortfolioState("ready");
    } catch (error) {
      setPortfolioError(error instanceof Error ? error.message : "Positions could not be loaded.");
      setPortfolioState("error");
    }
  }, [walletAddress]);

  useEffect(() => {
    if (!workspaceOpen || view !== "portfolio") return;
    const task = window.setTimeout(() => { void loadPortfolio(); }, 0);
    return () => window.clearTimeout(task);
  }, [workspaceOpen, view, loadPortfolio]);

  useEffect(() => {
    if (!workspaceOpen || view !== "analysis" || thinking || analysis || analysisError || prompt || miraState !== "greeting") return;
    const restTimer = window.setTimeout(() => setMiraState("resting"), 30000);
    return () => window.clearTimeout(restTimer);
  }, [workspaceOpen, view, thinking, analysis, analysisError, prompt, miraState]);

  useEffect(() => {
    if (miraState !== "trade-success") return;
    const timer = window.setTimeout(() => setMiraState(analysis ? "explaining" : "greeting"), 2600);
    return () => window.clearTimeout(timer);
  }, [miraState, analysis]);

  useEffect(() => {
    function keyHandler(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "j") { event.preventDefault(); startNewAnalysis(); }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); inputRef.current?.focus(); }
      if (event.key === "Escape") setSidebarOpen(false);
    }
    window.addEventListener("keydown", keyHandler);
    return () => window.removeEventListener("keydown", keyHandler);
  }, [startNewAnalysis]);

  const watchedMarkets = useMemo(() => markets.filter((market) => watchedIds.has(market.id)), [markets, watchedIds]);
  const visibleMarkets = useMemo(() => markets.filter((market) => !marketSearch || `${market.question} ${market.category ?? ""}`.toLowerCase().includes(marketSearch.toLowerCase())), [markets, marketSearch]);
  const openTrade = useCallback(async (market: Market, outcome: "YES" | "NO") => {
    let selectedMarket = market;
    if (market.phase === "secondary") {
      setActiveMarket(market);
      setMobilePanel("intelligence");
      setDetailLoading(true);
      setDetailWarning("");
      try {
        const response = await fetch(`/api/markets/${encodeURIComponent(market.id)}`, { cache: "no-store" });
        const payload = await response.json() as { data?: Market; error?: string; source?: ProviderMode; environment?: PantaEnvironment };
        if (!response.ok || !payload.data) throw new Error(payload.error ?? "Panta market details are unavailable.");
        selectedMarket = payload.data;
        setActiveMarket(selectedMarket);
        setMarkets((current) => current.map((item) => item.id === selectedMarket.id ? selectedMarket : item));
        setProviderMode(payload.source ?? selectedMarket.source);
        setProviderEnvironment(payload.environment ?? initialEnvironment);
        if (!isSecondaryTradeEligibleMarket(selectedMarket)) {
          setDetailWarning("Panta’s latest market details do not confirm an active, graduated, unresolved secondary market in its trading window. No transaction was prepared.");
          return;
        }
      } catch (error) {
        setDetailWarning(error instanceof Error ? error.message : "Panta market details are unavailable; no transaction was prepared.");
        return;
      } finally {
        setDetailLoading(false);
      }
    }
    setMiraState("trade-ready");
    setTicket({ market: selectedMarket, outcome });
  }, [initialEnvironment]);
  const closeTrade = useCallback(() => {
    setTicket(null);
    setMiraState(analysis ? analysis.confidence === "insufficient" ? "insufficient-data" : "explaining" : "greeting");
  }, [analysis]);

  if (!workspaceOpen) return <HomeExperience mode={providerMode} environment={providerEnvironment} markets={marketStatus === "ready" ? markets : []} prompt={prompt} setPrompt={setPrompt} onSubmit={() => void analyze()} onWallet={onWallet} onOpenWorkspace={(nextView) => { setWorkspaceOpen(true); setView(nextView); }} state={miraState} />;

  return <main className="workspace-world min-h-screen">
    <DaylightWorld compact />
    <div className={`workspace-frame ${sidebarCollapsed ? "workspace-frame--collapsed" : ""}`}>
      <WorkspaceSidebar view={view} setView={(nextView) => { setView(nextView); setMobilePanel("conversation"); }} history={history} openHistory={openHistory} deleteHistory={removeHistory} newAnalysis={startNewAnalysis} mobileOpen={sidebarOpen} closeMobile={() => setSidebarOpen(false)} collapsed={sidebarCollapsed} setCollapsed={setSidebarCollapsed} />
      <section className="workspace-main">
        <header className="workspace-topbar"><button className="mobile-menu-button" onClick={() => setSidebarOpen(true)} aria-label="Open navigation"><Menu size={19} /></button><div className="workspace-breadcrumb"><a href="#home" onClick={(event) => { event.preventDefault(); setWorkspaceOpen(false); }}>MIRA</a><span>/</span><b>{view === "analysis" ? analysis ? "Analysis" : conversationTurns.length ? "Conversation" : "New analysis" : view}</b></div><div className="workspace-topbar__right"><WalletButton onWallet={onWallet} currentWallet={wallet} /></div></header>
        {providerMode === "demo" && <div className="demo-ribbon"><Sparkles size={13} /><b>DEMO PROVIDER</b><span>Every sample price, volume, relation and quote below is an illustrative fixture — not live market data.</span><a href="/README" aria-label="Demo provider details">Details <ArrowRight size={12} /></a></div>}
        <nav className="mobile-workspace-tabs" role="tablist" aria-label="Workspace panels">
          <button role="tab" aria-selected={mobilePanel === "conversation"} className={mobilePanel === "conversation" ? "is-active" : ""} onClick={() => setMobilePanel("conversation")}>Conversation</button>
          <button role="tab" aria-selected={mobilePanel === "intelligence"} className={mobilePanel === "intelligence" ? "is-active" : ""} onClick={() => setMobilePanel("intelligence")}>Market intelligence{activeMarket ? <span>{activeMarket.question}</span> : null}</button>
        </nav>
        <div className="workspace-content-grid" data-mobile-panel={mobilePanel}>
          <section className="conversation-column" aria-live="polite">
            <div className="conversation-header"><div><span className="panel-kicker">{view === "analysis" ? "MIRA WORKSPACE" : `YOUR ${view.toUpperCase()}`}</span><h1>{viewTitle(view, analysis)}</h1></div><button className="conversation-refresh" onClick={() => view === "markets" ? void refreshMarkets() : view === "portfolio" ? void loadPortfolio() : void 0} title="Refresh provider data"><RefreshCw size={15} /></button></div>
            {view === "analysis" && <AnalysisView turns={conversationTurns} activeTurnId={activeTurnId} thinking={thinking} step={thinkingStep} error={analysisError} storageWarning={storageWarning} prompt={prompt} setPrompt={setPrompt} submit={(question) => void analyze(question?.trim() || prompt || investigationQuestion)} inputRef={inputRef} state={miraState} markets={revealedMarkets} suggestedMarkets={markets} watched={watchedIds} onSelect={focusMarket} onTrade={openTrade} onWatch={toggleWatch} pantaEnvironment={providerEnvironment} />}
            {view === "markets" && <MarketListView markets={visibleMarkets} status={marketStatus} error={marketError} search={marketSearch} setSearch={setMarketSearch} watched={watchedIds} retry={() => void refreshMarkets(marketSearch)} onSelect={focusMarket} onTrade={openTrade} onWatch={toggleWatch} onAskMira={(question) => { void analyze(question); }} pantaEnvironment={providerEnvironment} />}
            {view === "portfolio" && <PortfolioView positions={portfolio} state={portfolioState} error={portfolioError} wallet={walletAddress} onRefresh={() => void loadPortfolio()} />}
            {view === "watchlist" && <WatchlistView markets={watchedMarkets} watched={watchedIds} onSelect={focusMarket} onTrade={openTrade} onWatch={toggleWatch} pantaEnvironment={providerEnvironment} />}
            <div className="conversation-disclaimer"><span>◈</span> MIRA organizes market data. Prices can change quickly and are not financial advice.</div>
          </section>
          <MarketIntelPanel market={activeMarket} markets={markets} onSelect={focusMarket} onTrade={openTrade} onAskMira={(market) => { void analyze(`What’s happening in this market: ${market.question}`); }} allowTrading={view !== "markets"} detailLoading={detailLoading} detailWarning={detailWarning} isDemo={providerMode === "demo"} pantaEnvironment={providerEnvironment} relationships={analysis?.relatedMarkets ?? []} />
        </div>
      </section>
    </div>
    <AnimatePresence>{ticket && <TradeTicket key={`${ticket.market.id}:${ticket.outcome}:${ticket.amountUsd ?? "manual"}`} market={ticket.market} initialOutcome={ticket.outcome} initialAmount={ticket.amountUsd} autoPrepare={ticket.autoPrepare ?? false} wallet={wallet} onWallet={onWallet} onClose={closeTrade} onComplete={() => { setMiraState("trade-success"); if (view === "portfolio") void loadPortfolio(); }} />}</AnimatePresence>
  </main>;
}

function viewTitle(view: WorkspaceView, analysis: AnalysisResult | null) {
  if (view === "analysis") return analysis ? "Market analysis" : "New analysis";
  if (view === "markets") return "Market explorer";
  if (view === "portfolio") return "Your positions";
  return "Watchlist";
}

function AnalysisView({ turns, activeTurnId, thinking, step, error, storageWarning, prompt, setPrompt, submit, inputRef, state, markets, suggestedMarkets, watched, onSelect, onTrade, onWatch, pantaEnvironment }: {
  turns: ConversationTurn[];
  activeTurnId: string;
  thinking: boolean;
  step: string;
  error: string;
  storageWarning: string;
  prompt: string;
  setPrompt: (value: string) => void;
  submit: (question?: string) => void;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  state: MiraState;
  markets: Market[];
  suggestedMarkets: Market[];
  watched: Set<string>;
  onSelect: (market: Market) => void;
  onTrade: (market: Market, side: "YES" | "NO") => void;
  onWatch: (market: Market) => void;
  pantaEnvironment: PantaEnvironment;
}) {
  const suggestions = rankMarketSuggestions(suggestedMarkets).slice(0, 3);
  return <div className="analysis-view">
    {turns.map((turn) => {
      const isActive = turn.id === activeTurnId;
      const turnState = isActive ? state : turn.analysis?.confidence === "insufficient" ? "insufficient-data" : "explaining";
      return <section className="conversation-turn" key={turn.id}>
        <motion.div className="user-message" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}><span>YOU</span><p>{turn.userMessage}</p></motion.div>
        {turn.analysis && <AnalysisMessage result={turn.analysis} state={turnState} watched={watched} onSelect={onSelect} onTrade={onTrade} onWatch={onWatch} />}
        {turn.marketIntelligence && <MarketIntelligenceView result={turn.marketIntelligence} />}
        {turn.researchReport && <ResearchReportView report={turn.researchReport} />}
        {turn.reply && <><div className="assistant-message"><span className="assistant-character"><MiraCharacter state={turnState} compact /></span><div className="assistant-message__body"><div className="assistant-label">MIRA</div><p>{turn.reply}</p>{turn.sourceLink && <a href={turn.sourceLink.url} target="_blank" rel="noreferrer">{turn.sourceLink.title} ↗</a>}{turn.tradeChoices?.length ? <ol className="trade-market-choices">{turn.tradeChoices.map((market, index) => <li key={market.id}><div><b>{market.question}</b><small>ID {market.id} · {market.status}{market.closeAt ? ` · closes ${new Date(market.closeAt).toLocaleString()}` : " · closing time unavailable"}</small></div><button type="button" onClick={() => submit(`The ${["first", "second", "third", "fourth", "fifth"][index]} one.`)}>Choose</button></li>)}</ol> : null}</div></div></>}
        {turn.pending && isActive && (turn.requiresMarketData
          ? <motion.div className="mira-investigation-transition" initial={{ opacity: .9, y: 4 }} animate={{ opacity: 1, y: 0 }}><MiraInvestigation state={state} markets={markets} question={turn.userMessage} step={thinking ? step : undefined} pantaEnvironment={pantaEnvironment} /></motion.div>
          : <div className="assistant-message"><span className="assistant-character"><MiraCharacter state={state} compact /></span><div className="assistant-message__body"><div className="assistant-label">MIRA</div><p>{state === "thinking" ? "Let me think that through…" : "One moment…"}</p></div></div>)}
      </section>;
    })}
    {storageWarning && <div className="analysis-storage-warning" role="status">{storageWarning}</div>}
    {error && <div className="analysis-error" role="alert"><CircleHelp size={17} /><div><b>Analysis could not reach the provider</b><p>{error}</p><button onClick={() => submit()}>Try again <ArrowRight size={13} /></button></div></div>}
    {turns.at(-1)?.analysis?.confidence === "insufficient" && state === "insufficient-data" && suggestions.length > 0 && <div className="insufficient-followups"><span>EXPLORE THESE PROVIDER MARKETS:</span>{suggestions.map((market) => <button key={market.id} onClick={() => onSelect(market)}>{market.question} · {market.id}<ArrowRight size={12} /></button>)}</div>}
    {turns.length === 0 && !thinking && !error && <div className="analysis-prompt-list"><span>{suggestions.length ? "MARKETS FROM THE PROVIDER CATALOG" : "NO MARKET SUGGESTIONS AVAILABLE"}</span>{suggestions.map((market) => <button key={market.id} onClick={() => onSelect(market)}>{market.question}<small>{market.id} · {market.status === "unknown" ? "status unavailable" : market.status}</small><ArrowRight size={13} /></button>)}</div>}
    <div className="thread-composer"><Composer value={prompt} onChange={setPrompt} onSubmit={() => submit()} disabled={thinking} compact inputRef={inputRef} /><span><Command size={11} /> K focuses your prompt</span></div>
  </div>;
}

function MarketListView({ markets, status, error, search, setSearch, watched, retry, onSelect, onTrade, onWatch, onAskMira, pantaEnvironment }: {
  markets: Market[];
  status: "loading" | "ready" | "error";
  error: string;
  search: string;
  setSearch: (value: string) => void;
  watched: Set<string>;
  retry: () => void;
  onSelect: (market: Market) => void;
  onTrade: (market: Market, outcome: "YES" | "NO") => void;
  onWatch: (market: Market) => void;
  onAskMira: (question: string) => void;
  pantaEnvironment: PantaEnvironment;
}) {
  const [statusFilter, setStatusFilter] = useState<Market["status"] | "all">("all");
  const [phaseFilter, setPhaseFilter] = useState<string>("all");
  const phaseOptions = useMemo(() => [...new Set(markets.map((market) => market.phase?.trim() || "__unknown"))].sort(), [markets]);
  const filteredMarkets = useMemo(() => markets
    .filter((market) => statusFilter === "all" || market.status === statusFilter)
    .filter((market) => phaseFilter === "all" || (phaseFilter === "__unknown" ? !market.phase?.trim() : market.phase === phaseFilter))
    .sort((a, b) => Number(a.status === "resolved") - Number(b.status === "resolved")), [markets, phaseFilter, statusFilter]);
  const statusOptions: { value: Market["status"] | "all"; label: string }[] = [
    { value: "all", label: "All markets" },
    { value: "active", label: "Open / active" },
    { value: "resolved", label: "Resolved" },
    { value: "closed", label: "Closed" },
    { value: "unknown", label: "Status unavailable" },
  ];
  return <section className="markets-view"><div className="markets-view__intro"><div><span className="panel-kicker">DISCOVER WITH MIRA</span><h2>Markets in the world</h2><p>Search real provider listings, then open a market for its prices, history and related context.</p></div><div className="markets-view__prompts"><span>Try asking MIRA</span><button onClick={() => onAskMira("What markets are moving the most?")}>What markets are moving the most?</button><button onClick={() => onAskMira("Which markets have the highest volume?")}>Which markets have the highest volume?</button></div></div>
    <div className="markets-controls"><label><Search size={15} /><input aria-label="Search markets" placeholder="Search provider markets, topics or titles" value={search} onChange={(event) => setSearch(event.target.value)} /><kbd>⌘ K</kbd></label><details className="markets-filter"><summary aria-label="Filter markets"><ListFilter size={14} /> Filter</summary><div className="markets-filter__menu"><div role="group" aria-label="Filter by market status"><b>Status</b>{statusOptions.map((option) => <button type="button" key={option.value} aria-pressed={statusFilter === option.value} onClick={() => setStatusFilter(option.value)}>{option.label}</button>)}</div><div role="group" aria-label="Filter by market phase"><b>Phase</b><button type="button" aria-pressed={phaseFilter === "all"} onClick={() => setPhaseFilter("all")}>All phases</button>{phaseOptions.map((phase) => <button type="button" key={phase} aria-pressed={phaseFilter === phase} onClick={() => setPhaseFilter(phase)}>{phase === "__unknown" ? "Phase unavailable" : phase.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())}</button>)}</div></div></details><span>{status === "ready" ? statusFilter === "all" && phaseFilter === "all" ? `${filteredMarkets.length} markets` : `${filteredMarkets.length} of ${markets.length} markets` : "Searching markets"}</span></div>
    {status === "loading" && <div className="market-view-state"><span className="loading-leaf"><Leaf size={20} /></span><b>{search ? `Searching for “${search}”` : "Gathering provider market data"}</b><p>MIRA is checking the active market provider. Results keep their original source and missing fields stay unavailable.</p></div>}
    {status === "error" && <div className="market-view-state market-view-state--error"><b>Market feed unavailable</b><p>{error}</p><button onClick={retry}>Reconnect <RefreshCw size={13} /></button></div>}
    {status === "ready" && filteredMarkets.length === 0 && <div className="market-view-state"><Sprout size={22} /><b>{statusFilter !== "all" || phaseFilter !== "all" ? "No markets match this filter" : search ? "No matching markets found" : "No markets returned"}</b><p>{statusFilter !== "all" || phaseFilter !== "all" ? "Choose another status or phase filter to see more provider markets." : search ? "The selected provider did not return markets matching that search. Try a market title, topic, ticker or event." : "The active provider returned an empty market list. MIRA has not filled it with sample values."}</p></div>}
    {status === "ready" && filteredMarkets.length > 0 && <div className="market-list-grid">{filteredMarkets.map((market, index) => <MarketCard key={market.id} market={market} index={index} pantaEnvironment={pantaEnvironment} onSelect={onSelect} onTrade={onTrade} isWatched={watched.has(market.id)} onWatch={onWatch} />)}</div>}
  </section>;
}

function PortfolioView({ positions, state, error, wallet, onRefresh }: { positions: Position[]; state: "idle" | "loading" | "error" | "ready"; error: string; wallet: string; onRefresh: () => void }) {
  if (!wallet) return <div className="portfolio-empty"><span><WalletIcon /></span><h2>Connect a wallet to view positions</h2><p>Your holdings and claim eligibility are retrieved from the active market provider. MIRA will never invent a portfolio.</p></div>;
  if (state === "loading") return <div className="market-view-state"><span className="loading-leaf"><Leaf size={20} /></span><b>Loading provider positions</b><p>Wallet {wallet.slice(0, 5)}…{wallet.slice(-4)}</p></div>;
  if (state === "error") return <div className="market-view-state market-view-state--error"><b>Positions unavailable</b><p>{error}</p><button onClick={onRefresh}>Retry <RefreshCw size={13} /></button></div>;
  return <div className="portfolio-table-wrap"><div className="portfolio-table-heading"><div><span>WALLET</span><b>{wallet.slice(0, 7)}…{wallet.slice(-5)}</b></div><button onClick={onRefresh}><RefreshCw size={14} /> Refresh</button></div>{positions.length ? <div className="portfolio-rows">{positions.map((position) => <div className="portfolio-row" key={position.id}><div><span>{position.outcome}</span><b>{position.question}</b></div><div><span>SHARES</span><b>{position.shares.toLocaleString()}</b></div><div><span>VALUE</span><b>{position.currentValueUsd === null ? "—" : new Intl.NumberFormat("en", { style: "currency", currency: "USD" }).format(position.currentValueUsd)}</b></div><div><span>CLAIM</span><b>{position.claimable ? "Eligible" : "—"}</b></div></div>)}</div> : <div className="market-view-state"><Sprout size={22} /><b>No positions returned</b><p>The active provider reports no positions for this wallet.</p></div>}</div>;
}

function WatchlistView({ markets, watched, onSelect, onTrade, onWatch, pantaEnvironment }: { markets: Market[]; watched: Set<string>; onSelect: (market: Market) => void; onTrade: (market: Market, outcome: "YES" | "NO") => void; onWatch: (market: Market) => void; pantaEnvironment: PantaEnvironment }) {
  return markets.length ? <div className="market-list-grid">{markets.map((market, index) => <MarketCard key={market.id} market={market} index={index} pantaEnvironment={pantaEnvironment} onSelect={onSelect} onTrade={onTrade} isWatched={watched.has(market.id)} onWatch={onWatch} />)}</div> : <div className="portfolio-empty"><span><Bookmark size={21} /></span><h2>Your watchlist starts with one market</h2><p>Save markets from Discovery to keep an eye on provider-reported changes.</p></div>;
}

function WalletIcon() { return <svg width="23" height="23" viewBox="0 0 24 24" fill="none"><rect x="3" y="5" width="18" height="14" rx="2.4" stroke="currentColor" strokeWidth="1.5"/><path d="M3 9h18m-6 5h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>; }
