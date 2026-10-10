# MIRA — AI Market Intelligence

Understand prediction markets. Investigate the evidence. Make better-informed decisions.

MIRA is an AI-powered prediction-market intelligence workspace built with Next.js, TypeScript, Panta market data, and Solana infrastructure.

It brings market discovery, natural-language analysis, web research, evidence evaluation, on-chain order-book observations, and wallet-aware trade preparation into one workspace.

MIRA is designed to help users understand what a market is asking, what the available evidence supports, what remains uncertain, and what data is still missing.

> Data integrity comes first. MIRA distinguishes provider data, retrieved research, observed on-chain activity, analytical inference, and unavailable information. It does not intentionally replace missing live data with demonstration fixtures.

## What MIRA does

### AI market intelligence

- Ask questions about prediction markets using natural language.
- Discover relevant markets through the configured market provider.
- Examine market context and available YES/NO information.
- Generate structured analysis using provider data and available evidence.
- Use server-side Groq inference when configured.
- Retain deterministic analysis capabilities when the AI provider is unavailable, with limitations made explicit.

### Research and evidence

- Search for relevant web sources through Tavily.
- Retrieve source content where supported.
- Extract and evaluate evidence relevant to a research question.
- Separate evidence from analytical inference.
- Generate research reports with source references and uncertainty.
- Reject invalid evidence citations rather than silently accepting unsupported references.

Research quality depends on source availability, freshness, relevance, and coverage. A successful search does not guarantee a reliable directional conclusion.

### Live market data

MIRA uses a provider abstraction to separate market-data access from the intelligence and user-interface layers.

- Panta is the production market provider.
- Market discovery and detail views use the configured provider.
- Missing fields remain unavailable rather than being filled with invented values.
- Provider errors and insufficient-data states are surfaced explicitly.
- Demo fixtures are available only through an explicit local-development configuration and are not presented as tradable production quotes.

### Solana order-book observations

For supported and verified Panta secondary markets, MIRA can read on-chain order-book state through its server-side Solana adapter.

Available capabilities include:

- Normalized YES/NO bids and asks.
- Persisted market observations and capture timestamps.
- Historical snapshot queries without interpolating missing observations.
- Spread, midpoint, visible depth, imbalance, and liquidity-change analysis.
- Separation of order placement, cancellation, observed liquidity changes, and verified matched-trade evidence.

An order appearing on-chain is not, by itself, proof that a trade matched. One-sided liquidity is not automatically a market probability, and an observed book is not necessarily a complete view of executable liquidity.

### Wallet and trade safety

MIRA's trade workflow is designed around explicit user authorization.

- Request a quote and prepare an unsigned transaction.
- Validate the prepared transaction against the quote and supported instruction rules.
- Present the prepared transaction for explicit wallet confirmation.
- Verify uncertain broadcast outcomes rather than automatically resubmitting them.

MIRA does not need a user's private key or seed phrase on its server. Connecting a wallet, signing, broadcasting, and moving funds are separate actions.

Live trading should not be considered production-verified until the complete transaction lifecycle has been tested against the intended network and provider.

## How MIRA works

```text
Market discovery
       |
       v
Configured market provider
       |
       v
Market context and available data
       |
       +----------------------+
       |                      |
       v                      v
AI market analysis       Web research
       |                      |
       |                 Tavily retrieval
       |                      |
       |                 Evidence screening
       |                      |
       +-----------+----------+
                   |
                   v
          Evidence-based synthesis
                   |
                   v
       Findings, uncertainty and sources
```

On-chain order-book observations and wallet transaction preparation are separate server-side workflows. They are not substitutes for market-provider reference prices or research evidence.

## Intelligence and provider boundaries

| Component | Responsibility |
| --- | --- |
| Panta adapter | Market data and supported provider operations |
| AI layer | Natural-language understanding and model-assisted synthesis |
| Deterministic intelligence | Structured analysis and fallback behavior |
| Tavily integration | Web search and source discovery |
| Evidence layer | Evidence extraction, relevance checks and citation validation |
| Solana adapter | Supported on-chain reads and transaction-related operations |
| Neon PostgreSQL | Optional persistence for conversations, research and observations |
| Next.js application | User interface and server-side API routes |

Groq is the configured AI provider described by the current implementation. Tavily supplies research retrieval, not the final analytical conclusion. When model inference is unavailable, deterministic fallback behavior must not be represented as model-generated reasoning.

## Technology stack

- Application: Next.js and TypeScript
- AI inference: Groq
- Web research: Tavily
- Market data: Panta API
- Blockchain: Solana
- Database: Neon PostgreSQL
- Styling and UI: React-based application components
- Deployment target: Vercel

## Getting started

### Requirements

- Node.js and npm compatible with the project dependencies.
- A Panta API key for live market data.
- A Groq API key for model-assisted language understanding and synthesis.
- A Tavily API key for live web research.
- A Neon PostgreSQL database if persistent history and research storage are required.
- An HTTPS Solana RPC endpoint for supported on-chain reads.

Some functionality is optional. The availability of individual features depends on the configured providers and credentials.

### 1. Install dependencies

```sh
git clone <YOUR_GITHUB_REPOSITORY_URL>
cd MIRA
npm install
```

After creating a GitHub repository, use its clone URL here. No remote repository is configured by this project yet.

### 2. Configure environment variables

Create a local environment file:

```sh
cp .env.example .env.local
```

