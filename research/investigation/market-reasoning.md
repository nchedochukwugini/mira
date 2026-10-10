# MIRA Market Reasoning Rules

The reasoning layer in `lib/intelligence/market-reasoning.ts` is deterministic. It combines provider market values, complete MIRA-observed book snapshots, the current verified on-chain snapshot, decoded activity, and the latest persisted research run. It does not forecast outcomes.

## Signal classification

- A rise in Panta's reported YES price is classified as supporting the current YES price direction; a fall is classified as opposing that direction. Both remain price movement observations, not forecasts.
- Increased visible bid depth supports liquidity on that outcome's side. Decreased bid depth opposes that side's visible-liquidity signal.
- Increased visible ask depth opposes liquidity on that outcome's side. Decreased ask depth supports that side's visible-liquidity signal.
- Positive depth imbalance means more displayed bid than ask depth; negative means more displayed ask than bid depth. This classification is about displayed liquidity only. The ratio is never a probability.
- Spread widening or narrowing is neutral about outcome direction. It describes displayed quote width.
- Placement and cancellation instructions are neutral activity observations. A placement does not prove an order remained open or filled. Only a decoded `OrderMatched` event is classified as verified matched-trade evidence.
- Research evidence inherits only the persisted evidence engine's `supports-yes`, `supports-no`, or neutral direction. Unknown, mixed, or neutral evidence does not become directional.

These are rules for classifying observed signals, not evidence that a market outcome will happen.

## Observation and uncertainty rules

- Historical comparisons use actual complete MIRA snapshots and the current snapshot. Partial stored snapshots are excluded from change calculations. Identical observations are not duplicated when the slot or observation time matches.
- A change requires two real observations. No candles, interpolated points, or missing timestamps are created. The UI reports saved observation count separately from the comparison with the current snapshot.
- Panta market prices, order-book calculations, inferences, and retrieved evidence retain separate provenance. A book midpoint exists only when both sides are visible; an empty or one-sided book has no midpoint.
- Resolved markets are described as historical. Missing research, missing prices, unavailable history, partial books, sparse observations, and lack of verified matched trades are reported as uncertainty.
- Groq receives the structured reasoning result. Its wording is discarded in favor of deterministic text when it introduces unsupported cent values, percentages, research claims, matched-trade claims, or citations.

## Live check on 2026-10-07

Panta reported the previously verified GTA 6 market as active, secondary, graduated, and unresolved. The normal server `SOLANA_RPC_URL` was not configured, so a one-off read-only request used Solana's public mainnet RPC without changing environment files. The adapter's mainnet check passed.

The live CLOB read was complete at slot `454293473`: YES had a 1.00 USDC/share bid and no visible ask; NO had no visible bids or asks. There was no midpoint or spread for either outcome. YES depth imbalance was `+1.000`, labeled only as a visible-book liquidity ratio. The bounded activity set contained placement and cancellation instructions and no decoded matched trade. Neon returned two stored observations, one complete and one partial; the reasoning comparison used the complete saved observation plus the current live observation. No persisted research run was found for this market.

The public-RPC observation was read-only. Repeated unchanged books may not create another stored row because the existing persistence layer deduplicates unchanged visible depth.
