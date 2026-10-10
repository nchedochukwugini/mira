CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user','assistant','system','tool')), content text NOT NULL,
  metadata jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS conversation_state (
  conversation_id uuid PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
  state jsonb NOT NULL DEFAULT '{}'::jsonb, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS markets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), provider text NOT NULL, provider_market_id text NOT NULL,
  title text NOT NULL, description text, status text, phase text, categories jsonb,
  start_time timestamptz, end_time timestamptz, resolution_time timestamptz,
  latest_yes_probability double precision, latest_no_probability double precision, latest_volume_usdc double precision,
  raw_metadata jsonb, first_seen_at timestamptz NOT NULL DEFAULT now(), last_seen_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider, provider_market_id)
);
CREATE TABLE IF NOT EXISTS market_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), market_id uuid NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  captured_at timestamptz NOT NULL DEFAULT now(), yes_probability double precision, no_probability double precision,
  volume_usdc double precision, status text, raw_data jsonb
);
CREATE TABLE IF NOT EXISTS research_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
  market_id uuid REFERENCES markets(id) ON DELETE SET NULL, question text NOT NULL, status text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz, freshness text,
  source_count integer NOT NULL DEFAULT 0, evidence_count integer NOT NULL DEFAULT 0,
  assessment jsonb, model text, metadata jsonb
);
CREATE TABLE IF NOT EXISTS sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), url text NOT NULL UNIQUE, title text, publisher text, domain text,
  published_at timestamptz, retrieved_at timestamptz NOT NULL DEFAULT now(), content_hash text UNIQUE, metadata jsonb
);
CREATE TABLE IF NOT EXISTS evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), research_run_id uuid NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
  source_id uuid NOT NULL REFERENCES sources(id) ON DELETE CASCADE, evidence_key text NOT NULL, claim text NOT NULL,
  direction text CHECK (direction IN ('supports_yes','supports_no','neutral','mixed')), relevance text, reliability text,
  published_at timestamptz, retrieved_at timestamptz, excerpt text, metadata jsonb, UNIQUE(research_run_id,evidence_key)
);
CREATE TABLE IF NOT EXISTS related_markets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), market_id uuid NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  related_market_id uuid NOT NULL REFERENCES markets(id) ON DELETE CASCADE, relationship_type text NOT NULL,
  confidence double precision, created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (market_id <> related_market_id), UNIQUE(market_id,related_market_id,relationship_type)
);
CREATE TABLE IF NOT EXISTS trade_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
  market_id uuid REFERENCES markets(id) ON DELETE SET NULL, side text, amount_usdc numeric, status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), metadata jsonb
);
CREATE TABLE IF NOT EXISTS trade_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), trade_intent_id uuid NOT NULL REFERENCES trade_intents(id) ON DELETE CASCADE,
  market_id uuid NOT NULL REFERENCES markets(id) ON DELETE CASCADE, side text NOT NULL, amount_usdc numeric NOT NULL,
  estimated_shares numeric, average_price numeric, fee_usdc numeric, slippage_bps numeric, expires_at timestamptz,
  status text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), metadata jsonb
);
CREATE TABLE IF NOT EXISTS transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), trade_ticket_id uuid REFERENCES trade_tickets(id) ON DELETE SET NULL,
  provider text NOT NULL, provider_transaction_id text, wallet_address text, status text NOT NULL,
  submitted_at timestamptz, confirmed_at timestamptz, error_message text, metadata jsonb
);

CREATE INDEX IF NOT EXISTS conversations_updated_at_idx ON conversations(updated_at DESC);
CREATE INDEX IF NOT EXISTS messages_conversation_created_idx ON messages(conversation_id,created_at);
CREATE INDEX IF NOT EXISTS markets_provider_market_idx ON markets(provider,provider_market_id);
CREATE INDEX IF NOT EXISTS markets_last_seen_idx ON markets(last_seen_at DESC);
CREATE INDEX IF NOT EXISTS snapshots_market_captured_idx ON market_snapshots(market_id,captured_at DESC);
CREATE INDEX IF NOT EXISTS research_market_started_idx ON research_runs(market_id,started_at DESC);
CREATE INDEX IF NOT EXISTS research_conversation_started_idx ON research_runs(conversation_id,started_at DESC);
CREATE INDEX IF NOT EXISTS sources_hash_idx ON sources(content_hash);
CREATE INDEX IF NOT EXISTS evidence_run_idx ON evidence(research_run_id);
CREATE INDEX IF NOT EXISTS related_market_idx ON related_markets(market_id);
CREATE INDEX IF NOT EXISTS trade_intents_conversation_idx ON trade_intents(conversation_id);
CREATE INDEX IF NOT EXISTS transactions_provider_id_idx ON transactions(provider_transaction_id);