Populate it with the appropriate credentials and configuration. Do not commit `.env.local`.

The application reads the following variables. Only `PANTA_API_KEY` is needed for live Panta market data. AI analysis, web research, persistence, on-chain reads, scheduled snapshot collection, and wallet network selection depend on their respective optional settings. Without an optional provider, its dependent capability may be unavailable or use the explicitly limited deterministic fallback.

| Variable | Purpose |
| --- | --- |
| `PANTA_API_KEY` | Server-side Panta API access |
| `PANTA_API_BASE_URL` | Optional Panta API endpoint override; defaults to `https://live-api.panta.market/api/v1`. `PANTA_API_URL` is also accepted as an alias. |
| `GROQ_API_KEY` | Optional server-side model inference; without it, explicit deterministic fallback paths are used. |
| `GROQ_MODEL` | Optional model override; defaults to `openai/gpt-oss-120b`. |
| `TAVILY_API_KEY` | Optional live web research provider. |
| `DATABASE_URL` | Optional PostgreSQL connection string for persistence and migrations. |
| `SOLANA_RPC_URL` | Optional server-side RPC endpoint for supported on-chain reads and trade workflows. |
| `NEXT_PUBLIC_MARKET_PROVIDER` | Optional market provider selection; `demo` enables local demo fixtures, while live Panta requires `PANTA_API_KEY`. |
| `NEXT_PUBLIC_SOLANA_CLUSTER` | Optional public wallet-network setting; Panta Live uses `mainnet-beta`, and Panta Test uses `devnet`. |
| `NEXT_PUBLIC_SOLANA_RPC_URL` | Optional browser-visible wallet RPC endpoint. Treat its value as public. |
| `SNAPSHOT_COLLECTOR_TOKEN` | Optional server-side bearer token for scheduled snapshot collection; required to authorize the collection route when configured. |

Use `.env.example` as the source of truth for the current configuration schema. Its credential entries are placeholders. Do not put credentials in `NEXT_PUBLIC_` variables: values with that prefix can be exposed to browser clients.

### 3. Configure the database

For persistent conversation and research history, configure `DATABASE_URL` with your Neon PostgreSQL connection string.

Apply the checked-in migrations:

```sh
npm run db:migrate
```

Confirm that the migration completes successfully before starting workflows that depend on database persistence.

### 4. Start the development server

```sh
npm run dev
```

Open:

```text
http://localhost:3000
```

## Verification

Run the checks defined by the project:

```sh
npm test
npm run typecheck
npm run lint
npm run build -- --webpack
```

The webpack build command is included for environments where the project's existing Next.js setup requires it.

For changes involving persistence, also run:

```sh
npm run db:migrate
```

Database migration commands should be used against the intended environment only after reviewing the migration and confirming the connection string.

Record the results of the latest test run, production build, provider smoke tests, and database checks when publishing a release. Historical results are not proof that external providers remain available or that live trading works.

## Security

- Keep all server credentials out of source control.
- Never expose server API keys through browser-visible environment variables.
- Never send wallet private keys or seed phrases to the application server.
- Keep RPC provider secrets server-side.
- Use authentication and authorization for any externally accessible scheduled collection endpoint.
- Treat retrieved web content as untrusted input.
- Validate evidence references before incorporating them into a research report.
- Do not automatically retry uncertain transaction submissions without first checking their status.

Before publishing, inspect the Git staging area and verify that no local environment files, credentials, private keys, database dumps, or personal development artifacts are included.

## Current limitations

- AI analysis and research synthesis depend on the configured model provider; deterministic fallbacks are not equivalent to model reasoning.
- Research findings depend on the evidence that can actually be retrieved and evaluated.
- Related-market relationships are shown only when supplied by the active provider or explicitly identified as demonstration data.
- Solana RPC vendor failover is not implemented in the documented adapter.
- Persisted order-book observations represent captured states, not a guarantee of complete market depth or future execution.
- Wallet signing and the complete live transaction lifecycle require separate end-to-end verification.
- Positions, P&L, claims, and other provider operations must be treated as unavailable when their required data or functionality is not returned or supported.
- Market creation and some creator-fee and claim workflows are not exposed as active controls.

## Project structure

```text
app/                  Next.js pages and API routes
components/           UI, AI workspace, markets, charts and wallet
lib/ai/               Server-side AI provider and language layer
lib/intelligence/     Deterministic market and conversation analysis
lib/research/         Research retrieval, evidence and synthesis
lib/db/               Database client and SQL migrations
lib/panta/            Panta types and API adapter
lib/providers/        Provider interfaces and implementations
lib/wallet/           Solana wallet integration
lib/mock/             Explicit demonstration fixtures
docs/                 Project documentation
research/             Research and investigation notes
scripts/              Development and verification scripts
```

## Project principles

1. Evidence over invention. Missing information stays missing.
2. Facts before inference. Analytical conclusions should be distinguishable from observed data.
3. Source transparency. Research should preserve source references and available timestamps.
4. Explicit uncertainty. Insufficient evidence should produce an appropriately limited conclusion.
5. Provider isolation. External services should remain behind clear interfaces.
6. User authorization. Trade preparation must remain separate from wallet approval and transaction submission.

---

MIRA is being developed as a market-intelligence workspace where research, market data, and transaction operations remain distinct and auditable. Its goal is to make the evidence behind a market assessment easier to inspect—not to promise certainty about market outcomes.
