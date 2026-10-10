CREATE TABLE IF NOT EXISTS panta_trade_scans (
  market_id uuid PRIMARY KEY REFERENCES markets(id) ON DELETE CASCADE,
  event_pda text NOT NULL,
  newest_signature text,
  newest_slot bigint,
  backfill_signature text,
  initial_scan_complete boolean NOT NULL DEFAULT false,
  last_success_at timestamptz,
  last_error text,
  unresolved_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS panta_pending_transactions (
  signature text NOT NULL,
  market_id uuid NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  event_pda text NOT NULL,
  slot bigint NOT NULL,
  block_time timestamptz,
  status text NOT NULL DEFAULT 'discovered' CHECK (status IN ('discovered','unavailable','fetched','decoded','no_match','matched','permanent_failure')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  discovered_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(signature, market_id)
);
CREATE INDEX IF NOT EXISTS panta_pending_due_idx ON panta_pending_transactions(next_attempt_at, discovered_at) WHERE status IN ('discovered','unavailable','fetched');

CREATE TABLE IF NOT EXISTS panta_matched_fills (
  id bigserial PRIMARY KEY,
  market_id uuid NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  event_pda text NOT NULL,
  signature text NOT NULL,
  event_index integer NOT NULL,
  slot bigint NOT NULL,
  block_time timestamptz,
  outcome text NOT NULL CHECK (outcome IN ('YES','NO')),
  price double precision NOT NULL CHECK (price > 0 AND price <= 1),
  share_quantity double precision NOT NULL CHECK (share_quantity > 0),
  usdc_value double precision,
  decoder_version text NOT NULL,
  verification_status text NOT NULL CHECK (verification_status = 'matched-event-verified'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(market_id,signature,event_index)
);
CREATE INDEX IF NOT EXISTS panta_fills_market_time_idx ON panta_matched_fills(market_id,block_time DESC,slot DESC,event_index DESC);

CREATE TABLE IF NOT EXISTS panta_market_alerts (
  id bigserial PRIMARY KEY,
  market_id uuid NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  alert_key text NOT NULL,
  condition text NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT now(),
  evidence jsonb NOT NULL,
  source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(market_id,alert_key)
);
