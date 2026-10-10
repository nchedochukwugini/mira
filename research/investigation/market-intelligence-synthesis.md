# Phase 6 — Market Intelligence Synthesis & Assessment

## Purpose and architecture

Phase 6 adds a deterministic assembly layer in `lib/intelligence/market-intelligence.ts`. The `/api/analyze` route retrieves the selected Panta market, the persisted on-chain CLOB snapshot and microstructure history, existing Market Reasoning, persisted research and Event Intelligence, and provider-linked or conversation-selected related markets. It passes these existing outputs into one bounded `MarketIntelligenceContext` and persists the resulting view as conversation state. `MarketIntelligenceView` presents the same context and its explanation in the conversation.

The synthesis reuses Panta, the Solana RPC/CLOB adapter, snapshot persistence, microstructure calculations, Market Reasoning, Event Intelligence, the evidence store, Cross-Market Intelligence, Groq, and Neon conversation persistence. It creates no parallel discovery, research, or database service. Provider failures are isolated with settled requests; available sources remain usable and their gaps are reported.

**Phase 6 is not a prediction system.** MIRA describes and explains observable market conditions and available evidence. It does not determine which outcome will occur. Prices remain provider-reported market prices, never MIRA outcome probabilities. A one-sided book is visible liquidity, never an inferred probability. Cross-market timing or movement does not establish causation. The synthesis does not recommend or execute trades; an explicit trade request continues through the existing quote, build, ticket, wallet confirmation, and verification flow.

## Context and deterministic rules

The context retains market identity, category, provider/status/phase, available timestamps, resolution state, YES/NO quotes, provider completeness, price observations, book sides and freshness, activity classes, the existing reasoning output, event timeline/diff, research evidence, related-market report, observed changes, data quality, and uncertainty. Missing fields remain null or unavailable. Resolved markets are labeled historical and skip Groq synthesis.

Price history is derived only from persisted, complete observations and the current provider quote. CLOB state and microstructure are reused as calculated by their existing services; the synthesis does not calculate new book metrics. Order placement, cancellation, unknown activity, and verified `OrderMatched` records remain separate. The absence of a decoded match is described as no verified matched trade, not as proof that none occurred.

Changes require timestamped observations or a persisted Event Intelligence diff with a retained prior baseline. An `insufficient` event diff cannot generate a claim that evidence or event facts changed. Zero-valued depth deltas are omitted. With insufficient history, MIRA says that a meaningful change cannot be established. Provider observation, event/publication time, research retrieval time, persistence time, and context generation time remain separate fields.

## Evidence and contradictions

At most six research items receive compact references `E1` through `E6`; the reference map points back to the existing evidence IDs. Evidence is categorized by its observed function (reported fact, context, change, contradiction, uncertainty, market activity, or event), not into outcome-prediction buckets. Titles, source, quality/reliability, publication time, retrieval time, and URL remain visible. Undated sources stay undated. Event contradictions come from Event Intelligence; related-market disagreements come from Cross-Market Intelligence. A YES/NO price difference alone is not an evidence contradiction.

The model receives a bounded structured context: up to six evidence items, eight timeline entries, eight reasoning signals, four compact related-market summaries, and limited change/uncertainty lists. It does not receive full CLOB or cross-market histories. It may explain and organize this context, but may not invent prices, metrics, dates, evidence, events, market relationships, probabilities, causal conclusions, or trades. The grounding validator checks evidence IDs, factual wording against supplied context, unsupported changes, unknown names, timestamps/numbers, prediction language, causal language, and trade recommendations.

## Fallback and graceful degradation

If Groq times out, fails, returns malformed JSON, or fails grounding, a deterministic explanation is returned from the same context. Missing Panta data prevents a current market statement, while retrieved research and event context remain available and cited. Missing CLOB, research, or cross-market data does not erase other available inputs and is surfaced as a limitation. Failed persistence is not represented as historical context. The deterministic response remains descriptive and includes open questions and uncertainty.

## Conversation, UI, and trade safety

Full-picture, market-state, order-book, research, uncertainty, and “Should I buy YES/NO?” questions route to the descriptive market-intelligence intent when a market is selected. A purchase command remains an existing trade request. The intelligence response streams progress only at actual assembly stages (market lookup, saved book/research retrieval, activity/event review, related-market comparison when available, and explanation grounding). The compact conversation panel shows market source/completeness/freshness, prices, actual changes, book state, activity verification, event and source times, evidence links, related-market movement, uncertainty, and the grounded explanation.

## Known limitations

Price changes are limited to saved complete microstructure observations and provider quotes; sparse persistence can leave price history unavailable. Timeline coverage and source publication dates depend on retrieved evidence. Market price fields retain the existing provider type name `yesProbability`/`noProbability` internally, but Phase 6 labels and presents them explicitly as prices. Groq's prose validator is intentionally conservative about numbers, dates, names, and unsupported claim types; rate limits or rejected prose use deterministic synthesis.
