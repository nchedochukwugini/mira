import type { Market } from "@/lib/panta/types";
import type { ResearchMemory } from "@/lib/research/types";

export type ConversationIntent =
  | "greeting"
  | "help"
  | "market_discovery"
  | "market_analysis"
  | "market_detail"
  | "market_intelligence"
  | "research"
  | "trade_request"
  | "trade_cancel"
  | "spot_price"
  | "clarification"
  | "general";

export type ConversationMarket = Pick<Market, "id" | "question">;
export type ConversationMessage = { role: "user" | "assistant"; content: string };
export type PendingTradeDraft = { marketId?: string; marketQuestion?: string; outcome?: "YES" | "NO"; amountUsdc?: number; marketQuery?: string };

export type ConversationContext = {
  conversationId?: string;
  previousQuestion?: string;
  recentMessages?: ConversationMessage[];
  markets?: ConversationMarket[];
  activeMarketId?: string;
  pendingTrade?: PendingTradeDraft;
  researchMarketId?: string;
  researchQuestion?: string;
  researchSummary?: string;
  researchEvidence?: Array<{ id?: string; title: string; source: string; url: string; publishedAt: string | null; publishedAtPrecision?: "date" | "timestamp"; retrievedAt?: string; claim?: string; summary: string; direction: "supports-yes" | "supports-no" | "neutral" | "uncertain" }>;
  researchMemory?: ResearchMemory;
};

export type ConversationDecision = {
  intent: ConversationIntent;
  requiresMarketData: boolean;
  reply?: string;
  marketId?: string;
  marketQuestion?: string;
  analysisQuestion?: string;
  spotAsset?: "BTC" | "ETH";
  tradeOutcome?: "YES" | "NO";
  tradeAmountUsdc?: number;
  tradeMarketQuery?: string;
  tradeQuestion?: string;
  pendingTradeDraft?: PendingTradeDraft;
  comparisonSubjects?: string[];
  comparisonDimension?: "none" | "probability" | "activity" | "liquidity" | "volume" | "conceptual";
};

/** True when Groq adds useful language understanding beyond the safe local route. */
export function shouldInterpretWithGroq(decision: ConversationDecision, context: ConversationContext = {}): boolean {
  if (decision.intent === "clarification" && context.recentMessages?.length) return true;
  return !["greeting", "help", "trade_cancel", "clarification", "market_intelligence"].includes(decision.intent);
}

export function asksForMarketReasoning(message: string): boolean {
  if (/\b(?:what changed|has anything changed)\s+(?:since|today|in the news)|\brefresh(?: this)? research|\bresearch again|\bsince your last analysis\b/i.test(message)) return false;
  return /\b(order\s*book|bids?\b|asks?\s+(?:side|at|for)|spread\b|visible depth|order depth|imbalance|microstructure|market structure|liquidity (?:trend|increas|decreas|chang)|spread (?:widen|tighten|chang)|book (?:becoming|getting) (?:balanced|imbalanced)|what(?:'s| is) happening|what changed|has anything changed|what supports? (?:yes|no)|what(?:'s| is) working against|supporting signals?|opposing signals?|compare (?:the )?market structure|more liquid on (?:yes|no)|actually trading|just placing orders|what does the latest research|why (?:are you|is mira) uncertain|actually bullish|why (?:is|does|did) (?:this |the )?(?:market|yes price|price)|why is (?:this |the )?market showing)\b/i.test(message);
}

