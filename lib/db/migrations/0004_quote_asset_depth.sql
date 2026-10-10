ALTER TABLE market_snapshots
  ADD COLUMN IF NOT EXISTS quote_asset text,
  ADD COLUMN IF NOT EXISTS quote_asset_status text,
  ADD COLUMN IF NOT EXISTS yes_bid_depth_quote double precision,
  ADD COLUMN IF NOT EXISTS yes_ask_depth_quote double precision,
  ADD COLUMN IF NOT EXISTS no_bid_depth_quote double precision,
  ADD COLUMN IF NOT EXISTS no_ask_depth_quote double precision;
