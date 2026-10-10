# Panta → Solana CLOB investigation

**Scope:** read-only investigation using MIRA's configured Panta live API key and public Solana mainnet RPC. No production files, trading flow, wallet, or transactions were changed or used. Checked 2026-10-07.

## Findings from previous resolved-market investigation

| Finding | Status | Evidence / confidence |
|---|---|---|
| Panta market | **Verified** | Panta live `GET /markets/{id}/` returned market ID `6yEBmxJu2oWdubFVKZshVVUpLLsXd61csSfmf8y4Qtwd`, phase `secondary`, `isGraduated: true`, `resolved: true`, and program ID `6gM5afTQBq5VZCfgpGqcsqzfWd5maLSCKWtGjbEobZMp`. The API title was blank. The market account's raw RPC data contains the question “Will a female housemate win Big Brother Naija Season 11” and its resolution rule. The match is strong because the same key is returned as the market ID and is owned by the API-listed program. |
| Market/account identity | **Verified** | `marketId` is a valid Solana public key and is passed as a writable transaction account. `getAccountInfo(marketId)` returned a 2,982-byte account owned by the API-listed program. |
| Secondary-market activity | **Verified as a secondary limit-order instruction; fill is not verified** | Panta `GET /markets/{id}/trades/` returned signature `4jLSVRGo3ALFrdWDjpbcej9ZuJV7zuPzFvr8GXjYv1DBVpKRhvHi4myTbe8NSL1nHM1dFUwnFuxPfSBGTdq3YHWx`, marked `isPrimary: false`, `kind: buy`, `side: yes`, `shares: 1.921152`. Mainnet RPC returned a successful transaction at slot `453055714`, block time `1791063243`, with program log `Instruction: SecondaryLimitOrderUsdc`. This proves secondary limit-order activity, but does not by itself establish that the order matched or that a fill occurred. |
| CLOB program | **Verified** | Panta market detail lists `programId` `6gM5afTQBq5VZCfgpGqcsqzfWd5maLSCKWtGjbEobZMp`; the transaction invokes that exact program as its top-level instruction, emits the `SecondaryLimitOrderUsdc` instruction log, and succeeds. `getAccountInfo` says it is executable and owned by `BPFLoaderUpgradeab1e11111111111111111111111`. |
| Market/order-account relationship | **Partially verified** | The transaction passes the market account writable. It also passes program-owned accounts. A 269-byte account, `8EMEDskHGi5xxvKPhyXFGCfzzE3kdEi15GB3TJkFgp8g`, has the same 8-byte data prefix and stores the market public-key bytes at data offset 41. An RPC `getProgramAccounts` query by program owner, data size 269, and those observed market bytes at offset 41 returned this one account. This is **strongly indicative** of a market-associated order record, but without a published IDL/source its exact type and semantics remain unknown. |
| Individual order state | **Inferred** | The transaction creates program-owned account `5ACGFbBQitAbxQExQ5sbWGrVzWWkcFrKNkHhazzsVXf9` with space 269; it shares the 8-byte prefix with the market-associated 269-byte account. The current account bytes after that prefix are zero and do not contain this market key at offset 41. Treating these accounts as the same order-state type is a strong inference, not a proven schema. |
| Bids/asks and levels | **Unknown / not decoded** | RPC confirms accounts can be fetched and market-associated 269-byte state can be enumerated. No official IDL or source was found: `https://idl.solana.com/api/idl?programId=6gM5afTQBq5VZCfgpGqcsqzfWd5maLSCKWtGjbEobZMp&cluster=mainnet-beta` returned 404 (“No IDL found for this program”). The fetched bytes cannot responsibly be mapped to side, limit price, remaining size, or bid/ask levels from this evidence. |
| Trade/fill fields | **Partially verified / fill status unknown** | Panta's trade row supplies side and shares but has null USDC amount fields for this secondary record. The transaction includes a successful SPL-token transfer of 14,999 base units (0.014999 USDC) between program-related token accounts. That transfer alone is not enough to identify trade consideration or a seller payout. No decoded fill event or independently verified execution price/size was established. |
| Panta reconciliation | **Partial; API fields conflict** | The same market detail says `secondaryVolume: 0` and has null secondary prices/volume, although its trades endpoint returns the non-primary record. The trade record's amount fields are null. Therefore a bid/ask snapshot or fill price cannot be reconciled against Panta's observable market state. Panta's public description says secondary trading uses an open CLOB and trades execute when orders are accepted ([How It Works](https://www.panta.market/how-it-works)); it does not document this program's binary account layout. |

## Transaction evidence

