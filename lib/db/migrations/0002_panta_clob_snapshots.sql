ALTER TABLE market_snapshots
  ADD COLUMN IF NOT EXISTS data_source text NOT NULL DEFAULT 'panta',
  ADD COLUMN IF NOT EXISTS solana_slot bigint,
  ADD COLUMN IF NOT EXISTS order_book_status text,
  ADD COLUMN IF NOT EXISTS yes_best_bid double precision,
  ADD COLUMN IF NOT EXISTS yes_best_ask double precision,
  ADD COLUMN IF NOT EXISTS no_best_bid double precision,
  ADD COLUMN IF NOT EXISTS no_best_ask double precision,
  ADD COLUMN IF NOT EXISTS yes_bid_depth_usdc double precision,
  ADD COLUMN IF NOT EXISTS yes_ask_depth_usdc double precision,
  ADD COLUMN IF NOT EXISTS no_bid_depth_usdc double precision,
  ADD COLUMN IF NOT EXISTS no_ask_depth_usdc double precision;

CREATE INDEX IF NOT EXISTS market_clob_snapshots_idx
  ON market_snapshots(market_id, captured_at DESC)
  WHERE data_source = 'mira_observed';

CREATE UNIQUE INDEX IF NOT EXISTS market_clob_snapshot_slot_idx
  ON market_snapshots(market_id, solana_slot)
  WHERE data_source = 'mira_observed' AND solana_slot IS NOT NULL;
