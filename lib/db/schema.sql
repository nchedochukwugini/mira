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
  volume_usdc double precision, status text, raw_data jsonb,
  data_source text NOT NULL DEFAULT 'panta', solana_slot bigint, order_book_status text,
  yes_best_bid double precision, yes_best_ask double precision, no_best_bid double precision, no_best_ask double precision,
  yes_bid_depth_usdc double precision, yes_ask_depth_usdc double precision,
  no_bid_depth_usdc double precision, no_ask_depth_usdc double precision,
  quote_asset text, quote_asset_status text,
  yes_bid_depth_quote double precision, yes_ask_depth_quote double precision,
  no_bid_depth_quote double precision, no_ask_depth_quote double precision
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
CREATE TABLE IF NOT EXISTS secondary_operations (
  id uuid PRIMARY KEY, operation_type text NOT NULL CHECK(operation_type IN ('placement','cancellation')),
  market_id text NOT NULL, wallet_address text NOT NULL, cluster text NOT NULL,
  side text, price_units numeric, share_units numeric, buy boolean, target_order text,
  recent_blockhash text NOT NULL, last_valid_block_height bigint NOT NULL,
  expected_message_base64 text NOT NULL, expected_instructions jsonb NOT NULL,
  maker_accounts jsonb NOT NULL DEFAULT '[]'::jsonb, snapshot_slot bigint NOT NULL,
  expires_at timestamptz NOT NULL, status text NOT NULL DEFAULT 'built', signature text UNIQUE,
  chain_result jsonb, notification_status text NOT NULL DEFAULT 'not_applicable', notification_attempted_at timestamptz,
  reconciliation_status text NOT NULL DEFAULT 'pending', reconciled_order jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS panta_trade_scans (
  market_id uuid PRIMARY KEY REFERENCES markets(id) ON DELETE CASCADE,
  event_pda text NOT NULL, newest_signature text, newest_slot bigint, backfill_signature text, initial_scan_complete boolean NOT NULL DEFAULT false,
  last_success_at timestamptz, last_error text, unresolved_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS panta_pending_transactions (
  signature text NOT NULL, market_id uuid NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  event_pda text NOT NULL, slot bigint NOT NULL, block_time timestamptz,
  status text NOT NULL DEFAULT 'discovered', attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(), last_error text,
  discovered_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(signature,market_id)
);
CREATE TABLE IF NOT EXISTS panta_matched_fills (
  id bigserial PRIMARY KEY, market_id uuid NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  event_pda text NOT NULL, signature text NOT NULL, event_index integer NOT NULL,
  slot bigint NOT NULL, block_time timestamptz, outcome text NOT NULL CHECK (outcome IN ('YES','NO')),
  price double precision NOT NULL CHECK (price > 0 AND price <= 1),
  share_quantity double precision NOT NULL CHECK (share_quantity > 0), usdc_value double precision,
  quote_asset_status text NOT NULL DEFAULT 'unknown' CHECK (quote_asset_status IN ('verified','unknown','unsupported')),
  quote_mint text, quote_symbol text, quote_decimals smallint CHECK (quote_decimals IS NULL OR (quote_decimals >= 0 AND quote_decimals <= 18)),
  quote_network text, quote_source text, quote_asset_reason text,
  price_units numeric(20,0), share_quantity_units numeric(20,0), price_scale numeric(20,0), share_quantity_scale numeric(20,0),
  quote_notional numeric(50,15), quote_notional_mint text,
  quote_notional_status text NOT NULL DEFAULT 'unavailable' CHECK (quote_notional_status IN ('calculated','unavailable','unverified')),
  decoder_version text NOT NULL, verification_status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(market_id,signature,event_index)
);
CREATE TABLE IF NOT EXISTS panta_market_alerts (
  id bigserial PRIMARY KEY, market_id uuid NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  alert_key text NOT NULL, condition text NOT NULL, observed_at timestamptz NOT NULL DEFAULT now(),
  evidence jsonb NOT NULL, source text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(market_id,alert_key)
);

CREATE INDEX IF NOT EXISTS conversations_updated_at_idx ON conversations(updated_at DESC);
CREATE INDEX IF NOT EXISTS messages_conversation_created_idx ON messages(conversation_id,created_at);
CREATE INDEX IF NOT EXISTS markets_provider_market_idx ON markets(provider,provider_market_id);
CREATE INDEX IF NOT EXISTS markets_last_seen_idx ON markets(last_seen_at DESC);
CREATE INDEX IF NOT EXISTS snapshots_market_captured_idx ON market_snapshots(market_id,captured_at DESC);
CREATE INDEX IF NOT EXISTS market_clob_snapshots_idx ON market_snapshots(market_id,captured_at DESC) WHERE data_source='mira_observed';
CREATE UNIQUE INDEX IF NOT EXISTS market_clob_snapshot_slot_idx ON market_snapshots(market_id,solana_slot) WHERE data_source='mira_observed' AND solana_slot IS NOT NULL;
CREATE INDEX IF NOT EXISTS panta_pending_due_idx ON panta_pending_transactions(next_attempt_at,discovered_at) WHERE status IN ('discovered','unavailable','fetched');
CREATE INDEX IF NOT EXISTS panta_fills_market_time_idx ON panta_matched_fills(market_id,block_time DESC,slot DESC,event_index DESC);
CREATE INDEX IF NOT EXISTS panta_fills_quote_mint_time_idx ON panta_matched_fills(market_id,quote_mint,block_time DESC) WHERE quote_asset_status='verified';
CREATE INDEX IF NOT EXISTS research_market_started_idx ON research_runs(market_id,started_at DESC);
CREATE INDEX IF NOT EXISTS research_conversation_started_idx ON research_runs(conversation_id,started_at DESC);
CREATE INDEX IF NOT EXISTS sources_hash_idx ON sources(content_hash);
CREATE INDEX IF NOT EXISTS evidence_run_idx ON evidence(research_run_id);
CREATE INDEX IF NOT EXISTS related_market_idx ON related_markets(market_id);
CREATE INDEX IF NOT EXISTS trade_intents_conversation_idx ON trade_intents(conversation_id);
CREATE INDEX IF NOT EXISTS transactions_provider_id_idx ON transactions(provider_transaction_id);