- Signature: [`4jLSVRGo3ALfrdWDjpbcej9ZuJV7zuPzFvr8GXjYv1DBVpKRhvHi4myTbe8NSL1nHM1dFUwnFuxPfSBGTdq3YHWx`](https://solscan.io/tx/4jLSVRGo3ALfrdWDjpbcej9ZuJV7zuPzFvr8GXjYv1DBVpKRhvHi4myTbe8NSL1nHM1dFUwnFuxPfSBGTdq3YHWx)
- Market: [`6yEBmxJu2oWdubFVKZshVVUpLLsXd61csSfmf8y4Qtwd`](https://solscan.io/account/6yEBmxJu2oWdubFVKZshVVUpLLsXd61csSfmf8y4Qtwd)
- Program: [`6gM5afTQBq5VZCfgpGqcsqzfWd5maLSCKWtGjbEobZMp`](https://solscan.io/account/6gM5afTQBq5VZCfgpGqcsqzfWd5maLSCKWtGjbEobZMp)
- Signer: `BZvaJBkAHjtiE4tGVDFDRAxyAADbvqNqjUsb51VezY1e` (signer, writable)
- Other notable program-owned accounts passed to the instruction:
  - `3i55PXUsYvpzkitXu9ix8fshjoDHeiFmmxDeQg82ygJG` — 202 bytes; embeds the market key at offset 9 and signer key at offset 41. Likely user/market state; exact type unknown.
  - `5EGgwii4QovoEHjUZyeRfsPor23kia77DFAzLo9hB2Jc` — 218 bytes; embeds the market key at offset 9; exact type unknown.
  - `5ACGFbBQitAbxQExQ5sbWGrVzWWkcFrKNkHhazzsVXf9` — newly allocated 269-byte program-owned account; exact type unknown.
  - `8EMEDskHGi5xxvKPhyXFGCfzzE3kdEi15GB3TJkFgp8g` — existing 269-byte program-owned account; embeds the market key at offset 41; likely order state, exact type/side unknown.
  - `CvaKEKFtxtjgY3oMFpT6pAAbAFnCfnUzyxztCHYirgTB` — 202 bytes; embeds the market key at offset 9; exact type unknown.
- Logs: outer invocation of the Panta program; `Instruction: SecondaryLimitOrderUsdc`; successful System Program account creation (space 269, owner = Panta program); successful Token Program transfer; Panta program success. `meta.err` was null.
- Instruction account flags and bytes are available from the reproducible RPC query below. The key market account and candidate order account were writable. The signer above was the transaction signer.

## Reproducible queries

Panta API calls used the configured server-side `X-Api-Key`; the key is intentionally omitted here:

```text
GET https://live-api.panta.market/api/v1/markets/6yEBmxJu2oWdubFVKZshVVUpLLsXd61csSfmf8y4Qtwd/
GET https://live-api.panta.market/api/v1/markets/6yEBmxJu2oWdubFVKZshVVUpLLsXd61csSfmf8y4Qtwd/trades/
```

Mainnet RPC calls (public endpoint; `@solana/web3.js` is already installed in MIRA):

```json
{"jsonrpc":"2.0","id":1,"method":"getTransaction","params":["4jLSVRGo3ALfrdWDjpbcej9ZuJV7zuPzFvr8GXjYv1DBVpKRhvHi4myTbe8NSL1nHM1dFUwnFuxPfSBGTdq3YHWx",{"encoding":"jsonParsed","maxSupportedTransactionVersion":0,"commitment":"finalized"}]}
```

```json
{"jsonrpc":"2.0","id":1,"method":"getProgramAccounts","params":["6gM5afTQBq5VZCfgpGqcsqzfWd5maLSCKWtGjbEobZMp",{"encoding":"base64","withContext":true,"filters":[{"dataSize":269},{"memcmp":{"offset":41,"bytes":"6yEBmxJu2oWdubFVKZshVVUpLLsXd61csSfmf8y4Qtwd"}}]}]}
```

The second query returned one account, `8EMEDskHGi5xxvKPhyXFGCfzzE3kdEi15GB3TJkFgp8g`. Offset 41 was selected from the observed raw bytes; it is not an assumed protocol layout. This is an investigation query, not yet a safe general-purpose order-book filter.

## Search and limits

The Panta catalog returned 93 records in the live scan: 2 primary, 88 resolved, and 3 secondary. The three unresolved secondary-phase candidates had no `isPrimary: false` trade in the trade histories observed for them. The API's historical secondary records identified additional resolved markets, but their inspected signatures also logged `SecondaryLimitOrderUsdc`; they did not provide a clear fill event or decoded execution. The selected market is therefore the best traceable historical secondary example, **not proof of a current active market or a completed match**. A subsequent market scan can change as Panta updates its catalog/history.

MIRA's current integration normalizes Panta `marketId` to its internal `Market.id`; its Panta adapter has market discovery/detail/trade-history and primary quote/build/submit methods. It does not expose a Solana RPC URL in `.env.example` (only the client wallet's public `NEXT_PUBLIC_SOLANA_RPC_URL`, defaulting to devnet), and it has no CLOB account decoder. The investigation used public mainnet RPC because the configured Panta API key is live. MIRA already has `@solana/web3.js` installed.

## Exact unknowns from previous resolved-market investigation

1. Whether the selected `SecondaryLimitOrderUsdc` instruction matched another order in that transaction or left an open order; public API marks it as a buy/trade, but the on-chain evidence inspected here does not establish a fill.
2. The official account type names/layouts, PDA seeds, and semantics for the 269-, 218-, 202-, and 89-byte program-owned accounts.
3. Which account(s) are the canonical bid and ask structures, and how side, price, remaining quantity, and ordering are encoded.
4. Whether one account per order is the complete book or whether another index/page structure must also be queried.
5. A reliable mapping from on-chain order/accept/fill/cancel events to Panta's trade API rows, price, USDC size, and UI display.
6. Whether a currently unresolved secondary market has a matched trade and accessible live order book. The live scan found no such fill verifiable from the available records.

## Recommended next step for MIRA

Ask Panta for the canonical deployed program IDL (or source release), including account definitions, PDA seeds, order placement/accept/cancel/fill instruction semantics, and a known filled secondary transaction with expected order-book levels. Then reproduce that sample from mainnet RPC and reconcile it with Panta's UI/API before adding any read-only CLOB adapter. Keep the current trading flow untouched until the sample proves both fill semantics and bid/ask decoding.

## Active Secondary Market Investigation

**Status checked:** 2026-10-07. This section supersedes the earlier conclusion that no public IDL or book decoder was available. It also supersedes the earlier “currently active market unknown” finding. The older resolved-market trace above remains a separate historical example.

### Selected market

- **Market:** “Will GTA 6 release on November 19th, 2026” (question decoded from the on-chain Event account; Panta API title was blank in the latest response).
- **Market ID / Event account:** `GXh9iztJTm5v6qDWnR4YcKHbSc3AUZ2VEMGfKEegd92V`
- **Program:** `6gM5afTQBq5VZCfgpGqcsqzfWd5maLSCKWtGjbEobZMp`
- **Panta API state:** `phase: secondary`, `status: secondary_active`, `isActive: true`, `isResolved: false`, `isCancelled: false`, `isGraduated: true`; `secondaryVolume: 0`, prices null. The Event account is 2,982 bytes, owned by the Panta program, and decodes to `is_active: true`, `is_graduated: true`, `is_resolved: false`, `is_cancelled: false`, `total_trades: 0`, `active_volume: 0`.
- **Classification — VERIFIED:** API and account data establish an open, unresolved, graduated secondary-phase market at the time checked. Current API state is time-sensitive.
- **Classification — VERIFIED secondary model:** Panta’s official [How It Works](https://www.panta.market/how-it-works) describes secondary trading as a peer-to-peer CLOB with public limit orders. Panta’s own deployed frontend bundle contains the secondary-order client and account decoder. This supports that `phase: secondary` and `secondary_active` are the secondary phase, not merely an inference from market activity.

The live catalog scan returned 93 markets: 2 primary, 88 resolved, and 3 secondary. Of those three, the other two did not have secondary-order transaction evidence: the Manchester United market’s observed transactions were primary orders, and the other candidate had no trade history or secondary order transaction. The GTA 6 market is selected because its on-chain account is active and its address has successful secondary-order transactions. Its API trade list was empty and its market counters were zero, so this verifies order placement/resting book activity, **not a matched fill**.

### Mainnet secondary-order transactions

All signatures below were fetched with finalized Solana mainnet RPC. Each transaction succeeded (`meta.err: null`), invokes the Panta program, and logs `Instruction: SecondaryLimitOrderUsdc`.

1. `3iLr6PXpd9ZeqsoWYzpX1GerGTvFzmRQnGB6z2HWGCwZ6ipUQKfuE53zqPuD4UtXT7zhVCFHJ4Ye876qrvFhaJ34` — 2026-09-15 16:33:05 UTC, slot 447296449. The instruction created user-position account `9XTvyrNA...`, order node `A4DWhq...` (269 bytes), and price level `Ckiw...` (218 bytes). Inner SPL transfers were 2,000,000 and 30,000 USDC base units. The created order account is now closed; a successful `CancelSecondaryOrderUsdc` transaction followed 10 seconds later and references that order (the full order key is available in that transaction’s account keys; this report does not abbreviate it as a verified address). This is placement then cancellation, not evidence of a fill.
2. `22bt5Y3hwuwLGoxmNpd5DNJNz7KTXzu629m5vAiy3haRpfKNRMT1N6kbkCkV5cZsGNcoYE4KRRdLvCieeSucNWnH` — 2026-08-13 20:08:42 UTC, slot 439084423. Created price-level account `4szX8wsKwDdsyoNTCtxkNbj27MHNWtDS1G2evmovwnZa` and order node `53N74j3Rrv1MNVFZWKsubJBfcxVp4QKu1qh9HHZwna2P`; both still exist.
3. `2buCfGcm9a9xaGqsu257VT78arUjkixbLXfK4XDGkQMUQ4bscgc1i7rogY8ZRGDCR4tnBgVfFydcjgXmqndmm2RT` — 2026-08-10 20:50:12 UTC, slot 438472825. Successful secondary order instruction; created order node `5uhJmF41VCWi9ckZUGwKLFYkQbc8RPZzz3pEGPfVZiR8` (269 bytes), which is no longer present in the account query. No reason for its absence is asserted.

**Classification — VERIFIED:** these are successful mainnet transactions for the same market and the exact secondary-order instruction. **UNKNOWN:** whether transactions 2 and 3 filled, were cancelled, or otherwise closed; their instructions prove order placement, not match execution. The most recent order was cancelled. The API currently reports no trades, zero volume, and zero total trades for this market.

### Program and account evidence

Panta’s public frontend JS chunk [`5217-4e9bf78d0b5a7a4b.js`](https://www.panta.market/_next/static/chunks/5217-4e9bf78d0b5a7a4b.js) embeds the Anchor IDL for program `6gM5...`, including the USDC variant’s `secondary_limit_order_usdc` and `cancel_secondary_order_usdc` instructions. Thus the deployed program identity and instruction name are verified by both transaction logs and Panta’s own client bundle. The IDL is not in the public Solana IDL registry, which returned 404; an official Panta-hosted IDL is nevertheless embedded in the frontend bundle.

The companion Panta frontend chunk [`1861-b4c810d324d8244f.js`](https://www.panta.market/_next/static/chunks/1861-b4c810d324d8244f.js) contains the CLOB traversal logic: fetch `PriceLevel` accounts, then traverse their linked `OrderNode`s. This is official client evidence for the account roles/layout, checked against raw mainnet account bytes and matching lengths/discriminators.

| Account | Address | Owner / size | Observed role and classification |
|---|---|---|---|
| Market / Event | `GXh9iztJTm5v6qDWnR4YcKHbSc3AUZ2VEMGfKEegd92V` | Panta program / 2,982 bytes | **VERIFIED:** same identifier as Panta market ID; account decodes as active, graduated, unresolved Event with the GTA 6 question. Passed in the secondary-order instruction. |
| Panta CLOB program | `6gM5afTQBq5VZCfgpGqcsqzfWd5maLSCKWtGjbEobZMp` | Executable program | **VERIFIED:** transaction instruction program; market account owner; official Panta IDL/client. |
| PriceLevel | `4szX8wsKwDdsyoNTCtxkNbj27MHNWtDS1G2evmovwnZa` | Panta program / 218 bytes | **VERIFIED:** IDL discriminator and fields match raw data; derived with documented client seed pattern; contains bid head/tail pointing to the live order node. |
| PriceLevel | `CkiwPYHChPapxmamdxxg1dMfK6ijKzko1q1Jvp2F4qJJ` | Panta program / 218 bytes | **VERIFIED:** second Event-associated price level; initialized, but both sides have zero quantity/count and empty head/tail. |
| OrderNode | `53N74j3Rrv1MNVFZWKsubJBfcxVp4QKu1qh9HHZwna2P` | Panta program / 269 bytes | **VERIFIED:** owner, Event, PriceLevel, amount, side, type, intent and linked-list pointers decode consistently with IDL and containing level. This is the sole non-empty node returned for this Event. |
| User-position | Account created by transaction 1; address not transcribed in these notes | Panta program / 202 bytes | **INFERRED:** user-specific position/state created by the latest order instruction, based on size and instruction context. It is not part of the current order book snapshot.

Across the three order-creation transactions, the market, program, USDC mint, and standard token/associated-token/system programs recur. The signer, source token account, user-position, and order node vary per order/user; the price-level PDA changes with the limit price. This is **VERIFIED** by transaction account lists and creation logs. The market-level Event and `PriceLevel` accounts are shared market/book state; `OrderNode` accounts are individual resting order state. Vault and settlement accounts are present among instruction accounts, but exact economic roles beyond the official IDL labels/context are not claimed here.

### Decoded RPC snapshot

Panta’s frontend IDL gives these account discriminators and layouts:

- `PriceLevel`: discriminator `ec6a5aa2bc29dbba`, 218 bytes. `is_initialized` at offset 8; Event pubkey at 9; `price_lamports` at 41; aggregate bid/ask amounts and counts; bid and ask head/tail node pubkeys.
- `OrderNode`: discriminator `dceb263f428c8af4`, 269 bytes. Owner at 9; Event at 41; PriceLevel at 73; amount at 105; original amount at 113; timestamp at 121; side at 129; type at 130; intent at 131; price at 132; order ID at 141; nonce at 149; previous/next pointers at 157/189; locked amounts at 221/237/253.
- Enum values from the embedded IDL: side `0=Yes`, `1=No`; type `0=Bid`, `1=Ask`; intent `0=Buy`, `1=Sell`.
- The frontend’s v2 USDC conversion uses six decimal places for token amounts. Level price is in lamports-per-share units with 1,000,000,000 representing 1.0 USDC/share.

Read-only `getProgramAccounts` by owner and `dataSize: 218`, memcmp Event bytes at offset 9, returned the two `PriceLevel` accounts above. A separate `dataSize: 269`, Event memcmp at offset 41, returned the one current order node. The decoded snapshot is:

| Side | Price | Size | Count | State |
|---|---:|---:|---:|---|
| YES bid | 1.0 USDC/share | 1.000000 share | 1 | `4szX...` points to `53N74...`; OrderNode amount and level aggregate both equal 1,000,000 base share units |
| YES ask | None present | 0 | 0 | Ask head/tail are default pubkeys; no ask level/order returned |
| Other level | 0.5 USDC/share | 0 | 0 | `Ckiw...` is initialized and empty |

**VERIFIED:** best resting YES bid in the queried snapshot is 1.0 USDC/share for 1 share; no ask is present in the returned levels, so no best ask can be quoted. This is an open limit order, **not** a last trade, current probability, or evidence of an executed trade. The market Event reports zero trades/volume, consistent with no verified fill. The data establishes the YES-side linked-list state; no separate evidence established a populated NO-side level.

The Panta frontend’s account filter uses memcmp offset 8 for `PriceLevel`, but its embedded IDL/raw bytes place `is_initialized` at offset 8 and Event at offset 9. The offset-8 Event query returned zero accounts; offset 9 returned the two expected accounts. This observed client/query mismatch is not silently corrected in the report. Panta’s client uses offset 41 for Event-filtered `OrderNode` queries, matching the IDL.

### Panta reconciliation and limits

Panta’s live market detail showed `secondaryVolume: 0` and null yes/no prices; the market trade endpoint returned no trade rows. The official frontend decoder and on-chain account bytes independently agree on one resting YES bid and no populated ask. The frontend references an indexer at `https://indexer.balr.fun`, but its live orderbook/orders endpoints returned HTTP 401 without authorization, so an authenticated UI/indexer snapshot could not be compared. No Panta indexer credential was obtained or bypassed.

- **VERIFIED:** Panta API says the market is active/secondary; mainnet has successful `SecondaryLimitOrderUsdc` placements; Panta’s own IDL/client plus RPC account bytes decode one YES bid and no ask.
- **INFERRED:** the two returned `PriceLevel`s constitute the complete current level set for this Event, based on the official client’s Event-filtered account traversal and the exact returned linked-list state. No independent authenticated indexer snapshot was available.
- **UNKNOWN:** no matched/fill transaction, fill event, or reliable trade reconstruction has been established for this market. No ask price exists in this snapshot. The reason the two older created order nodes are now absent is unknown. Current state may change after this check.

### Reproducible mainnet RPC queries

Use finalized mainnet RPC with the market address `GXh9...` and program `6gM5...`:

```json
{"jsonrpc":"2.0","id":1,"method":"getSignaturesForAddress","params":["GXh9iztJTm5v6qDWnR4YcKHbSc3AUZ2VEMGfKEegd92V",{"limit":100,"commitment":"finalized"}]}
```

```json
{"jsonrpc":"2.0","id":1,"method":"getTransaction","params":["22bt5Y3hwuwLGoxmNpd5DNJNz7KTXzu629m5vAiy3haRpfKNRMT1N6kbkCkV5cZsGNcoYE4KRRdLvCieeSucNWnH",{"encoding":"jsonParsed","maxSupportedTransactionVersion":0,"commitment":"finalized"}]}
```

```json
{"jsonrpc":"2.0","id":1,"method":"getProgramAccounts","params":["6gM5afTQBq5VZCfgpGqcsqzfWd5maLSCKWtGjbEobZMp",{"encoding":"base64","withContext":true,"filters":[{"dataSize":218},{"memcmp":{"offset":9,"bytes":"GXh9iztJTm5v6qDWnR4YcKHbSc3AUZ2VEMGfKEegd92V"}}]}]}
```

```json
{"jsonrpc":"2.0","id":1,"method":"getProgramAccounts","params":["6gM5afTQBq5VZCfgpGqcsqzfWd5maLSCKWtGjbEobZMp",{"encoding":"base64","withContext":true,"filters":[{"dataSize":269},{"memcmp":{"offset":41,"bytes":"GXh9iztJTm5v6qDWnR4YcKHbSc3AUZ2VEMGfKEegd92V"}}]}]}
```

PDA seed patterns verified against Panta’s embedded client/IDL and known addresses: `PriceLevel = ["level_usdc", Event pubkey, price_lamports u64 little-endian]`; `OrderNode = ["order_usdc", PriceLevel pubkey, user pubkey, client_nonce u64 little-endian]`. Derived addresses matched the RPC accounts for prices 1,000,000,000 and 500,000,000, and the order node for owner `G7PExRdwMk8UbbSM7nG42EvzA19jEQPVvKHBWU4DjXzE` and nonce `1786651726011952`. These derivations are verified against Panta’s public frontend and observed accounts, not guessed seeds.

### Result and next step

The order-book data path is established through the final price/size decoding step for a live active secondary market: Panta market → successful mainnet secondary-order instruction → Panta program → Event/PriceLevel/OrderNode accounts → one decoded resting YES bid. The stricter matched-trade/fill path is **not** established; there is no verified fill for this market and the ask side is empty. Before production integration, validate the decoder against a market with a populated bid and ask and a known executed fill, then reconcile that snapshot with Panta's authenticated indexer/UI. Keep this investigation read-only and production trading untouched.

## MIRA read-only adapter implementation and live verification

**Checked:** 2026-10-07. The implementation reuses MIRA's Panta market provider, normalized market types, Neon `market_snapshots`, market-detail panel, existing Groq context path, and existing trade preparation/execution flow. The CLOB reader is server-only and exposed through `GET /api/markets/[id]/orderbook`.

### Implemented architecture

- **Panta → Event mapping — VERIFIED:** uses the Panta API market ID as the Solana Event account key, requires the market to be active, secondary, graduated, unresolved, and requires the API program ID to match `6gM5...`. It validates Event ownership, discriminator, and on-chain lifecycle flags before enumerating books.
- **IDL/client source — VERIFIED:** account discriminators, Borsh offsets, enum values, six-decimal USDC share amounts, one-billion price scale, and `PriceLevel`/`OrderNode` PDA seed patterns are from Panta's deployed frontend chunks cited above. The implementation uses Event `memcmp` offset 9 for 218-byte PriceLevel accounts and offset 41 for 269-byte OrderNodes, matching the embedded IDL/raw account bytes. It does not use the frontend's observed mismatching PriceLevel offset-8 filter.
- **YES/NO — VERIFIED representation:** each order node has an explicit side enum (`0=Yes`, `1=No`) as well as bid/ask type. MIRA traverses each level's separate bid and ask linked lists and groups levels by the node outcome. An absent outcome/side stays empty; MIRA does not derive the other outcome's book.
- **Normalization — IMPLEMENTED:** price is a decimal USDC/share value; amount is remaining shares. Bid/ask levels are aggregated by price, sorted best-first, and depth is the sum of observed `price × shares` in USDC. Best prices, spread, and midpoint are deterministic; spread/midpoint remain null unless both sides exist. Midpoint is explicitly not a traded price.
- **Provenance and freshness — IMPLEMENTED:** each response includes `source: panta-solana`, `sourceLabel`, observation time, confirmed RPC slot, complete/partial/unavailable state, and live/recent/stale age. The 5-second process cache and 30-second MIRA snapshot cadence are server-side. No browser RPC polling occurs; the panel refreshes the server route every 15 seconds only for active secondary markets.
- **Snapshots — IMPLEMENTED:** migration `0002_panta_clob_snapshots.sql` extends the existing market snapshot table with on-chain slot, book status, best prices, and visible depth. Rows use `data_source='mira_observed'`, are deduplicated by market and slot, and are not represented as Panta historical records.
- **Activity — PARTIAL / IMPLEMENTED:** recent market signatures are fetched read-only and inspected for successful `SecondaryLimitOrderUsdc` and `CancelSecondaryOrderUsdc` instructions. These are labeled as order placed/cancelled, never as trades. A fill is considered only for the configured `OrderMatched` program event discriminator and a matching Event key; no such fill was observed in this live check. Activity-fetch completeness is separate from order-book completeness.
- **AI — IMPLEMENTED:** the server creates structured, unit-labeled CLOB facts and deterministic wording. The AI context receives those facts; explicit order-book questions are answered by the deterministic summary. Groq has no Solana client and cannot source book facts itself.
- **Trading — UNCHANGED:** the adapter is read-only. It does not prepare, quote, build, sign, submit, or verify trades. The pre-existing resolved-market and explicit wallet confirmation checks remain in the existing Panta trading path.

### Live read-only result

The check used the Panta Live key already present in the local environment and supplied `https://api.mainnet-beta.solana.com` as a one-command `SOLANA_RPC_URL` for this verification only. The RPC URL was not saved to application configuration. The adapter intentionally refuses to operate when the server-only `SOLANA_RPC_URL` is absent; `.env.example` now documents the required server-side setting.

At `2026-10-07T14:41:14.937Z`, Panta resolved `GXh9iztJTm5v6qDWnR4YcKHbSc3AUZ2VEMGfKEegd92V` as the active GTA 6 secondary market. Mainnet RPC returned slot `454252599`. MIRA decoded:

| Outcome | Bids | Asks | Best bid | Best ask | Spread | Visible bid depth | Visible ask depth |
|---|---|---|---:|---:|---:|---:|---:|
| YES | 1 level: 1 share at 1.00 USDC/share | None | 1.00 | None | None | 1.00 USDC | None |
| NO | None | None | None | None | None | None | None |

The snapshot was `complete`, with `source=panta-solana`, a populated `observedAt`, and the slot above. Panta API reference fields separately returned YES 0.50 and NO 0.50, with no provider update timestamp. These are not book prices and are not reconciled as executions. Two MIRA observations are now persisted and contain the same best bid; the chart can show those two discrete observed points, without candles or interpolated history. This is sparse MIRA-collected history, not a Panta historical feed. The UI labels the sides “No visible asks/bids” and never displays an absent side as a zero price.

The recent activity lookup returned successful placements and cancellations, including the September 15 placement followed by cancellation; it returned no verified matched trade. Transaction lookups were limited to six sequential RPC requests to avoid bursts against public RPC. No transaction was submitted. MIRA persisted the observations to the existing Neon table using `mira_observed` provenance.

### Verification status and remaining limits

- **VERIFIED:** active Panta market lookup and secondary classification; mainnet genesis validation; market/Event mapping and ownership; PriceLevel/OrderNode enumeration; one decoded YES bid with correct price and size; absent asks and absent NO levels; provenance, slot and observation time; market reference/book source separation; verified order placement/cancellation activity; snapshot persistence.
- **PARTIAL:** order enumeration is limited to the RPC-returned Event-filtered program-account set, and recent activity only scans a bounded set of signatures. This does not claim global CLOB/indexer parity.
- **UNKNOWN:** no authenticated Panta indexer comparison, no matched fill, no populated ask, and no independently verified price/size on a second market. Historical account lifecycle and completeness beyond the returned RPC state remain unverified.
- **REQUIRES CONFIGURATION:** production deployment must set server-only `SOLANA_RPC_URL` to a mainnet-compatible HTTPS RPC. No default RPC fallback is used. The frontend's existing `NEXT_PUBLIC_SOLANA_RPC_URL` remains solely for the pre-existing wallet client and is not read by the CLOB adapter.
- **TESTS/BUILD:** `npm test` passed 87 tests; `npm run typecheck`, `npm run lint`, `npm run build -- --webpack`, and `npm run db:migrate` passed after correcting the full mainnet genesis hash. No production trading behavior was changed.

## Phase 2 — Market Microstructure Intelligence

**Status:** implemented and live-verified on 2026-10-07. See the current read-only observation below; it is separate from the earlier Phase 1 verification.

### Snapshot architecture and deterministic calculations

- **VERIFIED (code path):** the existing server-only CLOB adapter remains the collector and continues to use the Panta market provider, Solana mainnet RPC validation, normalized `PriceLevel`/`OrderNode` books, and the existing `market_snapshots` table. No second history store or migration was added. A scheduler can call `POST /api/markets/collect-snapshots` using the server-only `SNAPSHOT_COLLECTOR_TOKEN`; it discovers active, graduated, unresolved secondary markets and reads them sequentially with a maximum batch size of 20.
- **VERIFIED (code path):** deduplication compares YES/NO best bid, best ask, sorted price-size levels, and visible depth with exact normalized numeric equality. Identical book states do not add rows even when the RPC slot changes. Changed rows keep their own capture timestamp, slot, Panta reference, book provenance, activity, and completeness status. Existing slot uniqueness remains a second guard.
- **VERIFIED (code path):** midpoint is `(bestBid + bestAsk) / 2`; spread is `bestAsk - bestBid`; spread bps is `spread / midpoint * 10000` only for nonzero midpoint. Missing sides produce null midpoint/spread/bps. Depth imbalance is `(bidDepth - askDepth) / (bidDepth + askDepth)` and is null at zero total depth.
- **VERIFIED (code path):** depth changes are current minus previous. Percentage change is null with status `not-comparable` when the previous depth is zero. Level additions/increases and decreases/removals are grouped by price and use neutral visible-liquidity language; they do not assert a cancellation.
- **VERIFIED (code path):** liquidity trend is insufficient with one observation, `changed`/`stable` with two, and is called increasing/decreasing only across at least three monotonic observations. Spread regime requires at least three available spread observations and compares the current spread to the historical median (below = tight, equal = normal, above = wide). These relative rules do not encode an absolute market threshold.
- **VERIFIED (code path):** two-sided books, bid-only, ask-only, and empty books are distinct. A one-sided book is separately classified and cannot become bid-heavy/ask-heavy. Directional depth labels require two-sided outcomes and a mean imbalance beyond ±0.1; this is book structure, never probability. Market-level `active` requires verified matched-trade evidence; unknown/order/cancel activity remains separate.
- **VERIFIED (code path):** snapshot history and microstructure routes query only rows with `data_source='mira_observed'`. Range filtering, interval selection, and max points select actual stored observations only. No generated timestamps, interpolated values, candles, or Panta historical series are inserted. Panta references and CLOB midpoint/bid/ask remain separately sourced.
- **VERIFIED (code path):** Groq receives the structured book and already-calculated microstructure facts for order-book/microstructure questions. Its system prompt forbids recalculation or treating a one-sided quote as a probability. Matched volume/trade count are populated only from the existing verified `OrderMatched` event decoder; other observed transactions remain order, cancellation, or unknown activity.

### One-sided-book acceptance case

- **VERIFIED (deterministic test):** with a YES best bid of `1.00`, no visible ask, and a separate Panta reference of `0.50`, the response says: “The visible YES book is one-sided: a 1.00 USDC bid is present, but no ask is currently visible. Panta's reference price is 50¢. Because there is no two-sided quote, the 1.00 bid should not be treated as a reliable market probability.” The summary does not call YES a 100% price.
- **INFERRED:** any meaning assigned to an imbalance, trend, or state is a description of the decoded visible book only. It does not imply participant intent, execution, fair value, or future probability movement.
- **VERIFIED:** the fresh live orderbook endpoint returned a complete one-sided YES book and the microstructure endpoint classified it as `one-sided-book`. The observed state matches the cautious interpretation below. Previous persisted rows remain separately labeled `MIRA-observed`.

### History and activity limitations

- **VERIFIED:** the panel supports 1H, 6H, 1D, 1W, and ALL from MIRA observations. Empty ranges say there are no observations in the selected range; a single point is rendered as an empty-history message; multiple points are plotted at their real elapsed-time positions with gaps left empty. Current live state is not mislabeled as persisted history.
- **VERIFIED:** snapshot deduplication intentionally means unchanged books do not create heartbeat points. Sparse history is therefore expected; liquidity trends and spread regimes stay unavailable/insufficient until their stated observation requirements are met.
- **UNKNOWN:** the existing bounded recent-signature scan cannot establish a complete lifetime trade tape. No fill is inferred from a placement instruction or visible size reduction. `matchedVolume` is a sum of explicitly verified matched-event notional in the current verified activity set, not an all-time volume series.

### Safety and verification

- **VERIFIED (implementation review):** the collector is authenticated and server-only; Panta, Solana, Neon, Groq, and Tavily credentials remain server-side. No wallet signing or trade route was changed. The established quote → build → explicit confirmation → wallet signing → submit → verify flow remains the only execution route; microstructure does not authorize a trade.
- **VERIFIED:** no private key or seed-phrase storage was added. The browser bundle audit found no server credential identifiers or configured server credential values in 43 emitted browser JavaScript bundles. The public wallet RPC environment variable remains distinct from server-only `SOLANA_RPC_URL`.

### Phase 2 live read-only verification

**Checked:** 2026-10-07 using Panta Live metadata, finalized/confirmed Solana mainnet reads, the existing Neon database, and MIRA's built API routes. The RPC URL was supplied only to the verification process; no RPC credential was added to client configuration. No transaction was submitted.

- **Panta — VERIFIED with provider-field inconsistency:** the fresh lookup confirmed the GTA 6 market ID `GXh9iztJTm5v6qDWnR4YcKHbSc3AUZ2VEMGfKEegd92V`, active secondary phase, graduated, unresolved, and the verified Panta program ID. One response returned the full question and YES/NO references of 50¢; a later fresh detail response returned `Market title unavailable` and null references. MIRA uses the latest response as-is and does not backfill a current reference from older data.
- **Solana/CLOB — VERIFIED:** latest read returned slot `454271057`, complete book data, one YES bid at `1.00 USDC` for 1 share, no YES ask, no NO bids or asks, YES bid depth `1.00 USDC`, and zero visible NO depth. No current midpoint or spread exists because there is no two-sided quote.
- **One-sided interpretation — VERIFIED:** live microstructure returned YES `bid-only`, NO `empty`, imbalance `1.0` for YES (a visible depth ratio, not a probability), and `marketState=one-sided-book`. With the latest missing Panta reference, the current explanation reports that reference as unavailable. The persisted history and chart separately show that MIRA's two earlier observations recorded Panta YES/NO references at 50¢.
- **Snapshots/Neon — VERIFIED:** the snapshots endpoint returned exactly two persisted observations, slots `454252127` (partial) and `454252599` (complete), both MIRA-observed. The latest visible levels were unchanged, so the fresh read was not added as a duplicate heartbeat observation. The Neon integration test also inserted an initial CLOB state, proved an identical state was deduplicated, and proved a changed visible size was persisted as a second actual observation.
- **Microstructure — VERIFIED:** against the two persisted observations plus the current live observation, YES midpoint/spread/spread bps are null; YES depth is `1.00 / 0.00 USDC`, imbalance `1.0`, and book state bid-only. NO state is empty. Total depth change is zero from the prior observed state; three actual observations with identical depth classify liquidity as stable. History remains labeled sparse because only two snapshots are persisted.
- **Chart/API — VERIFIED:** `GET /api/markets/[id]/snapshots?range=all&maxPoints=10` returned the two actual Neon rows with their original timestamps, slots, `MIRA-observed` provenance, and stored 50¢ references. `GET /api/markets/[id]/microstructure` returned the current live calculation with `current-live` provenance and separately identified the two saved history points. No interpolated points were returned.
- **Activity — VERIFIED within bounded scan:** latest live read found three order placement instructions and three cancellation instructions in the six-signature scan, with zero verified matched trades and unavailable matched volume. Activity status is mixed; no trade tape or synthetic fills were created.
- **Commands — VERIFIED:** `npm test` passed 99/99; `npm run typecheck`, `npm run lint`, `npm run build -- --webpack`, and `npm run db:migrate` exited successfully. The migration command found no new schema requirement. Browser secret audit passed across 43 bundles; four configured server-secret values were checked without logging them.
- **Trade safety — VERIFIED:** only snapshot, read, and persistence paths were exercised. The trade quote/build/confirmation/sign/submit/verify flow was not changed or invoked.
