import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("./conversation.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const conversation = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`);
const capabilitySource = await readFile(new URL("./capabilities.ts", import.meta.url), "utf8");
const capabilityJavascript = ts.transpileModule(capabilitySource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const capabilities = await import(`data:text/javascript;base64,${Buffer.from(capabilityJavascript).toString("base64")}`);

const markets = [
  { id: "btc-1", question: "Will Bitcoin exceed $100k?" },
  { id: "btc-2", question: "Will Bitcoin reach $120k?" },
];

test("short greetings stay conversational and require no market data", () => {
  for (const message of ["Hi", "Hello", "Hey", "Good morning", "Thanks", "Goodbye"]) {
    const result = conversation.classifyConversationMessage(message);
    assert.equal(result.intent, "greeting");
    assert.equal(result.requiresMarketData, false);
    assert.equal(conversation.shouldInterpretWithGroq(result), false, message);
  }
  assert.equal(conversation.classifyConversationMessage("Hi").reply, "Hi! I’m MIRA. What would you like to explore?");
  assert.equal(conversation.classifyConversationMessage("Thank you").requiresMarketData, false);
});

test("unambiguous local turns do not need Groq interpretation", () => {
  for (const [message, context] of [["Hi", {}], ["What can you do?", {}], ["Cancel", { pendingTrade: { amountUsdc: 20, outcome: "YES" } }], ["Research it", {}]]) {
    const decision = conversation.classifyConversationMessage(message, context);
    assert.equal(conversation.shouldInterpretWithGroq(decision), false, message);
  }
  assert.equal(conversation.shouldInterpretWithGroq(conversation.classifyConversationMessage("What Bitcoin markets are available right now?")), true);
});

test("market reasoning followups use the selected market context without rediscovery", () => {
  for (const message of ["What's happening with this market?", "What supports YES?", "What about the order book?", "Has anything changed?", "Is this actually bullish?", "Why is this market showing 65% YES?"]) {
    assert.equal(conversation.asksForMarketReasoning(message), true, message);
  }
  assert.equal(conversation.asksForMarketReasoning("Hi"), false);
  assert.equal(conversation.asksForMarketReasoning("What changed since yesterday?"), false);
  const followup = conversation.classifyConversationMessage("What supports YES?", { markets, activeMarketId: "btc-2" });
  assert.equal(followup.marketId, "btc-2");
});

test("full-picture questions use descriptive synthesis and buying questions do not create a trade", () => {
  const context = { markets, activeMarketId: "btc-2" };
  for (const message of ["What do you see?", "Give me the full picture", "What do you think?", "What does the order book show?", "What does the research say?", "What don't we know?"]) {
    const result = conversation.classifyConversationMessage(message, context);
    assert.equal(result.intent, "market_intelligence", message);
    assert.equal(result.marketId, "btc-2", message);
    assert.equal(result.requiresMarketData, true);
    assert.equal(conversation.shouldInterpretWithGroq(result), false);
  }
  assert.equal(conversation.classifyConversationMessage("Should I buy YES?", context).intent, "market_intelligence");
  assert.equal(conversation.classifyConversationMessage("Buy $20 YES on this market", context).intent, "trade_request");
});

test("conversational trade preparation resolves an exact market before asking for side and amount", () => {
  const start = conversation.classifyConversationMessage("Prepare me a trade");
  assert.equal(start.intent, "trade_request");
  assert.equal(start.requiresMarketData, false);
  assert.equal(start.reply, "Sure. Which market would you like to trade?");
  assert.equal(start.pendingTradeDraft.marketId, undefined);
  assert.equal(start.pendingTradeDraft.marketQuery, undefined);

  const marketAnswer = conversation.classifyConversationMessage("Bitcoin reaching $100,000.", { pendingTrade: start.pendingTradeDraft });
  assert.equal(marketAnswer.requiresMarketData, true);
  assert.equal(marketAnswer.tradeMarketQuery, "Bitcoin reaching $100,000.");
  assert.equal(marketAnswer.marketId, undefined);
  assert.equal(marketAnswer.pendingTradeDraft.amountUsdc, undefined, "market target prices are never order sizes");

  const choices = [{ id: "btc-100", question: "Will Bitcoin reach $100,000?" }, { id: "btc-120", question: "Will Bitcoin reach $120,000?" }];
  const first = conversation.classifyConversationMessage("The first one.", { markets: choices, activeMarketId: "unrelated", pendingTrade: { ...marketAnswer.pendingTradeDraft, marketQuery: marketAnswer.tradeMarketQuery } });
  assert.equal(first.marketId, "btc-100");
  assert.equal(first.requiresMarketData, false);
  assert.equal(first.reply, "Would you like to buy YES or NO?");
  assert.equal(first.pendingTradeDraft.marketQuestion, choices[0].question);

  const yes = conversation.classifyConversationMessage("YES", { markets: choices, activeMarketId: "unrelated", pendingTrade: first.pendingTradeDraft });
  assert.equal(yes.requiresMarketData, false);
  assert.equal(yes.marketId, "btc-100");
  assert.equal(yes.reply, "How much would you like to spend in USDC? Enter a positive amount with up to two decimal places.");

  const amount = conversation.classifyConversationMessage("20", { markets: choices, activeMarketId: "unrelated", pendingTrade: yes.pendingTradeDraft });
  assert.equal(amount.requiresMarketData, true);
  assert.equal(amount.marketId, "btc-100");
  assert.equal(amount.tradeOutcome, "YES");
  assert.equal(amount.tradeAmountUsdc, 20);
});

test("capability questions return help without invoking market data", () => {
  const result = conversation.classifyConversationMessage("What can you do?");
  assert.equal(result.intent, "help");
  assert.equal(result.requiresMarketData, false);
  assert.match(result.reply, /search prediction markets/);
});

test("capability registry documents routing inputs, outputs, and safety for every capability", () => {
  const names = capabilities.MIRA_CAPABILITIES.map((item) => item.name);
  for (const name of ["conversation", "market-discovery", "market-analysis", "market-comparison", "research", "research-refresh", "research-followup", "trade-preparation", "portfolio", "help"]) assert.ok(names.includes(name));
  for (const item of capabilities.MIRA_CAPABILITIES) {
    assert.ok(item.description.length && item.inputRequirements.length && item.outputSchema.length && item.safetyConstraints.length && item.whenToUse.length, item.name);
  }
  assert.match(capabilities.getMiraCapability("trade-preparation").safetyConstraints.join(" "), /explicit confirmation/i);
});

test("market discovery and deterministic market analysis get distinct intents", () => {
  const discovery = conversation.classifyConversationMessage("Show me Bitcoin markets");
  assert.equal(discovery.intent, "market_discovery");
  assert.equal(discovery.requiresMarketData, true);
  const analysis = conversation.classifyConversationMessage("Which markets have the highest volume?");
  assert.equal(analysis.intent, "market_analysis");
  assert.equal(analysis.requiresMarketData, true);
});

const topicMarkets = [
  { id: "arsenal-market", question: "Will Arsenal win the next match?" },
  { id: "bitcoin-market", question: "Will Bitcoin exceed $100k?" },
];
const selectedArsenal = { markets: topicMarkets, activeMarketId: "arsenal-market", researchMarketId: "arsenal-market", researchQuestion: topicMarkets[0].question, researchSummary: "Saved Arsenal research" };

test("explicit Arsenal question keeps the matching market as research subject", () => {
  const result = conversation.classifyConversationMessage("What is happening with the Arsenal market?", selectedArsenal);
  assert.equal(result.intent, "research");
  assert.equal(result.marketId, "arsenal-market");
  assert.match(result.marketQuestion, /Arsenal/i);
});

test("explicit Bitcoin question overrides selected Arsenal context", () => {
  const result = conversation.classifyConversationMessage("What is happening with Bitcoin?", selectedArsenal);
  assert.equal(result.intent, "research");
  assert.equal(result.marketId, "bitcoin-market");
  assert.match(result.analysisQuestion, /Bitcoin/i);
  assert.doesNotMatch(result.marketQuestion, /Arsenal/i);
});

test("explicit Bitcoin freshness request does not borrow a different selected market", () => {
  const result = conversation.classifyConversationMessage("What changed with Bitcoin since yesterday?", selectedArsenal);
  assert.equal(result.intent, "research");
  assert.equal(result.marketId, "bitcoin-market");
  assert.match(result.analysisQuestion, /Bitcoin/i);
  assert.doesNotMatch(result.analysisQuestion, /Arsenal/i);
});

test("ambiguous question continues to use the selected market", () => {
  const result = conversation.classifyConversationMessage("What is happening?", selectedArsenal);
  assert.equal(result.intent, "research");
  assert.equal(result.marketId, "arsenal-market");
});

test("an explicit market switch wins over older research when the next question is ambiguous", () => {
  const result = conversation.classifyConversationMessage("What is happening?", {
    ...selectedArsenal,
    activeMarketId: "bitcoin-market",
    researchMarketId: "arsenal-market",
  });
  assert.equal(result.intent, "research");
  assert.equal(result.marketId, "bitcoin-market");
});

test("an explicit Arsenal question overrides selected Bitcoin context", () => {
  const result = conversation.classifyConversationMessage("What is happening with Arsenal?", { ...selectedArsenal, activeMarketId: "bitcoin-market", researchMarketId: "bitcoin-market" });
  assert.equal(result.intent, "research");
  assert.equal(result.marketId, "arsenal-market");
});

test("Bitcoin research without selected market has no inherited market ID", () => {
  const result = conversation.classifyConversationMessage("What is happening with Bitcoin?", {});
  assert.equal(result.intent, "research");
  assert.equal(result.marketId, undefined);
  assert.match(result.analysisQuestion, /Bitcoin/i);
});

test("a different explicit topic wins even when the selected market remains in context", () => {
  const result = conversation.classifyConversationMessage("What is happening with Ethereum?", selectedArsenal);
  assert.equal(result.intent, "research");
  assert.equal(result.marketId, undefined);
  assert.match(result.analysisQuestion, /Ethereum/i);
});

test("Bitcoin and Ethereum probability comparisons stay on the analysis path", () => {
  const result = conversation.classifyConversationMessage("Compare current Bitcoin and Ethereum probabilities");
  assert.equal(result.intent, "market_analysis");
  assert.equal(result.requiresMarketData, true);
  assert.equal(result.analysisQuestion, "Compare current Bitcoin and Ethereum probabilities");
});

test("an explicit asset comparison takes priority over an unrelated selected market", () => {
  const result = conversation.classifyConversationMessage("Compare current Bitcoin and Ethereum probabilities", {
    markets: [{ id: "rain", question: "Will it rain in London?" }],
    activeMarketId: "rain",
  });
  assert.equal(result.intent, "market_analysis");
  assert.equal(result.analysisQuestion, "Compare current Bitcoin and Ethereum probabilities");
});

test("specific market questions use the selected market context", () => {
  const result = conversation.classifyConversationMessage("Tell me about this market", {
    markets,
    activeMarketId: "btc-2",
  });
  assert.equal(result.intent, "market_detail");
  assert.equal(result.marketId, "btc-2");
});

test("an explicit Bitcoin spot price request ignores an unrelated selected market", () => {
  const result = conversation.classifyConversationMessage("What is the current price of bitcoin now", {
    markets: [{ id: "london-rain", question: "Will it rain in London before 9pm?" }],
    activeMarketId: "london-rain",
  });
  assert.equal(result.intent, "spot_price");
  assert.equal(result.spotAsset, "BTC");
  assert.equal(result.requiresMarketData, true);
});

test("ordinal follow-ups resolve against the prior displayed result order", () => {
  const result = conversation.classifyConversationMessage("Tell me about the second one", { markets });
  assert.equal(result.intent, "market_detail");
  assert.equal(result.marketId, "btc-2");
});

test("natural research requests use a dedicated research intent", () => {
  const context = { markets: [markets[0]], activeMarketId: markets[0].id };
  for (const message of ["Research this market", "Do a deep analysis of this market", "What's the latest news affecting this market?", "Find evidence for and against YES", "What are the strongest arguments for NO?", "Give me a full research report"]) {
    const result = conversation.classifyConversationMessage(message, context);
    assert.equal(result.intent, "research", message);
    assert.equal(result.requiresMarketData, true, message);
  }
});

test("event intelligence questions route through existing research intent and active market context", () => {
  const context = { markets: [{ id: "fed-1", question: "Will the Fed cut rates at the October meeting?" }], activeMarketId: "fed-1", researchMarketId: "fed-1", researchQuestion: "Will the Fed cut rates at the October meeting?", researchSummary: "Prior event research" };
  for (const question of ["What's happening?", "What's happening with the Fed?", "What changed since yesterday?", "What happened since I last checked?", "Give me the timeline", "Is that confirmed?", "Which sources confirm it?", "Are sources disagreeing?", "How does this relate to the market?", "What markets are affected?"]) {
    const decision = conversation.classifyConversationMessage(question, context);
    assert.equal(decision.intent, "research", question);
    assert.equal(decision.marketId, "fed-1", question);
    assert.notEqual(decision.analysisQuestion, context.researchQuestion, question);
    assert.ok(decision.analysisQuestion?.trim(), question);
  }
});

test("refresh language requests fresh research using the retained market context", () => {
  const result = conversation.classifyConversationMessage("What's changed?", {
    markets: [markets[0]], activeMarketId: markets[0].id,
    researchMarketId: markets[0].id, researchQuestion: markets[0].question, researchSummary: "Prior sourced research",
  });
  assert.equal(result.intent, "research");
  assert.equal(result.marketId, markets[0].id);
});

test("research follow-ups keep the researched market and recognize both sides and source questions", () => {
  const context = { markets, activeMarketId: "btc-1", researchMarketId: "btc-2", researchQuestion: markets[1].question, researchSummary: "Prior report" };
  for (const message of ["Research the second one", "What supports YES?", "What about the other side?", "Why do you think YES?", "Which source supports that?", "What changed?", "Go deeper", "What did you find earlier?"]) {
    const result = conversation.classifyConversationMessage(message, context);
    assert.equal(result.intent, "research", message);
    assert.equal(result.marketId, "btc-2", message);
  }
});

test("supporting and opposing YES/NO follow-ups stay attached to the researched market", () => {
  const context = { markets, activeMarketId: "btc-1", researchMarketId: "btc-2", researchQuestion: markets[1].question, researchSummary: "Prior report" };
  for (const message of ["What supports YES?", "What supports NO?", "Give me the case against YES", "Now give me the case for NO"]) {
    const result = conversation.classifyConversationMessage(message, context);
    assert.equal(result.intent, "research", message);
    assert.equal(result.marketId, "btc-2", message);
  }
});

test("explicit research references override stale research and invalid ordinals clarify", () => {
  const context = { markets, activeMarketId: "btc-1", researchMarketId: "btc-1", researchQuestion: markets[0].question, researchSummary: "Earlier report" };
  assert.equal(conversation.classifyConversationMessage("Research the second one", context).marketId, "btc-2");
  const oneMarket = { ...context, markets: [markets[0]] };
  const missingSecond = conversation.classifyConversationMessage("Research the second one", oneMarket);
  assert.equal(missingSecond.intent, "clarification");
  assert.equal(missingSecond.requiresMarketData, false);
  const noActiveMarket = conversation.classifyConversationMessage("Research it", { markets });
  assert.equal(noActiveMarket.intent, "clarification");
  assert.equal(noActiveMarket.requiresMarketData, false);
});

test("underpricing language is routed to grounded research", () => {
  for (const message of ["Is the market underpriced?", "Is it too bullish?", "Does the current price make sense?"]) {
    assert.equal(conversation.classifyConversationMessage(message, { markets: [markets[0]], activeMarketId: markets[0].id }).intent, "research", message);
  }
});

test("explicit topic switches remove the old topic from the market query", () => {
  const result = conversation.classifyConversationMessage("Actually, forget Bitcoin. Show me markets about the Fed.", {
    markets, activeMarketId: "btc-2",
  });
  assert.equal(result.intent, "market_discovery");
  assert.equal(result.analysisQuestion, "Find prediction markets about the fed");
  assert.doesNotMatch(result.analysisQuestion, /bitcoin/i);
});

test("relative market-interest questions use the known list or clarify when it is missing", () => {
  const contextual = conversation.classifyConversationMessage("Which one looks most interesting?", { markets, activeMarketId: "btc-1" });
  assert.equal(contextual.intent, "market_analysis");
  assert.equal(contextual.requiresMarketData, true);
  const ambiguous = conversation.classifyConversationMessage("Which one looks most interesting?");
  assert.equal(ambiguous.intent, "clarification");
  assert.equal(ambiguous.requiresMarketData, false);
});

test("research requests stay separate from trade preparation", () => {
  const research = conversation.classifyConversationMessage("Is this market mispriced?", { markets: [markets[0]], activeMarketId: markets[0].id });
  assert.equal(research.intent, "research");
  const trade = conversation.classifyConversationMessage("Buy $20 YES on this market", { markets: [markets[0]], activeMarketId: markets[0].id });
  assert.equal(trade.intent, "trade_request");
});

test("contextual comparison rewrites references to actual previous market titles", () => {
  const result = conversation.classifyConversationMessage("Compare it with the first one", { markets, activeMarketId: "btc-2" });
  assert.equal(result.intent, "market_analysis");
  assert.match(result.analysisQuestion, /Will Bitcoin reach \$120k/);
  assert.match(result.analysisQuestion, /Will Bitcoin exceed \$100k/);
});

test("resolved market details label normalized quotes and provider values as historical", () => {
  const resolved = {
    id: "btc-final", question: "Will Bitcoin hit $85,000?", category: "crypto", status: "resolved",
    yesProbability: 1, noProbability: 0, volumeUsd: 7, closeAt: "2026-10-04T00:00:00.000Z",
  };
  const prices = conversation.answerMarketDetail("What are the probabilities?", resolved);
  assert.match(prices, /final reported quotes/);
  assert.match(prices, /historical market values, not current prices or proof/);
  assert.doesNotMatch(prices, /currently reports/i);
  const details = conversation.answerMarketDetail("Tell me more", resolved);
  assert.match(details, /historical record/);
  assert.match(details, /Final YES quote \$1\.00 per share/);
  assert.match(details, /Reported historical volume 7 USDC/);
  assert.match(details, /not current market probabilities/);
});

test("active Panta quote explanations use per-share price units and disclose missing timestamps", () => {
  const active = { id: "btc-live", question: "Will Bitcoin reach $85,000?", category: "crypto", status: "active", yesProbability: 0.65, noProbability: 0.35, volumeUsd: 100, liquidityUsd: null, closeAt: null, updatedAt: null };
  const answer = conversation.answerMarketDetail("Why is this market showing 65% YES?", active);
  assert.match(answer, /\$0\.65 per share/);
  assert.match(answer, /not proof of the event’s likelihood/);
  assert.match(answer, /did not provide a quote update timestamp/);
  assert.doesNotMatch(answer, /65\.0%/);
});

test("a comparison request uses the previously shown market list", () => {
  const result = conversation.classifyConversationMessage("Compare these markets", { markets, activeMarketId: "btc-1" });
  assert.equal(result.intent, "market_analysis");
  assert.match(result.analysisQuestion, /Will Bitcoin exceed \$100k/);
  assert.match(result.analysisQuestion, /Will Bitcoin reach \$120k/);
});

test("cross-market divergence followups stay attached to the restored market list", () => {
  const decision = conversation.classifyConversationMessage("Why did they diverge?", { markets, activeMarketId: "btc-1", previousQuestion: "Compare Bitcoin markets" });
  assert.equal(decision.intent, "market_analysis");
  assert.equal(decision.requiresMarketData, true);
});

test("a comparison without market context asks which markets to compare", () => {
  const result = conversation.classifyConversationMessage("Compare these markets");
  assert.equal(result.intent, "clarification");
  assert.equal(result.requiresMarketData, false);
});

test("ambiguous questions ask for clarification without market lookup", () => {
  const result = conversation.classifyConversationMessage("What’s happening?");
  assert.equal(result.intent, "clarification");
  assert.equal(result.requiresMarketData, false);
  assert.match(result.reply, /what would you like me to look at/i);
});

test("unrelated questions do not accidentally start a market search", () => {
  const result = conversation.classifyConversationMessage("What is 2 + 2?");
  assert.equal(result.intent, "general");
  assert.equal(result.requiresMarketData, false);
});

test("general questions about a person are answered conversationally without market search", () => {
  const result = conversation.classifyConversationMessage("Do you know about Trump?");
  assert.equal(result.intent, "general");
  assert.equal(result.requiresMarketData, false);
  assert.match(result.reply, /prominent U\.S\. political figure and former president/);
  assert.match(result.reply, /prediction markets involving him/);
});

test("a general why question does not get captured by the selected market", () => {
  const result = conversation.classifyConversationMessage("Why is the sky blue?", {
    markets: [{ id: "rain", question: "Will it rain in London?" }],
    activeMarketId: "rain",
  });
  assert.equal(result.intent, "general");
  assert.equal(result.requiresMarketData, false);
});

test("a short why follow-up can refer to the active market", () => {
  const result = conversation.classifyConversationMessage("Why?", {
    markets,
    activeMarketId: "btc-2",
  });
  assert.equal(result.intent, "market_detail");
  assert.equal(result.marketId, "btc-2");
});

test("an explicit request for markets about Trump still searches Panta", () => {
  const result = conversation.classifyConversationMessage("Show me markets about Trump");
  assert.equal(result.intent, "market_discovery");
  assert.equal(result.requiresMarketData, true);
});

test("trade requests resolve side, amount, and ordinal market without signing or execution", () => {
  const decision = conversation.classifyConversationMessage("Buy $20 YES on the second one", { markets, activeMarketId: "btc-1" });
  assert.equal(decision.intent, "trade_request");
  assert.equal(decision.requiresMarketData, true);
  assert.equal(decision.marketId, "btc-2");
  assert.equal(decision.tradeOutcome, "YES");
  assert.equal(decision.tradeAmountUsdc, 20);
  assert.equal(decision.reply, undefined);
  assert.equal(decision.requiresWalletConfirmation, undefined);
});

test("trade intent asks for the missing amount or side instead of preparing a trade", () => {
  const missingAmount = conversation.classifyConversationMessage("Buy YES on this market", { markets, activeMarketId: "btc-2" });
  assert.equal(missingAmount.requiresMarketData, false);
  assert.match(missingAmount.reply, /How much.*USDC/);
  assert.equal(missingAmount.pendingTradeDraft.marketId, "btc-2");
  const missingSide = conversation.classifyConversationMessage("Buy $20 on this market", { markets, activeMarketId: "btc-2" });
  assert.equal(missingSide.requiresMarketData, false);
  assert.match(missingSide.reply, /YES or NO/);
  assert.equal(missingSide.pendingTradeDraft.amountUsdc, 20);
});

test("recognizes YES and NO purchase requests while keeping market-only trade requests incomplete", () => {
  const yes = conversation.classifyConversationMessage("Buy $20 USDC YES on the second one", { markets, activeMarketId: "btc-1" });
  const no = conversation.classifyConversationMessage("Buy $25 NO on the first one", { markets, activeMarketId: "btc-2" });
  const unspecified = conversation.classifyConversationMessage("Trade this market for me", { markets, activeMarketId: "btc-1" });
  assert.equal(yes.tradeOutcome, "YES");
  assert.equal(yes.tradeAmountUsdc, 20);
  assert.equal(no.tradeOutcome, "NO");
  assert.equal(no.tradeAmountUsdc, 25);
  assert.equal(unspecified.requiresMarketData, false);
  assert.match(unspecified.reply, /YES or NO/);
});

test("trade clarification followups complete the draft and cancellation clears it", () => {
  const pendingTrade = { marketId: "btc-2", marketQuestion: markets[1].question, outcome: "YES" };
  const amount = conversation.classifyConversationMessage("20", { markets, pendingTrade });
  assert.equal(amount.intent, "trade_request");
  assert.equal(amount.tradeAmountUsdc, 20);
  assert.equal(amount.marketId, "btc-2");
  const cancelled = conversation.classifyConversationMessage("cancel", { markets, pendingTrade });
  assert.equal(cancelled.intent, "trade_cancel");
  assert.match(cancelled.reply, /Canceled/);
});

test("trade analysis questions never turn into a prepared action", () => {
  const decision = conversation.classifyConversationMessage("Should I buy $20 YES on this market?", { markets, activeMarketId: "btc-2" });
  assert.notEqual(decision.intent, "trade_request");
  assert.notEqual(conversation.classifyConversationMessage("Don't buy $20 YES").intent, "trade_request");
});