const clean = (message: string) => message.trim().toLowerCase().replace(/[’']/g, "'").replace(/[.!?]+$/g, "").replace(/\s+/g, " ");
const entityPatterns = [
  /\b(?:bitcoin|btc)\b/,
  /\b(?:ethereum|ether|eth)\b/,
  /\b(?:fed|federal reserve|fomc)\b/,
  /\b(?:inflation|cpi)\b/,
  /\b(?:us election|presidential election|election)\b/,
];

function findMarketReference(message: string, context: ConversationContext, allowActiveFallback = true): ConversationMarket | undefined {
  const markets = context.markets ?? [];
  const text = clean(message);
  const ordinal: Record<string, number> = { first: 0, "1st": 0, one: 0, second: 1, "2nd": 1, two: 1, third: 2, "3rd": 2, three: 2, fourth: 3, "4th": 3, four: 3, fifth: 4, "5th": 4, five: 4 };
  const ordinalMatch = text.match(/\b(first|1st|one|second|2nd|two|third|3rd|three|fourth|4th|four|fifth|5th|five)\b/);
  if (ordinalMatch) return markets[ordinal[ordinalMatch[1] ?? ""] ?? -1];
  // A named market in the current message outranks the workspace selection.
  // Requiring every meaningful subject word avoids treating a partial overlap
  // (for example Bitcoin vs. Arsenal) as a market reference.
  const namedSubject = extractExplicitSubject(message);
  if (namedSubject) {
    const subjectWords = namedSubject.toLowerCase().match(/[a-z0-9]+/g)?.filter((word) => !["market", "prediction", "the", "a", "an"].includes(word)) ?? [];
    const named = markets.find((market) => {
      const marketWords = new Set(market.question.toLowerCase().match(/[a-z0-9]+/g) ?? []);
      return subjectWords.length > 0 && subjectWords.every((word) => marketWords.has(word));
    });
    if (named) return named;
    return undefined;
  }
  if (allowActiveFallback && context.activeMarketId) {
    const active = markets.find((market) => market.id === context.activeMarketId);
    if (active) return active;
  }
  return allowActiveFallback && markets.length === 1 ? markets[0] : undefined;
}

export function extractExplicitSubject(message: string): string | undefined {
  const match = message.trim().match(/^(?:what(?:'s| is) happening with|what(?:'s| is) going on with|what happened with|what changed (?:with|about)|what(?:'s| is) the latest on)\s+(?:the\s+)?(.+?)[?.!]*$/i);
  return match?.[1]?.replace(/\s+(?:since yesterday|since the last 24 hours?|today|this week|over the last week)$/i, "").trim();
}

function greetingReply(text: string): string {
  if (/^(thanks|thank you|thx|cheers)$/.test(text)) return "You’re welcome. Want to explore a market?";
  if (/^(goodbye|bye|see you|talk later)$/.test(text)) return "Bye! Come back whenever you’d like to explore markets.";
  if (/^how are you/.test(text)) return "I’m doing well, thanks for asking. What market are you curious about?";
  if (/^good morning/.test(text)) return "Good morning! What would you like to explore?";
  if (/^good afternoon/.test(text)) return "Good afternoon! What would you like to explore?";
  if (/^good evening/.test(text)) return "Good evening! What would you like to explore?";
  return "Hi! I’m MIRA. What would you like to explore?";
}

function topicKnowledgeReply(message: string, topic: string): string {
  const normalizedTopic = topic.trim().replace(/[?.!]+$/g, "").toLowerCase();
  if (/^(donald )?trump$/.test(normalizedTopic)) {
    return "Yes—Donald Trump is a prominent U.S. political figure and former president. Are you asking about his background, or about prediction markets involving him?";
  }
  if (/^(bitcoin|btc)$/.test(normalizedTopic)) {
    return "Yes—Bitcoin is a decentralized digital currency. Are you asking about Bitcoin generally, or its prediction markets?";
  }
  if (/^(ethereum|ether|eth)$/.test(normalizedTopic)) {
    return "Yes—Ethereum is a blockchain network, and ETH is its native asset. Are you asking about Ethereum generally, or its prediction markets?";
  }
  if (/^(the )?fed(eral reserve)?$/.test(normalizedTopic)) {
    return "Yes—the Federal Reserve is the U.S. central bank. Are you asking about its role or prediction markets related to its decisions?";
  }
  const displayTopic = message.trim().match(/(?:do you know about|do you know anything about|what do you know about|tell me about)\s+(.+?)[?.!]*$/i)?.[1]?.trim();
  return `I can help with ${displayTopic ?? topic}. Are you looking for a general overview, or prediction markets related to it?`;
}

export function classifyConversationMessage(message: string, context: ConversationContext = {}): ConversationDecision {
  const text = clean(message);
  if (/^(hi|hello|hey|heya|hiya|good morning|good afternoon|good evening|how are you|how are you doing|thanks|thank you|thx|cheers|goodbye|bye|see you|talk later)$/.test(text)) {
    return { intent: "greeting", requiresMarketData: false, reply: greetingReply(text) };
  }
  if (/\b(what can you do|what is mira|who are you|how can you help|what can i ask you|what can i ask|help me understand what you do)\b/.test(text)) {
    return { intent: "help", requiresMarketData: false, reply: "I can explore and search prediction markets, compare reported probabilities, find related markets, and explain the data Panta provides. Helping prepare Panta-powered actions is a future capability; it isn’t available yet." };
  }

  const explicitSubject = extractExplicitSubject(message);
  if (explicitSubject) {
    const referenced = findMarketReference(message, context);
    const normalizedSubject = explicitSubject.replace(/\b(?:market|prediction market)\b/gi, "").trim();
    return {
      intent: "research",
      requiresMarketData: true,
      marketId: referenced?.id,
      marketQuestion: referenced?.question,
      analysisQuestion: `Latest developments about ${normalizedSubject}`,
    };
  }

  const directMarketIntelligence = /\b(?:what do you see|give me (?:the )?full picture|full picture|summari[sz]e everything|what do you think|what don't we know|what do we know|what does the order ?book show|what does the research say|what are the conflicting reports|how are the related markets behaving|what's happening in this market|what is happening in this market|what is happening with this market|should i buy\s+(?:yes|no))\b/.test(text);
  if (directMarketIntelligence && (context.activeMarketId || context.researchMarketId || context.markets?.length)) {
    const referenced = findMarketReference(message, context);
    const marketId = referenced?.id ?? context.researchMarketId ?? context.activeMarketId ?? context.markets?.[0]?.id;
    const marketQuestion = referenced?.question ?? context.markets?.find((market) => market.id === marketId)?.question ?? context.researchQuestion;
    return { intent: "market_intelligence", requiresMarketData: true, marketId, marketQuestion, analysisQuestion: message.trim() };
  }
  if (directMarketIntelligence && !context.activeMarketId && !context.researchMarketId && !context.markets?.length) {
    return { intent: "clarification", requiresMarketData: false, reply: "Select a market first and I’ll assemble its current prices, order book, activity, research, related-market context, and uncertainty." };
  }

  const researchRefresh = /\b(what'?s changed|what has changed|what changed|has anything changed|anything new|what'?s new|research again|update(?: this)? research|refresh this|since yesterday|since your last analysis|since i last checked|check the latest|latest news|latest development|what happened today|give me the timeline)\b/.test(text);
  const ambiguousMarketQuestion = /^(what'?s happening|what is happening|what happened|what'?s going on|what is going on)$/.test(text);
  const researchAsk = /\b(research|deep analysis|full research|full report|latest news affecting|evidence for|evidence against|supports? yes|supports? no|strongest arguments? for|strongest arguments? against|mispriced|underpriced|overpriced|too bullish|too bearish|price make sense|priced at|what could cause .* market to move|compare .* probability .* evidence|why is .* market moving|what'?s happening with .* market|what is happening with .* market|what'?s happening with (?:the )?(?:fed|federal reserve|bitcoin|ethereum|election|inflation)|what'?s going on with (?:the )?(?:fed|federal reserve|bitcoin|ethereum|election|inflation)|what changed with (?:the )?(?:fed|federal reserve|bitcoin|ethereum|election)|what happened since i last checked|what changed since yesterday|what happened over the last week|what'?s the latest on|what is the latest on|is that confirmed|which sources confirm|are sources disagreeing|give me the timeline|how does this relate to the market|what markets are affected)\b/.test(text)
    || (/\b(research|investigate|analy[sz]e)\b/.test(text) && /\b(first|second|third|fourth|fifth|this market|that market|the market)\b/.test(text))
    || (Boolean(context.researchMarketId || context.activeMarketId) && ambiguousMarketQuestion);
  const researchFollowup = Boolean(context.researchMarketId && context.researchSummary && /\b(strongest argument|strongest source|against yes|for yes|for no|case for|case against|supports? yes|supports? no|other side|what did you find earlier|previous research|what changed|changed today|what's new|timeline|confirmed|disagreeing|affected markets?|since i last checked|does that make|cheap|expensive|evidence|sources|which source|since|latest|go deeper|what would invalidate|why do you think|last 24 hours?|last day)\b/.test(text))
    || Boolean(context.researchMarketId && context.researchSummary && /^(why|why\?|which source supports that|what supports yes|what supports no)$/.test(text));
  if (researchRefresh || researchAsk || researchFollowup) {
    const explicitOrdinal = /\b(first|1st|one|second|2nd|two|third|3rd|three|fourth|4th|four|fifth|5th|five)\b/.test(text);
    const explicitMarketPointer = explicitOrdinal
      || /\b(this market|that market|this one|that one)\b/.test(text)
      || /\b(research|investigate|look into|analy[sz]e)\s+(this|that|it)\b/.test(text);
    const referencedMarket = findMarketReference(message, context);
    if (explicitOrdinal && !referencedMarket) {
      return { intent: "clarification", requiresMarketData: false, reply: `I don’t have a ${text.match(/\b(first|1st|one|second|2nd|two|third|3rd|three|fourth|4th|four|fifth|5th|five)\b/)?.[0] ?? "matching"} market in the current list. Which market did you mean?` };
    }
    const researchMarket = explicitMarketPointer
      ? referencedMarket
      : ambiguousMarketQuestion
        ? findMarketReference(message, context)
        : (context.markets ?? []).find((market) => market.id === context.researchMarketId) ?? findMarketReference(message, context);
    if (explicitMarketPointer && !researchMarket) {
      return { intent: "clarification", requiresMarketData: false, reply: "Which market do you mean? Select one or name it, and I’ll research that market." };
    }
      const topicalQuery = message.trim()
      .replace(/\b(please|can you|could you|mira|research|deep|quick|full|analysis|report|this market|the market|latest news|what changed|what's changed|what has changed|evidence for|evidence against|whether|is|are|here|now)\b/gi, " ")
      .replace(/\s+/g, " ").trim();
    return { intent: "research", requiresMarketData: true, marketId: researchMarket?.id, marketQuestion: researchMarket?.question ?? context.researchQuestion, analysisQuestion: topicalQuery || message.trim() };
  }

  const spotAsset = /\b(bitcoin|btc)\b/.test(text) ? "BTC" : /\b(ethereum|ether|eth)\b/.test(text) ? "ETH" : undefined;
  const marketPriceContext = /\b(prediction market|markets?|contract|odds|yes price|no price)\b/.test(text);
  const asksForExplanation = /\b(explain|teach|beginner|simple|simpler|understand|what does .* mean|how does .* work|give me an example)\b/.test(text);
  if (spotAsset && !marketPriceContext && !asksForExplanation && /\b(price|worth|trading at|cost)\b/.test(text)) {
    return { intent: "spot_price", requiresMarketData: true, spotAsset };
  }

  if (context.pendingTrade && /^(cancel|never mind|nevermind|stop)$/i.test(text)) return { intent: "trade_cancel", requiresMarketData: false, reply: "Canceled the unfinished trade request. No quote or transaction will be used." };
  const pendingSideOrAmount = Boolean(context.pendingTrade && (/^(yes|no)$/i.test(text) || /^\$?\s*[\d,]+(?:\.\d{1,2})?\s*(?:usdc|usd)?$/i.test(text)));
  const pendingMarketAnswer = Boolean(context.pendingTrade && !context.pendingTrade.marketId && !context.pendingTrade.marketQuery && !pendingSideOrAmount);
  const draftReply = Boolean(context.pendingTrade && (pendingSideOrAmount || /\bactually make it\s+\$\s*\d/.test(text) || /\b(?:first|1st|second|2nd|third|3rd|fourth|4th|fifth|5th)\b/.test(text)));
  const asksForRecommendation = /\b(should i buy|would it be smart to buy|do you think .*\b(?:buy|trade)|what if i bought)\b/.test(text);
  const negatedTrade = /\b(?:don't|do not|never|no longer)\s+(?:want to\s+)?(?:buy|purchase|trade)\b/.test(text);
  const tradeRequest = !asksForRecommendation && !negatedTrade && (/\b(buy|purchase|trade|put\s+\$?\s*\d|how much would \$?\s*\d)/.test(text)
    || /\bprepare\s+(?:a\s+)?(?:\$?\d|yes|no)\b.*\b(?:trade|position|buy)\b/.test(text)
    || /\bactually make it\s+\$\s*\d/.test(text) || draftReply || pendingMarketAnswer);
  if (tradeRequest) {
    const side: "YES" | "NO" | undefined = /\bno\b/.test(text) ? "NO" : /\byes\b/.test(text) ? "YES" : context.pendingTrade?.outcome;
    // A numeric target in the market name (for example “Bitcoin reaching
    // $100,000”) is not an order amount. Only collect spend after an exact
    // market has been selected.
    const canReadAmount = !context.pendingTrade || Boolean(context.pendingTrade.marketId);
    const amountMatch = canReadAmount ? text.match(/\$\s*([\d,]+(?:\.\d{1,2})?)|\b([\d,]+(?:\.\d{1,2})?)\s*(?:usdc|usd)\b/) ?? (context.pendingTrade ? text.match(/^\s*([\d,]+(?:\.\d{1,2})?)\s*$/) : null) : null;
    const amount = amountMatch ? Number((amountMatch[1] ?? amountMatch[2] ?? "").replace(/,/g, "")) : context.pendingTrade?.amountUsdc;
    const reference = findMarketReference(message, context, !context.pendingTrade) ?? (context.pendingTrade?.marketId ? context.markets?.find((market) => market.id === context.pendingTrade?.marketId) : undefined) ?? (!context.pendingTrade && context.activeMarketId ? context.markets?.find((market) => market.id === context.activeMarketId) : undefined);
    const hasMarketPointer = /\b(this|that|it|second|first|third|fourth|fifth|one|market|contract)\b/.test(text);
    let tradeMarketQuery: string | undefined;
    if (pendingMarketAnswer && !reference) {
      tradeMarketQuery = message.trim();
    } else if (!reference && !hasMarketPointer && !context.pendingTrade?.marketQuery) {
      tradeMarketQuery = message.trim()
        .replace(/\b(?:buy|purchase|trade|put|prepare|for me|i want to|i'd like to|actually make it|how much would|how much|on the market|market for me|me|a|an)\b/gi, " ")
        .replace(/\b[\d,]+(?:\.\d{1,2})?\s*(?:usdc|usd)\b/gi, " ")
        .replace(/\b(?:yes|no|shares?|of|on|the|this|that|market|contract)\b/gi, " ")
        .replace(/\s+/g, " ").trim();
    }
    const resolvedQuery = context.pendingTrade?.marketQuery ?? tradeMarketQuery;
    const pendingDraft = {
      marketId: reference?.id ?? context.pendingTrade?.marketId,
      marketQuestion: reference?.question ?? context.pendingTrade?.marketQuestion,
      outcome: side,
      amountUsdc: amount,
      marketQuery: reference ? undefined : resolvedQuery || undefined,
    };
    if (!reference && !resolvedQuery) return { intent: "trade_request", requiresMarketData: false, reply: "Sure. Which market would you like to trade?", tradeQuestion: message.trim(), pendingTradeDraft: pendingDraft };
    if (resolvedQuery && !reference) return { intent: "trade_request", requiresMarketData: true, tradeOutcome: side, tradeAmountUsdc: amount, tradeMarketQuery: resolvedQuery, tradeQuestion: message.trim(), pendingTradeDraft: pendingDraft };
    if (!reference) return { intent: "trade_request", requiresMarketData: false, reply: "Which market would you like to trade?", pendingTradeDraft: pendingDraft };
    if (!side) return { intent: "trade_request", requiresMarketData: false, reply: "Would you like to buy YES or NO?", marketId: reference.id, marketQuestion: reference.question, tradeQuestion: message.trim(), pendingTradeDraft: pendingDraft };
    if (amount === undefined || !Number.isFinite(amount) || amount <= 0 || Number(amount.toFixed(2)) !== amount) return { intent: "trade_request", requiresMarketData: false, reply: "How much would you like to spend in USDC? Enter a positive amount with up to two decimal places.", tradeOutcome: side, marketId: reference.id, marketQuestion: reference.question, tradeQuestion: message.trim(), pendingTradeDraft: { ...pendingDraft, amountUsdc: undefined } };
    return { intent: "trade_request", requiresMarketData: true, tradeOutcome: side, tradeAmountUsdc: amount, marketId: reference.id, marketQuestion: reference.question, tradeQuestion: message.trim() };
  }

  const reference = findMarketReference(message, context);
  const hasOrdinal = /\b(first|1st|one|second|2nd|two|third|3rd|three|fourth|4th|four|fifth|5th|five)\b/.test(text);
  const hasContextPronoun = /\b(this market|that market|this contract|that contract|this one|that one|it|the market|the contract|tell me more|more about it)\b/.test(text)
    || (/^(why|why is that|why so)$/.test(text) && Boolean(reference));
  const compareWords = /\b(compare|versus|vs\.?|against)\b/.test(text);
  const refersToList = /\b(these markets|them|the two markets)\b/.test(text);

  if (compareWords && entityPatterns.filter((pattern) => pattern.test(text)).length > 1) {
    return { intent: "market_analysis", requiresMarketData: true, analysisQuestion: message.trim() };
  }

  if (compareWords && refersToList && !context.markets?.length) {
    return { intent: "clarification", requiresMarketData: false, reply: "Which markets would you like me to compare? Name them or find them first." };
  }

  if (/\b(most interesting|which one.*interesting|which .*looks? .*interesting)\b/.test(text)) {
    if (!context.markets?.length) return { intent: "clarification", requiresMarketData: false, reply: "Which markets should I compare? Find a list first, or name a market you’re considering." };
    return { intent: "market_analysis", requiresMarketData: true, analysisQuestion: message.trim() };
  }

  const topicSwitch = text.match(/\b(?:forget|ignore|drop)\s+[^.!?]+[.!?]\s*(?:show|find|search|look up|list)\s+(?:me\s+)?(?:prediction\s+)?markets?\s+(?:about|for|related to)\s+(.+)$/);
  if (topicSwitch?.[1]) {
    const topic = topicSwitch[1].replace(/[?.!]+$/g, "").trim();
    return { intent: "market_discovery", requiresMarketData: true, analysisQuestion: `Find prediction markets about ${topic}` };
  }

  if (compareWords && (hasOrdinal || hasContextPronoun || refersToList) && context.markets?.length) {
    const other = reference;
    const firstMention = /\b(first|1st|one)\b/.test(text) ? context.markets[0] : undefined;
    const active = context.markets.find((market) => market.id === context.activeMarketId);
    let left = active ?? (context.markets.length > 1 ? context.markets[1] : undefined);
    if (firstMention && left?.id === firstMention.id && context.markets.length > 1) left = context.markets.find((market) => market.id !== firstMention.id);
    const right = firstMention ?? (other?.id === left?.id ? context.markets.find((market) => market.id !== left?.id) : other);
    if (left && right && left.id !== right.id) {
      return { intent: "market_analysis", requiresMarketData: true, analysisQuestion: `Compare current probabilities for "${left.question}" and "${right.question}"` };
    }
    return { intent: "clarification", requiresMarketData: false, reply: "Which two markets would you like me to compare? You can name them or select them from the results." };
  }

  const explicitContextReference = hasOrdinal || hasContextPronoun;
  if (explicitContextReference) {
    if (!reference) return { intent: "clarification", requiresMarketData: false, reply: "Which market do you mean? Name it or ask me to find it first." };
    return { intent: "market_detail", requiresMarketData: true, marketId: reference.id, marketQuestion: reference.question };
  }

  if (/\b(probability|probabilities|odds|closing time|close date|volume|status|price)\b/.test(text) && reference) {
    return { intent: "market_detail", requiresMarketData: true, marketId: reference.id, marketQuestion: reference.question };
  }

  if (/^(what('?s| is) happening|what happened|what about|why|tell me more|more details|what is the probability|what('?s| is) the probability|when does it close)$/.test(text)) {
    return { intent: "clarification", requiresMarketData: false, reply: "What would you like me to look at — a specific market, topic, or event?" };
  }

  if (/\b(highest|most|largest|biggest|volume|liquidity|moving|movers|movement|compare|compar|related|diverg\w*|synchron\w*|aligned|together|shared event|same event|same news|contradiction|probabilit|odds|trend|trending|impact|sensitive|sensitivity|price change)\b/.test(text)
      || /\bwhat('?s| is) happening with\b/.test(text)) {
    return { intent: "market_analysis", requiresMarketData: true, analysisQuestion: message.trim() };
  }

  if (/\b(markets?|prediction markets?)\b/.test(text)
      && /\b(show|find|search|look up|list|available|about|related|explore|discover|what|which)\b/.test(text)) {
    return { intent: "market_discovery", requiresMarketData: true, analysisQuestion: message.trim() };
  }
  if (/^(what markets are available|show me markets|find prediction markets|search markets)$/.test(text)) {
    return { intent: "market_discovery", requiresMarketData: true, analysisQuestion: message.trim() };
  }
  if (/^(what about|and|how about)\s+.+$/.test(text) && /\b(bitcoin|btc|ethereum|eth|fed|federal reserve|trump|election|inflation|cpi)\b/.test(text)) {
    const topic = text.replace(/^(what about|and|how about)\s+/, "");
    return { intent: "market_discovery", requiresMarketData: true, analysisQuestion: `Find prediction markets about ${topic}` };
  }

  if (/\b(this market|that market|this contract|that contract|this one|that one|the second one|the first one|tell me more|more about this|why is this market|when does this market close|what is the probability)\b/.test(text)) {
    return reference
      ? { intent: "market_detail", requiresMarketData: true, marketId: reference.id, marketQuestion: reference.question }
      : { intent: "clarification", requiresMarketData: false, reply: "Which market should I look at? Share a name or select a market first." };
  }

  const topicQuestion = text.match(/^(?:do you know about|do you know anything about|what do you know about|tell me about)\s+(.+)$/);
  if (topicQuestion?.[1]) {
    return { intent: "general", requiresMarketData: false, reply: topicKnowledgeReply(message, topicQuestion[1]) };
  }

  return { intent: "general", requiresMarketData: false, reply: "I’m focused on prediction markets. I can help find markets or explain and compare the data they report. What topic are you curious about?" };
}

export function answerMarketDetail(message: string, market: Market): string {
  const text = clean(message);
  const resolved = market.status === "resolved";
  if (/\b(probabilit(?:y|ies)|odds|price|quote|showing)\b/.test(text)) {
    const yes = market.yesProbability === null ? "unavailable" : `$${market.yesProbability.toFixed(2)} per share`;
    const no = market.noProbability === null ? "unavailable" : `$${market.noProbability.toFixed(2)} per share`;
    const timestamp = market.updatedAt ? ` Panta lists the quote update time as ${new Date(market.updatedAt).toLocaleString()}.` : " Panta did not provide a quote update timestamp.";
    if (resolved) return `For resolved market “${market.question}”, Panta’s final reported quotes were YES ${yes} and NO ${no}. They are historical market values, not current prices or proof of an event’s likelihood.`;
    return `For “${market.question}”, Panta reports YES at ${yes} and NO at ${no}. These are market prices, not proof of the event’s likelihood.${timestamp}`;
  }
  if (/\b(close|end|resolve|when)\b/.test(text)) {
    if (resolved) return market.closeAt ? `“${market.question}” is resolved. Panta lists ${new Date(market.closeAt).toLocaleString()} as its close time; this is historical timing, not a future close.` : `“${market.question}” is resolved, but Panta did not provide its close time.`;
    return market.closeAt ? `“${market.question}” is scheduled to close ${new Date(market.closeAt).toLocaleString()}.` : `Panta hasn’t provided a closing time for “${market.question}”.`;
  }
  const facts = [
    market.category ? `Category: ${market.category}` : null,
    `Status: ${market.status}`,
    `${resolved ? "Final YES quote" : "YES quote"} ${market.yesProbability === null ? "unavailable" : `$${market.yesProbability.toFixed(2)} per share`}`,
    `${resolved ? "Final NO quote" : "NO quote"} ${market.noProbability === null ? "unavailable" : `$${market.noProbability.toFixed(2)} per share`}`,
    `${resolved ? "Reported historical volume" : "Volume"} ${market.volumeUsd === null ? "unavailable" : `${market.volumeUsd} USDC`}`,
    market.closeAt ? `${resolved ? "Historical close time" : "Closes"} ${new Date(market.closeAt).toLocaleString()}` : "Closing time unavailable",
    market.updatedAt ? `Provider quote updated ${new Date(market.updatedAt).toLocaleString()}` : "Provider quote update time unavailable",
  ].filter(Boolean);
  if (resolved && /\bwhy\b|interesting/.test(text)) return `This market is resolved. Its historical provider fields are: ${facts.join("; ")}. These values describe the resolved market and do not establish a current trading opportunity.`;
  if (/\bwhy\b|interesting/.test(text)) return `What stands out in “${market.question}” is the provider-reported information: ${facts.join("; ")}. This data alone doesn’t explain why the market moved.`;
  if (resolved) return `Here is Panta’s historical record for the resolved market “${market.question}”: ${facts.join("; ")}. Its final values are not current market probabilities.`;
  return `Here’s what Panta currently provides for “${market.question}”: ${facts.join("; ")}.`;
}
